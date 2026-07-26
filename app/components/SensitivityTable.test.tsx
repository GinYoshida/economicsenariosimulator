import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import SensitivityTable, { type SensRow } from "@/app/components/SensitivityTable";

const rows: SensRow[] = [
  { driver: "a", label: "変数A", sens: 0.001, contrib: 0.002 },
  { driver: "b", label: "変数B", sens: -0.02, contrib: -0.005 },
  { driver: "c", label: "変数C", sens: 0.005, contrib: 0 },
];

describe("SensitivityTable", () => {
  it("renders one row per driver, sorted by |sensitivity| desc", () => {
    render(<SensitivityTable rows={rows} />);
    const body = screen.getByTestId("sensitivity-table");
    const labels = Array.from(body.querySelectorAll("tbody tr")).map(
      (tr) => tr.querySelector("td")?.textContent ?? "",
    );
    // |0.02| > |0.005| > |0.001| -> B, C, A
    expect(labels[0]).toContain("変数B");
    expect(labels[1]).toContain("変数C");
    expect(labels[2]).toContain("変数A");
  });

  it("formats pp with sign", () => {
    render(<SensitivityTable rows={rows} />);
    const body = screen.getByTestId("sensitivity-table");
    expect(body).toHaveTextContent("−2.00pp"); // sens -0.02
    expect(body).toHaveTextContent("+0.50pp"); // sens 0.005
  });
});
