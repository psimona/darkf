# Agent-liveness stall detection: make a hung dispatch visible to the supervisor (opencode slice DONE)

Archived here because the spec's own first slice — opencode runner only,
`claude-code.ts` parity explicitly deferred — is built: incremental NDJSON
parsing (`readIncrementally` in `darkf-cli/src/agents/opencode.ts`),
`AgentProgress`/`onProgress` in `darkf-core`, the engine folding
`agentStepCount`/`agentIdleMs` into the heartbeat (`darkf-engine/src/run.ts`),
and `agentStallWarning` surfaced by both `status` and `monitor`
(`darkf-cli/src/status.ts`/`index.ts`). Two "Open questions" below remain
genuinely open, not resolved by this slice: the 15-minute `stallMs` default
is still an unmeasured placeholder, and the timeout/stderr metadata fold is
not implemented (no shape was ever specified for it, beyond "fold it in
somehow") — both are real follow-ups, not blockers for what's built.

A spec for surfacing agent-level progress through the journal, `status`, and
`monitor`, so a dispatch that has stopped making progress is distinguishable
from one that is grinding. No automatic intervention — the warning informs,
the supervisor decides, same as the existing stall warning.

## Problem

Dispatch heartbeats are written by the engine loop every 30 seconds. They say
"the engine is alive and the node is open," not "the agent is doing work."
A dispatch whose LLM provider has stalled produces green heartbeats for as
long as the runner is willing to wait.

Evidence (the consumer repo, 2026-10-12): runs `49b6a981` (4h04m) and `9c0765c7`
(31m) both died after the self-hosted model backend stopped serving
completions while its HTTP endpoint still answered. opencode retried with a
300 s header timeout six times. Through all of it, `darkf status` and
`darkf monitor` reported an advancing heartbeat and a healthy open node.
The supervisor watching the monitor had no signal to act on until the run
crashed.

## Root cause

The runner swallows the agent's stdout and reads it once, at the end
(`await new Response(proc.stdout).text()`). The per-step events opencode
emits on that stream (`step_start`, `step_finish`, `text` with
`part.reason`) are exactly the liveness signal needed — but they are parsed
only after the process exits, for `lastFinishReason`. The engine therefore
has no per-agent progress to fold into its heartbeat, and "no heartbeat for
90 s" (engine-side) is the only stall signal today.

## Design

### 1. Runner: parse the event stream incrementally

`opencode.ts` (and later `claude-code.ts`, for parity) reads stdout through
a line stream (`TextLineStream`) and folds each event as it arrives:

- `lastEventAt` — timestamp of the most recent parsed event
- `stepCount` — number of `step_start` events seen
- `lastFinishReason` — unchanged role, now computed incrementally

### 2. Liveness channel: runner reports, engine owns the journal

Extend the `AgentRunner` contract in `darkf-core` with an optional
progress callback:

```ts
run(id, def, handoff, info, onProgress?: (p: AgentProgress) => void)
```

with `AgentProgress = { at: number; stepCount: number; lastEvent: string }`.
The runner invokes it on each parsed event, throttled to at most one call per
30 s. The engine folds the latest value into its existing heartbeat record
(two new optional fields: `agentStepCount`, `agentIdleMs`). Journal ownership
stays with the engine — the runner never writes the journal itself.

### 3. Engine: stall is a journal event, not a crash

When a heartbeat observes `agentIdleMs > stallMs` (default: 15 min — see
open questions), the engine writes one `stall-suspected` journal event per
occurrence (not per heartbeat) with the progress metadata attached.
`status` prints `warn: agent stall suspected (no step event for Nm)` and
`monitor` surfaces it inline, mirroring the existing engine-stall warning's
inform-only semantics.

### 4. Supervisor interception

No automatic kill. The supervisor's options on a stall warning are the
existing ones: watch, `darkf steer <runId> "<message>"`, or kill the run.
The stall event's metadata (step count, idle time) is what makes that
decision informed: 0 steps in 15 min at dispatch start is a provider
problem; 120 steps with a growing idle tail is an agent grinding a long
build.

## Non-goals

- No automatic kill or restart on stall.
- No provider health probing before or during dispatch (separate spec).
- No `claude-code.ts` parity in the first slice (the contract is designed
  for it; the opencode runner ships first).

## Open questions

- **Tool-execution gaps look like stalls.** Step events pause while a tool
  runs; a 10-minute Gradle build between assistant messages produces the
  same signature as a hung provider. Options: (a) generous `stallMs`
  default, (b) opencode could emit `tool_start`/`tool_finish` events on the
  run stream (upstream ask), (c) treat only *pre-first-step* idleness as
  high-signal (provider hangs usually manifest before or between turns).
  The default of 15 min is a placeholder until measured against real runs.
- **stderr on timeout.** When `timeoutMs` fires, the runner kills the
  process and today reports only the exit code. Fold the timeout into the
  same metadata push (reason: `timeout after ${timeoutMs}ms`) — small,
  adjacent, in scope for the same slice.
