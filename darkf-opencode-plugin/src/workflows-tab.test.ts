import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DONE, FAILED, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { buildWorkflowGraph } from "./workflow-graph.ts";
import {
  ancestorsOf,
  buildPathIndex,
  catalogEntries,
  edgeFocus,
  WorkflowsTab,
  workflowDirFor,
} from "./workflows-tab.tsx";

// The same synthetic definition workflow-graph.test.ts walks — reused here so
// the focus tests exercise every target shape the tab can render: edges to a
// state (root-level and across a composite boundary), to DONE, to FAILED, and
// to an id the definition doesn't resolve.
const WORKFLOW: WorkflowDef = {
  initial: "Begin",
  states: {
    Begin: {
      type: "script",
      file: "begin.ts",
      on: { started: "Lane", branch_failed: DONE },
      next: FAILED,
    },
    Lane: {
      initial: "Do",
      states: {
        Do: { type: "agent", prompt: "do", on: { done: "Check" }, next: "Begin" },
        Check: { type: "script", file: "check.ts", on: { ok: "MarkDone" } },
        MarkDone: { type: "script", file: "mark.ts", on: { marked: "Begin" } },
      },
    },
    LooseEnd: { type: "agent", prompt: "no transitions" },
    Broken: { type: "script", file: "broken.ts", on: { gone: "Nowhere" } },
  },
};

const KEY = "built-in/demo";
const INDEX = buildPathIndex(buildWorkflowGraph(WORKFLOW).nodes);

describe("workflowDirFor", () => {
  test("workspace entries live under <cwd>/darkf/<name> — the scan's first root", () => {
    expect(workflowDirFor({ name: "demo", source: "workspace" })).toBe(
      resolve(process.cwd(), "darkf", "demo"),
    );
  });

  test("built-in entries resolve inside the imported darkf package, where workflow.ts exists", () => {
    // Grounded against a real shipped workflow: the package this module
    // imports ships `workflows/dev-loop`, so resolution must land there —
    // not in a cache, not relative to the plugin itself.
    const dir = workflowDirFor({ name: "dev-loop", source: "built-in" });
    expect(dir.endsWith(join("workflows", "dev-loop"))).toBe(true);
    expect(existsSync(join(dir, "workflow.ts"))).toBe(true);
  });
});

describe("catalogEntries", () => {
  test("one key per listed workflow, built-ins resolvable to a loadable workflow.ts", () => {
    const entries = catalogEntries();
    const devLoop = entries.find((entry) => entry.key === "built-in/dev-loop");
    expect(devLoop?.listing).toEqual({ name: "dev-loop", source: "built-in" });
    expect(existsSync(join(devLoop!.dir, "workflow.ts"))).toBe(true);
    // Keys are unique even when both roots list the same name.
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
  });
});

describe("buildPathIndex", () => {
  test("every node id maps to its PlanGraph-style path, composites included", () => {
    expect(INDEX.get("Begin")).toBe("Begin");
    expect(INDEX.get("Lane")).toBe("Lane");
    expect(INDEX.get("Do")).toBe("Lane/Do");
    expect(INDEX.get("MarkDone")).toBe("Lane/MarkDone");
    expect(INDEX.get("Broken")).toBe("Broken");
  });
});

describe("ancestorsOf", () => {
  test("root-first ancestors of a tree path; a root-level row has none", () => {
    expect(ancestorsOf("Begin")).toEqual([]);
    expect(ancestorsOf("Lane")).toEqual([]);
    expect(ancestorsOf("Lane/Do")).toEqual(["Lane"]);
    expect(ancestorsOf("Lane/MarkDone")).toEqual(["Lane"]);
  });
});

describe("edgeFocus — r10: selecting an edge is cursor/expand-focus only", () => {
  test("a nested target focuses its node row and opens every composite above it", () => {
    expect(edgeFocus(INDEX, KEY, { kind: "state", id: "Do" })).toEqual({
      cursor: `${KEY}/Lane/Do`,
      expand: [KEY, `${KEY}/Lane`],
    });
  });

  test("a root-level target only needs the entry itself open", () => {
    expect(edgeFocus(INDEX, KEY, { kind: "state", id: "Begin" })).toEqual({
      cursor: `${KEY}/Begin`,
      expand: [KEY],
    });
  });

  test("terminal targets name no node — the selection is a no-op", () => {
    expect(edgeFocus(INDEX, KEY, { kind: "done" })).toBeUndefined();
    expect(edgeFocus(INDEX, KEY, { kind: "failed" })).toBeUndefined();
  });

  test("an unresolved state id (recorded as written) has no row to focus", () => {
    expect(edgeFocus(INDEX, KEY, { kind: "state", id: "Nowhere" })).toBeUndefined();
  });
});

describe("WorkflowsTab", () => {
  test("the tab component is defined — the module transforms and loads", () => {
    expect(typeof WorkflowsTab).toBe("function");
  });
});
