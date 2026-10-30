# Resume-from-journal: restart a crashed or interrupted run from its own record

An investigation draft, not yet a decision. PHILOSOPHY.md promises that
the journal plus the last `NodeResult` should be enough to resume a run.
Nothing implements that promise today. This spec scopes what "resume"
means, what the journal already provides, and what is missing.

## Problem

A run stops three ways: a crash mid-dispatch (runner dies, timeout, machine
reboot), a failed terminal verdict the author wants to retry with edits, or
an orphaned detached run (host died, `darkf status` says so). Today every
restart is cold: `darkf run` starts from the initial state, re-paying every
completed agent dispatch — real money and real wall-clock.

The journal already records every transition (`journal.jsonl`, one JSON
line per step) and always opens with a begin marker and, on success, closes
with an end marker. A crashed run's last line names the exact node and
attempt that died. The data for resume exists; the command does not.

## Goals

- Define the resume semantics: which states re-execute, which are skipped,
  and how the journal of the resumed run relates to the original.
- Decide the CLI surface (`darkf resume <runId>`? a `--resume` flag on
  `run`?) and what the operator may edit between the original run and the
  resume (workflow file edits? handoff files?).
- Stay honest to the philosophy: the journal is the source of truth, not a
  cache to invalidate.

## Non-goals

- Rewriting or migrating journal history.
- Resuming composite scope mid-composite (cycle bookkeeping makes this a
  separate, harder question — possibly a permanent non-goal).
- Cross-machine resume (journal path is local; a consumer repo copies state
  its own way).

## Design sketch

The engine's `run()` accepts an optional `resumeFrom` transcript: the
ordered terminal `NodeResult`s of the prior attempt. States whose recorded
verdict still satisfies their routing (the `on`/`next` edge still exists)
are marked skipped with their original verdict; the walk restarts at the
first state that cannot be so satisfied. The new run journals normally,
with a begin marker carrying `resumedFrom: <runId>` so the two journals
chain by reference.

The CLI gains `darkf resume <runId>`: reads the registry entry, loads the
journal, folds it into the transcript, re-loads the workflow module, and
calls `run()` with `runId` preserved (same journal dir, appended) and the
transcript injected.

## Open decisions

- **Edit allowance between runs.** Can the workflow file change between the
  crashed run and the resume? Strictest answer: no (validate the old
  verdicts against the new graph, refuse on drift). Softer: allow it, skip
  only states whose edges are unchanged. Drift refusal is safer and simpler.
- **Where resume logic lives**: engine (`run()` grows `resumeFrom`) with a
  thin CLI — versus a CLI-side transcript pre-filter that feeds a normal
  `run()`. The engine-side version keeps the invariant in one place.
- **Nudged/resumed sessions**: a state whose crash happened mid-nudge
  carries a `sessionId` — resume should thread it like a retry does.

## Dependencies

- `registry-lifecycle` (shipped): gives `darkf resume` its run lookup.
- `task-list-json` (draft): a resumed task-queue workflow must not re-claim
  items the crashed run already finished — the shared task-list format with
  per-item status is what makes task-level idempotence expressible.
