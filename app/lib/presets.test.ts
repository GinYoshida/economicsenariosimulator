import { describe, it, expect } from "vitest";
import {
  PRESETS,
  applyOverrides,
  buildPaths,
  driverClass,
} from "@/app/lib/presets";

const drivers = ["cao.cci.attitude", "fut.wheat", "boj.policy_rate"];
const baseValues = {
  "cao.cci.attitude": 38,
  "fut.wheat": 600,
  "boj.policy_rate": 0.1,
};

describe("driverClass", () => {
  it("classifies sentiment, cost and rate drivers", () => {
    expect(driverClass("cao.watcher.outlook")).toBe("sentiment");
    expect(driverClass("fut.cotton")).toBe("cost");
    expect(driverClass("cpi.food")).toBe("cost");
    expect(driverClass("boj.usdjpy")).toBe("cost");
    expect(driverClass("boj.policy_rate")).toBe("rate");
  });
});

describe("buildPaths", () => {
  it("base preset returns flat paths at base values", () => {
    const paths = buildPaths(drivers, 3, "base", baseValues);
    expect(paths["fut.wheat"]).toEqual([600, 600, 600]);
    expect(paths["cao.cci.attitude"]).toHaveLength(3);
  });

  it("defaults missing base values to zero", () => {
    const paths = buildPaths(["fut.wheat"], 2, "base");
    expect(paths["fut.wheat"]).toEqual([0, 0]);
  });

  it("optimistic raises sentiment and lowers cost vs base", () => {
    const base = buildPaths(drivers, 1, "base", baseValues);
    const opt = buildPaths(drivers, 1, "optimistic", baseValues);
    expect(opt["cao.cci.attitude"][0]).toBeGreaterThan(base["cao.cci.attitude"][0]);
    expect(opt["fut.wheat"][0]).toBeLessThan(base["fut.wheat"][0]);
  });

  it("pessimistic lowers sentiment and raises cost vs base", () => {
    const base = buildPaths(drivers, 1, "base", baseValues);
    const pes = buildPaths(drivers, 1, "pessimistic", baseValues);
    expect(pes["cao.cci.attitude"][0]).toBeLessThan(base["cao.cci.attitude"][0]);
    expect(pes["fut.wheat"][0]).toBeGreaterThan(base["fut.wheat"][0]);
  });

  it("exposes the three presets", () => {
    expect(Object.keys(PRESETS).sort()).toEqual([
      "base",
      "optimistic",
      "pessimistic",
    ]);
  });
});

describe("applyOverrides", () => {
  it("replaces only the overridden driver path", () => {
    const paths = buildPaths(drivers, 3, "base", baseValues);
    const out = applyOverrides(paths, { "fut.wheat": [700, 710, 720] });
    expect(out["fut.wheat"]).toEqual([700, 710, 720]);
    // others untouched
    expect(out["cao.cci.attitude"]).toEqual(paths["cao.cci.attitude"]);
  });

  it("does not mutate the input paths", () => {
    const paths = buildPaths(drivers, 1, "base", baseValues);
    const snapshot = JSON.stringify(paths);
    applyOverrides(paths, { "fut.wheat": [999] });
    expect(JSON.stringify(paths)).toBe(snapshot);
  });
});
