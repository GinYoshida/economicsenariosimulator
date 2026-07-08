"use client";

import { useMemo, useState } from "react";

import BacktestPanel from "@/app/components/BacktestPanel";
import DecompositionChart, {
  type Contribution,
} from "@/app/components/DecompositionChart";
import DriverSliders, {
  type DriverSliderSpec,
} from "@/app/components/DriverSliders";
import FitScatter from "@/app/components/FitScatter";
import ForecastChart, { type ForecastRow } from "@/app/components/ForecastChart";
import ModelExplanation from "@/app/components/ModelExplanation";
import SourcePanel from "@/app/components/SourcePanel";
import SourceTables from "@/app/components/SourceTables";
import {
  toScenarioModel,
  type Backtest,
  type Baseline,
  type Coefficients,
  type SeriesFile,
  type SourceMeta,
} from "@/app/lib/artifacts";
import {
  applyOverrides,
  buildPaths,
  driverClass,
  type Preset,
} from "@/app/lib/presets";
import { computeForecast, decompose } from "@/app/lib/scenario";
import { narrate } from "@/app/lib/narrate";

const MONTHS = 12;
const PRESET_LABELS: Record<Preset, string> = {
  optimistic: "楽観",
  base: "標準",
  pessimistic: "悲観",
};

type Tab = "scenario" | "model" | "data";
const TAB_LABELS: Record<Tab, string> = {
  scenario: "シナリオ",
  model: "モデル解説",
  data: "データソース",
};

const SLIDER_BY_CLASS: Record<
  ReturnType<typeof driverClass>,
  { min: number; max: number; step: number; unit: string }
> = {
  sentiment: { min: -10, max: 10, step: 1, unit: "pt" },
  cost: { min: -0.1, max: 0.1, step: 0.005, unit: "" },
  rate: { min: -0.5, max: 0.5, step: 0.05, unit: "%" },
};

function addMonths(isoDate: string, n: number): string {
  const [y, m] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

function pctLabel(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function Dashboard({
  coefficients,
  baseline,
  backtest,
  sources,
  series = null,
}: {
  coefficients: Coefficients;
  baseline: Baseline;
  backtest: Backtest;
  sources: SourceMeta[];
  series?: SeriesFile | null;
}) {
  const categories = coefficients.categories;
  const driverIds = useMemo(
    () =>
      Array.from(
        new Set(categories.flatMap((c) => c.drivers.map((d) => d.driver))),
      ),
    [categories],
  );
  const labelOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories)
      for (const d of c.drivers) m[d.driver] = d.label_ja;
    return m;
  }, [categories]);

  const models = useMemo(() => {
    const m: Record<string, ReturnType<typeof toScenarioModel>> = {};
    for (const c of categories) m[c.category] = toScenarioModel(c);
    return m;
  }, [categories]);

  // 全ドライバーがラグ付き（≥1）なので、フラットなシナリオ水準を全月に効かせる
  // ため maxLag ぶん先頭をパディングし、計算後に切り落とす。
  const maxLag = useMemo(
    () =>
      Math.max(
        0,
        ...categories.flatMap((c) => c.drivers.map((d) => d.lag_months)),
      ),
    [categories],
  );
  const total = MONTHS + maxLag;

  const [tab, setTab] = useState<Tab>("scenario");
  const [preset, setPreset] = useState<Preset>("base");
  const [paths, setPaths] = useState(() => buildPaths(driverIds, total, "base"));
  const [activeCat, setActiveCat] = useState(categories[0]?.category ?? "food");
  const [showMA, setShowMA] = useState(false);

  function selectPreset(p: Preset) {
    setPreset(p);
    setPaths(buildPaths(driverIds, total, p));
  }
  function onSlider(id: string, value: number) {
    setPaths((prev) =>
      applyOverrides(prev, { [id]: Array.from({ length: total }, () => value) }),
    );
  }

  const foodFc = models.food
    ? computeForecast(models.food, paths, total).slice(maxLag)
    : [];
  const clothingFc = models.clothing
    ? computeForecast(models.clothing, paths, total).slice(maxLag)
    : [];

  const rows: ForecastRow[] = [];
  for (const h of baseline.history) {
    rows.push({
      date: h.date,
      food: h.food_yoy,
      clothing: h.clothing_yoy,
      kind: "history",
    });
  }
  const lastDate = baseline.history.at(-1)?.date ?? "2024-01-01";
  for (let i = 0; i < MONTHS; i++) {
    rows.push({
      date: addMonths(lastDate, i + 1),
      food: foodFc[i] ?? null,
      clothing: clothingFc[i] ?? null,
      kind: "forecast",
    });
  }

  const sliders: DriverSliderSpec[] = driverIds.map((id) => {
    const cls = driverClass(id);
    return {
      id,
      label: labelOf[id] ?? id,
      value: paths[id]?.[0] ?? 0,
      ...SLIDER_BY_CLASS[cls],
    };
  });

  const activeModel = categories.find((c) => c.category === activeCat);
  const driversAt = Object.fromEntries(
    driverIds.map((id) => [id, paths[id]?.[0] ?? 0]),
  );
  const contribMap = activeModel
    ? decompose(toScenarioModel(activeModel), driversAt)
    : {};
  const contributions: Contribution[] = (activeModel?.drivers ?? []).map(
    (d) => ({
      driver: d.driver,
      label: labelOf[d.driver] ?? d.driver,
      value: contribMap[d.driver] ?? 0,
    }),
  );

  return (
    <main className="mx-auto flex max-w-screen-sm flex-col gap-6 p-4">
      <header>
        <h1 className="text-lg font-bold">日本 消費シナリオ シミュレータ</h1>
        <p className="text-xs text-gray-500">
          食料・衣料の前年比をシナリオで試算（データ vintage:{" "}
          {categories[0]?.data_vintage ?? "—"}）
        </p>
      </header>

      <div role="tablist" aria-label="表示切替" className="flex gap-2 border-b border-gray-200">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t
                ? "border-blue-600 font-semibold text-blue-700"
                : "border-transparent text-gray-500"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "scenario" && (
        <div className="flex flex-col gap-6" data-testid="tab-scenario">
          <div role="group" aria-label="プリセット" className="flex gap-2">
            {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => selectPreset(p)}
                aria-pressed={preset === p}
                className={`rounded px-3 py-1 text-sm ${
                  preset === p ? "bg-blue-600 text-white" : "bg-gray-100"
                }`}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 text-sm" data-testid="next-forecast">
            <span data-testid="food-next">食料: {pctLabel(foodFc[0] ?? 0)}</span>
            <span data-testid="clothing-next">
              衣料: {pctLabel(clothingFc[0] ?? 0)}
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showMA}
                onChange={(e) => setShowMA(e.target.checked)}
                aria-label="3カ月平均を表示"
              />
              3カ月平均
            </label>
          </div>

          <ForecastChart rows={rows} showMovingAverage={showMA} />
          <DriverSliders sliders={sliders} onChange={onSlider} />

          <div>
            <div role="group" aria-label="カテゴリ選択" className="mb-2 flex gap-2">
              {categories.map((c) => (
                <button
                  key={c.category}
                  type="button"
                  onClick={() => setActiveCat(c.category)}
                  aria-pressed={activeCat === c.category}
                  className={`rounded px-3 py-1 text-sm ${
                    activeCat === c.category
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100"
                  }`}
                >
                  {c.category === "food" ? "食料" : "衣料"}
                </button>
              ))}
            </div>
            <p data-testid="narration" className="mt-2 text-sm text-gray-700">
              {narrate(contributions)}
            </p>
            <DecompositionChart contributions={contributions} />
          </div>
        </div>
      )}

      {tab === "model" && (
        <div className="flex flex-col gap-6" data-testid="tab-model">
          <ModelExplanation coefficients={coefficients} backtest={backtest} />
          <div>
            <h2 className="mb-2 text-base font-semibold">適合精度（実績×予測）</h2>
            {categories.map((c) => (
              <div key={c.category} className="mb-4">
                <FitScatter
                  predictions={backtest.predictions ?? []}
                  category={c.category}
                />
              </div>
            ))}
          </div>
          <BacktestPanel backtest={backtest} />
        </div>
      )}

      {tab === "data" && (
        <div className="flex flex-col gap-6" data-testid="tab-data">
          <SourceTables file={series} />
          <SourcePanel sources={sources} />
        </div>
      )}
    </main>
  );
}
