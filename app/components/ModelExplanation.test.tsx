import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import ModelExplanation from "@/app/components/ModelExplanation";
import type { Backtest, Coefficients } from "@/app/lib/artifacts";

const coefficients: Coefficients = {
  generated_at: "2026-06-22T00:00:00Z",
  categories: [
    {
      category: "food",
      intercept: 0.12,
      drivers: [
        { driver: "cpi.food", label_ja: "食料価格(CPI)", coef: -0.17, lag_months: 1 },
      ],
      r2: 0.61,
      model_version: "v1",
      data_vintage: "2024-05-01",
    },
    {
      category: "clothing",
      intercept: -0.03,
      drivers: [
        { driver: "cpi.clothing", label_ja: "被服価格(CPI)", coef: 0.2, lag_months: 1 },
      ],
      r2: 0.4,
      model_version: "v1",
      data_vintage: "2024-05-01",
    },
  ],
};

const backtest: Backtest = {
  window: "expanding, horizon=3",
  metrics: [
    {
      category: "food",
      mae: 0.02,
      rmse: 0.03,
      direction_hit: 0.66,
      medae: 0.015,
      naive_mae: 0.03,
      naive_rmse: 0.04,
      naive_medae: 0.02,
      naive_direction_hit: 0.5,
      beats_naive: true,
      passes_gate: true,
    },
  ],
};

describe("ModelExplanation", () => {
  it("renders each category's drivers, R2 and backtest verdict", () => {
    render(<ModelExplanation coefficients={coefficients} backtest={backtest} />);
    const food = screen.getByTestId("model-food");
    expect(within(food).getByText("食料価格(CPI)")).toBeInTheDocument();
    expect(within(food).getByText(/R²=0.61/)).toBeInTheDocument();
    expect(within(food).getByText("合格")).toBeInTheDocument();
    expect(screen.getByTestId("model-clothing")).toBeInTheDocument();
    expect(screen.getByTestId("driver-food-cpi.food")).toBeInTheDocument();
  });
});
