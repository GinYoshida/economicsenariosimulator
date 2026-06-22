import { describe, it, expect } from "vitest";
import {
  computeForecast,
  decompose,
  type CategoryCoef,
} from "@/app/lib/scenario";

const model: CategoryCoef = {
  intercept: 1,
  drivers: [
    { driver: "a", coef: 2, lagMonths: 0 },
    { driver: "b", coef: -3, lagMonths: 1 },
  ],
};

describe("computeForecast", () => {
  it("computes intercept + sum(coef * driver[t - lag])", () => {
    const drivers = { a: [10, 20, 30], b: [1, 2, 3] };
    const out = computeForecast(model, drivers, 3);
    // t0: 1 + 2*10 + (-3)*b[-1->oob=0] = 21
    // t1: 1 + 2*20 + (-3)*b[0]=1      = 1+40-3 = 38
    // t2: 1 + 2*30 + (-3)*b[1]=2      = 1+60-6 = 55
    expect(out).toEqual([21, 38, 55]);
  });

  it("treats out-of-range lagged values as zero contribution", () => {
    const m: CategoryCoef = {
      intercept: 0,
      drivers: [{ driver: "a", coef: 5, lagMonths: 2 }],
    };
    const out = computeForecast(m, { a: [4, 8, 16] }, 3);
    // t0,t1 -> a[-2],a[-1] oob -> 0 ; t2 -> a[0]=4 -> 20
    expect(out).toEqual([0, 0, 20]);
  });

  it("returns the requested number of months", () => {
    const out = computeForecast(model, { a: [1, 1, 1, 1], b: [1, 1, 1, 1] }, 4);
    expect(out).toHaveLength(4);
  });

  it("ignores drivers missing from the path (zero contribution)", () => {
    const out = computeForecast(model, { a: [10, 10, 10] }, 1);
    // b missing -> 0; t0: 1 + 2*10 = 21
    expect(out[0]).toBe(21);
  });
});

describe("decompose", () => {
  it("returns per-driver contributions coef*value", () => {
    const contrib = decompose(model, { a: 10, b: 2 });
    expect(contrib).toEqual({ a: 20, b: -6 });
  });

  it("contributions plus intercept equal the prediction", () => {
    const driversAt = { a: 7, b: 5 };
    const contrib = decompose(model, driversAt);
    const total =
      model.intercept + Object.values(contrib).reduce((s, v) => s + v, 0);
    // single-point forecast with lag 0 alignment
    expect(total).toBe(1 + 2 * 7 - 3 * 5);
  });

  it("treats missing driver values as zero", () => {
    const contrib = decompose(model, { a: 10 });
    expect(contrib).toEqual({ a: 20, b: 0 });
  });
});
