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

export type CategoryRow = {
  date: string;
  kind: "history" | "forecast";
  actual?: number | null;
  center?: number | null; // 当てはめ（履歴）／予測平均（将来）
};

type AxisBound = number | "auto";

// 信頼度 → z値・塗り不透明度（濃いほど高密度=狭い帯）。
const LEVELS: { key: string; label: string; z: number; opacity: number }[] = [
  { key: "b95", label: "95%", z: 1.96, opacity: 0.1 },
  { key: "b80", label: "80%", z: 1.2816, opacity: 0.18 },
  { key: "b50", label: "50%", z: 0.6745, opacity: 0.32 },
];

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

/** 1カテゴリの前年比：実績＋「h か月先予測」の中心線と信頼度別の帯。 */
export default function CategoryChart({
  label,
  color,
  centerColor,
  sd,
  horizon,
  rows,
  boundaryDate,
  showMovingAverage = false,
  maWindow = 3,
  yDomain = ["auto", "auto"],
  testId,
}: {
  label: string;
  color: string;
  centerColor?: string; // 予測中心線の色（実績と区別。既定は color）
  sd: number; // h か月先予測の標準偏差（帯の基準幅）
  horizon: number;
  rows: CategoryRow[];
  boundaryDate?: string;
  showMovingAverage?: boolean;
  maWindow?: number;
  yDomain?: [AxisBound, AxisBound];
  testId?: string;
}) {
  const ctr = centerColor ?? color;
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
  const dot = { r: 2.5, strokeWidth: 1.4, fill: "#fff" };

  const maSource = rows.map((r) => r.actual ?? r.center ?? null);
  const ma = movingAverage(maSource, maWindow);

  const data = rows.map((r, i) => {
    const c = r.center;
    const bandOf = (z: number): [number, number] | null =>
      c == null ? null : [c - z * sd, c + z * sd];
    return {
      ...r,
      ma: ma[i],
      b50: bandOf(LEVELS[2].z),
      b80: bandOf(LEVELS[1].z),
      b95: bandOf(LEVELS[0].z),
    };
  });

  return (
    <section aria-label={`${label}の前年比予測`} data-testid={testId}>
      <p className="mb-1 text-sm font-semibold" style={{ color }}>
        {label}（{horizon}カ月先予測）
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            />
            <Tooltip
              formatter={(value, name) => {
                if (Array.isArray(value)) {
                  const [lo, hi] = value as [number, number];
                  return [`${pct(lo)} 〜 ${pct(hi)}`, name];
                }
                return [pct(value == null ? null : Number(value)), name];
              }}
            />
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
            {/* 信頼度別の帯（広い順に重ねる＝濃い中心ほど高密度） */}
            {LEVELS.map((lv) => (
              <Area
                key={lv.key}
                dataKey={lv.key}
                name={`信頼${lv.label}`}
                legendType="rect"
                hide={off(lv.key)}
                stroke="none"
                fill={color}
                fillOpacity={lv.opacity}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            {boundaryDate && (
              <ReferenceLine x={boundaryDate} stroke="#888" strokeDasharray="4 4" label={{ value: "現在", fontSize: 10, position: "top" }} />
            )}
            {/* 予測中心（当てはめ＋将来予測平均）: 別色・太めの破線・マーカー無し */}
            <Line type="monotone" dataKey="center" name="予測中心" legendType="plainline" hide={off("center")} stroke={ctr} strokeDasharray="7 4" strokeWidth={2} dot={false} connectNulls />
            {/* 実績: カテゴリ色の実線＋〇マーカー */}
            <Line type="monotone" dataKey="actual" name="実績" legendType="line" hide={off("actual")} stroke={color} strokeWidth={2} dot={dot} activeDot={{ r: 4 }} connectNulls />
            {showMovingAverage && (
              <Line type="monotone" dataKey="ma" name={`${maWindow}カ月平均`} legendType="none" stroke={color} strokeDasharray="1 2" strokeWidth={1} dot={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" data-testid={testId ? `${testId}-data` : undefined}>
        {data.map((r) => (
          <li key={r.date}>
            {r.date} {r.kind} 実績{pct(r.actual)} 中心{pct(r.center)}
            {showMovingAverage ? ` MA${pct(r.ma)}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
