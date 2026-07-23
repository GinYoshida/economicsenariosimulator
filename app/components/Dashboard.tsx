"use client";

import { useState } from "react";

import BacktestPanel from "@/app/components/BacktestPanel";
import ModelExplanation from "@/app/components/ModelExplanation";
import Simulator from "@/app/components/Simulator";
import SourcePanel from "@/app/components/SourcePanel";
import SourceTables from "@/app/components/SourceTables";
import {
  type Backtest,
  type Baseline,
  type Coefficients,
  type DriverForecastFile,
  type MinlagModelFile,
  type SeriesFile,
  type SourceMeta,
} from "@/app/lib/artifacts";

type Tab = "scenario" | "model" | "data";
const TAB_LABELS: Record<Tab, string> = {
  scenario: "シナリオ",
  model: "モデル解説",
  data: "データソース",
};

export default function Dashboard({
  coefficients,
  baseline,
  backtest,
  sources,
  series = null,
  driverForecasts = null,
  minlag = null,
}: {
  coefficients: Coefficients;
  baseline: Baseline;
  backtest: Backtest;
  sources: SourceMeta[];
  series?: SeriesFile | null;
  driverForecasts?: DriverForecastFile | null;
  minlag?: MinlagModelFile | null;
}) {
  const [tab, setTab] = useState<Tab>("scenario");
  const categories = coefficients.categories;

  return (
    <main className="mx-auto flex max-w-screen-sm flex-col gap-6 p-4">
      <header>
        <h1 className="text-lg font-bold">日本 消費シナリオ シミュレータ</h1>
        <p className="text-xs text-gray-500">
          食料・衣料の前年比を、あなたの前提（説明変数の読み）で試算（データ vintage:{" "}
          {categories[0]?.data_vintage ?? "—"}）
        </p>
      </header>

      <div role="tablist" aria-label="表示切替" className="flex gap-2 border-b border-gray-200">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t
                ? "border-blue-600 font-semibold text-blue-700"
                : "border-transparent text-gray-500"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "scenario" &&
        (minlag ? (
          <Simulator
            minlag={minlag}
            driverForecasts={driverForecasts}
            baseline={baseline}
            backtestFallback={backtest.predictions ?? []}
          />
        ) : (
          <p className="text-sm text-gray-500" data-testid="tab-scenario">
            シミュレータのモデル（minlag_model.json）が未生成です。次回バッチで生成されます。
          </p>
        ))}

      {tab === "model" && (
        <div className="flex flex-col gap-6" data-testid="tab-model">
          <ModelExplanation coefficients={coefficients} backtest={backtest} />
          <BacktestPanel backtest={backtest} />
        </div>
      )}

      {tab === "data" && (
        <div className="flex flex-col gap-6" data-testid="tab-data">
          <SourceTables file={series} />
          <SourcePanel sources={sources} />
        </div>
      )}
    </main>
  );
}
