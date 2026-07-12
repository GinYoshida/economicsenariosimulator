// シナリオ・プリセットと手動上書き。
//
// プリセットはドライバーの「水準パス」を生成する。base は与えた基準値
// （例: 先物の期待値・直近のDI水準）で横ばい。optimistic/pessimistic は
// ドライバー種別ごとに消費に有利/不利な向きへずらす（v1 の説明的仮定）。

import type { DriverPath } from "@/app/lib/scenario";

export type Preset = "optimistic" | "base" | "pessimistic";
export type DriverClass = "sentiment" | "cost" | "rate";

type PresetConfig = {
  // 各種別の base からのシフト量（ドライバー自身の単位）。
  sentiment: number;
  cost: number;
  rate: number;
};

export const PRESETS: Record<Preset, PresetConfig> = {
  optimistic: { sentiment: +3, cost: -0.02, rate: 0 },
  base: { sentiment: 0, cost: 0, rate: 0 },
  pessimistic: { sentiment: -3, cost: +0.02, rate: +0.001 },
};

/** ドライバー ID から種別を判定する。 */
export function driverClass(driverId: string): DriverClass {
  if (driverId.startsWith("cao.")) return "sentiment";
  if (driverId === "boj.policy_rate") return "rate";
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
