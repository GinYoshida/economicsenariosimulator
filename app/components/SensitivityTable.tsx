"use client";

// 感度テーブル: 各説明変数が消費(前年比)をどれだけ動かすか。
//  - 感度(1σ)   = 係数 × ドライバーの標準偏差（標準的な変動での影響, pp）
//  - 今の寄与   = 係数 × (あなたの着地値 − 現在値)（今の読みが与える影響, pp）

export type SensRow = {
  driver: string;
  label: string;
  sens: number; // 1σ感度（YoY 比・pp化前）
  contrib: number; // 今の読みの寄与（同上）
};

function ppLabel(v: number): string {
  const pp = v * 100;
  const s = pp >= 0 ? "+" : "−";
  return `${s}${Math.abs(pp).toFixed(2)}pp`;
}

export default function SensitivityTable({ rows }: { rows: SensRow[] }) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.sens) - Math.abs(a.sens));
  const max = Math.max(1e-9, ...sorted.map((r) => Math.abs(r.sens)));

  return (
    <div data-testid="sensitivity-table" className="text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-gray-500">
            <th className="py-1 text-left font-medium">説明変数</th>
            <th className="py-1 text-right font-medium">感度(1σ)</th>
            <th className="py-1 text-right font-medium">今の寄与</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const w = (Math.abs(r.sens) / max) * 100;
            const up = r.sens >= 0;
            return (
              <tr key={r.driver} className="border-t border-gray-100">
                <td className="py-1 pr-2">
                  <div>{r.label}</div>
                  <div className="mt-0.5 h-1.5 w-full rounded bg-gray-100">
                    <div
                      className="h-1.5 rounded"
                      style={{
                        width: `${w}%`,
                        backgroundColor: up ? "#2563eb" : "#dc2626",
                      }}
                    />
                  </div>
                </td>
                <td className="py-1 text-right tabular-nums text-gray-700">
                  {ppLabel(r.sens)}
                </td>
                <td className="py-1 text-right tabular-nums text-gray-700">
                  {ppLabel(r.contrib)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-gray-400">
        感度(1σ)＝その変数が標準的に1σ動いたとき消費前年比が何pp動くか。
        今の寄与＝あなたの着地値と現在値の差が与える影響。青=プラス／赤=マイナス。
      </p>
    </div>
  );
}
