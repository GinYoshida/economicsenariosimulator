"use client";

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

/** バックテストの実績(x)×OOS予測(y)散布図。対角線(y=x)に近いほど高精度。 */
export default function FitScatter({
  predictions,
  category,
}: {
  predictions: BacktestPoint[];
  category: string;
}) {
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

  const all = pts.flatMap((p) => [p.x, p.y]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);

  return (
    <section aria-label="適合散布図" data-testid="fit-scatter">
      <p className="mb-1 text-xs text-gray-500">
        {CATEGORY_LABEL[category] ?? category}: 実績(横) × 予測(縦)・対角線に近いほど高精度（n={pts.length}）
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name="実績"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="予測"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            />
            <ZAxis range={[30, 30]} />
            <Tooltip
              formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
              labelFormatter={() => ""}
            />
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
