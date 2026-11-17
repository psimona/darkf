import type { DispatchInfo } from "@psimona/darkf/src/core/index.ts";

// Ported from blueprint's build-backend create_branch: cut feature/<slug>
// from the current tree. Uncommitted work (the feature under construction)
// rides along on the branch — Finish commits it there before the squash.
// The slug is a workflow-file constant for the pilot; editing this file per
// feature is the contract until engine-side input plumbing exists.
const FEATURE = "skill-setup";

function sh(cwd: string, ...args: string[]): [string, number] {
  const proc = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  return [`${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`, proc.exitCode ?? 1];
}

export default function begin(_handoff: unknown, info: DispatchInfo) {
  const target = `feature/${FEATURE}`;
  const [, exists] = sh(info.rootDir, "git", "rev-parse", "--verify", target);
  const co =
    exists === 0
      ? sh(info.rootDir, "git", "checkout", target)
      : sh(info.rootDir, "git", "checkout", "-b", target);
  return co[1] === 0
    ? { event: "started", output: { branch: target, reused: exists === 0 } }
    : { event: "branch_failed", output: { reason: co[0] } };
}
