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
import ForecastChart, {
  type ForecastRow,
  type Overlay,
} from "@/app/components/ForecastChart";
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

const MONTHS = 36; // 3年先までの解釈的ホライズン（4か月目以降はドライバー横ばい）
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

const WINDOW_OPTIONS: { key: string; label: string; months: number }[] = [
  { key: "all", label: "全期間", months: Infinity },
  { key: "10y", label: "10年", months: 120 },
  { key: "5y", label: "5年", months: 60 },
  { key: "3y", label: "3年", months: 36 },
  { key: "1y", label: "1年", months: 12 },
];

const OVERLAY_COLORS = [
  "#8a5cf6", "#0ea5e9", "#f59e0b", "#ef4444", "#14b8a6",
  "#a3a3a3", "#db2777", "#65a30d", "#7c3aed",
];

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

  // グラフ軸・オーバーレイの操作用 state
  const [windowKey, setWindowKey] = useState("5y");
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");
  const [overlayIds, setOverlayIds] = useState<Set<string>>(new Set());

  function selectPreset(p: Preset) {
    setPreset(p);
    setPaths(buildPaths(driverIds, total, p));
  }
  function onSlider(id: string, value: number) {
    setPaths((prev) =>
      applyOverrides(prev, { [id]: Array.from({ length: total }, () => value) }),
    );
  }
  function toggleOverlay(id: string) {
    setOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const foodFc = models.food
    ? computeForecast(models.food, paths, total).slice(maxLag)
    : [];
  const clothingFc = models.clothing
    ? computeForecast(models.clothing, paths, total).slice(maxLag)
    : [];

  const allRows: ForecastRow[] = [];
  for (const h of baseline.history) {
    allRows.push({
      date: h.date,
      food: h.food_yoy,
      clothing: h.clothing_yoy,
      kind: "history",
    });
  }
  const lastDate = baseline.history.at(-1)?.date ?? "2024-01-01";
  for (let i = 0; i < MONTHS; i++) {
    allRows.push({
      date: addMonths(lastDate, i + 1),
      food: foodFc[i] ?? null,
      clothing: clothingFc[i] ?? null,
      kind: "forecast",
    });
  }

  // X軸ウィンドウ（実績側の表示期間を絞る。予測は常に表示）。
  const windowMonths =
    WINDOW_OPTIONS.find((w) => w.key === windowKey)?.months ?? Infinity;
  const cutoff =
    windowMonths === Infinity ? "" : addMonths(lastDate, -windowMonths);
  const rows = allRows.filter((r) => r.kind === "forecast" || r.date >= cutoff);

  const yDomain: [number | "auto", number | "auto"] = [
    yMin === "" ? "auto" : Number(yMin) / 100,
    yMax === "" ? "auto" : Number(yMax) / 100,
  ];

  // 元データ（入力系列）のオーバーレイ。
  const seriesList = series?.series ?? [];
  const overlays: Overlay[] = seriesList
    .filter((s) => overlayIds.has(s.series_id))
    .map((s, i) => ({
      id: s.series_id,
      label: s.series_id,
      color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
      byDate: Object.fromEntries(s.points.map((p) => [p.date, p.value])),
    }));

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

          {/* 軸レンジ・元データ表示の操作 */}
          <div className="flex flex-col gap-2 rounded border border-gray-200 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1">
                期間
                <select
                  aria-label="表示期間"
                  value={windowKey}
                  onChange={(e) => setWindowKey(e.target.value)}
                  className="rounded border border-gray-300 px-1 py-0.5"
                >
                  {WINDOW_OPTIONS.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                縦軸% 下限
                <input
                  type="number"
                  aria-label="縦軸下限"
                  value={yMin}
                  onChange={(e) => setYMin(e.target.value)}
                  placeholder="auto"
                  className="w-16 rounded border border-gray-300 px-1 py-0.5"
                />
              </label>
              <label className="flex items-center gap-1">
                上限
                <input
                  type="number"
                  aria-label="縦軸上限"
                  value={yMax}
                  onChange={(e) => setYMax(e.target.value)}
                  placeholder="auto"
                  className="w-16 rounded border border-gray-300 px-1 py-0.5"
                />
              </label>
            </div>
            {seriesList.length > 0 && (
              <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
                <legend className="text-gray-500">元データを重ねる（右軸）</legend>
                {seriesList.map((s) => (
                  <label key={s.series_id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={overlayIds.has(s.series_id)}
                      onChange={() => toggleOverlay(s.series_id)}
                      aria-label={`${s.series_id} を重ねる`}
                    />
                    {s.series_id}
                  </label>
                ))}
              </fieldset>
            )}
          </div>

          <ForecastChart
            rows={rows}
            showMovingAverage={showMA}
            yDomain={yDomain}
            overlays={overlays}
          />
          <p className="-mt-4 text-[10px] text-gray-400">
            予測は先3か月がモデル主導、以降3年はドライバー横ばい仮定の解釈的延長です。
          </p>

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

          {/* 適合状況（実績×予測）を先頭タブ下段に表示 */}
          <div>
            <h2 className="mb-2 text-base font-semibold">
              予測の適合状況（実績×予測）
            </h2>
            <FitScatter
              predictions={backtest.predictions ?? []}
              category={activeCat}
            />
          </div>
        </div>
      )}

      {tab === "model" && (
        <div className="flex flex-col gap-6" data-testid="tab-model">
          <ModelExplanation coefficients={coefficients} backtest={backtest} />
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
