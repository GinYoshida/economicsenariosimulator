import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import FitScatter from "@/app/components/FitScatter";
import type { BacktestPoint } from "@/app/lib/artifacts";

const predictions: BacktestPoint[] = [
  { category: "food", date: "2024-01-01", actual: 0.02, predicted: 0.018 },
  { category: "food", date: "2024-02-01", actual: -0.01, predicted: 0.0 },
  { category: "clothing", date: "2024-01-01", actual: 0.05, predicted: 0.04 },
];

describe("FitScatter", () => {
  it("plots only the selected category's actual/predicted pairs", () => {
    render(<FitScatter predictions={predictions} category="food" />);
    const data = within(screen.getByTestId("fit-scatter-data")).getAllByRole(
      "listitem",
    );
    expect(data).toHaveLength(2); // two food points
    expect(screen.getByTestId("fit-scatter").textContent).toMatch(/n=2/);
  });

  it("shows a placeholder when there are no predictions", () => {
    render(<FitScatter predictions={[]} category="food" />);
    expect(screen.getByTestId("fit-scatter").textContent).toMatch(/次回バッチ/);
  });

  it("switches to a density grid and back", () => {
    render(<FitScatter predictions={predictions} category="food" />);
    expect(screen.queryByTestId("fit-density")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "密度" }));
    expect(screen.getByTestId("fit-density")).toBeInTheDocument();
    // density cells count the food points
    const cells = within(screen.getByTestId("fit-density-data")).getAllByRole(
      "listitem",
    );
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "散布図" }));
    expect(screen.queryByTestId("fit-density")).toBeNull();
  });
});
