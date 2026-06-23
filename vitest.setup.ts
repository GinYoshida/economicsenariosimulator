import "@testing-library/jest-dom/vitest";

// jsdom には ResizeObserver が無いため、Recharts の ResponsiveContainer 用に補う。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    ResizeObserverStub;
}
