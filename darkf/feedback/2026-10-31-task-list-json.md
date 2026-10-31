# Run feedback — task-list-json

- **Date:** 2026-10-31
- **Engine/workflow:** darkf dev-loop
- **Run:** 7f95d772-b147-42d8-b40a-1e40b9ce51d5
- **Final outcome:** merged. Squashed `feature/task-list-json` to master as `feat: task-list-json (task-list-json)`; branch deleted. Confirmed in git log as `02a7aa2`.
- **Scopes:** TaskList support shipped end to end: `Task`/`TaskList` types in core, hand-written zero-dependency `parseTaskList`, `foldTaskList` in the kit, and a new tasks tab (absent/invalid/valid views, strict done/total, stall warning) in the opencode plugin overlay.

## What worked

- One pass through the loop: Implement → Check → Fix → Check → Review approved → merged. No retry loops.
- All gates green at merge: secret-scan, typecheck, lint, arch-check, darkf 179 tests, plugin 12 tests, coverage at ~96% lines.
- Implementation matched the spec field for field (`docs/specs/task-list-json/spec.md`); the reviewer verified types, decisions, and tests against it and approved with no change requests.
- `parseTaskList` narrowing is proven by tests: legacy `moscow` and task-side `requirements` are dropped, bad unions and non-object roots rejected with path-prefixed errors.
- The plugin reads `tasks.json` via the existing 1s poll plus an `fs.watch` with the same retry-until-exists pattern as the journal watcher; teardown cleans up both.

## Failures and root causes

1. First Check gate failed on a biome format error in `darkf/workflows/dev-loop/scripts/finish.ts:17` (the `ALLOWED` array needed multi-line formatting). Root cause: this feature's own retarget commit (a054445) edited the finish script and committed it unformatted. The Implement summary then mislabeled it as "pre-existing and outside allowed paths". Cost: one extra Fix → Check cycle, about 3 minutes per journal timestamps (fail at 1793474949114, pass at 1793475128840).

## Notes

- The dev-loop finish script (`darkf/workflows/dev-loop/scripts/finish.ts`) sits in the lint path. Any run that retargets it must format it before committing, or the Check gate will fail.
- When a failing file is outside the feature's allowed paths, check `git log`/`git blame` before calling it pre-existing. Here the implementing agent's claim was wrong and the fix step had to re-derive the cause.
- The spec's mention of item-loop.ts refers to the separate, not-yet-implemented item-loop-convention spec. No migration was required for this run. Future item-loop work will need it.
- No tasks.json was produced by this run itself; the feature only adds the consumer side. Exercise the producer path in a later run.
