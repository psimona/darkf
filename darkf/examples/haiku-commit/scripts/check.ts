import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DispatchInfo, NodeResult } from "@psimona/darkf/src/core/index.ts";

const START_MARKER = "<!-- haiku:start -->";
const END_MARKER = "<!-- haiku:end -->";

export default async function check(_handoff: NodeResult, info: DispatchInfo): Promise<NodeResult> {
  const readmePath = join(info.rootDir, "README.md");
  const text = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  if (!text.includes(START_MARKER) || !text.includes(END_MARKER)) {
    return { event: "missing" };
  }

  const add = Bun.spawn(["git", "add", "README.md"], { cwd: info.rootDir });
  if ((await add.exited) !== 0) throw new Error("git add README.md failed");

  const commit = Bun.spawn(["git", "commit", "-m", "Add haiku to README"], {
    cwd: info.rootDir,
  });
  if ((await commit.exited) !== 0) throw new Error("git commit failed");

  return { event: "committed" };
}
