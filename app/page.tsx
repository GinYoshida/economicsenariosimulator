"use client";

import { useEffect, useState } from "react";

import Dashboard from "@/app/components/Dashboard";
import {
  loadBacktest,
  loadBaseline,
  loadCoefficients,
  loadDriverForecasts,
  loadMinlagModel,
  loadSeries,
  loadSources,
  type Backtest,
  type Baseline,
  type Coefficients,
  type DriverForecastFile,
  type MinlagModelFile,
  type SeriesFile,
  type SourceMeta,
} from "@/app/lib/artifacts";

type Artifacts = {
  coefficients: Coefficients;
  baseline: Baseline;
  backtest: Backtest;
  sources: SourceMeta[];
  series: SeriesFile | null;
  driverForecasts: DriverForecastFile | null;
  minlag: MinlagModelFile | null;
};

export default function Home() {
  const [data, setData] = useState<Artifacts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadCoefficients(),
      loadBaseline(),
      loadBacktest(),
      loadSources(),
      loadSeries(),
      loadDriverForecasts(),
      loadMinlagModel(),
    ])
      .then(
        ([coefficients, baseline, backtest, sources, series, driverForecasts, minlag]) =>
          setData({
            coefficients,
            baseline,
            backtest,
            sources,
            series,
            driverForecasts,
            minlag,
          }),
      )
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p role="alert" className="text-sm text-red-600">
          データの読み込みに失敗しました: {error}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
        <p className="text-base text-gray-500" role="status">
          Loading scenarios…
        </p>
      </main>
    );
  }

  return (
    <Dashboard
      coefficients={data.coefficients}
      baseline={data.baseline}
      backtest={data.backtest}
      sources={data.sources}
      series={data.series}
      driverForecasts={data.driverForecasts}
      minlag={data.minlag}
    />
  );
}
