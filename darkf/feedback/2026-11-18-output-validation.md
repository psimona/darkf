# Run feedback — output-validation dev-loop

- **Date:** 2026-11-18
- **Engine/workflow:** darkf dev-loop
- **Run:** 2ae4434d-a397-4b79-a45e-855914f9cf83 (first attempt, crashed), 0494ed6d-00ea-4132-9c3b-f42dd0fa5c8f (resumed, completed)
- **Final outcome:** Succeeded, after two runs and one manual fix. Squash-merged to master as `ed2782d feat: output-validation (output-validation)`; branch `feature/output-validation` deleted.
- **Scopes:** Loop shipped Zod as darkf-core's first runtime dependency, `outputType`/`OutputSchema` on `AgentStateDef`, the Zod adapter (`kit/validation/zod.ts`), nudge-on-`validate`-failure, the `isNodeResult` Zod rewrite, full test coverage for all of it, and four doc/skill updates.

## What worked

- The resume semantics written into the Implement prompt ("if the working tree already implements this task, verify it instead of re-implementing") worked exactly as designed: the second run re-verified the first 13 tasks in 2-6 minutes each instead of redoing them from scratch.
- Review approved every one of the 17 tasks on first pass across both runs — no `changes_requested` seen anywhere in either journal. Its "inspect `git status --porcelain`, read the spec, confirm the tree satisfies it" design held under a resumed, partially-pre-built tree, not just a fresh one.
- Running `/council` on the spec before dispatch caught a real defect (Zod reporting only the first of several validation issues, which would have burned all 3 nudge attempts on one field at a time without converging) before any code was written. Implement never had to discover or work around it mid-build.
- Document ran once, at the end of the resumed run, and updated exactly the four files the spec's own "Skill and doc updates" section named (`failure-modes.md`, `node-types.md`, `write-your-first-workflow.md`, `core-types.md`, the `darkf-writing-workflows` skill) — no drift from what the spec promised.
- Full suite stayed green after the merge: 289 pass, 0 fail, `tsc --noEmit` clean.

## Failures and root causes

1. `BuildPhase`'s `maxCycles` (72) undersized the real plan. The sizing comment assumed up to 8 tasks at up to 9 dispatches each; Plan's real output was 17 tasks. Cost: the first run crashed with `cycle-limit` at `cycles: 72` after 75 total dispatches, 13 of 17 tasks done. No implementation work was lost (`Implement`/`Review` never commit), but the crash cost roughly 84 minutes of wall-clock run time before being caught. Fixed by raising `maxCycles` to 162 (18×9) in `workflow.ts`.
2. `FEATURE` is duplicated by design across three files (`workflow.ts`, `scripts/begin.ts`, `scripts/finish.ts` — documented in `workflow.ts`'s header comment as "the per-feature contract until engine-side input plumbing exists"), and nothing checks the three copies agree. Cost: only `workflow.ts`'s copy got updated before the first run, so `Begin` reused a stale, unrelated `feature/skill-setup` branch instead of cutting `feature/output-validation`. No content was lost (the stale branch sat at the same commit as master), but the branch name, and the would-be merge subject, were wrong until caught and fixed by hand before the second run.
3. `finish.ts`'s anti-sweep `ALLOWED` list had no entry for `bun.lock`. Cost: the resumed run's `Finish` step failed with `merge_failed` ("dirty paths outside the loop's surface: bun.lock") even though every task had been implemented, tested, and reviewed clean. Any task that adds a real dependency (task 1 here, `add-zod-dependency`) legitimately touches the root lockfile in this bun workspace, and the rail had never been exercised by a feature that adds one before. Required adding `bun.lock` to `ALLOWED` and re-running `finishBranch` by hand, outside the engine's own `Finish → Feedback` routing — which is also why this note is written after the fact instead of by the `Feedback` node itself.

## Notes

- Before the next dispatch of this workflow for a new feature, grep all three `FEATURE` constants (`workflow.ts`, `scripts/begin.ts`, `scripts/finish.ts`), not just `workflow.ts`. Nothing currently catches a mismatch except a wrong branch name discovered mid-run.
- Size `BuildPhase.maxCycles` from Plan's actual task count, once it is known, rather than trusting the workflow file's static default. This run's dispatch cost per already-reviewed task (~5, once resumed) matched the sizing comment's assumption; the comment's task-count ceiling, not its per-task estimate, was the part that was wrong.
- `finish.ts`'s `ALLOWED` list will trip on any future feature that legitimately touches a path outside `darkf/`, `docs/`, and `darkf-opencode-plugin/`. Treat a `merge_failed` with a dirty-paths reason as a signal to check whether the path is legitimate before assuming the loop did something wrong — this rail exists for a real past incident and should stay strict, just kept in sync with what a feature can legitimately touch.
- Because `Finish` failed and was completed by hand, `Feedback` never ran as part of either run. If this happens again, re-run `Finish` by hand but let `Feedback` still dispatch afterward if the engine allows it, rather than writing the retrospective out of band as this file was.
- Total cost across both runs: 166 dispatches, about 196 minutes of agent wall-clock time, for a feature whose real work (17 tasks, one new dependency, three rewired call sites, two new source files, four doc files) is moderate. Most of the overrun was the crash-and-resume cycle from findings 1 and 2, not genuine implementation churn.
