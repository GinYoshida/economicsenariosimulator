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
  driverLookup,
  type Backtest,
  type Baseline,
  type Coefficients,
  type DriverForecastFile,
  type SeriesFile,
  type SourceMeta,
} from "@/app/lib/artifacts";
import { driverClass, driverShift, type Preset } from "@/app/lib/presets";
import {
  addMonths,
  computeFanForecast,
  type FanModel,
} from "@/app/lib/fanForecast";
import { decompose } from "@/app/lib/scenario";
import { narrate } from "@/app/lib/narrate";

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

// スライダーは各ドライバーの予測値を中心に ±span で微調整する。
const SPAN_BY_CLASS: Record<
  ReturnType<typeof driverClass>,
  { span: number; step: number; unit: string }
> = {
  sentiment: { span: 10, step: 1, unit: "pt" },
  cost: { span: 0.1, step: 0.005, unit: "" },
  rate: { span: 0.5, step: 0.05, unit: "%" },
};

function pctLabel(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function Dashboard({
  coefficients,
  baseline,
  backtest,
  sources,
  series = null,
  driverForecasts = null,
}: {
  coefficients: Coefficients;
  baseline: Baseline;
  backtest: Backtest;
  sources: SourceMeta[];
  series?: SeriesFile | null;
  driverForecasts?: DriverForecastFile | null;
}) {
  const categories = coefficients.categories;
  const lookup = useMemo(() => driverLookup(driverForecasts), [driverForecasts]);
  const horizon = driverForecasts?.horizon ?? 12;
  const z = driverForecasts?.z ?? 1.2816;

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
  const lagOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of categories)
      for (const d of c.drivers) m[d.driver] = d.lag_months;
    return m;
  }, [categories]);

  const fanModels = useMemo(() => {
    const m: Record<string, FanModel> = {};
    for (const c of categories) {
      m[c.category] = {
        intercept: c.intercept,
        residStd: c.resid_std ?? 0,
        drivers: c.drivers.map((d) => ({
          driver: d.driver,
          coef: d.coef,
          lagMonths: d.lag_months,
        })),
      };
    }
    return m;
  }, [categories]);

  const [tab, setTab] = useState<Tab>("scenario");
  const [preset, setPreset] = useState<Preset>("base");
  const [activeCat, setActiveCat] = useState(categories[0]?.category ?? "food");
  const [showMA, setShowMA] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [windowKey, setWindowKey] = useState("5y");
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");
  const [overlayIds, setOverlayIds] = useState<Set<string>>(new Set());

  const lastDate = baseline.history.at(-1)?.date ?? "2024-01-01";
  const shift = (id: string) => driverShift(preset, id);

  // 各ドライバーの「予測に基づく既定値」（1か月先の対象月に対応するドライバー月）。
  const defaultOf = useMemo(() => {
    const firstTarget = addMonths(lastDate, 1);
    const m: Record<string, number> = {};
    for (const id of driverIds) {
      const dDate = addMonths(firstTarget, -(lagOf[id] ?? 0));
      const base = lookup[id]?.[dDate]?.mean ?? 0;
      m[id] = base + driverShift(preset, id);
    }
    return m;
  }, [driverIds, lagOf, lookup, lastDate, preset]);

  function selectPreset(p: Preset) {
    setPreset(p);
  }
  function onSlider(id: string, value: number) {
    setOverrides((prev) => ({ ...prev, [id]: value }));
  }
  function toggleOverlay(id: string) {
    setOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const foodFan = computeFanForecast(fanModels.food, lookup, {
    lastTargetDate: lastDate,
    horizon,
    z,
    shift,
    overrides,
  });
  const clothingFan = computeFanForecast(fanModels.clothing, lookup, {
    lastTargetDate: lastDate,
    horizon,
    z,
    shift,
    overrides,
  });
  const foodByDate = Object.fromEntries(foodFan.map((p) => [p.date, p]));
  const clothingByDate = Object.fromEntries(clothingFan.map((p) => [p.date, p]));

  const allRows: ForecastRow[] = [];
  for (const h of baseline.history) {
    allRows.push({
      date: h.date,
      food: h.food_yoy,
      clothing: h.clothing_yoy,
      kind: "history",
    });
  }
  for (let i = 0; i < horizon; i++) {
    const date = addMonths(lastDate, i + 1);
    const f = foodByDate[date];
    const c = clothingByDate[date];
    allRows.push({
      date,
      food: f?.mean ?? null,
      clothing: c?.mean ?? null,
      foodLow: f?.low ?? null,
      foodHigh: f?.high ?? null,
      clothingLow: c?.low ?? null,
      clothingHigh: c?.high ?? null,
      kind: "forecast",
    });
  }

  const windowMonths =
    WINDOW_OPTIONS.find((w) => w.key === windowKey)?.months ?? Infinity;
  const cutoff =
    windowMonths === Infinity ? "" : addMonths(lastDate, -windowMonths);
  const rows = allRows.filter((r) => r.kind === "forecast" || r.date >= cutoff);

  const yDomain: [number | "auto", number | "auto"] = [
    yMin === "" ? "auto" : Number(yMin) / 100,
    yMax === "" ? "auto" : Number(yMax) / 100,
  ];

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
    const cfg = SPAN_BY_CLASS[cls];
    const dflt = defaultOf[id] ?? 0;
    const value = overrides[id] ?? dflt;
    return {
      id,
      label: labelOf[id] ?? id,
      value,
      min: dflt - cfg.span,
      max: dflt + cfg.span,
      step: cfg.step,
      unit: cfg.unit,
    };
  });

  const activeModel = categories.find((c) => c.category === activeCat);
  const driversAt = Object.fromEntries(
    driverIds.map((id) => [id, overrides[id] ?? defaultOf[id] ?? 0]),
  );
  const contribMap = activeModel
    ? decompose(fanModels[activeCat], driversAt)
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
          食料・衣料の前年比を1年先までシナリオ試算（データ vintage:{" "}
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
            <span data-testid="food-next">食料: {pctLabel(foodFan[0]?.mean ?? 0)}</span>
            <span data-testid="clothing-next">
              衣料: {pctLabel(clothingFan[0]?.mean ?? 0)}
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
            塗りは{Math.round(z === 1.2816 ? 80 : z === 1.96 ? 95 : 80)}%信頼帯。
            説明変数は状態空間モデルで1年先まで予測し、その不確実性を線形モデルへ伝播。
            スライダーで固定したドライバーは「確定値（帯なし）」として扱います。
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
