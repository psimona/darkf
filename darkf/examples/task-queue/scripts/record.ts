import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DispatchInfo, NodeResult } from "@psimona/darkf/src/core/index.ts";

interface Task {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "done";
}

export default function record(_handoff: NodeResult, info: DispatchInfo): NodeResult {
  const path = join(info.rootDir, "tasks.json");
  const tasks: Task[] = JSON.parse(readFileSync(path, "utf8"));
  const task = tasks.find((t) => t.status === "in-progress");
  if (!task) throw new Error("no in-progress task to record");

  task.status = "done";
  writeFileSync(path, JSON.stringify(tasks, null, 2));
  return { event: "recorded" };
}
