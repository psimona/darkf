# Registry lifecycle: readiness-gated `running`, captured worker output, boot-id context (DONE)

Archived here because all four design items are built: `worker.log`
capture (`startCmd`'s spawn redirects `stderr` instead of discarding it),
the `ready`-file gate before `running` is written (`failed-start` on a
worker that dies first, with the captured tail), `bootId` stamping
(`host-died` vs `orphaned` in `status`/`monitor`), and the start-time
dirty-config guard over the bare `darkf/` directory (`--allow-dirty-workflow`
override) — exactly the path Design §4 names. (An earlier pass of this
implementation guessed `.darkf/workflows` instead, misreading the dotless
`darkf` in the spec's own prose; corrected once the convention was
confirmed: `darkf/` is the user/consumer-repo's versioned workflow config,
`.darkf/` is darkf's own runtime/run-storage directory — gitignored,
never checked for drift.)

A spec for darkf-cli's `start`/`status`/registry layer. Two defects, one
theme: the registry makes claims without evidence at write time, and
interprets claims without context at read time. Includes the start-time
guard for uncommitted workflow config (the workflow-cleanup companion fix
landed the consumer repo-side in `cleanup.ts`).

## Problem

1. **Premature `running`.** `start` spawns the detached worker with stderr
   discarded, sleeps 250 ms, checks "pid exists," then writes registry
   `running`. The workflow module loads *inside* the child, so a load
   failure produces a registry that says `running` for a process that
   never ran a node. Evidence: the consumer repo run `940e2d8d` (2026-10-13) —
   died on `Cannot find package 'darkf-core'` (node_modules wiped by a
   prior run's `git clean -fdx`), registry said `running`, diagnosis
   required a foreground reproduction because the child's stderr went to
   `ignore`.
2. **Context-free orphan interpretation.** When the pid is gone and the
   journal has no terminal marker, `status` reports `orphaned` /
   outcome-unknown — even when the host rebooted and the attribution is
   knowable. Evidence: the consumer repo run `a8f58823` (2026-10-12): the host
   rebooted at 14:02; the run sat as `orphaned: outcome unknown` for
   hours when `host-died at 14:02` was the truth.

## Root cause

The readiness check is time-based, not evidence-based (a live pid at
+250 ms says nothing about module load), and the registry records nothing
about the environment the run was born into (no boot identity), so pid
loss is inherently ambiguous between "process died" and "host died."

## Design

### 1. Capture the child's voice

The worker's stderr goes to `.darkf/run/<id>/worker.log` instead of
`ignore`. Every startup failure self-documents; the foreground-reproduction
step disappears from RCA.

### 2. `running` requires proof

The worker writes `.darkf/run/<id>/ready` after the workflow module loads.
`start` waits up to 10 s for it:

- ready arrives → write registry `running` (unchanged behavior after this
  point);
- worker dies before ready → registry `failed-start` with the last lines
  of `worker.log`, `start` exits 1.

Alternative considered: parent imports the workflow before spawning (same
env, fail-fast, no new file). Rejected as the sole mechanism because it
proves the parent's env, not the child's, and doubles import cost; kept as
an optional later fast-fail.

### 3. Stamp the world the run was born in

The registry entry gains an optional `bootId`
(`/proc/sys/kernel/random/boot_id`, recorded at `start`).
`status` compares against the current boot id:

- different → `host-died (last journal event <ts>)` — outcome is
  interrupted, not unknown;
- same, pid gone, no terminal marker → `orphaned` (unchanged);
- field absent (entries written before this change) → today's `orphaned`
  wording, degrading gracefully without a schema bump.

### 4. Start-time config guard (lesson-2 companion)

`start` refuses to launch when `git status --porcelain -- darkf` is
non-empty in the target repo (workflow config dirty → it *will* be swept
into a run commit or reset away; the consumer repo lost config edits both ways).
Message names the dirty files. `--allow-dirty-workflow` overrides.

## Non-goals

- No auto-restart of failed-start or host-died runs.
- No remote/cross-machine runs (boot-id is meaningful per-host only).
- No engine-side journal mirroring outside the repo (the workflow-side
  cleanup fix — exclude `.darkf` from `clean -fdx` — addresses the
  acute wipe; a repo-external registry mirror remains a fog item).

## Open questions

- Ready-wait timeout: 10 s fixed, or proportional to a cold bun import
  measured on this host?
- `bootId` as optional field (this spec) vs `schemaVersion: 2` bump with
  explicit migration — optional degrades cleanly; bump is cleaner if more
  environment fields are coming (hostname? worktree hash?).
- Should `status` suggest deleting a stale registry entry when the run is
  `host-died`/`crashed` and the pid is gone (the recurring
  `cached "running" but PID gone` warning), or stay read-only?
