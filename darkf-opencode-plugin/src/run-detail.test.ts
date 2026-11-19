import { describe, expect, test } from "bun:test";
import {
  type DetailLayout,
  layoutDirection,
  RunDetail,
  RunDetailBody,
  RunsTabContent,
} from "./run-detail.tsx";

describe("layoutDirection — r11: the manual toggle swaps the pane row", () => {
  test("side-by-side is the fixed two-column row", () => {
    expect(layoutDirection("side-by-side")).toBe("row");
  });

  test("stacked is top-bottom", () => {
    expect(layoutDirection("stacked")).toBe("column");
  });

  test("every layout resolves to a direction — the toggle never comes up empty", () => {
    const layouts: DetailLayout[] = ["side-by-side", "stacked"];
    for (const layout of layouts) {
      expect(["row", "column"]).toContain(layoutDirection(layout));
    }
  });
});

describe("RunDetail / RunsTabContent / RunDetailBody", () => {
  test("the detail view, its extracted body, and the tab's list↔detail switch are defined — the module transforms and loads", () => {
    expect(typeof RunDetail).toBe("function");
    expect(typeof RunDetailBody).toBe("function");
    expect(typeof RunsTabContent).toBe("function");
  });
});
