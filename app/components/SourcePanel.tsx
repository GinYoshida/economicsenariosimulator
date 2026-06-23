"use client";

import type { SourceMeta } from "@/app/lib/artifacts";

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/** 出典パネル: 全系列の出典名・URL・取得日を常時表示する。 */
export default function SourcePanel({ sources }: { sources: SourceMeta[] }) {
  // 出典名でまとめて重複表示を避ける。
  const seen = new Map<string, SourceMeta>();
  for (const s of sources) {
    if (!seen.has(s.name)) seen.set(s.name, s);
  }
  const unique = [...seen.values()];

  return (
    <section aria-label="出典" data-testid="source-panel">
      <h2 className="mb-2 text-sm font-semibold">出典</h2>
      <ul className="flex flex-col gap-1 text-xs text-gray-600">
        {unique.map((s) => (
          <li key={s.name}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              {s.name}
            </a>
            <span className="ml-2 text-gray-400">
              取得 {formatDate(s.retrieved_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
