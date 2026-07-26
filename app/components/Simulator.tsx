"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import CategoryChart, { type CategoryRow } from "@/app/components/CategoryChart";
import DriverReadBlock from "@/app/components/DriverReadBlock";
import FitScatter from "@/app/components/FitScatter";
import SensitivityTable, { type SensRow } from "@/app/components/SensitivityTable";
import type {
  Baseline,
  DriverForecastFile,
  MinlagModelFile,
} from "@/app/lib/artifacts";
import { addMonths } from "@/app/lib/fanForecast";
import { buildLinearPath, simulateConsumption } from "@/app/lib/minlagSim";

// 横軸（表示期間）の選択肢。既定は直近3年＋予測。
const WINDOW_OPTIONS: { key: string; label: string; months: number }[] = [
  { key: "all", label: "全期間", months: Infinity },
  { key: "10y", label: "10年", months: 120 },
  { key: "5y", label: "5年", months: 60 },
  { key: "3y", label: "3年", months: 36 },
  { key: "2y", label: "2年", months: 24 },
  { key: "1y", label: "1年", months: 12 },
];

const CAT_COLOR: Record<string, string> = { food: "#e07a3f", clothing: "#3f6fe0" };
const CAT_CENTER: Record<string, string> = { food: "#7c2d12", clothing: "#6d28d9" };
const CAT_LABEL: Record<string, string> = { food: "食料", clothing: "衣料" };
// 保存シナリオの比較色（最大3）。
const SCENARIO_COLORS = ["#0ea5e9", "#f59e0b", "#10b981"];
const MAX_SAVED = 3;

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

type SavedScenario = {
  id: number;
  name: string;
  landings: Record<string, number>;
  food: { date: string; mean: number }[];
  clothing: { date: string; mean: number }[];
};

export default function Simulator({
  minlag,
  driverForecasts,
  baseline,
  backtestFallback,
}: {
  minlag: MinlagModelFile;
  driverForecasts: DriverForecastFile | null;
  baseline: Baseline;
  backtestFallback?: { category: string; date: string; actual: number; predicted: number }[];
}) {
  const z = driverForecasts?.z ?? 1.2816;
  const maxHorizon = driverForecasts?.horizon ?? 12;
  const lastDate = baseline.history.at(-1)?.date ?? "2024-01-01";

  const catModel = useMemo(() => {
    const m: Record<string, MinlagModelFile["categories"][number]> = {};
    for (const c of minlag.categories) m[c.category] = c;
    return m;
  }, [minlag]);

  // 外生ドライバーの集合（AR項＝各カテゴリ ar_driver は除外済み）。
  const drivers = useMemo(() => {
    const seen = new Map<string, { driver: string; label: string; unit: string }>();
    for (const c of minlag.categories)
      for (const d of c.drivers)
        if (!seen.has(d.driver))
          seen.set(d.driver, { driver: d.driver, label: d.label_ja, unit: d.unit });
    return Array.from(seen.values());
  }, [minlag]);

  // ドライバーの「現在値（最終実績）」と「モデル予測の着地値（最終ホライズンの mean）」。
  const driverForecastMap = useMemo(() => {
    const m: Record<string, DriverForecastFile["drivers"][number]> = {};
    for (const d of driverForecasts?.drivers ?? []) m[d.driver] = d;
    return m;
  }, [driverForecasts]);

  const currentOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of drivers) {
      const pts = driverForecastMap[d.driver]?.points ?? [];
      const actuals = pts.filter((p) => p.actual != null);
      m[d.driver] = actuals.length ? (actuals.at(-1)!.actual as number) : 0;
    }
    return m;
  }, [drivers, driverForecastMap]);

  const modelLandingOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of drivers) {
      const pts = driverForecastMap[d.driver]?.points ?? [];
      const fc = pts.filter((p) => p.mean != null);
      m[d.driver] = fc.length ? (fc.at(-1)!.mean as number) : currentOf[d.driver] ?? 0;
    }
    return m;
  }, [drivers, driverForecastMap, currentOf]);

  const [horizon, setHorizon] = useState(Math.min(6, maxHorizon));
  const [landings, setLandings] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [seq, setSeq] = useState(1);
  const [windowKey, setWindowKey] = useState("3y");
  const [analysisCat, setAnalysisCat] = useState<"food" | "clothing">("food");

  const windowMonths =
    WINDOW_OPTIONS.find((w) => w.key === windowKey)?.months ?? Infinity;
  const cutoff = windowMonths === Infinity ? "" : addMonths(lastDate, -windowMonths);

  // 実効着地値（ユーザー設定が無ければモデル予測の着地値）。
  const landingOf = (id: string) =>
    landings[id] ?? modelLandingOf[id] ?? currentOf[id] ?? 0;

  // ドライバーパス（現在→着地の線形補間）。
  const driverPaths = useMemo(() => {
    const paths: Record<string, number[]> = {};
    for (const d of drivers)
      paths[d.driver] = buildLinearPath(
        currentOf[d.driver] ?? 0,
        landingOf(d.driver),
        horizon,
      );
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, currentOf, landings, modelLandingOf, horizon]);

  const startY = {
    food: baseline.history.at(-1)?.food_yoy ?? 0,
    clothing: baseline.history.at(-1)?.clothing_yoy ?? 0,
  };

  const sim = useMemo(() => {
    const out: Record<string, ReturnType<typeof simulateConsumption>> = {};
    for (const cat of ["food", "clothing"]) {
      const model = catModel[cat];
      if (!model) continue;
      out[cat] = simulateConsumption(
        model,
        driverPaths,
        startY[cat as "food" | "clothing"],
        lastDate,
        horizon,
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catModel, driverPaths, lastDate, horizon]);

  // カテゴリチャート用の行（履歴実績＋シナリオ予測）。
  function rowsFor(cat: string, actualOf: (h: Baseline["history"][number]) => number): CategoryRow[] {
    const out: CategoryRow[] = [];
    for (const h of baseline.history)
      out.push({ date: h.date, kind: "history", actual: actualOf(h), center: null, sd: null });
    for (const p of sim[cat] ?? [])
      out.push({ date: p.date, kind: "forecast", actual: null, center: p.mean, sd: p.sd });
    // 横軸フィルタ（予測は常に残す）。
    return out.filter((r) => r.kind === "forecast" || !cutoff || r.date >= cutoff);
  }
  const foodRows = rowsFor("food", (h) => h.food_yoy);
  const clothingRows = rowsFor("clothing", (h) => h.clothing_yoy);

  function saveScenario() {
    if (saved.length >= MAX_SAVED) return;
    const snapshot: Record<string, number> = {};
    for (const d of drivers) snapshot[d.driver] = landingOf(d.driver);
    setSaved((prev) => [
      ...prev,
      {
        id: seq,
        name: `想定${seq}`,
        landings: snapshot,
        food: (sim.food ?? []).map((p) => ({ date: p.date, mean: p.mean })),
        clothing: (sim.clothing ?? []).map((p) => ({ date: p.date, mean: p.mean })),
      },
    ]);
    setSeq((n) => n + 1);
  }
  function removeScenario(id: number) {
    setSaved((prev) => prev.filter((s) => s.id !== id));
  }
  function resetLandings() {
    setLandings({});
  }

  const fitPoints = minlag.fit.length ? minlag.fit : backtestFallback ?? [];

  // ドライバーの標準偏差（実績履歴から）。感度＝係数×σ。
  const sigmaOf = (id: string): number => {
    const vals = (driverForecastMap[id]?.points ?? [])
      .filter((p) => p.actual != null)
      .map((p) => p.actual as number);
    if (vals.length < 2) return 0;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
  };
  const sensRows: SensRow[] = (catModel[analysisCat]?.drivers ?? []).map((d) => {
    const sigma = sigmaOf(d.driver);
    const cur = currentOf[d.driver] ?? 0;
    return {
      driver: d.driver,
      label: d.label_ja,
      sens: d.coef * sigma,
      contrib: d.coef * (landingOf(d.driver) - cur),
    };
  });

  return (
    <div className="flex flex-col gap-6" data-testid="tab-scenario">
      <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
        将来はモデルに当てさせず、<b>あなたが各説明変数の「読み（着地値）」を置き</b>、その前提で消費を試算します。
        まず各変数の状態空間予測（帯付き）を出発点に、上下に調整してください。予測は<b>ラグ最小</b>で翻訳します。
      </p>

      {/* 表示期間（横軸）＋予測ホライズン */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <label className="flex items-center gap-1">
          表示期間
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
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            {Array.from({ length: maxHorizon }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {h}カ月先
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex gap-3" data-testid="sim-next">
          <span data-testid="food-next">食料: {pct(sim.food?.[0]?.mean)}</span>
          <span data-testid="clothing-next">衣料: {pct(sim.clothing?.[0]?.mean)}</span>
        </span>
      </div>

      {/* 消費予測（出力） */}
      <div data-testid="forecast-chart" className="flex flex-col gap-4">
        <CategoryChart
          label="食料"
          color={CAT_COLOR.food}
          centerColor={CAT_CENTER.food}
          horizon={horizon}
          rows={foodRows}
          boundaryDate={lastDate}
          testId="forecast-chart-food"
        />
        <CategoryChart
          label="衣料"
          color={CAT_COLOR.clothing}
          centerColor={CAT_CENTER.clothing}
          horizon={horizon}
          rows={clothingRows}
          boundaryDate={lastDate}
          testId="forecast-chart-clothing"
        />
      </div>

      {/* シナリオ保存・比較 */}
      <div className="rounded border border-gray-200 p-2" data-testid="scenario-save">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveScenario}
            disabled={saved.length >= MAX_SAVED}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            この想定を保存
          </button>
          <span className="text-xs text-gray-500">
            {saved.length}/{MAX_SAVED} 件
          </span>
          <button
            type="button"
            onClick={resetLandings}
            className="ml-auto rounded bg-gray-100 px-3 py-1 text-xs"
          >
            モデル予測に戻す
          </button>
        </div>
        {saved.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {saved.map((s, i) => (
              <li
                key={s.id}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs"
                style={{ backgroundColor: `${SCENARIO_COLORS[i]}22`, color: SCENARIO_COLORS[i] }}
              >
                {s.name}
                <button
                  type="button"
                  aria-label={`${s.name}を削除`}
                  onClick={() => removeScenario(s.id)}
                  className="ml-1 font-bold"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {saved.length > 0 && (
        <ScenarioCompare saved={saved} current={sim} lastDate={lastDate} />
      )}

      {/* 説明変数ごとに「予測グラフ＋着地値スライダー」を一体で縦に並べる。
          グラフの予測中心＝あなたの読みで、信頼帯ごとスライダーに連動して動く。 */}
      <div data-testid="driver-reads">
        <h2 className="mb-1 text-base font-semibold">説明変数の読み（着地値）と予測</h2>
        <p className="mb-2 text-[10px] text-gray-400">
          各グラフの点線＝あなたの読み（現在→着地の想定）。スライダーを動かすと予測中心と信頼帯が一緒に動きます。
        </p>
        <div className="flex flex-col gap-3">
          {drivers.map((d) => (
            <DriverReadBlock
              key={d.driver}
              driver={driverForecastMap[d.driver] ?? null}
              label={d.label}
              unit={d.unit}
              current={currentOf[d.driver] ?? 0}
              modelLanding={modelLandingOf[d.driver] ?? currentOf[d.driver] ?? 0}
              landing={landingOf(d.driver)}
              edited={landings[d.driver] != null}
              horizon={horizon}
              z={z}
              cutoff={cutoff}
              onChange={(v) => setLandings((p) => ({ ...p, [d.driver]: v }))}
            />
          ))}
        </div>
      </div>

      {/* 感度・当てはめ（食料/衣料 切替） */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">感度と当てはめ</h2>
          <div role="group" aria-label="分析カテゴリ" className="ml-auto flex gap-1">
            {(["food", "clothing"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAnalysisCat(c)}
                aria-pressed={analysisCat === c}
                className={`rounded px-3 py-0.5 text-xs ${
                  analysisCat === c ? "bg-gray-800 text-white" : "bg-gray-100"
                }`}
              >
                {c === "food" ? "食料" : "衣料"}
              </button>
            ))}
          </div>
        </div>

        <h3 className="mb-1 text-sm font-semibold text-gray-700">
          パラメーター感度（{analysisCat === "food" ? "食料" : "衣料"}）
        </h3>
        <SensitivityTable rows={sensRows} />

        <h3 className="mt-4 mb-1 text-sm font-semibold text-gray-700">
          翻訳器の当てはめ（実績×予測）
        </h3>
        <FitScatter predictions={fitPoints} category={analysisCat} />
        <p className="mt-1 text-[10px] text-gray-400">
          ラグ最小モデルが当月の説明変数から消費を再現できているか（当月まで）。
        </p>
      </div>
    </div>
  );
}

// 保存シナリオ＋現在の消費予測中心線を重ねて比較する。
function ScenarioCompare({
  saved,
  current,
  lastDate,
}: {
  saved: SavedScenario[];
  current: Record<string, { date: string; mean: number }[]>;
  lastDate: string;
}) {
  const [cat, setCat] = useState<"food" | "clothing">("food");
  // 全シナリオの日付軸をマージ。
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const s of saved) for (const p of s[cat]) set.add(p.date);
    for (const p of current[cat] ?? []) set.add(p.date);
    return Array.from(set).sort();
  }, [saved, current, cat]);

  const rows = dates.map((date) => {
    const row: Record<string, number | string | null> = { date };
    saved.forEach((s, i) => {
      row[`s${i}`] = s[cat].find((p) => p.date === date)?.mean ?? null;
    });
    row.current = (current[cat] ?? []).find((p) => p.date === date)?.mean ?? null;
    return row;
  });

  return (
    <div data-testid="scenario-compare">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-base font-semibold">保存シナリオ比較</h2>
        <div role="group" aria-label="比較カテゴリ" className="ml-auto flex gap-1">
          {(["food", "clothing"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={`rounded px-2 py-0.5 text-xs ${
                cat === c ? "bg-gray-800 text-white" : "bg-gray-100"
              }`}
            >
              {CAT_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d) => String(d).slice(2, 7)} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip
              formatter={(v) => {
                const n = typeof v === "number" ? v : Number(v);
                return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
              }}
              labelFormatter={(d) => String(d)}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine x={lastDate} stroke="#9ca3af" strokeDasharray="4 3" />
            {saved.map((s, i) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={`s${i}`}
                name={s.name}
                stroke={SCENARIO_COLORS[i]}
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            ))}
            <Line
              type="monotone"
              dataKey="current"
              name="現在の想定"
              stroke="#111827"
              strokeDasharray="5 3"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
