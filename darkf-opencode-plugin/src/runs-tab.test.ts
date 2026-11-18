import { describe, expect, test } from "bun:test";
import type { PickerEntry } from "./locate.ts";
import {
  formatDate,
  RunsTab,
  runMatches,
  runRows,
  runTitle,
  SPINNER_FRAMES,
  spinnerFrame,
} from "./runs-tab.tsx";

function mk(
  runId: string,
  startedAt: number,
  active: boolean,
  fields: Partial<PickerEntry["entry"]> = {},
): PickerEntry {
  return {
    entry: {
      runId,
      startedAt,
      pid: 0,
      rootDir: "/p",
      schemaVersion: 1,
      status: "running",
      ...fields,
    } as PickerEntry["entry"],
    active,
  };
}

describe("runTitle — r12: message, then workflowDir basename, then runId", () => {
  test("the message wins when set", () => {
    expect(runTitle(mk("r1", 0, true, { message: "Fix the login flow" }).entry)).toBe(
      "Fix the login flow",
    );
  });

  test("otherwise the workflowDir's basename", () => {
    expect(runTitle(mk("r1", 0, true, { workflowDir: "/home/x/proj/darkf/my-flow" }).entry)).toBe(
      "my-flow",
    );
  });

  test("otherwise the bare runId", () => {
    expect(runTitle(mk("r1", 0, true).entry)).toBe("r1");
  });

  test("a blank message counts as unset and falls through", () => {
    expect(runTitle(mk("r1", 0, true, { message: "", workflowDir: "/p/darkf/wf" }).entry)).toBe(
      "wf",
    );
  });

  test("a blank workflowDir counts as unset and falls through to the runId", () => {
    expect(runTitle(mk("r1", 0, true, { workflowDir: "" }).entry)).toBe("r1");
  });
});

describe("formatDate — r5: date + title, fixed local-time shape", () => {
  test("YYYY-MM-DD HH:mm in the host's local time", () => {
    // Built in local time so the expectation holds on every host/timezone.
    expect(formatDate(new Date(2026, 10, 18, 14, 30).getTime())).toBe("2026-11-18 14:30");
  });

  test("zero-pads month, day, hour, and minute", () => {
    expect(formatDate(new Date(2026, 0, 5, 3, 7).getTime())).toBe("2026-01-05 03:07");
  });
});

describe("runMatches — r13: the displayed title, plus always the runId", () => {
  const entry = mk("2026-11-18T10-00-00-demo", 0, true, {
    message: "Fix the login flow",
  });

  test("matches the displayed title, case-insensitively", () => {
    expect(runMatches(entry, "LOGIN")).toBe(true);
    expect(runMatches(entry, "login flo")).toBe(true);
  });

  test("matches the runId even though a message is displayed instead", () => {
    expect(runMatches(entry, "10-00-00-demo")).toBe(true);
    expect(runMatches(entry, "DEMO")).toBe(true);
  });

  test("no match when neither title nor runId contains the query", () => {
    expect(runMatches(entry, "deploy")).toBe(false);
  });

  test("a blank query matches everything", () => {
    expect(runMatches(entry, "")).toBe(true);
    expect(runMatches(entry, "   ")).toBe(true);
  });
});

describe("runRows — r5/r8/r15: ordered, filtered, complete", () => {
  test("active runs first, most-recent-first within each group", () => {
    const rows = runRows(
      [mk("done-old", 100, false), mk("live-old", 100, true), mk("live-new", 200, true)],
      "",
    );
    expect(rows.map((c) => c.entry.runId)).toEqual(["live-new", "live-old", "done-old"]);
  });

  test("the filter narrows by title or runId, order preserved", () => {
    const rows = runRows(
      [
        mk("a", 300, false, { message: "ship the thing" }),
        mk("b", 200, false, { workflowDir: "/p/darkf/dev-loop" }),
        mk("c", 100, false),
      ],
      "dev-loop",
    );
    expect(rows.map((c) => c.entry.runId)).toEqual(["b"]);
  });

  test("an empty filter returns every run — nothing sliced away (no paging)", () => {
    const candidates = Array.from({ length: 60 }, (_, i) => mk(`r${i}`, i, false));
    const rows = runRows(candidates, "");
    expect(rows).toHaveLength(candidates.length);
    expect(rows[0]!.entry.runId).toBe("r59");
  });

  test("no candidates, or no matches, renders no rows", () => {
    expect(runRows([], "")).toEqual([]);
    expect(runRows([mk("a", 1, false)], "zzz")).toEqual([]);
  });

  test("the store's candidate array is not mutated", () => {
    const candidates = [mk("a", 1, false), mk("b", 2, true)];
    runRows(candidates, "a");
    expect(candidates.map((c) => c.entry.runId)).toEqual(["a", "b"]);
  });
});

describe("spinnerFrame — r14: one frame per poll tick, on active rows only", () => {
  test("tick 0 is the first glyph", () => {
    expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0]);
  });

  test("consecutive ticks walk the set in order", () => {
    SPINNER_FRAMES.forEach((glyph, tick) => {
      expect(spinnerFrame(tick)).toBe(glyph);
    });
  });

  test("wraps back to the first glyph after the last", () => {
    expect(spinnerFrame(SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
    expect(spinnerFrame(SPINNER_FRAMES.length + 1)).toBe(SPINNER_FRAMES[1]);
  });

  test("a long-running counter keeps cycling", () => {
    expect(spinnerFrame(123)).toBe(SPINNER_FRAMES[123 % SPINNER_FRAMES.length]);
    expect(spinnerFrame(10_007)).toBe(SPINNER_FRAMES[10_007 % SPINNER_FRAMES.length]);
  });

  test("every tick resolves to a glyph — the frame never comes up empty", () => {
    for (let tick = 0; tick < 25; tick++) {
      expect(SPINNER_FRAMES).toContain(spinnerFrame(tick));
    }
  });
});

describe("RunsTab", () => {
  test("the runs-tab list component is defined — the module transforms and loads", () => {
    expect(typeof RunsTab).toBe("function");
  });
});
