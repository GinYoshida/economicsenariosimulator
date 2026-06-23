import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import Dashboard from "@/app/components/Dashboard";
import type {
  Backtest,
  Baseline,
  Coefficients,
  SourceMeta,
} from "@/app/lib/artifacts";

import coefficients from "@/public/data/coefficients.json";
import baseline from "@/public/data/baseline.json";
import backtest from "@/public/data/backtest.json";
import sources from "@/public/data/sources.json";

function renderDashboard() {
  return render(
    <Dashboard
      coefficients={coefficients as Coefficients}
      baseline={baseline as Baseline}
      backtest={backtest as Backtest}
      sources={sources as SourceMeta[]}
    />,
  );
}

describe("Dashboard", () => {
  it("renders all panels", () => {
    renderDashboard();
    expect(screen.getByTestId("forecast-chart")).toBeInTheDocument();
    expect(screen.getByTestId("driver-sliders")).toBeInTheDocument();
    expect(screen.getByTestId("decomposition-chart")).toBeInTheDocument();
    expect(screen.getByTestId("backtest-panel")).toBeInTheDocument();
    expect(screen.getByTestId("source-panel")).toBeInTheDocument();
  });

  it("updates the forecast when a driver slider moves", () => {
    renderDashboard();
    const before = screen.getByTestId("food-next").textContent;
    // pick the first slider and move it
    const sliders = within(screen.getByTestId("driver-sliders")).getAllByRole(
      "slider",
    );
    fireEvent.change(sliders[0], { target: { value: "9" } });
    const after = screen.getByTestId("food-next").textContent;
    expect(after).not.toEqual(before);
  });

  it("switching presets changes driver values", () => {
    renderDashboard();
    const foodBase = screen.getByTestId("food-next").textContent;
    fireEvent.click(screen.getByRole("button", { name: "悲観" }));
    const foodPessimistic = screen.getByTestId("food-next").textContent;
    expect(foodPessimistic).not.toEqual(foodBase);
  });

  it("forecast data includes history and forecast rows", () => {
    renderDashboard();
    const items = within(screen.getByTestId("forecast-data")).getAllByRole(
      "listitem",
    );
    const text = items.map((i) => i.textContent ?? "").join("\n");
    expect(text).toMatch(/history/);
    expect(text).toMatch(/forecast/);
  });

  it("decomposition switches with the active category", () => {
    renderDashboard();
    const foodDecomp = screen.getByTestId("decomposition-data").textContent;
    fireEvent.click(screen.getByRole("button", { name: "衣料" }));
    const clothingDecomp = screen.getByTestId("decomposition-data").textContent;
    expect(clothingDecomp).not.toEqual(foodDecomp);
  });
});
