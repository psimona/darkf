import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DispatchInfo, type NodeResult, parseTaskList } from "@psimona/darkf/src/core/index.ts";

// The node that walks the plan — darkf's item-loop-convention shape
// (docs/specs/item-loop-convention/spec.md), hand-rolled here because that
// spec's own darkf-core/kit helper isn't shipped yet; this follows its
// algorithm and vocabulary directly (pending → in-progress, picked once
// and re-verified by Review rather than trusted, status written back
// before the real work starts) without importing anything from it.
//
// Picks the first "pending" task out of this run's tasks.json, flips it
// "in-progress", and hands it to Implement as the one thing to build this
// pass. Re-entered once per task — by Review approving one, via MarkDone
// — until the plan is exhausted.
export default async function dispatch(
  _handoff: NodeResult,
  info: DispatchInfo,
): Promise<NodeResult> {
  const path = join(info.rootDir, ".darkf", "run", info.runId, "tasks.json");
  const parsed = parseTaskList(JSON.parse(await readFile(path, "utf8")));
  if ("error" in parsed) {
    return { event: "blocked", output: { reason: `tasks.json is invalid: ${parsed.error}` } };
  }

  const next = parsed.tasks.find((t) => t.status === "pending");
  if (!next) {
    const failed = parsed.tasks.filter((t) => t.status === "failed");
    if (failed.length > 0) {
      return {
        event: "blocked",
        output: { reason: `task(s) failed: ${failed.map((t) => t.id).join(", ")}` },
      };
    }
    return { event: "plan_exhausted", output: {} };
  }

  next.status = "in-progress";
  await writeFile(path, JSON.stringify(parsed, null, 2));

  const done = parsed.tasks.filter((t) => t.status === "done").length;
  return {
    event: "next_item",
    output: { task: next, itemIndex: done + 1, itemsTotal: parsed.tasks.length },
  };
}
