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
  it("passes food (beats naive + directional skill) and flags clothing", () => {
    render(<BacktestPanel backtest={backtest} />);
    // food: beats_naive + direction 0.66 -> 合格
    expect(within(screen.getByTestId("bt-food")).getByText("合格")).toBeInTheDocument();
    // clothing: does not beat naive -> 要改善
    expect(
      within(screen.getByTestId("bt-clothing")).getByText("要改善"),
    ).toBeInTheDocument();
    expect(screen.getByText(/expanding, horizon=3/)).toBeInTheDocument();
  });

  it("flags a MAE-only win without directional skill as 要改善", () => {
    const maeOnly: Backtest = {
      window: "w",
      metrics: [
        {
          category: "clothing",
          mae: 0.071,
          rmse: 0.09,
          medae: 0.05,
          direction_hit: 0.498, // no directional skill
          naive_mae: 0.086,
          naive_rmse: 0.1,
          naive_medae: 0.06,
          naive_direction_hit: 0.5,
          beats_naive: true, // MAE wins...
          passes_gate: false, // ...but the gate rejects it
        },
      ],
    };
    render(<BacktestPanel backtest={maeOnly} />);
    expect(
      within(screen.getByTestId("bt-clothing")).getByText("要改善"),
    ).toBeInTheDocument();
  });
});
