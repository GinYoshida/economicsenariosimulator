import { describe, it, expect } from "vitest";
import {
  addMonths,
  computeFanForecast,
  type DriverForecastLookup,
  type FanModel,
} from "@/app/lib/fanForecast";

const model: FanModel = {
  intercept: 0,
  residStd: 0,
  drivers: [{ driver: "a", coef: 2, lagMonths: 0 }],
};

const lookup: DriverForecastLookup = {
  a: {
    "2024-02-01": { mean: 10, std: 1 },
    "2024-03-01": { mean: 20, std: 2 },
  },
};

describe("addMonths", () => {
  it("adds and subtracts months across year boundaries", () => {
    expect(addMonths("2024-12-01", 1)).toBe("2025-01-01");
    expect(addMonths("2024-01-01", -2)).toBe("2023-11-01");
  });
});

describe("computeFanForecast", () => {
  it("propagates driver mean and variance into a band", () => {
    const out = computeFanForecast(model, lookup, {
      lastTargetDate: "2024-01-01",
      horizon: 2,
      z: 2,
    });
    // h1: mean 2*10=20, sd=sqrt(2^2*1^2)=2 -> [16,24]
    expect(out[0]).toEqual({ date: "2024-02-01", mean: 20, low: 16, high: 24 });
    // h2: mean 40, sd=sqrt(4*4)=4 -> [32,48]
    expect(out[1]).toEqual({ date: "2024-03-01", mean: 40, low: 32, high: 48 });
  });

  it("pinned overrides are certain (zero band contribution)", () => {
    const out = computeFanForecast(model, lookup, {
      lastTargetDate: "2024-01-01",
      horizon: 1,
      z: 2,
      overrides: { a: 5 },
    });
    expect(out[0]).toEqual({ date: "2024-02-01", mean: 10, low: 10, high: 10 });
  });

  it("applies a preset shift to the driver mean", () => {
    const out = computeFanForecast(model, lookup, {
      lastTargetDate: "2024-01-01",
      horizon: 1,
      z: 2,
      shift: () => 1,
    });
    expect(out[0].mean).toBe(2 * (10 + 1));
  });

  it("adds residual variance to the band", () => {
    const out = computeFanForecast(
      { intercept: 0, residStd: 3, drivers: [] },
      {},
      { lastTargetDate: "2024-01-01", horizon: 1, z: 1 },
    );
    expect(out[0]).toEqual({ date: "2024-02-01", mean: 0, low: -3, high: 3 });
  });
});
