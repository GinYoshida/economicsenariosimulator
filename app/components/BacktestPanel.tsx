"use client";

import { metricPasses, type Backtest } from "@/app/lib/artifacts";

const CATEGORY_LABEL: Record<string, string> = {
  food: "食料",
  clothing: "衣料",
};

/** バックテスト指標（モデル vs ナイーブ）の一覧。合否は方向一致も加味。 */
export default function BacktestPanel({ backtest }: { backtest: Backtest }) {
  return (
    <section aria-label="バックテスト" data-testid="backtest-panel">
      <p className="mb-1 text-xs text-gray-500">窓: {backtest.window}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>カテゴリ</th>
              <th>MAE</th>
              <th>中央誤差</th>
              <th>ナイーブMAE</th>
              <th>方向一致</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {backtest.metrics.map((m) => {
              const pass = metricPasses(m);
              return (
                <tr key={m.category} data-testid={`bt-${m.category}`}>
                  <td>{CATEGORY_LABEL[m.category] ?? m.category}</td>
                  <td className="tabular-nums">{m.mae.toFixed(3)}</td>
                  <td className="tabular-nums">
                    {m.medae == null ? "—" : m.medae.toFixed(3)}
                  </td>
                  <td className="tabular-nums">{m.naive_mae.toFixed(3)}</td>
                  <td className="tabular-nums">
                    {(m.direction_hit * 100).toFixed(0)}%
                  </td>
                  <td>
                    <span className={pass ? "text-green-600" : "text-amber-600"}>
                      {pass ? "合格" : "要改善"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        合格 = MAEでナイーブ超え かつ 方向一致&gt;50%。MAE単独の勝ちは平均回帰系列で
        起こりやすいため、方向一致も基準に含めています。
      </p>
    </section>
  );
}
