import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import SourcePanel from "@/app/components/SourcePanel";
import type { SourceMeta } from "@/app/lib/artifacts";

const sources: SourceMeta[] = [
  {
    series_id: "household.food.real_yoy",
    name: "総務省 家計調査",
    url: "https://www.stat.go.jp/data/kakei/",
    retrieved_at: "2026-06-05T00:00:00+00:00",
    license: "政府統計（出典明示で利用可）",
    unit: "yoy_pct",
    frequency: "monthly",
  },
  {
    series_id: "household.clothing.real_yoy",
    name: "総務省 家計調査", // duplicate name -> shown once
    url: "https://www.stat.go.jp/data/kakei/",
    retrieved_at: "2026-06-05T00:00:00+00:00",
    license: "政府統計（出典明示で利用可）",
    unit: "yoy_pct",
    frequency: "monthly",
  },
  {
    series_id: "boj.usdjpy",
    name: "日本銀行",
    url: "https://www.stat-search.boj.or.jp/",
    retrieved_at: "2026-06-04T00:00:00+00:00",
    license: "日本銀行（出典明示で利用可）",
    unit: "jpy_per_usd",
    frequency: "monthly",
  },
];

describe("SourcePanel", () => {
  it("lists unique sources with links and retrieval dates", () => {
    render(<SourcePanel sources={sources} />);
    const kakei = screen.getAllByRole("link", { name: "総務省 家計調査" });
    expect(kakei).toHaveLength(1); // de-duplicated by name
    expect(kakei[0]).toHaveAttribute("href", "https://www.stat.go.jp/data/kakei/");
    expect(screen.getByRole("link", { name: "日本銀行" })).toBeInTheDocument();
    expect(screen.getAllByText(/取得 2026-06-/).length).toBeGreaterThan(0);
  });
});
