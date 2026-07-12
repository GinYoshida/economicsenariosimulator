// 目的変数の 1 年先ファン予測（状態空間ドライバー予測 → 線形OLSへ不確実性伝播）。
//
// ŷ_t   = 切片 + Σ 係数_i × ドライバー_i(t - lag)
// Var(ŷ_t) ≈ Σ 係数_i² × ドライバー分散_i(t - lag) + 残差分散
// 帯 = ŷ_t ± z·√Var(ŷ_t)
//
// 手動ピン（overrides）したドライバーは確定値＝分散0として扱う。

export type DriverForecastLookup = Record<
  string,
  Record<string, { mean: number; std: number }>
>;

export type FanModel = {
  intercept: number;
  residStd: number;
  drivers: { driver: string; coef: number; lagMonths: number }[];
};

export type FanPoint = { date: string; mean: number; low: number; high: number };

export function addMonths(isoDate: string, n: number): string {
  const [y, m] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

export function computeFanForecast(
  model: FanModel,
  lookup: DriverForecastLookup,
  opts: {
    lastTargetDate: string;
    horizon: number;
    z: number;
    shift?: (driverId: string) => number;
    overrides?: Record<string, number>;
  },
): FanPoint[] {
  const { lastTargetDate, horizon, z, shift, overrides = {} } = opts;
  const out: FanPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const date = addMonths(lastTargetDate, h);
    let mean = model.intercept;
    let variance = model.residStd * model.residStd;
    for (const d of model.drivers) {
      const dDate = addMonths(date, -d.lagMonths);
      let val: number;
      let std: number;
      if (Object.prototype.hasOwnProperty.call(overrides, d.driver)) {
        val = overrides[d.driver];
        std = 0;
      } else {
        const f = lookup[d.driver]?.[dDate];
        const base = f ? f.mean : 0;
        val = base + (shift ? shift(d.driver) : 0);
        std = f ? f.std : 0;
      }
      mean += d.coef * val;
      variance += d.coef * d.coef * std * std;
    }
    const sd = Math.sqrt(Math.max(variance, 0));
    out.push({ date, mean, low: mean - z * sd, high: mean + z * sd });
  }
  return out;
}
