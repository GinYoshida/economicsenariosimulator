import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import BacktestPanel from "@/app/components/BacktestPanel";
import type { Backtest } from "@/app/lib/artifacts";

const backtest: Backtest = {
  window: "expanding, horizon=3, min_train=24",
  metrics: [
    {
      category: "food",
      mae: 0.02,
      rmse: 0.03,
      direction_hit: 0.66,
      naive_mae: 0.03,
      naive_rmse: 0.04,
      naive_direction_hit: 0.5,
      beats_naive: true,
    },
    {
      category: "clothing",
      mae: 0.05,
      rmse: 0.06,
      direction_hit: 0.4,
      naive_mae: 0.04,
      naive_rmse: 0.05,
      naive_direction_hit: 0.45,
      beats_naive: false,
    },
  ],
};

describe("BacktestPanel", () => {
  it("shows the naive-gate verdict per category", () => {
    render(<BacktestPanel backtest={backtest} />);
    const food = screen.getByTestId("bt-food");
    expect(within(food).getByText("ナイーブ超え")).toBeInTheDocument();
    const clothing = screen.getByTestId("bt-clothing");
    expect(within(clothing).getByText("ナイーブ未達")).toBeInTheDocument();
    expect(screen.getByText(/expanding, horizon=3/)).toBeInTheDocument();
  });
});
