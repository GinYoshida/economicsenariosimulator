"use client";

import { useState } from "react";
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

import { movingAverage } from "@/app/lib/movingAverage";

export type ForecastRow = {
  date: string;
  kind: "history" | "forecast";
  foodActual?: number | null;
  foodBackcast?: number | null;
  foodForecast?: number | null;
  foodLow?: number | null;
  foodHigh?: number | null;
  clothingActual?: number | null;
  clothingBackcast?: number | null;
  clothingForecast?: number | null;
  clothingLow?: number | null;
  clothingHigh?: number | null;
};

type AxisBound = number | "auto";

const COLOR = {
  foodActual: "#e07a3f",
  foodForecast: "#c2410c",
  clothingActual: "#3f6fe0",
  clothingForecast: "#6d28d9",
  backcast: "#9ca3af",
};

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function band(lo?: number | null, hi?: number | null): [number, number] | null {
  return lo == null || hi == null ? null : [lo, hi];
}

/** 食料・衣料の前年比：実績／バックキャスト／フォーキャストを色分け＋信頼帯。 */
export default function ForecastChart({
  rows,
  showMovingAverage = false,
  maWindow = 3,
  yDomain = ["auto", "auto"],
}: {
  rows: ForecastRow[];
  showMovingAverage?: boolean;
  maWindow?: number;
  yDomain?: [AxisBound, AxisBound];
}) {
  const foodCombined = rows.map((r) => r.foodActual ?? r.foodForecast ?? null);
  const clothingCombined = rows.map(
    (r) => r.clothingActual ?? r.clothingForecast ?? null,
  );
  const maFood = movingAverage(foodCombined, maWindow);
  const maClothing = movingAverage(clothingCombined, maWindow);

  const data = rows.map((r, i) => ({
    ...r,
    food_ma: maFood[i],
    clothing_ma: maClothing[i],
    food_band: band(r.foodLow, r.foodHigh),
    clothing_band: band(r.clothingLow, r.clothingHigh),
  }));

  const lastHistory = [...rows].reverse().find((r) => r.kind === "history");
  const boundary = lastHistory?.date;

  // 凡例クリックで系列の表示/非表示を切り替える。
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key?: string | number) => {
    if (key == null) return;
    const k = String(key);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const off = (key: string) => hidden.has(key);
  // データポイントを明示する〇マーカー（白抜き＋線色のリング）。
  // strokeWidth を 0 にすると白丸が背景に溶けて見えなくなるので必ずリングを描く。
  const dot = { r: 2.5, strokeWidth: 1.4, fill: "#fff" };

  return (
    <section aria-label="消費前年比の予測" data-testid="forecast-chart">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            />
            <Tooltip formatter={(v) => pct(v == null ? null : Number(v))} />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              onClick={(o) => toggle((o as { dataKey?: string | number })?.dataKey)}
              formatter={(value, entry) => {
                const key = (entry as { dataKey?: string | number })?.dataKey;
                const isOff = key != null && off(String(key));
                return (
                  <span
                    title="クリックで表示/非表示"
                    style={{
                      color: isOff ? "#9ca3af" : "#111827",
                      fontWeight: isOff ? 400 : 600,
                      textDecoration: isOff ? "line-through" : "none",
                      cursor: "pointer",
                    }}
                  >
                    {value}
                  </span>
                );
              }}
            />
            <Area dataKey="food_band" name="食料 帯" legendType="none" hide={off("foodForecast")} stroke="none" fill={COLOR.foodActual} fillOpacity={0.15} connectNulls isAnimationActive={false} />
            <Area dataKey="clothing_band" name="衣料 帯" legendType="none" hide={off("clothingForecast")} stroke="none" fill={COLOR.clothingActual} fillOpacity={0.15} connectNulls isAnimationActive={false} />
            {boundary && (
              <ReferenceLine x={boundary} stroke="#888" strokeDasharray="4 4" label={{ value: "予測開始", fontSize: 10, position: "top" }} />
            )}
            {/* 実績 */}
            <Line type="monotone" dataKey="foodActual" name="食料 実績" hide={off("foodActual")} stroke={COLOR.foodActual} dot={dot} activeDot={{ r: 4 }} connectNulls />
            <Line type="monotone" dataKey="clothingActual" name="衣料 実績" hide={off("clothingActual")} stroke={COLOR.clothingActual} dot={dot} activeDot={{ r: 4 }} connectNulls />
            {/* バックキャスト（当てはめ） */}
            <Line type="monotone" dataKey="foodBackcast" name="食料 当てはめ" hide={off("foodBackcast")} stroke={COLOR.backcast} strokeDasharray="4 2" strokeWidth={1} dot={false} connectNulls />
            <Line type="monotone" dataKey="clothingBackcast" name="衣料 当てはめ" hide={off("clothingBackcast")} stroke={COLOR.backcast} strokeDasharray="4 2" strokeWidth={1} dot={false} connectNulls />
            {/* フォーキャスト */}
            <Line type="monotone" dataKey="foodForecast" name="食料 予測" hide={off("foodForecast")} stroke={COLOR.foodForecast} strokeWidth={2} dot={dot} activeDot={{ r: 4 }} connectNulls />
            <Line type="monotone" dataKey="clothingForecast" name="衣料 予測" hide={off("clothingForecast")} stroke={COLOR.clothingForecast} strokeWidth={2} dot={dot} activeDot={{ r: 4 }} connectNulls />
            {showMovingAverage && (
              <>
                <Line type="monotone" dataKey="food_ma" name={`食料 ${maWindow}カ月平均`} legendType="none" stroke={COLOR.foodActual} strokeDasharray="5 3" strokeWidth={1} dot={false} connectNulls />
                <Line type="monotone" dataKey="clothing_ma" name={`衣料 ${maWindow}カ月平均`} legendType="none" stroke={COLOR.clothingActual} strokeDasharray="5 3" strokeWidth={1} dot={false} connectNulls />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" data-testid="forecast-data">
        {data.map((r) => (
          <li key={r.date}>
            {r.date} {r.kind}
            {r.kind === "history"
              ? ` 実績 食料${pct(r.foodActual)} 衣料${pct(r.clothingActual)} 当${pct(r.foodBackcast)}`
              : ` 予測 食料${pct(r.foodForecast)} 衣料${pct(r.clothingForecast)} 帯[${pct(r.foodLow)}〜${pct(r.foodHigh)}]`}
            {showMovingAverage ? ` MA食${pct(r.food_ma)} MA衣${pct(r.clothing_ma)}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
