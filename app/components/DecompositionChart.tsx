"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type Contribution = { driver: string; label: string; value: number };

/** 要因分解（各ドライバーの寄与 coef*value）の横棒チャート。 */
export default function DecompositionChart({
  contributions,
}: {
  contributions: Contribution[];
}) {
  return (
    <section aria-label="要因分解" data-testid="decomposition-chart">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={contributions}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis
              type="category"
              dataKey="label"
              width={120}
              tick={{ fontSize: 10 }}
            />
            <Tooltip formatter={(v) => Number(v).toFixed(3)} />
            <Bar dataKey="value">
              {contributions.map((c) => (
                <Cell key={c.driver} fill={c.value >= 0 ? "#2e9e6b" : "#d05050"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" data-testid="decomposition-data">
        {contributions.map((c) => (
          <li key={c.driver}>
            {c.label}: {c.value.toFixed(3)}
          </li>
        ))}
      </ul>
    </section>
  );
}
