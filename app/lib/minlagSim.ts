// ラグ最小モデルによる「ユーザーの読み→消費」シミュレーション（純粋関数）。
//
// 設計: ユーザーが各外生ドライバーの「着地値」を置く → 直近実績から着地値へ
// 線形補間したパスを作る → 翻訳器（外生 lag0・AR lag1・季節は月別切片）で
// 消費を逐次計算する。将来のドライバー値はユーザーが供給するので、消費の帯は
// 「翻訳器の残差」を AR で伝播させたものだけ（ドライバー不確実性は step1 の
// ドライバー予測グラフ側で別途提示する）。

import { addMonths } from "@/app/lib/fanForecast";
import type { MinlagCategory } from "@/app/lib/artifacts";

/** ISO 日付（YYYY-MM-01）の月（1..12）。 */
export function monthOf(isoDate: string): number {
  return Number(isoDate.slice(5, 7));
}

/** 直近実績値 start から着地値 landing へ months 個の線形パスを作る。
 * path[k]（k=0..months-1）は「k+1 か月先」に対応する。 */
export function buildLinearPath(
  start: number,
  landing: number,
  months: number,
): number[] {
  const out: number[] = [];
  for (let k = 0; k < months; k++) {
    out.push(start + ((landing - start) * (k + 1)) / months);
  }
  return out;
}

export type SimPoint = { date: string; mean: number; sd: number };

/** 翻訳器でカテゴリ消費を逐次計算する。
 * @param model         ラグ最小カテゴリモデル
 * @param driverPaths   {driverId: number[]}（各長さ months、k=0 が 1 か月先）
 * @param startY        起点（現在月）の消費 YoY（AR の初期 y_{t-1}）
 * @param lastDate      現在月（YYYY-MM-01）。1 か月先から予測する。
 * @param months        予測ホライズン
 */
export function simulateConsumption(
  model: MinlagCategory,
  driverPaths: Record<string, number[]>,
  startY: number,
  lastDate: string,
  months: number,
): SimPoint[] {
  const out: SimPoint[] = [];
  let yPrev = startY;
  let varPrev = 0;
  const resid2 = model.resid_std * model.resid_std;
  for (let k = 0; k < months; k++) {
    const date = addMonths(lastDate, k + 1);
    const m = monthOf(date);
    let yhat = model.intercept_by_month[m - 1] ?? 0;
    for (const d of model.drivers) {
      const v = driverPaths[d.driver]?.[k];
      if (Number.isFinite(v)) yhat += d.coef * (v as number);
    }
    yhat += model.ar_coef * yPrev;
    // 残差分散を AR で伝播（var_t = resid^2 + ar^2·var_{t-1}）。
    const varT = resid2 + model.ar_coef * model.ar_coef * varPrev;
    out.push({ date, mean: yhat, sd: Math.sqrt(varT) });
    yPrev = yhat;
    varPrev = varT;
  }
  return out;
}
