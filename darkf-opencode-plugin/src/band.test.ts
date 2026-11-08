import { describe, expect, test } from "bun:test";
import { summaryLine } from "./summary.ts";
import type { LiveStore } from "./store.ts";
import type { PickerEntry } from "./locate.ts";
import type { PlanView, TaskListView } from "./digest.ts";

function storeWith(views: PlanView[], picker: PickerEntry[]): LiveStore {
  const viewMap = new Map(views.map((v) => [v.runId, v]));
  return {
    views: () => viewMap,
    taskViews: () => new Map<string, TaskListView>(),
    pickerCandidates: () => picker,
    bindingFor: () => undefined,
  };
}

function view(runId: string, current: PlanView["current"]): PlanView {
  return {
    runId,
    root: { id: "w", kind: "composite", children: [] },
    current,
    visits: {},
  } as unknown as PlanView;
}

function picker(runId: string, active: boolean): PickerEntry {
  return {
    entry: { runId, startedAt: 0, pid: 0, rootDir: "/p", schemaVersion: 1, status: "running" } as PickerEntry["entry"],
    active,
  };
}

describe("summaryLine", () => {
  test("no active runs — history alone renders nothing", () => {
    const s = storeWith([view("done-1", { state: "EXIT", phase: "done" })], [picker("done-1", false)]);
    expect(summaryLine(s)).toBe("");
  });

  test("one live run among finished ones shows that run's status, not a count", () => {
    const s = storeWith(
      [view("done-1", { state: "EXIT", phase: "done" }), view("live-1", { state: "impl", phase: "running", startedAt: Date.now() - 5000 })],
      [picker("done-1", false), picker("live-1", true)],
    );
    const line = summaryLine(s);
    expect(line).toContain("impl");
    expect(line).not.toContain("runs active");
  });

  test("two active runs count", () => {
    const s = storeWith(
      [view("a", { state: "EXIT", phase: "done" }), view("b", { state: "EXIT", phase: "done" })],
      [picker("a", true), picker("b", true)],
    );
    expect(summaryLine(s)).toBe("2 darkf runs active");
  });

  test("active run with no view yet renders nothing", () => {
    const s = storeWith([], [picker("just-registered", true)]);
    expect(summaryLine(s)).toBe("");
  });
});
