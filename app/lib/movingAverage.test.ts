import { describe, it, expect } from "vitest";
import { movingAverage } from "@/app/lib/movingAverage";

describe("movingAverage", () => {
  it("computes a trailing window mean", () => {
    const out = movingAverage([3, 6, 9, 12], 3);
    // first two positions lack a full window
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo((3 + 6 + 9) / 3);
    expect(out[3]).toBeCloseTo((6 + 9 + 12) / 3);
  });

  it("returns null where the window contains a null", () => {
    const out = movingAverage([1, null, 3, 4, 5], 3);
    expect(out[2]).toBeNull(); // window has a null
    expect(out[3]).toBeNull(); // window has a null
    expect(out[4]).toBeCloseTo((3 + 4 + 5) / 3);
  });

  it("keeps output length equal to input", () => {
    expect(movingAverage([1, 2, 3], 2)).toHaveLength(3);
  });
});
