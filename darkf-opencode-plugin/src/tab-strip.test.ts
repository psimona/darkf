import { describe, expect, test } from "bun:test";
import { nextTabLabel, TAB_ORDER, type TabId } from "./tab-strip.ts";

// Decision 7's fixture checks (docs/specs/opencode-overlay-tiles/spec.md —
// tab-strip-navigation): the arrow-key step math and its wraparound are the
// pure half of the tab strip's keyboard model; whether the strip *reads* as
// navigable is confirmed live, per the spec's verification strategy.

describe("TAB_ORDER — the strip's single traversal vocabulary", () => {
  test("the two tabs, in display order", () => {
    expect(TAB_ORDER).toEqual(["workflows", "runs"]);
  });

  test("every tab id is a member — the step math can never leave the set", () => {
    for (const tab of TAB_ORDER) expect(TAB_ORDER).toContain(tab);
  });
});

describe("nextTabLabel — one arrow-key step across the labels (decision 7)", () => {
  test("right moves to the next label in order", () => {
    expect(nextTabLabel("workflows", "right")).toBe("runs");
  });

  test("left moves to the previous label in order", () => {
    expect(nextTabLabel("runs", "left")).toBe("workflows");
  });

  test("right wraps past the last label back to the first", () => {
    expect(nextTabLabel("runs", "right")).toBe("workflows");
  });

  test("left wraps past the first label back to the last", () => {
    expect(nextTabLabel("workflows", "left")).toBe("runs");
  });

  test("with two labels the two directions read as a toggle — every label is reachable from every other", () => {
    for (const from of TAB_ORDER as readonly TabId[]) {
      for (const direction of ["left", "right"] as const) {
        expect(TAB_ORDER).toContain(nextTabLabel(from, direction));
        expect(nextTabLabel(from, direction)).not.toBe(from);
      }
    }
  });

  test("a current outside the order steps from the first label instead of crashing", () => {
    const stale = "tile:some-run" as TabId;
    expect(nextTabLabel(stale, "right")).toBe("runs");
    expect(nextTabLabel(stale, "left")).toBe("runs");
  });
});
