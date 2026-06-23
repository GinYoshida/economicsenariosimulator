"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ForecastRow = {
  date: string;
  food: number | null;
  clothing: number | null;
  kind: "history" | "forecast";
};

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

/** 食料・衣料の前年比（実績＋シナリオ予測）の折れ線チャート。 */
export default function ForecastChart({ rows }: { rows: ForecastRow[] }) {
  return (
    <section aria-label="消費前年比の予測" data-testid="forecast-chart">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip formatter={(v) => pct(v == null ? null : Number(v))} />
            <Line type="monotone" dataKey="food" name="食料" stroke="#e07a3f" dot={false} />
            <Line type="monotone" dataKey="clothing" name="衣料" stroke="#3f6fe0" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* アクセシブルなデータ要約（スクリーンリーダ・テスト用） */}
      <ul className="sr-only" data-testid="forecast-data">
        {rows.map((r) => (
          <li key={r.date}>
            {r.date} {r.kind} 食料{pct(r.food)} 衣料{pct(r.clothing)}
          </li>
        ))}
      </ul>
    </section>
  );
}
