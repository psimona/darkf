import { describe, expect, test } from "bun:test";
import { parseTaskList } from "./tasks.ts";
import type { TaskList } from "./types.ts";

const VALID: TaskList = {
  id: "ips-csv-load",
  spec: { prd: "docs/specs/x/prd.md", design: "docs/specs/x/design.md" },
  requirements: [
    { id: "REQ-1", kind: "req", text: "load the csv", priority: "must" },
    { id: "NFR-2", kind: "nfr", text: "under 10s", priority: "should" },
  ],
  tasks: [
    { id: "T-1", title: "wire the loader", status: "done", satisfies: ["REQ-1"], priority: "must" },
    { id: "T-2", title: "bench it", status: "in-progress", satisfies: ["NFR-2"] },
    { id: "T-3", title: "write it up", status: "pending" },
  ],
};

test("parseTaskList on a valid list returns it narrowed, unknown extra fields ignored", () => {
  const parsed = parseTaskList({
    ...VALID,
    tasks: [...VALID.tasks, { id: "T-9", title: "future", status: "failed", note: "extra" }],
  });
  expect(parsed).not.toHaveProperty("error");
  expect(parsed).toEqual({
    ...VALID,
    tasks: [...VALID.tasks, { id: "T-9", title: "future", status: "failed" }],
  });
});

test("parseTaskList accepts the minimal shape: only id and tasks, everything else optional", () => {
  expect(parseTaskList({ id: "x", tasks: [] })).toEqual({ id: "x", tasks: [] });
});

describe("parseTaskList narrowing", () => {
  test("non-object roots are rejected", () => {
    expect(parseTaskList(null)).toHaveProperty("error");
    expect(parseTaskList("nope")).toHaveProperty("error");
    expect(parseTaskList([VALID])).toHaveProperty("error");
    expect(parseTaskList(undefined)).toHaveProperty("error");
  });

  test("missing or wrong-typed id", () => {
    const { id: _id, ...noId } = VALID;
    expect(parseTaskList(noId)).toHaveProperty("error");
    expect(parseTaskList({ ...VALID, id: 7 })).toHaveProperty("error");
  });

  test("wrong-typed spec fields", () => {
    expect(parseTaskList({ ...VALID, spec: "docs" })).toHaveProperty("error");
    expect(parseTaskList({ ...VALID, spec: { prd: 3 } })).toHaveProperty("error");
    expect(parseTaskList({ ...VALID, spec: { design: [] } })).toHaveProperty("error");
  });

  test("missing or wrong-typed fields on a task", () => {
    const missingTitle = { id: "T-1", status: "pending" };
    expect(parseTaskList({ id: "x", tasks: [missingTitle] })).toHaveProperty("error");
    expect(
      parseTaskList({ id: "x", tasks: [{ id: 1, title: "t", status: "pending" }] }),
    ).toHaveProperty("error");
  });

  test("bad status union", () => {
    const parsed = parseTaskList({
      id: "x",
      tasks: [{ id: "T-1", title: "t", status: "archived" }],
    });
    expect(parsed).toHaveProperty("error");
    expect((parsed as { error: string }).error).toContain("tasks[0].status");
    expect((parsed as { error: string }).error).toContain(
      '"pending" | "in-progress" | "done" | "failed"',
    );
  });

  test("bad priority union, on both tasks and requirements", () => {
    const taskSide = parseTaskList({
      id: "x",
      tasks: [{ id: "T-1", title: "t", status: "pending", priority: "Must" }],
    });
    expect((taskSide as { error: string }).error).toContain("tasks[0].priority");
    expect((taskSide as { error: string }).error).toContain(
      '"must" | "should" | "could" | "won\'t"',
    );

    const requirementSide = parseTaskList({
      id: "x",
      requirements: [{ id: "REQ-1", kind: "req", text: "t", priority: "SHOULD" }],
      tasks: [],
    });
    expect((requirementSide as { error: string }).error).toContain("requirements[0].priority");
  });

  test("bad requirement kind union and wrong-typed requirement fields", () => {
    const badKind = parseTaskList({
      id: "x",
      requirements: [{ id: "REQ-1", kind: "story", text: "t" }],
      tasks: [],
    });
    expect((badKind as { error: string }).error).toContain("requirements[0].kind");

    const noText = parseTaskList({
      id: "x",
      requirements: [{ id: "REQ-1", kind: "req" }],
      tasks: [],
    });
    expect(noText).toHaveProperty("error");
  });

  test("satisfies must be an array of strings", () => {
    const notArray = parseTaskList({
      id: "x",
      tasks: [{ id: "T-1", title: "t", status: "pending", satisfies: "REQ-1" }],
    });
    expect((notArray as { error: string }).error).toContain("tasks[0].satisfies");

    const notStrings = parseTaskList({
      id: "x",
      tasks: [{ id: "T-1", title: "t", status: "pending", satisfies: ["REQ-1", 2] }],
    });
    expect((notStrings as { error: string }).error).toContain("tasks[0].satisfies[1]");
  });

  test("tasks not an array", () => {
    const parsed = parseTaskList({ id: "x", tasks: "T-1,T-2" });
    expect(parsed).toHaveProperty("error");
    expect((parsed as { error: string }).error).toContain("tasks:");
  });

  test("requirements not an array", () => {
    expect(parseTaskList({ id: "x", requirements: {}, tasks: [] })).toHaveProperty("error");
  });

  test("the legacy consumer shape has no tolerance: task-side requirements are not read", () => {
    // Pre-migration consumer tasks carry `requirements` instead of `satisfies`
    // — the validator narrows to the standard only; migration is the writer's
    // one-shot job (Decisions: Consumer repo migrates to the standard).
    const legacy = parseTaskList({
      id: "x",
      tasks: [{ id: "T-1", requirements: ["REQ-1"], title: "t", status: "pending" }],
    });
    expect(legacy).toEqual({
      id: "x",
      tasks: [{ id: "T-1", title: "t", status: "pending" }],
    });
  });
});
