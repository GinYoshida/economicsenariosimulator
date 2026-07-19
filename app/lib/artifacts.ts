// 成果物 JSON のローダと型（M3-1 pydantic スキーマと一致）。
// public/ 配下は web ルートに配信されるため /data/*.json で取得する。

import type { CategoryCoef } from "@/app/lib/scenario";
import type { DriverForecastLookup } from "@/app/lib/fanForecast";

export type DriverCoefJSON = {
  driver: string;
  label_ja: string;
  coef: number;
  lag_months: number;
};

export type CategoryModel = {
  category: string;
  intercept: number;
  drivers: DriverCoefJSON[];
  r2: number;
  resid_std?: number; // 旧成果物では欠落
  model_version: string;
  data_vintage: string;
};

export type Coefficients = {
  generated_at: string;
  categories: CategoryModel[];
};

export type BaselinePoint = {
  date: string;
  food_yoy: number;
  clothing_yoy: number;
  food_low: number;
  food_high: number;
  clothing_low: number;
  clothing_high: number;
  food_fit?: number | null; // バックキャスト（OLS当てはめ）
  clothing_fit?: number | null;
};

export type Baseline = {
  history: BaselinePoint[];
  forecast: BaselinePoint[];
  horizon_note: string;
};

export type BacktestMetric = {
  category: string;
  mae: number;
  rmse: number;
  medae?: number; // 中央絶対誤差（旧成果物では欠落）
  direction_hit: number;
  naive_mae: number;
  naive_rmse: number;
  naive_medae?: number;
  naive_direction_hit: number;
  beats_naive: boolean;
  passes_gate?: boolean; // beats_naive かつ 方向一致>50%（旧成果物では欠落）
};

/** 実質的な合格判定（passes_gate が無い旧データは beats_naive で近似）。 */
export function metricPasses(m: BacktestMetric): boolean {
  return m.passes_gate ?? (m.beats_naive && m.direction_hit > 0.5);
}

export type BacktestPoint = {
  category: string;
  date: string;
  actual: number;
  predicted: number;
};

export type Backtest = {
  metrics: BacktestMetric[];
  window: string;
  predictions?: BacktestPoint[]; // 実績×予測（未生成の旧成果物では欠落）
};

export type SourceMeta = {
  series_id: string;
  name: string;
  url: string;
  retrieved_at: string;
  license: string;
  unit: string;
  frequency: string;
};

export type SeriesPoint = { date: string; value: number | null };

export type SeriesData = {
  series_id: string;
  name: string;
  url: string;
  unit: string;
  frequency: string;
  points: SeriesPoint[];
};

export type SeriesFile = {
  generated_at: string;
  series: SeriesData[];
};

const BASE = "/data";

async function loadJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) {
    throw new Error(`Failed to load ${file}: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const loadCoefficients = () => loadJson<Coefficients>("coefficients.json");
export const loadBaseline = () => loadJson<Baseline>("baseline.json");
export const loadBacktest = () => loadJson<Backtest>("backtest.json");
export const loadSources = () => loadJson<SourceMeta[]>("sources.json");

/** series.json をロード。未生成（404）なら null を返す（次回バッチで生成）。 */
export async function loadSeries(): Promise<SeriesFile | null> {
  try {
    return await loadJson<SeriesFile>("series.json");
  } catch {
    return null;
  }
}

export type DriverForecastPoint = {
  date: string;
  actual?: number | null;   // 実績（過去月）
  backcast?: number | null; // 状態空間の当てはめ（過去月）
  mean?: number | null;     // 予測平均（将来月）
  std?: number | null;      // 予測std（将来月）
};
export type DriverForecast = {
  driver: string;
  label_ja: string;
  unit: string;
  points: DriverForecastPoint[];
};
export type DriverForecastFile = {
  generated_at: string;
  horizon: number;
  z: number;
  drivers: DriverForecast[];
  anchor?: string | null; // 後ろ向き検証の予測起点（前向きは null）
};

/** driver_forecasts.json をロード。未生成なら null（フラット予測にフォールバック）。 */
export async function loadDriverForecasts(): Promise<DriverForecastFile | null> {
  try {
    return await loadJson<DriverForecastFile>("driver_forecasts.json");
  } catch {
    return null;
  }
}

/** driver_forecasts_hindcast.json（後ろ向き検証）をロード。未生成なら null。 */
export async function loadDriverForecastsHindcast(): Promise<DriverForecastFile | null> {
  try {
    return await loadJson<DriverForecastFile>("driver_forecasts_hindcast.json");
  } catch {
    return null;
  }
}

/** DriverForecastFile を {driver: {date: {mean,std}}} の参照マップに変換。
 * 過去月は actual を平均・std=0、将来月は mean/std を使う（ファン伝播用）。 */
export function driverLookup(file: DriverForecastFile | null): DriverForecastLookup {
  const map: DriverForecastLookup = {};
  for (const d of file?.drivers ?? []) {
    const byDate: Record<string, { mean: number; std: number }> = {};
    for (const p of d.points) {
      const m = p.mean ?? p.actual;
      if (m == null) continue;
      byDate[p.date] = { mean: m, std: p.std ?? 0 };
    }
    map[d.driver] = byDate;
  }
  return map;
}

/** 成果物のカテゴリモデルをシナリオエンジンの型へ変換（lag_months -> lagMonths）。 */
export function toScenarioModel(m: CategoryModel): CategoryCoef {
  return {
    intercept: m.intercept,
    drivers: m.drivers.map((d) => ({
      driver: d.driver,
      coef: d.coef,
      lagMonths: d.lag_months,
    })),
  };
}
