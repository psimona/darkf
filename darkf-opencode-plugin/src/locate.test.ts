import { describe, expect, test } from "bun:test";
import { PICKER_PAGE_SIZE, type PickerEntry, pickerOrder, pickerPage } from "./locate.ts";

function mk(runId: string, startedAt: number, active: boolean): PickerEntry {
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

describe("pickerOrder", () => {
  test("active sorts before inactive regardless of recency", () => {
    const ordered = pickerOrder([mk("old-live", 100, true), mk("new-done", 999, false)]);
    expect(ordered.map((e) => e.entry.runId)).toEqual(["old-live", "new-done"]);
  });

  test("recency desc within the active group and within the inactive group", () => {
    const ordered = pickerOrder([
      mk("done-old", 100, false),
      mk("live-old", 100, true),
      mk("done-new", 300, false),
      mk("live-new", 200, true),
    ]);
    expect(ordered.map((e) => e.entry.runId)).toEqual([
      "live-new",
      "live-old",
      "done-new",
      "done-old",
    ]);
  });

  test("input array is not mutated", () => {
    const input = [mk("a", 1, false), mk("b", 2, true)];
    pickerOrder(input);
    expect(input.map((e) => e.entry.runId)).toEqual(["a", "b"]);
  });
});

describe("pickerPage", () => {
  const many = Array.from({ length: PICKER_PAGE_SIZE + 1 }, (_, i) => mk(`r${i}`, i, false));

  test("page 0 slices one page and reports more", () => {
    const { rows, hasMore } = pickerPage(many, 0);
    expect(rows).toHaveLength(PICKER_PAGE_SIZE);
    expect(hasMore).toBe(true);
  });

  test("last partial page reports no more", () => {
    const { rows, hasMore } = pickerPage(many, 1);
    expect(rows).toHaveLength(1);
    expect(hasMore).toBe(false);
  });

  test("exactly one page reports no more", () => {
    const { rows, hasMore } = pickerPage(many.slice(0, PICKER_PAGE_SIZE), 0);
    expect(rows).toHaveLength(PICKER_PAGE_SIZE);
    expect(hasMore).toBe(false);
  });

  test("empty list", () => {
    const { rows, hasMore } = pickerPage([], 0);
    expect(rows).toHaveLength(0);
    expect(hasMore).toBe(false);
  });
});
