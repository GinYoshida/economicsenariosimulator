// 成果物 JSON のローダと型（M3-1 pydantic スキーマと一致）。
// public/ 配下は web ルートに配信されるため /data/*.json で取得する。

import type { CategoryCoef } from "@/app/lib/scenario";

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
