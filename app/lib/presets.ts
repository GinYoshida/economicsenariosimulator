// シナリオ・プリセットと手動上書き。
//
// プリセットはドライバーの「水準パス」を生成する。base は与えた基準値
// （例: 先物の期待値・直近のDI水準）で横ばい。optimistic/pessimistic は
// ドライバー種別ごとに消費に有利/不利な向きへずらす（v1 の説明的仮定）。

import type { DriverPath } from "@/app/lib/scenario";

export type Preset = "optimistic" | "base" | "pessimistic";
// "self" は目的変数の前値（AR項）。シナリオでは動かさない（＝0）。
export type DriverClass = "sentiment" | "cost" | "rate" | "income" | "self";

type PresetConfig = {
  // 各種別の base からのシフト量（ドライバー自身の単位）。
  sentiment: number;
  cost: number;
  rate: number;
  income: number;
  self: number;
};

export const PRESETS: Record<Preset, PresetConfig> = {
  // income は名目給与YoY。楽観は賃上げ加速（+1pp）、悲観は減速（-1pp）。
  // cost とは符号が逆（賃金上昇は消費に有利）。self（前値）は不変。
  optimistic: { sentiment: +3, cost: -0.02, rate: 0, income: +0.01, self: 0 },
  base: { sentiment: 0, cost: 0, rate: 0, income: 0, self: 0 },
  pessimistic: { sentiment: -3, cost: +0.02, rate: +0.001, income: -0.01, self: 0 },
};

/** ドライバー ID から種別を判定する。 */
export function driverClass(driverId: string): DriverClass {
  if (driverId.startsWith("household.")) return "self"; // 前値（AR項）
  if (driverId.startsWith("cao.")) return "sentiment";
  if (driverId === "boj.policy_rate") return "rate";
  if (driverId.startsWith("wage.")) return "income";
  // cpi.* / fut.* / boj.usdjpy などコスト・円安要因
  return "cost";
}

/** プリセットが与えるドライバーごとのシフト量（状態空間の平均に加える差分）。 */
export function driverShift(preset: Preset, driverId: string): number {
  return PRESETS[preset][driverClass(driverId)];
}

/** プリセットに沿った各ドライバーの水準パス（長さ = months）を作る。 */
export function buildPaths(
  driverIds: string[],
  months: number,
  preset: Preset,
  baseValues: Record<string, number> = {},
): DriverPath {
  const cfg = PRESETS[preset];
  const paths: DriverPath = {};
  for (const id of driverIds) {
    const base = Number.isFinite(baseValues[id]) ? baseValues[id] : 0;
    const value = base + cfg[driverClass(id)];
    paths[id] = Array.from({ length: months }, () => value);
  }
  return paths;
}

/** 指定ドライバーのパスのみ上書きした新しい DriverPath を返す（入力は不変）。 */
export function applyOverrides(
  paths: DriverPath,
  overrides: DriverPath,
): DriverPath {
  const out: DriverPath = {};
  for (const [k, v] of Object.entries(paths)) out[k] = [...v];
  for (const [k, v] of Object.entries(overrides)) out[k] = [...v];
  return out;
}
