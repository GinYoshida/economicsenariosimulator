"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { movingAverage } from "@/app/lib/movingAverage";

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
export default function ForecastChart({
  rows,
  showMovingAverage = false,
  maWindow = 3,
}: {
  rows: ForecastRow[];
  showMovingAverage?: boolean;
  maWindow?: number;
}) {
  const maFood = movingAverage(rows.map((r) => r.food), maWindow);
  const maClothing = movingAverage(rows.map((r) => r.clothing), maWindow);
  const data = rows.map((r, i) => ({
    ...r,
    food_ma: maFood[i],
    clothing_ma: maClothing[i],
  }));

  // 実績と予測の境界（最後の history 行）。
  const lastHistory = [...rows].reverse().find((r) => r.kind === "history");
  const boundary = lastHistory?.date;

  return (
    <section aria-label="消費前年比の予測" data-testid="forecast-chart">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            />
            <Tooltip formatter={(v) => pct(v == null ? null : Number(v))} />
            {boundary && (
              <ReferenceLine
                x={boundary}
                stroke="#888"
                strokeDasharray="4 4"
                label={{ value: "予測開始", fontSize: 10, position: "top" }}
              />
            )}
            <Line type="monotone" dataKey="food" name="食料(実績/予測)" stroke="#e07a3f" dot={false} />
            <Line type="monotone" dataKey="clothing" name="衣料(実績/予測)" stroke="#3f6fe0" dot={false} />
            {showMovingAverage && (
              <>
                <Line
                  type="monotone"
                  dataKey="food_ma"
                  name={`食料 ${maWindow}カ月平均`}
                  stroke="#e07a3f"
                  strokeDasharray="5 3"
                  strokeWidth={1}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="clothing_ma"
                  name={`衣料 ${maWindow}カ月平均`}
                  stroke="#3f6fe0"
                  strokeDasharray="5 3"
                  strokeWidth={1}
                  dot={false}
                  connectNulls
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* アクセシブルなデータ要約（スクリーンリーダ・テスト用） */}
      <ul className="sr-only" data-testid="forecast-data">
        {data.map((r) => (
          <li key={r.date}>
            {r.date} {r.kind} 食料{pct(r.food)} 衣料{pct(r.clothing)}
            {showMovingAverage
              ? ` 食料MA${pct(r.food_ma)} 衣料MA${pct(r.clothing_ma)}`
              : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
