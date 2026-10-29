# run-resilience

## Destination

A darkf run survives, or at minimum *explains*, every failure class
observed in the the consumer repo `composition-root-consolidation` series
(2026-10-12/13 — 9 runs, 4 crashes, 1 merge): host death, shared-DB
contention, hung LLM provider, permission-policy collisions, and the
workflow's own cleanup wiping config and artifacts. After this effort, no
failure mode leaves the supervisor watching green signals through a dead
or thrashing dispatch, and every terminal entry carries the facts needed
to diagnose it without opening opencode's server log.

## Notes

- Origin: the Oct 12/13 postmortem conversation. Failure-family analysis
  and the 16-lesson list live in that session; the four specs below are
  the darkf-side subset (workflow-side fixes already landed in the consumer repo:
  cleanup path-scoping in `workspace-pilot/scripts/cleanup.ts`, glm+auto
  model pins committed).
- Grounded in current code: `darkf-cli/src/agents/opencode.ts` (stdout
  read-once at line 145, `lastFailures` preamble, 2026-10-09 finish-reason
  capture), `darkf-cli/src/index.ts` (`startCmd` 250 ms grace check,
  `stdio: ignore`), `darkf-core/src/types.ts` (`AgentRunner`),
  `darkf-cli/src/registry.ts`.
- Philosophy constraint carried into every spec: darkf informs, the
  supervisor decides. No spec here auto-kills or auto-restarts.

## Decisions so far

- **silent-model-fallback** — built (`35ae612`, bundled with the
  per-workflow `--auto` opt-in): the runner warns once per worker run,
  naming the unpinned state and the constant's production history, then
  falls back. Retired from fog.
- **session-nudge** — built and merged
  (`docs/specs/_built/session-nudge/spec.md`). Same-session nudge (≤3 per
  outer attempt, invisible to `def.retries`, sharing one deadline per
  outer attempt) for the three repairable output failures (handoff
  missing/unparseable, event unroutable), both opencode and claude-code.
  Landed `AgentFailure` and the `handoff-missing`/`handoff-unparseable`
  `CrashReason` kinds in `darkf-core`, the nested nudge loop in
  `darkf-engine/src/run.ts`, `scanStepFinish`'s `stepCount > 0` resumability
  guard in `opencode.ts`, and `nudgeWarning` in `status.ts`/`index.ts`.
  Unblocks failure-metadata's kind split.
- **failed-terminal** — **slice 1 built, archived**
  (`docs/specs/_built/failed-terminal/spec.md`): `DONE` (renamed from
  `EXIT`, deprecated alias kept), new failure-graded `FAILED` pseudostate,
  the engine's terminal transition (checked before the unresolved-target
  guard, same position as `DONE`), `NodeStatus`'s `failed` phase,
  registry/status/report rendering (`RegistryStatus`, `TerminalOutcome`,
  `TerminalState`, `foldJournal`'s `hasEnd`, `foldReport`'s dispatch row,
  `monitor`/`status` exit codes), and `mermaid.ts`'s styled `FAILED` node
  (`[-]` has no stateDiagram-v2 built-in, unlike `[*]`). This repo's
  entire scope is done. Remaining slices live in the consumer repo, not this
  repo: slice 2 is the `run_failure` node + per-edge retarget table for
  the ~20 give-up edges that today end as `succeeded` (grades expressed
  as routing — retry = bounded node re-entry, escalate = `task_plan`,
  stop = `run_failure`), plus the `failed` scope status for
  retry-on-next-run; slice 3 is failure-metadata integration once that
  channel lands. The `EXIT` alias stays until slice 2 retargets
  the consumer repo's pilots and deletes it.
- **workflow-validation** — built (2026-10-22), archived
  (`docs/specs/_built/workflow-validation/spec.md`): eager, whole-graph
  structural validation (`validateWorkflow` in `darkf-core/src/graph.ts`)
  at run start — unresolved targets, composite-`initial` cycles, dead-end
  leaves — before the first dispatch. Closed the real hang: a composite
  `initial`-cycle no longer loops `enter()` forever. Wired into
  `darkf-engine`'s `run()` (new `invalid-workflow` `CrashReason`) and
  `darkf`'s `doctor` command (one line per problem, no run started). Its
  own blocker (`failed-terminal` slice 1, above) had already landed, so
  it was written directly against the final `{DONE, FAILED}` terminal set
  rather than the old `{EXIT}`-only one. Retired from fog — no other
  ticket in this map was itself waiting on it.
- **agent-liveness** — opencode slice built, archived
  (`docs/specs/_built/agent-liveness/spec.md`): incremental NDJSON stream
  parsing (`readIncrementally`, `darkf-cli/src/agents/opencode.ts`),
  `AgentProgress`/`onProgress` on `AgentRunner` (`darkf-core`), the engine
  folding `agentStepCount`/`agentIdleMs` into the heartbeat
  (`darkf-engine/src/run.ts`), and `agentStallWarning` surfaced by both
  `status` and `monitor`. `claude-code.ts` parity was out of scope for
  this slice, as specced. Two real follow-ups remain open, not fixed by
  this slice: the 15-minute `stallMs` default is an unmeasured
  placeholder, and folding timeout/stderr into the same progress metadata
  was never given a concrete shape to implement against.
- **registry-lifecycle** — built, archived
  (`docs/specs/_built/registry-lifecycle/spec.md`): `worker.log` capture
  (`startCmd`'s spawn redirects `stderr` instead of discarding it), a
  `ready`-file gate before registry `running` is written (`failed-start`
  with the captured tail otherwise), `bootId` stamping so `status`/
  `monitor` report `host-died` instead of outcome-unknown `orphaned`, and
  a start-time dirty-config guard over the bare `darkf/` directory
  (`--allow-dirty-workflow` overrides) — `darkf/` is the user/consumer
  repo's versioned workflow config; `.darkf/` is darkf's own
  runtime/run-storage directory, gitignored, never checked for drift.

## Open tickets

- **failure-metadata** — spec ready: `docs/specs/failure-metadata/spec.md`.
  Structured, named crash-detail fields on `CrashReason` (stderr tail,
  last tool error, step count, etc.) — observability only, no effect on
  retry or nudge behavior. Unblocked: session-nudge's kind split
  (`handoff-missing`/`handoff-unparseable`) has landed.

## Not yet specified (fog)

- **registry mirror outside the repo** — the workflow-side cleanup fix
  stops the known wiper, but `.darkf/` remains one careless
  `git clean -fdx` away from losing journals. Repo-external mirror of
  registry (+ optionally journals) is the durable shape; problem captured,
  not designed — `docs/specs/registry-mirror/spec.md`.
- **provider health gate** — pre-dispatch probe (completion-level, not
  endpoint-level) so a hung backend fails a run in seconds with a
  `provider-unhealthy` reason instead of a 31-minute retry burn. Needs a
  design of its own (which endpoint, what cost, cached for how long);
  agent-liveness covers the during-dispatch half only — problem captured,
  not designed — `docs/specs/provider-health-gate/spec.md`.

## Out of scope

- Auto-kill/auto-restart on any signal (philosophy: inform, supervisor
  decides).
- Claude Code runner parity in **agent-liveness**'s first slice specifically
  (opencode ships first there; its NDJSON progress-parsing doesn't carry
  over to claude-code's JSON-summary output the same way). Does not apply
  to session-nudge, which targets both runners from the start — both
  already support session resume.
- Consumer-repo operational lessons from the same postmortem that are
  not darkf code: integration-test environment docs, Gradle build-time
  work, model-pin rationale comments (tracked in the the consumer repo repo, not
  here).
