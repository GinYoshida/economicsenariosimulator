import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import DriverChart from "@/app/components/DriverChart";
import type { DriverForecast } from "@/app/lib/artifacts";

const driver: DriverForecast = {
  driver: "cpi.food",
  label_ja: "食料価格(CPI)",
  unit: "index",
  points: [
    { date: "2024-01-01", actual: 0.03, backcast: 0.028 },
    { date: "2024-02-01", actual: 0.031, backcast: 0.03 },
    { date: "2024-03-01", mean: 0.032, std: 0.01 },
    { date: "2024-04-01", mean: 0.033, std: 0.015 },
  ],
};

describe("DriverChart", () => {
  it("renders actual/backcast history and forecast rows", () => {
    render(<DriverChart driver={driver} z={2} />);
    expect(screen.getByTestId("driver-chart")).toBeInTheDocument();
    const items = within(screen.getByTestId("driver-chart-data")).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(4);
    const text = items.map((i) => i.textContent).join("\n");
    expect(text).toMatch(/history/);
    expect(text).toMatch(/forecast/);
    expect(screen.getByText(/食料価格\(CPI\)/)).toBeInTheDocument();
  });
});
