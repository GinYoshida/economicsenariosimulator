"use client";

import type { SeriesData, SeriesFile } from "@/app/lib/artifacts";
import { seriesInfo, unitNote } from "@/app/lib/seriesInfo";

const RECENT = 36; // 各系列で表示する直近件数（3年＝前年同月比の動向が見えるように）

function fmt(v: number | null): string {
  return v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** 直近データの小さな折れ線（動向を一目で把握）。欠測は線を切る。 */
function Sparkline({ points }: { points: { date: string; value: number | null }[] }) {
  const W = 100;
  const H = 28;
  const vals = points.map((p) => p.value);
  const nums = vals.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - ((v - lo) / span) * H;

  // 欠測で分割した折れ線セグメント。
  const segs: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) {
        segs.push(cur.join(" "));
        cur = [];
      }
    } else {
      cur.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    }
  });
  if (cur.length) segs.push(cur.join(" "));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2 h-8 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      {segs.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function SeriesCard({ s }: { s: SeriesData }) {
  const window = s.points.slice(-RECENT);
  const recent = [...window].reverse();
  const info = seriesInfo(s.series_id);
  return (
    <div className="rounded border border-gray-200 p-3" data-testid={`series-${s.series_id}`}>
      <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-sm font-semibold">{info.name}</span>
        <span className="text-xs text-gray-500">
          単位: {unitNote(s.unit)}
        </span>
      </div>
      <div className="mb-1 font-mono text-[10px] text-gray-400">{s.series_id}</div>
      {info.desc && (
        <p className="mb-1 text-[11px] leading-relaxed text-gray-600">{info.desc}</p>
      )}
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-600 underline"
      >
        出典: {s.name}
      </a>
      <Sparkline points={window} />
      <div className="mt-1 max-h-52 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left text-gray-500">
              <th>年月</th>
              <th className="text-right">値</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((p) => (
              <tr key={p.date}>
                <td className="tabular-nums">{p.date.slice(0, 7)}</td>
                <td className="text-right tabular-nums">{fmt(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        全{s.points.length}件のうち直近{Math.min(RECENT, s.points.length)}件（約3年）
      </p>
    </div>
  );
}

/** データソースタブ: 入力系列ごとの実績テーブル。 */
export default function SourceTables({ file }: { file: SeriesFile | null }) {
  if (!file || file.series.length === 0) {
    return (
      <section aria-label="入力データ" data-testid="source-tables">
        <p className="text-sm text-gray-500">
          入力データの実績テーブルは次回バッチ（series.json 生成）で表示されます。
        </p>
      </section>
    );
  }
  return (
    <section aria-label="入力データ" data-testid="source-tables" className="flex flex-col gap-4">
      <p className="text-xs text-gray-500">
        生成日時: {file.generated_at.slice(0, 10)}
      </p>
      <p className="rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-500">
        ここは<b>モデルの入力となる生系列</b>（水準または前年比・出典そのまま）です。
        目的の「実質消費支出・前年同月比」はこれらを変換・実質化した後の値で、この表とは別物です。
        家計調査（<code>household.*</code>）は名目金額、CPIやDIは各出典の単位で表示しています。
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {file.series.map((s) => (
          <SeriesCard key={s.series_id} s={s} />
        ))}
      </div>
    </section>
  );
}
