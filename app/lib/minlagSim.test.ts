import { describe, it, expect } from "vitest";

import {
  buildLinearPath,
  monthOf,
  simulateConsumption,
} from "@/app/lib/minlagSim";
import type { MinlagCategory } from "@/app/lib/artifacts";

describe("monthOf", () => {
  it("extracts the month number", () => {
    expect(monthOf("2026-07-01")).toBe(7);
    expect(monthOf("2026-01-01")).toBe(1);
  });
});

describe("buildLinearPath", () => {
  it("interpolates start -> landing over the horizon", () => {
    // start=0, landing=4, months=4 -> 1,2,3,4
    expect(buildLinearPath(0, 4, 4)).toEqual([1, 2, 3, 4]);
  });
  it("stays flat when landing equals start", () => {
    expect(buildLinearPath(2, 2, 3)).toEqual([2, 2, 2]);
  });
});

const MODEL: MinlagCategory = {
  category: "food",
  intercept_by_month: Array.from({ length: 12 }, () => 0), // 季節ゼロ
  ar_coef: 0.5,
  ar_driver: "household.food.real_yoy",
  drivers: [{ driver: "cpi.food", label_ja: "食料価格", unit: "index", coef: 2 }],
  r2: 0.5,
  resid_std: 0.1,
};

describe("simulateConsumption", () => {
  it("applies drivers, AR recursion and monthly intercept", () => {
    // driver path constant 1 -> contribution 2 each step; ar=0.5, start y=0
    const paths = { "cpi.food": [1, 1, 1] };
    const sim = simulateConsumption(MODEL, paths, 0, "2025-12-01", 3);
    // t1: 0 + 2*1 + 0.5*0 = 2
    // t2: 0 + 2*1 + 0.5*2 = 3
    // t3: 0 + 2*1 + 0.5*3 = 3.5
    expect(sim.map((p) => p.mean)).toEqual([2, 3, 3.5]);
    expect(sim.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("propagates residual variance through the AR term (bands widen)", () => {
    const paths = { "cpi.food": [0, 0, 0] };
    const sim = simulateConsumption(MODEL, paths, 0, "2025-12-01", 3);
    // sd_1 = 0.1; var grows: var_t = 0.01 + 0.25*var_{t-1}
    expect(sim[0].sd).toBeCloseTo(0.1, 6);
    expect(sim[1].sd).toBeGreaterThan(sim[0].sd);
    expect(sim[2].sd).toBeGreaterThan(sim[1].sd);
  });

  it("uses the month-specific intercept", () => {
    const seasonal: MinlagCategory = {
      ...MODEL,
      ar_coef: 0,
      drivers: [],
      intercept_by_month: Array.from({ length: 12 }, (_, i) => (i === 0 ? 0.05 : 0)),
    };
    // start at 2025-12 -> first step 2026-01 (month index 0) uses 0.05
    const sim = simulateConsumption(seasonal, {}, 0, "2025-12-01", 1);
    expect(sim[0].mean).toBeCloseTo(0.05, 6);
  });
});
