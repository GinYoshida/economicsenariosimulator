"use client";

import type { Backtest } from "@/app/lib/artifacts";

const CATEGORY_LABEL: Record<string, string> = {
  food: "食料",
  clothing: "衣料",
};

/** バックテスト指標（モデル vs ナイーブ）の一覧。 */
export default function BacktestPanel({ backtest }: { backtest: Backtest }) {
  return (
    <section aria-label="バックテスト" data-testid="backtest-panel">
      <p className="mb-1 text-xs text-gray-500">窓: {backtest.window}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th>カテゴリ</th>
            <th>MAE</th>
            <th>ナイーブMAE</th>
            <th>方向一致</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {backtest.metrics.map((m) => (
            <tr key={m.category} data-testid={`bt-${m.category}`}>
              <td>{CATEGORY_LABEL[m.category] ?? m.category}</td>
              <td className="tabular-nums">{m.mae.toFixed(3)}</td>
              <td className="tabular-nums">{m.naive_mae.toFixed(3)}</td>
              <td className="tabular-nums">{(m.direction_hit * 100).toFixed(0)}%</td>
              <td>
                <span
                  className={
                    m.beats_naive ? "text-green-600" : "text-gray-500"
                  }
                >
                  {m.beats_naive ? "ナイーブ超え" : "ナイーブ未達"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
