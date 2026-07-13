"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DriverForecast } from "@/app/lib/artifacts";

const COLOR = {
  actual: "#2e9e6b",
  backcast: "#9ca3af",
  forecast: "#2563eb",
};

/** 説明変数（ドライバー）の別グラフ: 実績／バックキャスト／フォーキャスト＋信頼帯。 */
export default function DriverChart({
  driver,
  z = 1.2816,
}: {
  driver: DriverForecast;
  z?: number;
}) {
  const rows = driver.points.map((p) => {
    const hasFc = p.mean != null;
    const std = p.std ?? 0;
    return {
      date: p.date,
      actual: p.actual ?? null,
      backcast: p.backcast ?? null,
      forecast: hasFc ? p.mean : null,
      band: hasFc ? [p.mean! - z * std, p.mean! + z * std] : null,
      kind: hasFc ? "forecast" : "history",
    };
  });
  const lastHistory = [...rows].reverse().find((r) => r.kind === "history");

  return (
    <section aria-label={`ドライバー予測 ${driver.driver}`} data-testid="driver-chart">
      <p className="mb-1 text-xs text-gray-500">
        {driver.label_ja}（{driver.driver}・単位: {driver.unit}）実績/当てはめ/予測（前年比等）
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => (v == null ? "—" : Number(v).toFixed(3))} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area dataKey="band" name="予測帯" legendType="none" stroke="none" fill={COLOR.forecast} fillOpacity={0.15} connectNulls isAnimationActive={false} />
            {lastHistory && (
              <ReferenceLine x={lastHistory.date} stroke="#888" strokeDasharray="4 4" label={{ value: "予測開始", fontSize: 10, position: "top" }} />
            )}
            <Line type="monotone" dataKey="actual" name="実績" stroke={COLOR.actual} dot={false} connectNulls />
            <Line type="monotone" dataKey="backcast" name="当てはめ" stroke={COLOR.backcast} strokeDasharray="4 2" strokeWidth={1} dot={false} connectNulls />
            <Line type="monotone" dataKey="forecast" name="予測" stroke={COLOR.forecast} strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" data-testid="driver-chart-data">
        {rows.map((r) => (
          <li key={r.date}>
            {r.date} {r.kind} 実績{r.actual ?? "—"} 当{r.backcast ?? "—"} 予測
            {r.forecast ?? "—"}
          </li>
        ))}
      </ul>
    </section>
  );
}
