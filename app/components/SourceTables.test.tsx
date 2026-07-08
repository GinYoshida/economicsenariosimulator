import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import SourceTables from "@/app/components/SourceTables";
import type { SeriesFile } from "@/app/lib/artifacts";

const file: SeriesFile = {
  generated_at: "2026-06-22T00:00:00Z",
  series: [
    {
      series_id: "household.food.real_yoy",
      name: "総務省 家計調査",
      url: "https://www.stat.go.jp/data/kakei/",
      unit: "yoy_pct",
      frequency: "monthly",
      points: [
        { date: "2024-01-01", value: 82531 },
        { date: "2024-02-01", value: null },
        { date: "2024-03-01", value: 84120 },
      ],
    },
  ],
};

describe("SourceTables", () => {
  it("renders a per-series table with source link and null handling", () => {
    render(<SourceTables file={file} />);
    const card = screen.getByTestId("series-household.food.real_yoy");
    expect(within(card).getByRole("link", { name: "総務省 家計調査" })).toHaveAttribute(
      "href",
      "https://www.stat.go.jp/data/kakei/",
    );
    expect(within(card).getByText("2024-03")).toBeInTheDocument();
    expect(within(card).getByText("—")).toBeInTheDocument(); // null value
  });

  it("shows a placeholder when series data is absent", () => {
    render(<SourceTables file={null} />);
    expect(screen.getByTestId("source-tables").textContent).toMatch(/次回バッチ/);
  });
});
