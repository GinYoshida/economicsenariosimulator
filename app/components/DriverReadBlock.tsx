"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DriverForecast } from "@/app/lib/artifacts";
import { addMonths } from "@/app/lib/fanForecast";
import { buildLinearPath } from "@/app/lib/minlagSim";

const COLOR = { actual: "#2e9e6b", read: "#7c3aed" };

// 単位に応じた表示整形。
function fmtVal(v: number, unit: string): string {
  if (unit === "ratio") return v.toFixed(3);
  if (unit === "yen") return Math.round(v).toLocaleString();
  if (Math.abs(v) >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

/** 1ドライバー分の「予測グラフ＋着地値スライダー」を一体表示する。
 *
 * グラフの予測は状態空間の固定値ではなく、ユーザーの読み（現在→着地の線形パス）を
 * 中心線として描き、信頼帯（中心±z·std）も読みと一緒に上下に動く。 */
export default function DriverReadBlock({
  driver,
  label,
  unit,
  current,
  modelLanding,
  landing,
  edited,
  horizon,
  z,
  cutoff,
  onChange,
}: {
  driver: DriverForecast | null;
  label: string;
  unit: string;
  current: number;
  modelLanding: number;
  landing: number;
  edited: boolean;
  horizon: number;
  z: number;
  cutoff: string;
  onChange: (v: number) => void;
}) {
  // ユーザーの読み（現在→着地）を予測パスにする。
  const path = buildLinearPath(current, landing, horizon);
  const futurePts = (driver?.points ?? [])
    .filter((p) => p.mean != null)
    .slice(0, horizon);
  const history = (driver?.points ?? []).filter(
    (p) => p.actual != null && (!cutoff || p.date >= cutoff),
  );
  const lastActual = history.at(-1);

  type Row = {
    date: string;
    actual: number | null;
    read: number | null;
    band: [number, number] | null;
  };
  const rows: Row[] = history.map((p) => ({
    date: p.date,
    actual: p.actual ?? null,
    read: null,
    band: null,
  }));
  // 境界で実績と読みの線をつなぐ。
  if (lastActual)
    rows.push({
      date: lastActual.date,
      actual: null,
      read: lastActual.actual ?? null,
      band: null,
    });
  const baseDate = lastActual?.date ?? driver?.points[0]?.date ?? "";
  for (let k = 0; k < path.length; k++) {
    const date = futurePts[k]?.date ?? addMonths(baseDate, k + 1);
    const std = futurePts[k]?.std ?? 0;
    rows.push({
      date,
      actual: null,
      read: path[k],
      band: [path[k] - z * std, path[k] + z * std],
    });
  }

  // スライダーの可動域（現在・モデル着地を含む余裕を持たせる）。
  const delta = Math.max(
    Math.abs(modelLanding - current),
    Math.abs(current) * 0.2,
    Math.abs(modelLanding) * 0.2,
    unit === "ratio" ? 0.1 : 1e-6,
  );
  const lo = Math.min(current, modelLanding) - 2 * delta;
  const hi = Math.max(current, modelLanding) + 2 * delta;
  const step = (hi - lo) / 100 || 0.01;

  return (
    <div className="rounded border border-gray-200 p-2" data-testid="driver-read-block">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-800">{label}</span>
        <span className="ml-auto text-xs text-gray-400">
          現在 {fmtVal(current, unit)} → モデル {fmtVal(modelLanding, unit)}
        </span>
      </div>

      {driver && (
        <div className="mt-1 h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9 }}
                minTickGap={28}
                tickFormatter={(d) => String(d).slice(2, 7)}
              />
              <YAxis tick={{ fontSize: 9 }} width={40} />
              <Tooltip
                formatter={(v, name) => {
                  if (Array.isArray(v))
                    return [`${Number(v[0]).toFixed(3)} 〜 ${Number(v[1]).toFixed(3)}`, name];
                  return [v == null ? "—" : Number(v).toFixed(3), name];
                }}
                labelFormatter={(d) => String(d)}
              />
              <Area
                dataKey="band"
                name="信頼帯"
                stroke="none"
                fill={COLOR.read}
                fillOpacity={0.15}
                connectNulls
                isAnimationActive={false}
              />
              {lastActual && (
                <ReferenceLine x={lastActual.date} stroke="#9ca3af" strokeDasharray="4 3" />
              )}
              <Line
                type="monotone"
                dataKey="actual"
                name="実績"
                stroke={COLOR.actual}
                dot={{ r: 2, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="read"
                name="あなたの読み"
                stroke={COLOR.read}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-1 flex items-center gap-2">
        <input
          type="range"
          aria-label={`${label}の着地値スライダー`}
          min={lo}
          max={hi}
          step={step}
          value={landing}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          aria-label={`${label}の着地値`}
          value={Number.isFinite(landing) ? Number(landing.toFixed(4)) : 0}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-24 rounded border px-1 py-0.5 text-right text-xs ${
            edited ? "border-blue-400 bg-blue-50" : "border-gray-300"
          }`}
        />
      </div>
    </div>
  );
}
