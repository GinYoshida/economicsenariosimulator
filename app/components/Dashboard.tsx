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
  type RollingForecastFile,
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
  self: { span: 0.05, step: 0.005, unit: "" }, // 前値（AR項）: UIには出さない
};

/** 目的変数の前値（AR項）＝シナリオUIから除外する内部ドライバー。 */
const isBaselineDriver = (id: string) => id.startsWith("household.");

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
  rolling = null,
}: {
  coefficients: Coefficients;
  baseline: Baseline;
  backtest: Backtest;
  sources: SourceMeta[];
  series?: SeriesFile | null;
  driverForecasts?: DriverForecastFile | null;
  rolling?: RollingForecastFile | null;
}) {
  const categories = coefficients.categories;
  const lookup = useMemo(() => driverLookup(driverForecasts), [driverForecasts]);
  const horizon = driverForecasts?.horizon ?? 12;
  const z = driverForecasts?.z ?? 1.2816;

  // ローリング検証: (category|h|date) -> {mean, sd, actual}
  const rollMap = useMemo(() => {
    const m: Record<string, { mean: number; sd: number; actual: number | null }> = {};
    for (const p of rolling?.points ?? [])
      m[`${p.category}|${p.h}|${p.date}`] = {
        mean: p.mean,
        sd: p.sd,
        actual: p.actual ?? null,
      };
    return m;
  }, [rolling]);
  const hasRolling = (rolling?.points?.length ?? 0) > 0;

  // ナイーブ縮約: (category|h) -> {w, sd}
  const blendMap = useMemo(() => {
    const m: Record<string, { w: number; sd: number }> = {};
    for (const b of rolling?.blend ?? [])
      m[`${b.category}|${b.h}`] = { w: b.w, sd: b.sd };
    return m;
  }, [rolling]);

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
  const [fcHorizon, setFcHorizon] = useState(Math.min(2, horizon)); // 予測期間（既定2か月先）
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

  // カテゴリ別の行を作る。役割を分離：
  //  - 過去（history）＝ローリング検証（基準前提・固定）。実測なのでシナリオ非適用。
  //  - 未来（forecast）＝シナリオ予測（前方ファン）。楽観/悲観・スライダーが反映される。
  function catRows(
    cat: string,
    actualOf: (h: (typeof baseline.history)[number]) => number,
    fitOf: (h: (typeof baseline.history)[number]) => number | null | undefined,
    fan: { date: string; mean: number; low: number; high: number }[],
    sdConst: number,
  ): CategoryRow[] {
    const roll = (date: string) => rollMap[`${cat}|${hSel}|${date}`];
    const b = blendMap[`${cat}|${hSel}`];
    const naiveNow = baseline.history.length
      ? actualOf(baseline.history[baseline.history.length - 1])
      : 0;
    const out: CategoryRow[] = [];
    for (const h of baseline.history) {
      const r = hasRolling ? roll(h.date) : undefined;
      out.push({
        date: h.date,
        kind: "history",
        actual: actualOf(h),
        center: r ? r.mean : fitOf(h) ?? null,
        sd: r ? r.sd : sdConst,
      });
    }
    // 未来はシナリオ反映の前方予測（中心はプリセット/スライダーで動く）。
    // ナイーブ縮約 w を適用：中心 = w·モデル + (1−w)·直近実測、帯は縮約後OOS std。
    for (let k = 0; k < hSel; k++) {
      const p = fan[k];
      if (!p) break;
      const center = b ? b.w * p.mean + (1 - b.w) * naiveNow : p.mean;
      out.push({
        date: p.date,
        kind: "forecast",
        actual: null,
        center,
        sd: b ? b.sd : (p.high - p.low) / (2 * z),
      });
    }
    return out.filter((r) => r.kind === "forecast" || r.date >= cutoff);
  }
  const foodRows = catRows("food", (h) => h.food_yoy, (h) => h.food_fit, foodFan, sdFood);
  const clothingRows = catRows(
    "clothing",
    (h) => h.clothing_yoy,
    (h) => h.clothing_fit,
    clothingFan,
    sdClothing,
  );

  const yDomain: [number | "auto", number | "auto"] = [
    yMin === "" ? "auto" : Number(yMin) / 100,
    yMax === "" ? "auto" : Number(yMax) / 100,
  ];

  // 前値(AR項)はシナリオ操作の対象外。ドライバー選択・スライダー・要因分解から除外。
  const driverForecastList = (driverForecasts?.drivers ?? []).filter(
    (d) => !isBaselineDriver(d.driver),
  );
  const activeDriver =
    driverForecastList.find((d) => d.driver === selectedDriver) ??
    driverForecastList[0];

  const sliders: DriverSliderSpec[] = driverIds
    .filter((id) => !isBaselineDriver(id))
    .map((id) => {
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
  const contributions: Contribution[] = (activeModel?.drivers ?? [])
    .filter((d) => !isBaselineDriver(d.driver))
    .map((d) => ({
      driver: d.driver,
      label: labelOf[d.driver] ?? d.driver,
      value: contribMap[d.driver] ?? 0,
    }));

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
              horizon={hSel}
              rows={clothingRows}
              boundaryDate={lastDate}
              showMovingAverage={showMA}
              yDomain={yDomain}
              testId="forecast-chart-clothing"
            />
          </div>
          <p className="-mt-2 text-[10px] text-gray-400">
            現在（縦破線）より<b>左＝検証</b>：各月について「{hSel}カ月前を起点に当時までのデータだけで
            再学習＋状態空間で{hSel}カ月外挿した予測」{hasRolling ? "（拡張窓ローリング・基準前提）" : "（近似・バッチ生成前）"}
            を実績（実線＋〇）と重ね、外れても帯に収まるかを見ます。
            <b>右＝シナリオ予測</b>：<b>楽観/悲観・スライダーがここに反映</b>されます（過去は実測なので不変）。
            予測は<b>ナイーブ（直近値）へ縮約</b>（w をカテゴリ・期間別にバックテストで最適化。食料はほぼナイーブ、
            衣料はモデル寄り）。予測中心＝破線、帯は<b>信頼度別（50/80/95%）</b>に色分け。凡例クリックで表示切替。
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
