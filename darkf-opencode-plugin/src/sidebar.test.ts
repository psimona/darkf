import { describe, expect, test } from "bun:test";
import type { PlanView, TaskListView } from "./digest.ts";
import type { PickerEntry, RunBinding } from "./locate.ts";
import { sidebarRunForSession } from "./sidebar.tsx";
import type { LiveStore } from "./store.ts";
import { setPanelOpen, tileRunIds } from "./tiles.ts";

// Decision 12's suppression (docs/specs/opencode-overlay-tiles/spec.md):
// `sidebar.content` shows nothing for a run the open panel currently shows
// as a tile. The membership read (`tileRunIds`) has its own tests in
// tiles.test.ts; these cover the sidebar-side half — session resolution and
// the suppression gate. Module-level signals are shared per process, so
// every test establishes its own open state before reading.

function storeWith(views: PlanView[], picker: PickerEntry[], bindings: RunBinding[]): LiveStore {
  const viewMap = new Map(views.map((v) => [v.runId, v]));
  const bindingMap = new Map(bindings.map((b) => [b.runId, b]));
  return {
    views: () => viewMap,
    taskViews: () => new Map<string, TaskListView>(),
    pickerCandidates: () => picker,
    bindingFor: (runId: string) => bindingMap.get(runId),
    tick: () => 0,
  };
}

function view(runId: string): PlanView {
  return {
    runId,
    root: { id: "w", kind: "composite", children: [] },
    current: { state: "impl", phase: "running" },
    visits: {},
  } as unknown as PlanView;
}

function picker(runId: string, startedAt: number, active: boolean): PickerEntry {
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

function binding(runId: string, sessionID: string): RunBinding {
  return { runId, rootDir: "/p", supervisorSessionID: sessionID };
}

describe("sidebarRunForSession — decision 12's sidebar/tile suppression", () => {
  test("a closed panel suppresses nothing — the bound run renders", () => {
    setPanelOpen(false);
    const store = storeWith(
      [view("live-1")],
      [picker("live-1", 1, true)],
      [binding("live-1", "ses-1")],
    );
    expect(sidebarRunForSession(store, "ses-1")).toBeDefined();
  });

  test("an open panel suppresses the entry for a run it tiles", () => {
    setPanelOpen(true);
    const store = storeWith(
      [view("live-1")],
      [picker("live-1", 1, true)],
      [binding("live-1", "ses-1")],
    );
    expect(tileRunIds(store)).toEqual(["live-1"]);
    expect(sidebarRunForSession(store, "ses-1")).toBeUndefined();
  });

  test("an open panel does not suppress a finished run — it tiles nothing", () => {
    setPanelOpen(true);
    const store = storeWith(
      [view("done-1")],
      [picker("done-1", 1, false)],
      [binding("done-1", "ses-1")],
    );
    expect(tileRunIds(store)).toEqual([]);
    expect(sidebarRunForSession(store, "ses-1")).toBeDefined();
  });

  test("an open panel does not suppress a session whose run is not tiled", () => {
    setPanelOpen(true);
    const store = storeWith(
      [view("live-1"), view("done-2")],
      [picker("live-1", 1, true), picker("done-2", 2, false)],
      [binding("live-1", "ses-1"), binding("done-2", "ses-2")],
    );
    expect(tileRunIds(store)).toEqual(["live-1"]);
    expect(sidebarRunForSession(store, "ses-2")).toBeDefined();
    expect(sidebarRunForSession(store, "ses-1")).toBeUndefined();
  });

  test("the run finishing un-suppresses the entry — no stale suppression across ticks", () => {
    setPanelOpen(true);
    const pickerEntries = [picker("live-1", 1, true)];
    const store = storeWith([view("live-1")], pickerEntries, [binding("live-1", "ses-1")]);
    expect(sidebarRunForSession(store, "ses-1")).toBeUndefined();
    // The next poll tick's classification: the run finished, drops out of
    // the grid, and the sidebar entry comes back.
    pickerEntries[0]!.active = false;
    expect(tileRunIds(store)).toEqual([]);
    expect(sidebarRunForSession(store, "ses-1")).toBeDefined();
  });

  test("a session with no bound run renders nothing, panel open or closed", () => {
    const store = storeWith(
      [view("live-1")],
      [picker("live-1", 1, true)],
      [binding("live-1", "ses-1")],
    );
    setPanelOpen(false);
    expect(sidebarRunForSession(store, "ses-other")).toBeUndefined();
    setPanelOpen(true);
    expect(sidebarRunForSession(store, "ses-other")).toBeUndefined();
  });
});
