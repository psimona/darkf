import type { DispatchInfo, NodeResult } from "@psimona/darkf/src/core/index.ts";

// Runs the repo's full quality gate (`bun run check`: gitleaks, typecheck,
// biome, dependency-cruiser, bun test with coverage thresholds) at
// info.rootDir — the invocation cwd, wherever the workflow runs from. The
// last 80 lines of output travel to Fix via the handoff: the one hop the
// fix agent gets.
export default function check(_handoff: NodeResult, info: DispatchInfo): NodeResult {
  const proc = Bun.spawnSync(["bun", "run", "check"], {
    cwd: info.rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${proc.stdout?.toString() ?? ""}\n${proc.stderr?.toString() ?? ""}`;
  const tail = output.split("\n").slice(-80).join("\n");
  return proc.exitCode === 0
    ? { event: "passed", output: { tail } }
    : { event: "failed", output: { tail } };
}
