// 自然言語解釈レイヤ（v1: テンプレベースの決定論的文章生成）。
//
// 原則: 数値は必ず成果物JSON由来（要因分解の寄与）を使う。LLM は将来
// feature flag 経由で「言い回し」だけを差し替える想定で、数値は生成させない。

export type Contribution = { driver: string; label: string; value: number };

/** LLM 文章生成が有効か（既定 false）。本実装は別計画。 */
export function isLlmNarrationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_LLM_NARRATION === "true";
}

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

/**
 * 要因分解から決定論的な説明文を作る。寄与の大きい順に押上げ/押下げを述べる。
 * 数値は contributions（成果物由来）をそのまま使い、創作しない。
 */
export function narrate(
  contributions: Contribution[],
  options: { topN?: number } = {},
): string {
  const topN = options.topN ?? 2;
  const nonZero = contributions.filter((c) => c.value !== 0);
  if (nonZero.length === 0) {
    return "主要因による前年比への押上げ・押下げは小さい状況です。";
  }

  const sorted = [...nonZero].sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value),
  );
  const ups = sorted.filter((c) => c.value > 0).slice(0, topN);
  const downs = sorted.filter((c) => c.value < 0).slice(0, topN);

  const parts: string[] = [];
  for (const c of ups) {
    parts.push(`${c.label}が${pct(c.value)}押上げ`);
  }
  for (const c of downs) {
    parts.push(`${c.label}が${pct(c.value)}押下げ`);
  }
  return `${parts.join("、")}しています。`;
}
