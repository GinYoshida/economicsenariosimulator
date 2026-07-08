import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadBacktest,
  loadBaseline,
  loadCoefficients,
  loadSeries,
  loadSources,
  toScenarioModel,
  type Backtest,
  type Baseline,
  type Coefficients,
  type SourceMeta,
} from "@/app/lib/artifacts";
import { computeForecast } from "@/app/lib/scenario";

import coefficientsSample from "@/public/data/coefficients.json";
import baselineSample from "@/public/data/baseline.json";
import backtestSample from "@/public/data/backtest.json";
import sourcesSample from "@/public/data/sources.json";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sample artifacts conform to types", () => {
  it("coefficients sample has both categories with labelled drivers", () => {
    const c = coefficientsSample as Coefficients;
    const cats = c.categories.map((x) => x.category);
    expect(cats).toContain("food");
    expect(cats).toContain("clothing");
    for (const cat of c.categories) {
      expect(cat.drivers.length).toBeGreaterThan(0);
      for (const d of cat.drivers) {
        expect(typeof d.label_ja).toBe("string");
        expect(typeof d.coef).toBe("number");
      }
    }
  });

  it("baseline sample has history and a 3-month forecast", () => {
    const b = baselineSample as Baseline;
    expect(b.history.length).toBeGreaterThan(0);
    expect(b.forecast).toHaveLength(3);
  });

  it("backtest sample carries naive comparison fields", () => {
    const bt = backtestSample as Backtest;
    for (const m of bt.metrics) {
      expect(typeof m.beats_naive).toBe("boolean");
      expect(typeof m.naive_mae).toBe("number");
    }
  });

  it("sources sample is a non-empty provenance list", () => {
    const s = sourcesSample as SourceMeta[];
    expect(Array.isArray(s)).toBe(true);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].url.startsWith("http")).toBe(true);
  });

  it("toScenarioModel maps lag_months to lagMonths and stays computable", () => {
    const c = coefficientsSample as Coefficients;
    const model = toScenarioModel(c.categories[0]);
    expect(model.drivers[0]).toHaveProperty("lagMonths");
    const drivers = Object.fromEntries(
      model.drivers.map((d) => [d.driver, [1, 1, 1]]),
    );
    expect(computeForecast(model, drivers, 3)).toHaveLength(3);
  });
});

describe("loaders fetch and parse JSON", () => {
  function stubFetch(payload: unknown, ok = true, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, status, json: async () => payload })),
    );
  }

  it("loadCoefficients returns parsed payload", async () => {
    stubFetch(coefficientsSample);
    const c = await loadCoefficients();
    expect(c.categories.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith("/data/coefficients.json");
  });

  it("loadBaseline / loadBacktest / loadSources hit the right paths", async () => {
    stubFetch(baselineSample);
    await loadBaseline();
    expect(fetch).toHaveBeenCalledWith("/data/baseline.json");

    stubFetch(backtestSample);
    await loadBacktest();
    expect(fetch).toHaveBeenCalledWith("/data/backtest.json");

    stubFetch(sourcesSample);
    await loadSources();
    expect(fetch).toHaveBeenCalledWith("/data/sources.json");
  });

  it("throws on a non-ok response", async () => {
    stubFetch({}, false, 404);
    await expect(loadCoefficients()).rejects.toThrow(/Failed to load/);
  });

  it("loadSeries returns null when series.json is absent (404)", async () => {
    stubFetch({}, false, 404);
    await expect(loadSeries()).resolves.toBeNull();
  });

  it("loadSeries returns the parsed file when present", async () => {
    const payload = { generated_at: "2026-06-22T00:00:00Z", series: [] };
    stubFetch(payload);
    await expect(loadSeries()).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith("/data/series.json");
  });
});
