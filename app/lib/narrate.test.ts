import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isLlmNarrationEnabled,
  narrate,
  type Contribution,
} from "@/app/lib/narrate";

const contributions: Contribution[] = [
  { driver: "fut.cotton", label: "綿先物", value: -0.012 },
  { driver: "cao.watcher.outlook", label: "景気ウォッチャー先行きDI", value: 0.008 },
  { driver: "cpi.food", label: "食料価格(CPI)", value: -0.003 },
  { driver: "boj.usdjpy", label: "ドル円", value: 0.0 },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("narrate", () => {
  it("mentions the largest up and down drivers with signed magnitudes", () => {
    const text = narrate(contributions, { topN: 1 });
    expect(text).toContain("綿先物");
    expect(text).toContain("-1.2%");
    expect(text).toContain("押下げ");
    expect(text).toContain("景気ウォッチャー先行きDI");
    expect(text).toContain("+0.8%");
    expect(text).toContain("押上げ");
  });

  it("ignores zero-contribution drivers", () => {
    const text = narrate(contributions);
    expect(text).not.toContain("ドル円");
  });

  it("handles the all-quiet case", () => {
    const text = narrate([{ driver: "x", label: "X", value: 0 }]);
    expect(text).toMatch(/小さい/);
  });

  it("reflects sign: a positive driver reads as 押上げ", () => {
    const text = narrate([{ driver: "a", label: "A", value: 0.05 }]);
    expect(text).toContain("A");
    expect(text).toContain("押上げ");
    expect(text).not.toContain("押下げ");
  });
});

describe("isLlmNarrationEnabled", () => {
  it("defaults to false", () => {
    expect(isLlmNarrationEnabled()).toBe(false);
  });

  it("is true only when the flag is exactly 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LLM_NARRATION", "true");
    expect(isLlmNarrationEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LLM_NARRATION", "1");
    expect(isLlmNarrationEnabled()).toBe(false);
  });
});
