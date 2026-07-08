"use client";

import type { SeriesData, SeriesFile } from "@/app/lib/artifacts";

const RECENT = 12; // 各系列で表示する直近件数

function fmt(v: number | null): string {
  return v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function SeriesCard({ s }: { s: SeriesData }) {
  const recent = s.points.slice(-RECENT).reverse();
  return (
    <div className="rounded border border-gray-200 p-3" data-testid={`series-${s.series_id}`}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-sm font-semibold">{s.series_id}</span>
        <span className="text-xs text-gray-500">単位: {s.unit}</span>
      </div>
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-600 underline"
      >
        {s.name}
      </a>
      <table className="mt-2 w-full text-sm">
        <thead>
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
      <p className="mt-1 text-[10px] text-gray-400">
        全{s.points.length}件のうち直近{Math.min(RECENT, s.points.length)}件
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {file.series.map((s) => (
          <SeriesCard key={s.series_id} s={s} />
        ))}
      </div>
    </section>
  );
}
