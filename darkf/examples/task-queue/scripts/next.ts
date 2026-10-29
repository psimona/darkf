import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DispatchInfo, NodeResult } from "@psimona/darkf/src/core/index.ts";

interface Task {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "done";
}

export default function next(_handoff: NodeResult, info: DispatchInfo): NodeResult {
  const path = join(info.rootDir, "tasks.json");
  const tasks: Task[] = JSON.parse(readFileSync(path, "utf8"));
  const task = tasks.find((t) => t.status === "pending");
  if (!task) return { event: "empty" };

  task.status = "in-progress";
  writeFileSync(path, JSON.stringify(tasks, null, 2));
  return { event: "found", output: { title: task.title } };
}
