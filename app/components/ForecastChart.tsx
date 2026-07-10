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

export type Overlay = {
  id: string;
  label: string;
  color: string;
  byDate: Record<string, number | null>;
};

type AxisBound = number | "auto";

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

/** 食料・衣料の前年比（実績＋シナリオ予測）＋任意の入力系列オーバーレイ。 */
export default function ForecastChart({
  rows,
  showMovingAverage = false,
  maWindow = 3,
  yDomain = ["auto", "auto"],
  overlays = [],
}: {
  rows: ForecastRow[];
  showMovingAverage?: boolean;
  maWindow?: number;
  yDomain?: [AxisBound, AxisBound];
  overlays?: Overlay[];
}) {
  const maFood = movingAverage(rows.map((r) => r.food), maWindow);
  const maClothing = movingAverage(rows.map((r) => r.clothing), maWindow);
  const data = rows.map((r, i) => {
    const row: Record<string, unknown> = {
      ...r,
      food_ma: maFood[i],
      clothing_ma: maClothing[i],
    };
    for (const ov of overlays) row[`ov_${ov.id}`] = ov.byDate[r.date] ?? null;
    return row;
  });

  const lastHistory = [...rows].reverse().find((r) => r.kind === "history");
  const boundary = lastHistory?.date;

  return (
    <section aria-label="消費前年比の予測" data-testid="forecast-chart">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis
              yAxisId="pct"
              domain={yDomain}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            />
            {overlays.length > 0 && (
              <YAxis
                yAxisId="raw"
                orientation="right"
                tick={{ fontSize: 10 }}
                width={44}
              />
            )}
            <Tooltip
              formatter={(v, name) =>
                typeof name === "string" && name.includes("前年比")
                  ? pct(v == null ? null : Number(v))
                  : v == null
                    ? "—"
                    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })
              }
            />
            {boundary && (
              <ReferenceLine
                yAxisId="pct"
                x={boundary}
                stroke="#888"
                strokeDasharray="4 4"
                label={{ value: "予測開始", fontSize: 10, position: "top" }}
              />
            )}
            <Line yAxisId="pct" type="monotone" dataKey="food" name="食料(前年比)" stroke="#e07a3f" dot={false} />
            <Line yAxisId="pct" type="monotone" dataKey="clothing" name="衣料(前年比)" stroke="#3f6fe0" dot={false} />
            {showMovingAverage && (
              <>
                <Line yAxisId="pct" type="monotone" dataKey="food_ma" name={`食料 ${maWindow}カ月平均(前年比)`} stroke="#e07a3f" strokeDasharray="5 3" strokeWidth={1} dot={false} connectNulls />
                <Line yAxisId="pct" type="monotone" dataKey="clothing_ma" name={`衣料 ${maWindow}カ月平均(前年比)`} stroke="#3f6fe0" strokeDasharray="5 3" strokeWidth={1} dot={false} connectNulls />
              </>
            )}
            {overlays.map((ov) => (
              <Line
                key={ov.id}
                yAxisId="raw"
                type="monotone"
                dataKey={`ov_${ov.id}`}
                name={ov.label}
                stroke={ov.color}
                strokeWidth={1}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" data-testid="forecast-data">
        {data.map((r) => (
          <li key={r.date as string}>
            {r.date as string} {r.kind as string} 食料{pct(r.food as number | null)} 衣料
            {pct(r.clothing as number | null)}
            {showMovingAverage
              ? ` 食料MA${pct(r.food_ma as number | null)} 衣料MA${pct(r.clothing_ma as number | null)}`
              : ""}
            {overlays.length > 0
              ? ` ${overlays.map((ov) => `${ov.label}:${r[`ov_${ov.id}`] ?? "—"}`).join(" ")}`
              : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
