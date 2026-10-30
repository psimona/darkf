import type { DispatchInfo, NodeResult } from "@psimona/darkf/src/core/index.ts";

// Ported from blueprint's build-backend finish_branch (node 4): commit the
// loop's work on the feature branch, squash-merge onto master as one commit
// (subject from the prd H1), delete the branch. The run ends with the work
// merged; no supervisor merge.
//
// Safety rails:
//   - only runs on feature/<slug>;
//   - refuses when the dirty tree touches paths outside the loop's known
//     surface (the anti-sweep rail — a blind `git add -A` once wiped a
//     repo's .darkf state in the registry-lifecycle incident);
//   - refuses unless master is an ancestor of the branch (master must not
//     have moved mid-run — the only case where the squash could conflict);
//   - rolls back (reset --hard + checkout back) on any git failure.
const FEATURE = "self-update";
const ALLOWED = ["docs/specs/", "darkf/src/", "ROADMAP.md", "darkf/workflows/"];

function sh(...args: string[]): [string, number] {
  const proc = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  return [`${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`, proc.exitCode ?? 1];
}

function prdTitle(): string | null {
  const [out, rc] = sh("head", "-1", `docs/specs/${FEATURE}/prd.md`);
  if (rc !== 0) return null;
  const line = out.trim();
  return line.startsWith("# ") ? line.slice(2).trim() : null;
}

export default function finishBranch(_handoff: NodeResult, _info: DispatchInfo): NodeResult {
  const branch = `feature/${FEATURE}`;

  const [current, currentRc] = sh("git", "branch", "--show-current");
  if (currentRc !== 0 || current.trim() !== branch) {
    return {
      event: "merge_failed",
      output: { failure: `not on ${branch} (on '${current.trim()}')` },
    };
  }

  const [status, statusRc] = sh("git", "status", "--porcelain");
  if (statusRc !== 0) {
    return { event: "merge_failed", output: { failure: "git status failed" } };
  }
  const dirty = status
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  const foreign = dirty.filter((p) => !ALLOWED.some((prefix) => p.startsWith(prefix)));
  if (foreign.length > 0) {
    return {
      event: "merge_failed",
      output: {
        failure: `dirty paths outside the loop's surface — human decision:\n${foreign.join("\n")}`,
      },
    };
  }

  const title = prdTitle() ?? FEATURE;
  const subject = `feat: ${title} (${FEATURE})`;
  const add = sh("git", "add", "-A");
  const commit = add[1] === 0 ? sh("git", "commit", "-m", subject) : [add[0], 1];
  if (commit[1] !== 0) {
    return {
      event: "merge_failed",
      output: { failure: `commit on ${branch} failed: ${commit[0]}` },
    };
  }

  const [, ancestorRc] = sh("git", "merge-base", "--is-ancestor", "master", "HEAD");
  if (ancestorRc !== 0) {
    return {
      event: "merge_failed",
      output: {
        failure:
          "master has moved since the branch was cut — squash could conflict; human merge required",
      },
    };
  }

  const [ahead] = sh("git", "log", "--oneline", `master..${branch}`);
  if (ahead.trim() === "") {
    return { event: "merged", output: { note: "no commits ahead of master — nothing to merge" } };
  }

  const checkout = sh("git", "checkout", "master");
  if (checkout[1] !== 0) {
    return { event: "merge_failed", output: { failure: `checkout master failed: ${checkout[0]}` } };
  }

  const merge = sh("git", "merge", "--squash", branch);
  if (merge[1] !== 0) {
    sh("git", "reset", "--hard", "HEAD");
    sh("git", "checkout", branch);
    return { event: "merge_failed", output: { failure: `squash merge failed: ${merge[0]}` } };
  }

  const body =
    "Landed via the dev-loop darkf workflow — check gate green, independent review approved.";
  const final = sh("git", "commit", "-m", subject, "-m", body);
  if (final[1] !== 0) {
    sh("git", "reset", "--hard", "HEAD");
    sh("git", "checkout", branch);
    return { event: "merge_failed", output: { failure: `squash commit failed: ${final[0]}` } };
  }

  const del = sh("git", "branch", "-D", branch);
  const note =
    del[1] === 0
      ? `squashed ${branch} to master as ${subject}; branch deleted`
      : `merged as ${subject}; branch delete failed: ${del[0]}`;
  return { event: "merged", output: { merged: true, note } };
}
