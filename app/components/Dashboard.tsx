"use client";

import { useMemo, useState } from "react";

import BacktestPanel from "@/app/components/BacktestPanel";
import DecompositionChart, {
  type Contribution,
} from "@/app/components/DecompositionChart";
import DriverChart from "@/app/components/DriverChart";
import DriverSliders, {
  type DriverSliderSpec,
} from "@/app/components/DriverSliders";
import CategoryChart, { type CategoryRow } from "@/app/components/CategoryChart";
import FitScatter from "@/app/components/FitScatter";
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

// スライダーは各ドライバーの予測値を中心に ±span で微調整する。
const SPAN_BY_CLASS: Record<
  ReturnType<typeof driverClass>,
  { span: number; step: number; unit: string }
> = {
  sentiment: { span: 10, step: 1, unit: "pt" },
  cost: { span: 0.1, step: 0.005, unit: "" },
  rate: { span: 0.5, step: 0.05, unit: "%" },
  income: { span: 0.05, step: 0.005, unit: "" },
};

// カテゴリの色。実績・帯（color）と、予測中心線（centerColor）は別色にする。
const CAT_COLOR: Record<string, string> = {
  food: "#e07a3f",
  clothing: "#3f6fe0",
};
const CAT_CENTER: Record<string, string> = {
  food: "#7c2d12", // 濃い茶（食料の実績オレンジと区別）
  clothing: "#6d28d9", // 紫（衣料の実績ブルーと区別）
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
  const [fcHorizon, setFcHorizon] = useState(horizon); // 予測期間（1..12か月先）
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");
  const [selectedDriver, setSelectedDriver] = useState(
    driverForecasts?.drivers[0]?.driver ?? "",
  );

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
  // 「h か月先予測」の帯幅（標準偏差）を前方ファンの h ステップ目から得る。
  // 履歴も前方も同じ h に統一する（異なる予測期間の混在を避ける）。
  const hSel = Math.min(Math.max(fcHorizon, 1), Math.max(foodFan.length, 1));
  const sdAt = (fan: { low: number; high: number }[]) => {
    const i = Math.min(hSel, fan.length) - 1;
    return i >= 0 ? (fan[i].high - fan[i].low) / (2 * z) : 0;
  };
  const sdFood = sdAt(foodFan);
  const sdClothing = sdAt(clothingFan);

  const windowMonths =
    WINDOW_OPTIONS.find((w) => w.key === windowKey)?.months ?? Infinity;
  const cutoff =
    windowMonths === Infinity ? "" : addMonths(lastDate, -windowMonths);

  // カテゴリ別の行（履歴: 当てはめ中心／将来: 予測平均を h か月先まで）。
  function catRows(
    actualOf: (h: (typeof baseline.history)[number]) => number,
    fitOf: (h: (typeof baseline.history)[number]) => number | null | undefined,
    fan: { date: string; mean: number }[],
  ): CategoryRow[] {
    const out: CategoryRow[] = [];
    for (const h of baseline.history) {
      out.push({ date: h.date, kind: "history", actual: actualOf(h), center: fitOf(h) ?? null });
    }
    for (let k = 0; k < hSel && k < fan.length; k++) {
      out.push({ date: fan[k].date, kind: "forecast", actual: null, center: fan[k].mean });
    }
    return out.filter((r) => r.kind === "forecast" || r.date >= cutoff);
  }
  const foodRows = catRows((h) => h.food_yoy, (h) => h.food_fit, foodFan);
  const clothingRows = catRows((h) => h.clothing_yoy, (h) => h.clothing_fit, clothingFan);

  const yDomain: [number | "auto", number | "auto"] = [
    yMin === "" ? "auto" : Number(yMin) / 100,
    yMax === "" ? "auto" : Number(yMax) / 100,
  ];

  const driverForecastList = driverForecasts?.drivers ?? [];
  const activeDriver =
    driverForecastList.find((d) => d.driver === selectedDriver) ??
    driverForecastList[0];

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
                予測期間
                <select
                  aria-label="予測期間（か月先）"
                  value={hSel}
                  onChange={(e) => setFcHorizon(Number(e.target.value))}
                  className="rounded border border-gray-300 px-1 py-0.5"
                >
                  {Array.from({ length: Math.max(foodFan.length, 1) }, (_, i) => i + 1).map(
                    (h) => (
                      <option key={h} value={h}>
                        {h}カ月先
                      </option>
                    ),
                  )}
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
          </div>

          <div data-testid="forecast-chart" className="flex flex-col gap-4">
            <CategoryChart
              label="食料"
              color={CAT_COLOR.food}
              centerColor={CAT_CENTER.food}
              sd={sdFood}
              horizon={hSel}
              rows={foodRows}
              boundaryDate={lastDate}
              showMovingAverage={showMA}
              yDomain={yDomain}
              testId="forecast-chart-food"
            />
            <CategoryChart
              label="衣料"
              color={CAT_COLOR.clothing}
              centerColor={CAT_CENTER.clothing}
              sd={sdClothing}
              horizon={hSel}
              rows={clothingRows}
              boundaryDate={lastDate}
              showMovingAverage={showMA}
              yDomain={yDomain}
              testId="forecast-chart-clothing"
            />
          </div>
          <p className="-mt-2 text-[10px] text-gray-400">
            <b>{hSel}カ月先予測</b>の視点で統一表示。実績＝実線＋〇／予測中心＝破線。帯は
            <b>信頼度別（50/80/95%）</b>に色分け（濃いほど高確率＝狭い帯）。予測期間を変えると帯幅と
            前方の伸びが連動します。凡例クリックで各系列/帯を表示切替できます。
          </p>

          <DriverSliders sliders={sliders} onChange={onSlider} />

          {/* 説明変数（ドライバー）の予測は別グラフで表示 */}
          {activeDriver && (
            <div data-testid="driver-section">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-base font-semibold">説明変数の予測</h2>
                <select
                  aria-label="ドライバー選択"
                  value={activeDriver.driver}
                  onChange={(e) => setSelectedDriver(e.target.value)}
                  className="rounded border border-gray-300 px-1 py-0.5 text-sm"
                >
                  {driverForecastList.map((d) => (
                    <option key={d.driver} value={d.driver}>
                      {d.label_ja}
                    </option>
                  ))}
                </select>
              </div>
              <DriverChart driver={activeDriver} z={z} />
            </div>
          )}

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
