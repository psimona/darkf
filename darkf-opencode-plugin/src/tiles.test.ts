import { describe, expect, test } from "bun:test";
import type { PickerEntry } from "./locate.ts";
import type { LiveStore } from "./store.ts";
import {
  CONTENT_REGION,
  columnCount,
  focusedTileRunId,
  gridColumnCount,
  MIN_FOCUSED_TILE_WIDTH,
  MIN_TILE_WIDTH,
  nextRegion,
  promotedTileRunId,
  type RegionId,
  regionBoxFocused,
  regionOrder,
  setFocusedTileRunId,
  setPanelOpen,
  TAB_STRIP_REGION,
  tileBoxFocused,
  tileRegionId,
  tileRows,
  tileRunIdOfRegion,
  tileRunIds,
  tileWidthPercent,
  vanishHandoffTarget,
} from "./tiles.ts";

// Module-level signals are shared per process, so every test establishes
// its own open/focus state before reading — no test trusts a previous one.

function storeWith(picker: PickerEntry[]): LiveStore {
  return {
    views: () => new Map(),
    taskViews: () => new Map(),
    pickerCandidates: () => picker,
    bindingFor: () => undefined,
    tick: () => 0,
  };
}

function pick(runId: string, startedAt: number, active: boolean): PickerEntry {
  return {
    entry: {
      runId,
      startedAt,
      pid: 0,
      rootDir: "/p",
      schemaVersion: 1,
      status: "running",
    } as PickerEntry["entry"],
    active,
  };
}

describe("tileRunIds — the open panel's tile membership (spec: opencode-overlay-tiles, decision 9)", () => {
  test("a closed panel renders no tiles, even with active runs", () => {
    setPanelOpen(false);
    expect(tileRunIds(storeWith([pick("live-1", 1, true)]))).toEqual([]);
  });

  test("an open panel tiles every active run and only active runs", () => {
    setPanelOpen(true);
    const ids = tileRunIds(storeWith([pick("done-1", 999, false), pick("live-1", 1, true)]));
    expect(ids).toEqual(["live-1"]);
  });

  test("membership follows the runs list's own ranking: active-first, most-recent-first", () => {
    setPanelOpen(true);
    const ids = tileRunIds(
      storeWith([
        pick("live-old", 100, true),
        pick("live-new", 200, true),
        pick("done-new", 999, false),
      ]),
    );
    expect(ids).toEqual(["live-new", "live-old"]);
  });

  test("an open panel with no active run has no tiles", () => {
    setPanelOpen(true);
    expect(tileRunIds(storeWith([pick("done-1", 1, false)]))).toEqual([]);
  });

  test("each call returns a fresh array; the store's own value is untouched", () => {
    setPanelOpen(true);
    const picker = [pick("live-1", 1, true)];
    const first = tileRunIds(storeWith(picker));
    const second = tileRunIds(storeWith(picker));
    expect(first).not.toBe(second);
    expect(picker.map((c) => c.entry.runId)).toEqual(["live-1"]);
  });

  test("a run that stops being active drops out on the tick the classification moves — without touching focus (the vanish handoff owns that)", () => {
    setPanelOpen(true);
    setFocusedTileRunId("live-1");
    const finished = [pick("live-1", 1, false), pick("live-2", 2, true)];
    expect(tileRunIds(storeWith(finished))).toEqual(["live-2"]);
    expect(focusedTileRunId()).toBe("live-1");
  });
});

describe("focusedTileRunId — the region-focused tile (spec: opencode-overlay-tiles, Runtime View)", () => {
  test("no tile holds region focus before the region cycle drives one", () => {
    setPanelOpen(false);
    setFocusedTileRunId(undefined);
    expect(focusedTileRunId()).toBeUndefined();
  });

  test("the panel container's write is the read", () => {
    setPanelOpen(true);
    setFocusedTileRunId("live-1");
    expect(focusedTileRunId()).toBe("live-1");
    setFocusedTileRunId(undefined);
    expect(focusedTileRunId()).toBeUndefined();
  });

  test("closing the panel clears focus — no stale tile reference across opens", () => {
    setPanelOpen(true);
    setFocusedTileRunId("live-1");
    setPanelOpen(false);
    expect(focusedTileRunId()).toBeUndefined();
    // The next open starts clean even though runs are tiling again.
    setPanelOpen(true);
    expect(tileRunIds(storeWith([pick("live-1", 1, true)]))).toEqual(["live-1"]);
    expect(focusedTileRunId()).toBeUndefined();
  });
});

describe("columnCount — the grid's N-up column math (spec: opencode-overlay-tiles, decision 8)", () => {
  test("one tile fits exactly at MIN_TILE_WIDTH", () => {
    expect(columnCount(MIN_TILE_WIDTH)).toBe(1);
  });

  test("narrow widths stay at 1 — the formula's boundary case, not a compact-mode branch", () => {
    expect(columnCount(MIN_TILE_WIDTH - 1)).toBe(1);
    expect(columnCount(1)).toBe(1);
    expect(columnCount(0)).toBe(1);
  });

  test("columns grow by whole tiles only — a too-narrow remainder adds none", () => {
    expect(columnCount(MIN_TILE_WIDTH * 2 - 1)).toBe(1);
    expect(columnCount(MIN_TILE_WIDTH * 2)).toBe(2);
    expect(columnCount(MIN_TILE_WIDTH * 3 + 1)).toBe(3);
  });

  test("no hard cap: columns keep growing with width", () => {
    expect(columnCount(MIN_TILE_WIDTH * 10)).toBe(10);
    expect(columnCount(MIN_TILE_WIDTH * 50)).toBe(50);
  });

  test("fractional widths floor — a partial tile is not a column", () => {
    expect(columnCount(79.9)).toBe(1);
    expect(columnCount(80.5)).toBe(2);
  });

  test("accepts a caller-supplied minimum — the pure formula is parameterized on the constant", () => {
    expect(columnCount(100, 60)).toBe(1);
    expect(columnCount(120, 60)).toBe(2);
    // The default is the spec constant itself.
    expect(columnCount(80)).toBe(columnCount(80, MIN_TILE_WIDTH));
  });
});

describe("gridColumnCount — decision 10's column drop (spec: opencode-overlay-tiles)", () => {
  test("unfocused is the plain N-up formula, unchanged", () => {
    expect(gridColumnCount(40, false)).toBe(columnCount(40));
    expect(gridColumnCount(80, false)).toBe(columnCount(80));
    expect(gridColumnCount(201, false)).toBe(columnCount(201));
  });

  test("focused counts the focused tile at its larger minimum and the others at MIN_TILE_WIDTH", () => {
    // 120 = MIN_FOCUSED_TILE_WIDTH + MIN_TILE_WIDTH: one promoted tile plus
    // one condensed tile — the uniform-80 reading would fit only 1 here.
    expect(gridColumnCount(120, true)).toBe(2);
    // 240 = 80 + 4 × 40.
    expect(gridColumnCount(240, true)).toBe(5);
  });

  test("mixed-formula breakpoints: the focused tile's 80 plus whole 40-wide others", () => {
    const breakpoints: Array<[number, number]> = [
      [79, 1],
      [80, 1],
      [119, 1],
      [120, 2],
      [159, 2],
      [160, 3],
      [199, 3],
      [200, 4],
      [201, 4],
    ];
    for (const [width, columns] of breakpoints) {
      expect(gridColumnCount(width, true)).toBe(columns);
    }
  });

  test("the drop actually drops: the same width fits fewer columns while a tile is focused", () => {
    expect(gridColumnCount(120, false)).toBe(3);
    expect(gridColumnCount(120, true)).toBe(2);
    expect(gridColumnCount(200, false)).toBe(5);
    expect(gridColumnCount(200, true)).toBe(4);
  });

  test("the drop never adds a column and never goes below one", () => {
    for (const width of [1, 39, 40, 41, 79, 80, 81, 120, 160, 239, 400]) {
      expect(gridColumnCount(width, true)).toBeLessThanOrEqual(gridColumnCount(width, false));
      expect(gridColumnCount(width, true)).toBeGreaterThanOrEqual(1);
    }
  });

  test("the drop is exactly the minimal drop: one column, once the focused tile fits beside another", () => {
    // 80 is an exact multiple of 40, so for every width that fits the
    // focused tile at all, focused mode is the unfocused count minus one.
    for (let width = MIN_FOCUSED_TILE_WIDTH; width <= 400; width++) {
      expect(gridColumnCount(width, true)).toBe(gridColumnCount(width, false) - 1);
    }
  });

  test("N=1 is the focused mode's floor too — below the wider minimum, scrolling is the last resort", () => {
    expect(gridColumnCount(MIN_FOCUSED_TILE_WIDTH, true)).toBe(1);
    expect(gridColumnCount(MIN_FOCUSED_TILE_WIDTH - 1, true)).toBe(1);
    expect(gridColumnCount(1, true)).toBe(1);
  });

  test("no cap while focused either: wider panels keep fitting proportionally more columns", () => {
    // 800 = 80 + 18 × 40; 4000 = 80 + 98 × 40 — still growing with width.
    expect(gridColumnCount(MIN_FOCUSED_TILE_WIDTH * 10, true)).toBe(19);
    expect(gridColumnCount(MIN_FOCUSED_TILE_WIDTH * 50, true)).toBe(99);
  });

  test("the focused minimum is the larger of the two — the wider column is the point", () => {
    expect(MIN_FOCUSED_TILE_WIDTH).toBeGreaterThan(MIN_TILE_WIDTH);
  });
});

describe("tileWidthPercent — decision 10's focused-mode geometry (spec: opencode-overlay-tiles)", () => {
  test("unfocused, every tile takes an equal 1/columns slice", () => {
    expect(tileWidthPercent("a", undefined, 3)).toBeCloseTo(100 / 3);
    expect(tileWidthPercent("b", undefined, 3)).toBeCloseTo(100 / 3);
  });

  test("focused, the promoted tile takes two units and every other tile one", () => {
    expect(tileWidthPercent("a", "a", 4)).toBe(40);
    expect(tileWidthPercent("b", "a", 4)).toBe(20);
    expect(tileWidthPercent("c", "a", 4)).toBe(20);
  });

  test("rows without the promoted tile keep the same unit width — rows stay aligned", () => {
    expect(tileWidthPercent("z", "a", 4)).toBe(20);
  });

  test("at an exact-fit width the promoted tile renders MIN_FOCUSED_TILE_WIDTH and each other tile MIN_TILE_WIDTH", () => {
    const width = MIN_FOCUSED_TILE_WIDTH + 3 * MIN_TILE_WIDTH; // 200
    const columns = gridColumnCount(width, true); // 4
    expect((tileWidthPercent("a", "a", columns) * width) / 100).toBe(MIN_FOCUSED_TILE_WIDTH);
    expect((tileWidthPercent("b", "a", columns) * width) / 100).toBe(MIN_TILE_WIDTH);
  });

  test("a full focused-mode row still sums to 100% — the extra unit comes out of the column drop", () => {
    const columns = gridColumnCount(200, true); // 4
    const row = ["a", "b", "c", "d"];
    const sum = row.reduce((total, runId) => total + tileWidthPercent(runId, "a", columns), 0);
    expect(sum).toBeCloseTo(100);
  });

  test("a partial focused-mode row sums below 100% — trailing cells stay empty, tiles don't stretch", () => {
    const columns = gridColumnCount(200, true); // 4
    const sum = ["a", "b"].reduce(
      (total, runId) => total + tileWidthPercent(runId, "a", columns),
      0,
    );
    expect(sum).toBeLessThan(100);
  });
});

describe("promotedTileRunId — the focused tile's promotion guard (spec: opencode-overlay-tiles, decision 10)", () => {
  test("a focused id in membership is the promotion target", () => {
    expect(promotedTileRunId(["live-2", "live-1"], "live-1")).toBe("live-1");
  });

  test("a focused id outside membership promotes nothing — no tile that no longer renders", () => {
    expect(promotedTileRunId(["live-2"], "live-1")).toBeUndefined();
    expect(promotedTileRunId([], "live-1")).toBeUndefined();
  });

  test("no focused tile promotes no tile — every tile stays condensed", () => {
    expect(promotedTileRunId(["live-1", "live-2"], undefined)).toBeUndefined();
  });
});

describe("tileRows — the grid's row chunking (spec: opencode-overlay-tiles, decision 8)", () => {
  test("the first `columns` runs fill the top row; the rest become additional rows", () => {
    expect(tileRows(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  test("fewer runs than columns is one row — no filler", () => {
    expect(tileRows(["a", "b"], 4)).toEqual([["a", "b"]]);
  });

  test("an exact multiple of columns leaves no empty trailing row", () => {
    expect(tileRows(["a", "b", "c", "d"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("one column stacks every run — the N=1 boundary case", () => {
    expect(tileRows(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
  });

  test("empty membership is no rows", () => {
    expect(tileRows([], 3)).toEqual([]);
  });

  test("membership order is preserved within and across rows", () => {
    const rows = tileRows(["r5", "r4", "r3", "r2", "r1"], 3);
    expect(rows.flat()).toEqual(["r5", "r4", "r3", "r2", "r1"]);
  });

  test("no pagination: every run appears in exactly one row, exactly once", () => {
    const ids = Array.from({ length: 17 }, (_, i) => `run-${i}`);
    const rows = tileRows(ids, 5);
    expect(rows.flat()).toEqual(ids);
    expect(rows.flat().length).toBe(new Set(rows.flat()).size);
  });

  test("a degenerate column count clamps to 1 instead of looping forever", () => {
    expect(tileRows(["a", "b"], 0)).toEqual([["a"], ["b"]]);
    expect(tileRows(["a", "b"], -3)).toEqual([["a"], ["b"]]);
    expect(tileRows(["a", "b"], 2.9)).toEqual([["a", "b"]]);
  });
});

describe("regionOrder — the container's cycle order (spec: opencode-overlay-tiles, decision 6)", () => {
  test("no tiles: tab strip then content area — the two fixed regions", () => {
    expect(regionOrder([])).toEqual<RegionId[]>(["tab-strip", "content"]);
  });

  test("tiled: each tile follows the content area, in grid (membership) order", () => {
    expect(regionOrder(["live-1", "live-2"])).toEqual<RegionId[]>([
      "tab-strip",
      "content",
      "tile:live-1",
      "tile:live-2",
    ]);
  });

  test("every tile gets exactly one region — no duplicates, no omissions", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `run-${i}`);
    const order = regionOrder(ids);
    expect(order.slice(2)).toEqual(ids.map((id) => tileRegionId(id)));
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("nextRegion — the forward Tab step (spec: opencode-overlay-tiles, decision 6)", () => {
  const untiled = regionOrder([]);
  const tiled = regionOrder(["live-1", "live-2"]);

  test("the strip's forward neighbor is the content area", () => {
    expect(nextRegion(tiled, "tab-strip")).toBe("content");
  });

  test("the content area's forward neighbor is the first tile when tiled", () => {
    expect(nextRegion(tiled, "content")).toBe("tile:live-1");
  });

  test("untiled, the content area wraps straight back to the strip", () => {
    expect(nextRegion(untiled, "content")).toBe("tab-strip");
  });

  test("tiles chain forward, and the last tile wraps to the tab strip", () => {
    expect(nextRegion(tiled, "tile:live-1")).toBe("tile:live-2");
    expect(nextRegion(tiled, "tile:live-2")).toBe("tab-strip");
  });

  test("forward-only wraparound never leaves the cycle — every step stays a member", () => {
    for (const current of tiled) {
      expect(tiled).toContain(nextRegion(tiled, current));
    }
    for (const current of untiled) {
      expect(untiled).toContain(nextRegion(untiled, current));
    }
  });

  test("a stale tile region (its run stopped being active) still steps — onto the first region", () => {
    expect(nextRegion(tiled, "tile:vanished")).toBe("tab-strip");
  });

  test("cycling from every region eventually returns to it — a single closed loop", () => {
    let current: (typeof tiled)[number] = "tab-strip";
    let steps = 0;
    do {
      current = nextRegion(tiled, current);
      steps++;
    } while (current !== "tab-strip" && steps <= tiled.length);
    expect(current).toBe("tab-strip");
    expect(steps).toBe(tiled.length);
  });
});

describe("vanishHandoffTarget — the focused-tile vanish handoff (spec: opencode-overlay-tiles, Runtime View)", () => {
  test("no tile holds focus — nothing can dangle, no handoff", () => {
    expect(vanishHandoffTarget(["live-1", "live-2"], undefined)).toBeUndefined();
    expect(vanishHandoffTarget([], undefined)).toBeUndefined();
  });

  test("the focused run is still in membership — focus is where it should be, no handoff", () => {
    expect(vanishHandoffTarget(["live-1", "live-2"], "live-1")).toBeUndefined();
    expect(vanishHandoffTarget(["live-2"], "live-2")).toBeUndefined();
  });

  test("the focused run dropped but tiles remain — focus moves to the next remaining tile", () => {
    // The next remaining tile is the first of the remaining membership —
    // the `pickerOrder` ranking the grid, the cycle, and the list agree on
    // (tileRunIds' doc). Whatever position the vanished tile held.
    expect(vanishHandoffTarget(["live-2", "live-3"], "live-1")).toBe(tileRegionId("live-2"));
    expect(vanishHandoffTarget(["live-1", "live-3"], "live-2")).toBe(tileRegionId("live-1"));
    expect(vanishHandoffTarget(["live-1", "live-2"], "live-3")).toBe(tileRegionId("live-1"));
  });

  test("the focused run dropped and no tiles remain — focus moves to the content area", () => {
    // The content area is the handoff's else-target: its surface is then
    // the plain runs list (the grid > list > detail precedence leaves the
    // list once no tiles remain). The region is what the handoff owns; the
    // content's own state decides the surface.
    expect(vanishHandoffTarget([], "live-1")).toBe(CONTENT_REGION);
  });

  test("the target is always a region that still renders — never a tile outside membership", () => {
    const remaining = ["live-2", "live-3"];
    const order = regionOrder(remaining);
    for (const focused of [undefined, "live-1", "also-gone"]) {
      const target = vanishHandoffTarget(remaining, focused);
      if (target !== undefined) expect(order).toContain(target);
    }
    // The empty-membership target is the content area — a member of the
    // untiled order too.
    const emptyTarget = vanishHandoffTarget([], "live-1")!;
    expect(emptyTarget).toBe(CONTENT_REGION);
    expect(regionOrder([])).toContain(emptyTarget);
  });

  test("membership order is what the target resolves against — the grid's own ranking", () => {
    // The same membership the grid renders from (`tileRunIds`' output
    // shape: active-first, most-recent-first) after the most recent run
    // dropped — so the handoff lands on the tile the grid actually draws
    // first, not on some other order's survivor.
    const membership = tileRunIds(
      storeWith([pick("live-old", 100, true), pick("live-new", 200, false)]),
    );
    expect(membership).toEqual(["live-old"]);
    expect(vanishHandoffTarget(membership, "live-new")).toBe(tileRegionId("live-old"));
  });
});

describe("tileRegionId / tileRunIdOfRegion — the tile region naming", () => {
  test("a tile region names its run, and the round trip returns it", () => {
    expect(tileRegionId("live-1")).toBe("tile:live-1");
    expect(tileRunIdOfRegion(tileRegionId("live-1"))).toBe("live-1");
  });

  test("the two fixed regions name no tile", () => {
    expect(tileRunIdOfRegion("tab-strip")).toBeUndefined();
    expect(tileRunIdOfRegion("content")).toBeUndefined();
  });
});

describe("regionBoxFocused — the region-focus border switching (spec: opencode-overlay-tiles, decision 6)", () => {
  const tiled: RegionId[] = regionOrder(["live-1", "live-2"]);

  test("the panel not owning input stands every region box down — nothing lights, whichever region is current", () => {
    for (const current of tiled) {
      for (const box of tiled) {
        expect(regionBoxFocused(current, box, false)).toBe(false);
      }
    }
  });

  test("only the current region's box takes the focused border — every other pairing is false", () => {
    for (const current of tiled) {
      for (const box of tiled) {
        expect(regionBoxFocused(current, box, true)).toBe(current === box);
      }
    }
  });

  test("exactly one box holds the border at every stop of the cycle — switching, never doubling, never dying", () => {
    for (const current of tiled) {
      const lit = tiled.filter((box) => regionBoxFocused(current, box, true));
      expect(lit).toEqual([current]);
    }
  });

  test("the border follows Tab around the whole cycle — each step's next region is the only one lit there", () => {
    let current: RegionId = tiled[0]!;
    for (let step = 0; step < tiled.length; step++) {
      for (const box of tiled) {
        expect(regionBoxFocused(current, box, true)).toBe(box === current);
      }
      current = nextRegion(tiled, current);
    }
    // The cycle wrapped cleanly back to the strip — the border came with it.
    expect(current).toBe(TAB_STRIP_REGION);
  });

  test("the content area showing the plain runs list stands its box down — the filter input is the region's focus holder", () => {
    const listShowing = true;
    const boxFocused = regionBoxFocused(CONTENT_REGION, CONTENT_REGION, true, listShowing);
    // The container's complement (overlay.tsx's `listInputFocused`): the
    // input takes native focus exactly while the box stands down — one
    // focus holder, never two, never zero.
    const inputFocused = regionBoxFocused(CONTENT_REGION, CONTENT_REGION, true) && listShowing;
    expect(boxFocused).toBe(false);
    expect(inputFocused).toBe(true);
    expect(boxFocused && inputFocused).toBe(false);
  });

  test("a tiled content area keeps its box focused — the stand-down is the plain list's alone", () => {
    expect(regionBoxFocused(CONTENT_REGION, CONTENT_REGION, true, false)).toBe(true);
    // The strip and the tiles never stand down for the list fact.
    expect(regionBoxFocused(TAB_STRIP_REGION, TAB_STRIP_REGION, true, true)).toBe(true);
    expect(regionBoxFocused(tileRegionId("live-1"), tileRegionId("live-1"), true, true)).toBe(true);
  });
});

describe("tileBoxFocused — which tile's border lights (spec: opencode-overlay-tiles, decision 6)", () => {
  const membership = ["live-1", "live-2"];

  test("exactly the focused tile lights; its neighbors stay dim", () => {
    expect(tileBoxFocused("live-1", "live-1", true)).toBe(true);
    expect(tileBoxFocused("live-2", "live-1", true)).toBe(false);
    expect(tileBoxFocused("live-1", "live-2", true)).toBe(false);
    expect(tileBoxFocused("live-2", "live-2", true)).toBe(true);
  });

  test("no tile holds focus — none lights", () => {
    for (const runId of membership) {
      expect(tileBoxFocused(runId, undefined, true)).toBe(false);
    }
  });

  test("the panel not owning input — no tile lights, focused or not", () => {
    expect(tileBoxFocused("live-1", "live-1", false)).toBe(false);
    expect(tileBoxFocused("live-2", "live-1", false)).toBe(false);
  });

  test("a focused id naming no rendered tile — the vanished run's frame before the handoff — lights nothing", () => {
    for (const runId of membership) {
      expect(tileBoxFocused(runId, "vanished", true)).toBe(false);
    }
  });

  test("moving focus between tiles switches the border from one tile to the other — never both, never neither", () => {
    for (const focused of membership) {
      const lit = membership.filter((runId) => tileBoxFocused(runId, focused, true));
      expect(lit).toEqual([focused]);
    }
  });

  test("the tile verdict and the region verdict agree through the projection — one region state, one border", () => {
    // The container projects its region onto `focusedTileRunId`; for tile
    // regions the two render-half functions must light the same box.
    for (const current of regionOrder(membership)) {
      const projected = tileRunIdOfRegion(current);
      for (const runId of membership) {
        expect(tileBoxFocused(runId, projected, true)).toBe(
          regionBoxFocused(current, tileRegionId(runId), true),
        );
      }
    }
  });
});
