"use client";

import { useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { BacktestPoint } from "@/app/lib/artifacts";

const CATEGORY_LABEL: Record<string, string> = { food: "食料", clothing: "衣料" };
const BINS = 12;

type Mode = "scatter" | "density";

function niceBounds(values: number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) return [lo - 0.01, hi + 0.01];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

/** 密度モード: 実績×予測を BINS×BINS で数え、色の濃さで密度を示す SVG グリッド。 */
function DensityGrid({
  pts,
  lo,
  hi,
}: {
  pts: { x: number; y: number }[];
  lo: number;
  hi: number;
}) {
  const span = hi - lo || 1;
  const grid: number[][] = Array.from({ length: BINS }, () =>
    Array<number>(BINS).fill(0),
  );
  const idx = (v: number) =>
    Math.min(BINS - 1, Math.max(0, Math.floor(((v - lo) / span) * BINS)));
  let max = 0;
  for (const p of pts) {
    const gx = idx(p.x);
    const gy = idx(p.y);
    grid[gy][gx] += 1;
    if (grid[gy][gx] > max) max = grid[gy][gx];
  }

  const cell = 100 / BINS;
  return (
    <div className="w-full" data-testid="fit-density">
      <svg viewBox="0 0 100 100" className="h-72 w-full" preserveAspectRatio="none">
        {grid.map((rowArr, gy) =>
          rowArr.map((count, gx) => {
            const t = max ? count / max : 0;
            // 濃さ: 白 -> 緑
            const fill =
              count === 0 ? "transparent" : `rgba(46,158,107,${0.15 + 0.85 * t})`;
            return (
              <rect
                key={`${gx}-${gy}`}
                x={gx * cell}
                y={100 - (gy + 1) * cell}
                width={cell}
                height={cell}
                fill={fill}
                stroke="#0001"
                strokeWidth={0.2}
              />
            );
          }),
        )}
        {/* 対角線 y=x（左下→右上） */}
        <line x1={0} y1={100} x2={100} y2={0} stroke="#888" strokeDasharray="2 2" strokeWidth={0.5} />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>実績 {(lo * 100).toFixed(0)}%</span>
        <span>最大密度 {max} 件/セル</span>
        <span>{(hi * 100).toFixed(0)}%</span>
      </div>
      <ul className="sr-only" data-testid="fit-density-data">
        {grid.flatMap((rowArr, gy) =>
          rowArr.map((count, gx) =>
            count > 0 ? <li key={`${gx}-${gy}`}>{`cell ${gx},${gy}: ${count}`}</li> : null,
          ),
        )}
      </ul>
    </div>
  );
}

/** バックテストの実績(x)×OOS予測(y)。同一スケール＋対角線で適合度を示す。密度切替可。 */
export default function FitScatter({
  predictions,
  category,
}: {
  predictions: BacktestPoint[];
  category: string;
}) {
  const [mode, setMode] = useState<Mode>("scatter");

  const pts = predictions
    .filter((p) => p.category === category)
    .map((p) => ({ x: p.actual, y: p.predicted, date: p.date }));

  if (pts.length === 0) {
    return (
      <section aria-label="適合散布図" data-testid="fit-scatter">
        <p className="text-sm text-gray-500">
          適合データ（実績×予測）は次回バッチで生成されます。
        </p>
      </section>
    );
  }

  // X/Y 同一スケール（両軸に共通の domain を使う）。
  const [lo, hi] = niceBounds(pts.flatMap((p) => [p.x, p.y]));

  return (
    <section aria-label="適合散布図" data-testid="fit-scatter">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {CATEGORY_LABEL[category] ?? category}: 実績(横)×予測(縦)・対角線に近いほど高精度（n={pts.length}）
        </p>
        <div role="group" aria-label="表示モード" className="flex gap-1">
          {(["scatter", "density"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-xs ${
                mode === m ? "bg-gray-800 text-white" : "bg-gray-100"
              }`}
            >
              {m === "scatter" ? "散布図" : "密度"}
            </button>
          ))}
        </div>
      </div>

      {mode === "density" ? (
        <DensityGrid pts={pts} lo={lo} hi={hi} />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 8, bottom: 16, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name="実績"
                domain={[lo, hi]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="予測"
                domain={[lo, hi]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <ZAxis range={[30, 30]} />
              <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} labelFormatter={() => ""} />
              <ReferenceLine
                segment={[
                  { x: lo, y: lo },
                  { x: hi, y: hi },
                ]}
                stroke="#888"
                strokeDasharray="4 4"
              />
              <Scatter data={pts} fill="#2e9e6b" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="sr-only" data-testid="fit-scatter-data">
        {pts.map((p) => (
          <li key={p.date}>
            {p.date} 実績{(p.x * 100).toFixed(1)}% 予測{(p.y * 100).toFixed(1)}%
          </li>
        ))}
      </ul>
    </section>
  );
}
