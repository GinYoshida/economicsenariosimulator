"use client";

import type { ReactNode } from "react";

import { metricPasses, type Backtest, type Coefficients } from "@/app/lib/artifacts";

const CATEGORY_LABEL: Record<string, string> = { food: "食料", clothing: "衣料" };

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const FLOW_TONE: Record<string, string> = {
  src: "border-emerald-300 bg-emerald-50",
  mid: "border-blue-300 bg-blue-50",
  out: "border-purple-300 bg-purple-50",
};

/** データフロー図の1ボックス。 */
function FlowBox({
  children,
  tone = "mid",
  className = "",
}: {
  children: ReactNode;
  tone?: "src" | "mid" | "out";
  className?: string;
}) {
  return (
    <div className={`rounded border px-2 py-1.5 font-medium ${FLOW_TONE[tone]} ${className}`}>
      {children}
    </div>
  );
}

/** ボックス間の下向き矢印（ラベル付き）。 */
function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center leading-none text-gray-400">
      <span aria-hidden>↓</span>
      {label && <span className="text-[10px] text-gray-500">{label}</span>}
    </div>
  );
}

/** 数式ブロック（等幅・横スクロール可）。 */
function MathBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded bg-gray-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-800">
      {children}
    </pre>
  );
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
          物価・<strong>賃金</strong>・商品先物・為替などを<strong>公表ラグ付き</strong>で加え、月の
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

      {/* --- データフロー図 --- */}
      <div data-testid="model-dataflow" className="text-sm text-gray-700">
        <h2 className="mb-2 text-base font-semibold">データフロー</h2>
        <div className="flex flex-col items-stretch gap-1 text-center text-xs">
          <FlowBox tone="src">
            公的統計API
            <span className="block text-[10px] font-normal text-gray-500">
              e-Stat（家計調査・CPI・景気ウォッチャー）／統計ダッシュボード（毎月勤労統計・賃金）／
              Yahoo Finance（先物・為替）
            </span>
          </FlowBox>
          <Arrow label="月次バッチ取得" />
          <FlowBox tone="mid">
            DuckDB（系列ストア）
            <span className="block text-[10px] font-normal text-gray-500">
              出典・取得日時つきで系列を保存
            </span>
          </FlowBox>
          <Arrow label="前年比化・実質化・平滑" />
          <FlowBox tone="mid">
            月次パネル（YoY）
            <span className="block text-[10px] font-normal text-gray-500">
              名目給与YoY と CPI を別列で保持（実質は係数から創発）
            </span>
          </FlowBox>
          <Arrow label="学習" />
          <div className="flex gap-1">
            <FlowBox tone="mid" className="flex-1">
              OLS（カテゴリ別）
            </FlowBox>
            <FlowBox tone="mid" className="flex-1">
              状態空間（ドライバー先行き）
            </FlowBox>
          </div>
          <Arrow label="係数×ドライバー予測＋不確実性伝播" />
          <FlowBox tone="out">
            public/data/*.json → ブラウザで即時シナリオ計算
          </FlowBox>
        </div>
      </div>

      {/* --- モデルの構造と数式 --- */}
      <div data-testid="model-math" className="text-sm leading-relaxed text-gray-700">
        <h2 className="mb-2 text-base font-semibold">モデルの構造と数式</h2>

        <h3 className="mt-1 text-sm font-semibold">① 前処理（前年比・実質化）</h3>
        <p className="mt-1">
          水準系列は前年同月比に変換します。家計調査（名目金額）は対応CPIで実質化します。
        </p>
        <MathBlock>
          {"yoy_t = x_t / x_{t-12} − 1"}
          {"\n"}
          {"real_t = (1 + nominal_t) / (1 + cpi_t) − 1"}
        </MathBlock>
        <p className="mt-1 text-xs text-gray-600">
          賃金は<strong>名目のまま</strong>投入し、各カテゴリのCPIを別ドライバーに置くことで、
          実質賃金の効果を「名目給与の係数」と「そのカテゴリCPIの係数」の差として推定します
          （実質化を先に固定しない）。総合CPIはカテゴリCPIと強く相関するためドライバーには入れません。
        </p>

        <h3 className="mt-3 text-sm font-semibold">② 回帰（カテゴリ別 OLS）</h3>
        <p className="mt-1">
          カテゴリ <code>c</code>（食料／衣料）の実質消費 YoY を、ラグ付きドライバーと季節ダミーで説明します。
        </p>
        <MathBlock>
          {"ŷ_{c,t} = β_{c,0} + Σ_k β_{c,k}·d_{k, t−ℓ_k} + Σ_{m} γ_{c,m}·month_m"}
        </MathBlock>
        <p className="mt-1 text-xs text-gray-600">
          <code>d_k</code>=ドライバー（CPI・名目給与・先物・為替・DI）、<code>ℓ_k</code>=公表ラグ（月）。
          給与は公表ラグを見込み <code>ℓ=2</code>。
        </p>

        <h3 className="mt-3 text-sm font-semibold">③ ドライバー先行き（状態空間・局所線形トレンド）</h3>
        <p className="mt-1">
          各ドライバーの1年先を、水準 <code>μ</code> と傾き <code>ν</code> を持つ局所線形トレンド
          （観測ノイズ <code>ε</code>）で外挿します。
        </p>
        <MathBlock>
          {"d_t = μ_t + ε_t,        ε_t ~ N(0, σ_ε²)"}
          {"\n"}
          {"μ_t = μ_{t-1} + ν_{t-1} + η_t,   η_t ~ N(0, σ_η²)"}
          {"\n"}
          {"ν_t = ν_{t-1} + ζ_t,        ζ_t ~ N(0, σ_ζ²)"}
        </MathBlock>

        <h3 className="mt-3 text-sm font-semibold">④ 不確実性の伝播（ファン）</h3>
        <p className="mt-1">
          ドライバー予測の分散を線形モデルに伝播し、残差分散を足して予測帯を作ります。
        </p>
        <MathBlock>
          {"Var(ŷ_{c,t}) = Σ_k β_{c,k}²·Var(d̂_{k,t−ℓ_k}) + σ_{resid}²"}
          {"\n"}
          {"帯 = ŷ_{c,t} ± z·√Var(ŷ_{c,t})      (z=1.2816 → 80%)"}
        </MathBlock>
        <p className="mt-1 text-xs text-gray-600">
          スライダーで固定したドライバーは確定値（分散0）として扱い、その分だけ帯が狭くなります。
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
