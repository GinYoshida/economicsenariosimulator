"use client";

import { metricPasses, type Backtest, type Coefficients } from "@/app/lib/artifacts";

const CATEGORY_LABEL: Record<string, string> = { food: "食料", clothing: "衣料" };

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** モデルの解説タブ: 手法・係数・当てはまり・バックテスト指標を説明する。 */
export default function ModelExplanation({
  coefficients,
  backtest,
}: {
  coefficients: Coefficients;
  backtest: Backtest;
}) {
  const metricOf = (cat: string) =>
    backtest.metrics.find((m) => m.category === cat);

  return (
    <section aria-label="モデルの解説" data-testid="model-explanation" className="flex flex-col gap-5">
      <div className="text-sm leading-relaxed text-gray-700">
        <h2 className="mb-1 text-base font-semibold">手法</h2>
        <p>
          カテゴリ別に <strong>線形回帰（OLS）</strong> を学習しています。説明変数は
          物価・商品先物・為替などを<strong>公表ラグ付き</strong>で加え、月の
          <strong>季節ダミー</strong>も含みます。予測は
          <code>切片 + Σ 係数×ドライバー(ラグ)</code> の線形式で、ブラウザ上で即時計算します。
          家計調査の未公表直近月は、公表の早い指標から<strong>ナウキャスト</strong>で補完します。
        </p>
        <p className="mt-2">
          精度は <strong>拡張窓アウトオブサンプル</strong>（各時点で学習→3か月先を予測）で検証し、
          「直前値をそのまま予測する<strong>ナイーブ</strong>」を上回るかを合格基準にしています
          （窓: {backtest.window}）。
        </p>
      </div>

      {coefficients.categories.map((c) => {
        const m = metricOf(c.category);
        return (
          <div key={c.category} data-testid={`model-${c.category}`} className="rounded border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-semibold">
              {CATEGORY_LABEL[c.category] ?? c.category}モデル
              <span className="ml-2 font-normal text-gray-500">
                R²={c.r2.toFixed(2)} / 版 {c.model_version} / vintage {c.data_vintage}
              </span>
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>ドライバー</th>
                  <th>係数</th>
                  <th>ラグ(月)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>切片</td>
                  <td className="tabular-nums">{c.intercept.toFixed(4)}</td>
                  <td>—</td>
                </tr>
                {c.drivers.map((d) => (
                  <tr key={d.driver} data-testid={`driver-${c.category}-${d.driver}`}>
                    <td>{d.label_ja}</td>
                    <td className="tabular-nums">{d.coef.toFixed(4)}</td>
                    <td className="tabular-nums">{d.lag_months}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {m && (
              <p className="mt-2 text-xs text-gray-600">
                バックテスト: MAE {m.mae.toFixed(3)}（ナイーブ {m.naive_mae.toFixed(3)}）
                {m.medae != null ? `, 中央誤差 ${m.medae.toFixed(3)}` : ""}, 方向一致{" "}
                {pct(m.direction_hit)},{" "}
                <span className={metricPasses(m) ? "text-green-600" : "text-amber-600"}>
                  {metricPasses(m) ? "合格" : "要改善"}
                </span>
                {m.beats_naive && !metricPasses(m)
                  ? "（MAEは超えるが方向一致が五分未満）"
                  : ""}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
