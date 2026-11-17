import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchInfo, NodeResult, TaskList } from "@psimona/darkf/src/core/index.ts";

// The deterministic half of Review's approval: Review judges whether the
// in-progress task's claim actually holds (it never touches files to do
// so); this script does the one mechanical write that follows — agent for
// judgment, script for the bookkeeping, per darkf-writing-workflows. Only
// Dispatch and this script ever write tasks.json, and Dispatch always
// just wrote a valid one before handing off, so there is nothing here to
// re-validate.
export default async function markDone(
  _handoff: NodeResult,
  info: DispatchInfo,
): Promise<NodeResult> {
  const path = join(info.rootDir, ".darkf", "run", info.runId, "tasks.json");
  const list = JSON.parse(await readFile(path, "utf8")) as TaskList;
  const current = list.tasks.find((t) => t.status === "in-progress");
  if (current) current.status = "done";
  await writeFile(path, JSON.stringify(list, null, 2));
  return { event: "marked", output: {} };
}
