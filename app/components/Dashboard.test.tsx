import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import Dashboard from "@/app/components/Dashboard";
import type {
  Backtest,
  Baseline,
  Coefficients,
  DriverForecastFile,
  SeriesFile,
  SourceMeta,
} from "@/app/lib/artifacts";

import coefficients from "@/public/data/coefficients.json";
import baseline from "@/public/data/baseline.json";
import backtest from "@/public/data/backtest.json";
import sources from "@/public/data/sources.json";

const driverForecasts: DriverForecastFile = {
  generated_at: "2026-06-22T00:00:00Z",
  horizon: 12,
  z: 1.2816,
  drivers: [
    {
      driver: "cpi.food",
      label_ja: "食料価格(CPI)",
      unit: "index",
      points: [
        { date: "2024-01-01", actual: 0.03, backcast: 0.028 },
        { date: "2024-02-01", mean: 0.031, std: 0.01 },
      ],
    },
    {
      driver: "cpi.clothing",
      label_ja: "被服価格(CPI)",
      unit: "index",
      points: [
        { date: "2024-01-01", actual: 0.01, backcast: 0.009 },
        { date: "2024-02-01", mean: 0.011, std: 0.02 },
      ],
    },
  ],
};

const seriesFile: SeriesFile = {
  generated_at: "2026-06-22T00:00:00Z",
  series: [
    {
      series_id: "cpi.food",
      name: "総務省 消費者物価指数",
      url: "https://www.stat.go.jp/data/cpi/",
      unit: "index",
      frequency: "monthly",
      points: [
        { date: "2024-01-01", value: 105.3 },
        { date: "2024-02-01", value: 105.9 },
      ],
    },
  ],
};

function renderDashboard(
  dff: DriverForecastFile | null = null,
  series: SeriesFile | null = null,
) {
  return render(
    <Dashboard
      coefficients={coefficients as Coefficients}
      baseline={baseline as Baseline}
      backtest={backtest as Backtest}
      sources={sources as SourceMeta[]}
      series={series}
      driverForecasts={dff}
    />,
  );
}

describe("Dashboard tabs", () => {
  it("shows the scenario tab (with fit scatter at the bottom) by default", () => {
    renderDashboard();
    expect(screen.getByTestId("tab-scenario")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-chart")).toBeInTheDocument();
    expect(screen.getByTestId("driver-sliders")).toBeInTheDocument();
    expect(screen.getByTestId("decomposition-chart")).toBeInTheDocument();
    expect(screen.getByTestId("fit-scatter")).toBeInTheDocument(); // moved here
    // model/data panels are not mounted until their tab is selected
    expect(screen.queryByTestId("model-explanation")).toBeNull();
    expect(screen.queryByTestId("source-tables")).toBeNull();
  });

  it("switches to the model tab and shows explanation + backtest (no scatter)", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("tab", { name: "モデル解説" }));
    expect(screen.getByTestId("model-explanation")).toBeInTheDocument();
    expect(screen.getByTestId("backtest-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("fit-scatter")).toBeNull(); // now on the scenario tab
  });

  it("switches to the data tab and shows source tables + citations", () => {
    renderDashboard(null, seriesFile);
    fireEvent.click(screen.getByRole("tab", { name: "データソース" }));
    expect(screen.getByTestId("source-tables")).toBeInTheDocument();
    expect(screen.getByTestId("series-cpi.food")).toBeInTheDocument();
    expect(screen.getByTestId("source-panel")).toBeInTheDocument();
  });
});

describe("Dashboard scenario interactions", () => {
  it("updates the forecast when a driver slider moves", () => {
    renderDashboard();
    const before = screen.getByTestId("food-next").textContent;
    const sliders = within(screen.getByTestId("driver-sliders")).getAllByRole(
      "slider",
    );
    fireEvent.change(sliders[0], { target: { value: "9" } });
    expect(screen.getByTestId("food-next").textContent).not.toEqual(before);
  });

  it("switching presets changes driver values", () => {
    renderDashboard();
    const base = screen.getByTestId("food-next").textContent;
    fireEvent.click(screen.getByRole("button", { name: "悲観" }));
    expect(screen.getByTestId("food-next").textContent).not.toEqual(base);
  });

  it("toggling 3-month average adds MA fields to the chart data", () => {
    renderDashboard();
    expect(screen.getByTestId("forecast-data").textContent).not.toMatch(/MA/);
    fireEvent.click(screen.getByLabelText("3カ月平均を表示"));
    expect(screen.getByTestId("forecast-data").textContent).toMatch(/MA/);
  });

  it("decomposition switches with the active category", () => {
    renderDashboard();
    const food = screen.getByTestId("decomposition-data").textContent;
    fireEvent.click(screen.getByRole("button", { name: "衣料" }));
    expect(screen.getByTestId("decomposition-data").textContent).not.toEqual(food);
  });

  it("shows the driver forecast in a separate chart and switches driver", () => {
    renderDashboard(driverForecasts);
    expect(screen.getByTestId("driver-section")).toBeInTheDocument();
    const chart = screen.getByTestId("driver-chart");
    const first = within(chart).getByTestId("driver-chart-data").textContent;
    fireEvent.change(screen.getByLabelText("ドライバー選択"), {
      target: { value: "cpi.clothing" },
    });
    const second = screen.getByTestId("driver-chart-data").textContent;
    expect(second).not.toEqual(first);
  });

  it("has no driver section when driver forecasts are absent", () => {
    renderDashboard(null);
    expect(screen.queryByTestId("driver-section")).toBeNull();
  });
});
