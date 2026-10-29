// Verify: run the target repo's Gradle check suite. green → Review, red → Implement.
// rootDir (the invocation cwd) IS the target repo — no path hardcoding.
import type { DispatchInfo, NodeResult } from "@psimona/darkf/src/core/index.ts";

export default function verify(_handoff: NodeResult, info: DispatchInfo): NodeResult {
  const proc = Bun.spawnSync(["./gradlew", "check"], {
    cwd: info.rootDir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 1_200_000,
  });
  const tail = `${proc.stdout?.toString() ?? ""}\n${proc.stderr?.toString() ?? ""}`
    .split("\n")
    .slice(-120)
    .join("\n");
  if (proc.exitCode === 0) return { event: "green", output: { tail } };
  return { event: "red", output: { exitCode: proc.exitCode, tail: tail.slice(-6000) } };
}
