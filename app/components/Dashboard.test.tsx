import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import Dashboard from "@/app/components/Dashboard";
import type {
  Backtest,
  Baseline,
  Coefficients,
  DriverForecastFile,
  MinlagModelFile,
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

// ラグ最小の翻訳器モデル（合成フィクスチャ）。
const minlag: MinlagModelFile = {
  generated_at: "2026-06-22T00:00:00Z",
  data_vintage: "2024-01-01",
  categories: [
    {
      category: "food",
      intercept_by_month: Array.from({ length: 12 }, () => 0),
      ar_coef: 0.3,
      ar_driver: "household.food.real_yoy",
      drivers: [
        { driver: "cpi.food", label_ja: "食料価格(CPI)", unit: "index", coef: 2 },
      ],
      r2: 0.5,
      resid_std: 0.02,
    },
    {
      category: "clothing",
      intercept_by_month: Array.from({ length: 12 }, () => 0),
      ar_coef: 0.2,
      ar_driver: "household.clothing.real_yoy",
      drivers: [
        { driver: "cpi.clothing", label_ja: "被服価格(CPI)", unit: "index", coef: 1 },
      ],
      r2: 0.4,
      resid_std: 0.03,
    },
  ],
  fit: [
    { category: "food", date: "2024-01-01", actual: 0.02, predicted: 0.018 },
    { category: "clothing", date: "2024-01-01", actual: 0.01, predicted: 0.012 },
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

function renderDashboard(opts: {
  dff?: DriverForecastFile | null;
  series?: SeriesFile | null;
  mm?: MinlagModelFile | null;
} = {}) {
  const { dff = driverForecasts, series = null, mm = minlag } = opts;
  return render(
    <Dashboard
      coefficients={coefficients as Coefficients}
      baseline={baseline as Baseline}
      backtest={backtest as Backtest}
      sources={sources as SourceMeta[]}
      series={series}
      driverForecasts={dff}
      minlag={mm}
    />,
  );
}

describe("Dashboard tabs", () => {
  it("shows the simulator scenario tab by default", () => {
    renderDashboard();
    expect(screen.getByTestId("tab-scenario")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-chart-food")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-chart-clothing")).toBeInTheDocument();
    expect(screen.getByTestId("driver-reads")).toBeInTheDocument();
    expect(screen.getByTestId("fit-scatter")).toBeInTheDocument();
    expect(screen.queryByTestId("model-explanation")).toBeNull();
    expect(screen.queryByTestId("source-tables")).toBeNull();
  });

  it("switches to the model tab (explanation + backtest)", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("tab", { name: "モデル解説" }));
    expect(screen.getByTestId("model-explanation")).toBeInTheDocument();
    expect(screen.getByTestId("backtest-panel")).toBeInTheDocument();
  });

  it("switches to the data tab (source tables + citations)", () => {
    renderDashboard({ series: seriesFile });
    fireEvent.click(screen.getByRole("tab", { name: "データソース" }));
    expect(screen.getByTestId("source-tables")).toBeInTheDocument();
    expect(screen.getByTestId("series-cpi.food")).toBeInTheDocument();
    expect(screen.getByTestId("source-panel")).toBeInTheDocument();
  });

  it("shows a fallback when the min-lag model is missing", () => {
    renderDashboard({ mm: null });
    expect(screen.getByTestId("tab-scenario")).toHaveTextContent("未生成");
    expect(screen.queryByTestId("forecast-chart-food")).toBeNull();
  });
});

describe("Simulator interactions", () => {
  it("updates the consumption forecast when a driver landing changes", () => {
    renderDashboard();
    const before = screen.getByTestId("food-next").textContent;
    const input = screen.getByLabelText("食料価格(CPI)の着地値");
    fireEvent.change(input, { target: { value: "0.2" } });
    expect(screen.getByTestId("food-next").textContent).not.toEqual(before);
  });

  it("changes the forecast horizon", () => {
    renderDashboard();
    const sel = screen.getByLabelText("予測期間（か月先）");
    fireEvent.change(sel, { target: { value: "3" } });
    expect((sel as HTMLSelectElement).value).toBe("3");
  });

  it("saves up to three scenarios and disables further saving", () => {
    renderDashboard();
    const save = screen.getByRole("button", { name: "この想定を保存" });
    fireEvent.click(save);
    expect(screen.getByTestId("scenario-compare")).toBeInTheDocument();
    fireEvent.click(save);
    fireEvent.click(save);
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes a saved scenario", () => {
    renderDashboard();
    const save = screen.getByRole("button", { name: "この想定を保存" });
    fireEvent.click(save);
    fireEvent.click(screen.getByRole("button", { name: "想定1を削除" }));
    expect(screen.queryByTestId("scenario-compare")).toBeNull();
  });

  it("shows the selected driver's state-space forecast chart", () => {
    renderDashboard();
    expect(screen.getByTestId("driver-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("driver-chart")).toBeInTheDocument();
  });

  it("resets landings to the model forecast", () => {
    renderDashboard();
    const input = screen.getByLabelText("食料価格(CPI)の着地値") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "モデル予測に戻す" }));
    // reset -> back to the model landing (0.031), not the edited 0.25
    expect(Number(input.value)).toBeCloseTo(0.031, 3);
  });
});
