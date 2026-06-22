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
  direction_hit: number;
  naive_mae: number;
  naive_rmse: number;
  naive_direction_hit: number;
  beats_naive: boolean;
};

export type Backtest = {
  metrics: BacktestMetric[];
  window: string;
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
