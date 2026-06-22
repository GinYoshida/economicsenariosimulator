// クライアント側シナリオエンジン（純粋関数・サーバー不要）。
//
// 線形モデル: yhat_t = intercept + Σ_i coef_i * driver_i[t - lagMonths_i]
// 範囲外（t - lag < 0 もしくはパスより先）のラグ値は寄与 0 とみなす。

export type DriverPath = Record<string, number[]>;

export type DriverCoef = {
  driver: string;
  coef: number;
  lagMonths: number;
};

export type CategoryCoef = {
  intercept: number;
  drivers: DriverCoef[];
};

function laggedValue(path: number[] | undefined, t: number, lag: number): number {
  if (!path) return 0;
  const idx = t - lag;
  if (idx < 0 || idx >= path.length) return 0;
  const v = path[idx];
  return Number.isFinite(v) ? v : 0;
}

/** 各月の予測値を返す（長さ = months）。 */
export function computeForecast(
  model: CategoryCoef,
  drivers: DriverPath,
  months: number,
): number[] {
  const out: number[] = [];
  for (let t = 0; t < months; t++) {
    let yhat = model.intercept;
    for (const d of model.drivers) {
      yhat += d.coef * laggedValue(drivers[d.driver], t, d.lagMonths);
    }
    out.push(yhat);
  }
  return out;
}

/** 1 時点の各ドライバー寄与（coef * value）。欠損値は 0 として扱う。 */
export function decompose(
  model: CategoryCoef,
  driversAt: Record<string, number>,
): Record<string, number> {
  const contrib: Record<string, number> = {};
  for (const d of model.drivers) {
    const v = driversAt[d.driver];
    const c = d.coef * (Number.isFinite(v) ? v : 0);
    contrib[d.driver] = c === 0 ? 0 : c; // -0 を 0 に正規化
  }
  return contrib;
}
