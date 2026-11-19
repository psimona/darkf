import { describe, expect, test } from "bun:test";
import { RunDetailBody } from "./run-detail.tsx";
import { CompactRunView } from "./sidebar.tsx";
import { TileGrid } from "./tile-grid.tsx";

describe("TileGrid — the runs view's tiled mode (spec: opencode-overlay-tiles, decisions 2/8/9/10)", () => {
  test("the grid component is defined — the module transforms and loads", () => {
    expect(typeof TileGrid).toBe("function");
  });
});

describe("CompactRunView — decision 10's condensed tile content", () => {
  test("sidebar.tsx's compact view is exported for the tiles to reuse — the module transforms and loads", () => {
    expect(typeof CompactRunView).toBe("function");
  });
});

describe("RunDetailBody — decision 10's promoted tile content", () => {
  test("the full detail view's body is exported for the focused tile to reuse — the module transforms and loads", () => {
    expect(typeof RunDetailBody).toBe("function");
  });
});
