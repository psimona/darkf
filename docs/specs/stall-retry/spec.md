# Stall retry: kill a silently-stalled agent dispatch and retry within the attempt bound

**Draft — decided 2026-11-12, not yet built.** Decision recorded on
`docs/roadmap/run-resilience/tickets/stalled-stream-outruns-stall-warn.md`
(Decided, same date). A spec for the opencode runner
(`darkf/src/kit/agents/opencode.ts`), the engine's attempt loop
(`darkf/src/engine/run.ts`), and the stall warning
(`darkf/src/kit/status.ts`). When an agent dispatch stops producing
output — a provider stream that went silent mid-flight — the runner kills
its own child after a bounded silent window, and the engine retries
within the existing attempt bound.

Sibling of `usage-limit-backoff` (built): that spec covers the *explicit
rejection* family — the provider answers with a quota error. This spec
covers the *silent hang* family during dispatch — the provider accepts
the request and never answers.

## Problem

Three backstops exist today and none acts in time:

- `agentStallWarning` fires at 15 minutes (`AGENT_STALL_MS`,
  `status.ts:296`) and is display-only. It never acts.
- The runner's kill timer fires at 1 hour (`DEFAULT_TIMEOUT_MS`,
  `opencode.ts:17`, armed at `opencode.ts:302`). Worst case: one full
  hour of a hung dispatch, then a retry into the same silent provider.
- Between them, the engine heartbeat stays green (`run.ts:280-284`).
  It proves process liveness, not progress. A process sitting in
  `epoll_wait` is "alive".

Live incident (run `b5f76215`, 2026-11-11, consumer repo): the `simplify`
agent completed 11 steps, then its next glm-5.3-flash stream went silent
at 18:14:54. TCP stayed ESTABLISHED, `lastsnd` 220 s — request out,
response never came. opencode sat in `epoll_wait` forever: it has no
stream inactivity timeout. `agentIdleMs` climbed past 273 s under a green
heartbeat; the 15-minute warn never fired; the supervisor diagnosed the
stall by hand in ~4 minutes from data darkf already had (journal idle
counter plus `ss -tni` socket ages) and hand-killed the agent to reach
the designed retry.

Two stall shapes are now observed across incidents:

- **Pre-response** (2026-10-12, runs `49b6a981`/`9c0765c7`): opencode's
  own 300 s header timeout retried six times, then failed. Slow, but
  bounded by opencode itself.
- **Mid-stream** (this incident): the stream starts, then dies silently.
  Nothing in opencode times it out. Unbounded without darkf.

darkf cannot fix opencode's timers. It can bound the damage.

Adjacent latent bug, same code path: the runner drains stderr only on
the non-zero-exit branch (`opencode.ts:334`). A child that writes more
than the ~64 KB pipe buffer to stderr blocks on that write and can
neither produce stdout nor exit — the runner reads this as a stall, or
waits on the 1h timer. Liveness must watch both streams, and stderr
must be drained concurrently.

## Success criteria

- A dispatch with no output line on stdout or stderr for `stallMs` is
  killed by the runner and retried. Retries stay bounded by
  `def.retries`. Exhaustion crashes with `agent-stall` and the stall
  facts in the journal.
- The warn fires at 5 minutes — before the kill — and states the
  pending action.
- Legit long tool runs (longest cited: a 10-minute build, see
  agent-liveness's open questions) survive the default threshold.
- A stderr-heavy child can no longer deadlock the pipe; its stderr
  feeds the liveness signal.
- `agentStepCount` either counts real steps or is gone — verified
  against a captured real run stream, because the same matcher gates
  `agentSessionId` (session-nudge and usage-limit continuation depend
  on it).
- Every other failure kind behaves exactly as before.

## Design

### Detection (runner)

The liveness signal is the most recent line on **stdout or stderr**.
Today only stdout is read live (`readIncrementally`, `opencode.ts:327`).
Drain stderr concurrently through the same line-splitting path and fold
both into the same timestamp update — the `lastEventAt` in `onLine`
(`opencode.ts:312`). This widens the signal (provider retries and
warnings log to stderr) and fixes the pipe deadlock.

Arm a debounce timer at spawn, beside the existing `killTimer`:

- reset on every line from either stream;
- on fire: kill, classify as a stall (below);
- cleared in the same `finally` as `killTimer` (`opencode.ts:329-331`).

The window is leaf config:

```ts
stallMs?: number; // beside retries/timeoutMs/usageLimitRetryMs, types.ts:53-59
```

### Thresholds (measured once)

- **Warn at 5 minutes.** `AGENT_STALL_MS` 15 → 5 (`status.ts:296`).
  Measurement: the human diagnosed the `b5f76215` stall in ~4 minutes;
  4.5+ minutes of silence is confirmed real-stall territory.
- **Act at 15 minutes.** `DEFAULT_STALL_MS = 15 * 60_000`. Above the
  longest cited legit gap (a 10-minute tool run) with margin; far below
  the 1h timeout ceiling.

This is one data point, and the spec is honest about it. The per-leaf
`stallMs` override is the escape hatch for noisy workflows; the defaults
are revisited on the first false kill or the first wasteful 15-minute
wait.

### Kill (runner)

On stall fire: `proc.kill()` (SIGTERM), set a `stalled` flag, await
exit. Classification order matters: the `stalled` flag is checked
**before** the non-zero-exit branch (`opencode.ts:333`) — a SIGTERM kill
surfaces as a non-zero/signal exit and must not classify as
`runner-error`.

```ts
{ kind: "agent-stall"; idleMs: number; lastEvent: string }
```

The `AgentFailure` message carries the stderr tail; `agentSessionId`
stays evidence-gated (`stepCount > 0`) exactly like every other path.

### Retry (engine) — no loop change

`agent-stall` is deliberately absent from `NUDGEABLE_KINDS` — a stall is
not an output defect a nudge can correct — and it is not `usage-limit`,
so the existing catch falls through to `continue attemptLoop`
(`run.ts:376`): the stall consumes an attempt, bounded by
`maxAttempts = (def.retries ?? 0) + 1` (`run.ts:210`). "Auto retry up to
a limit" is the limit the workflow author already set. No new knob, no
engine change.

The retry dispatch is **fresh** — no `-s` resume. The stall wedged the
connection; a fresh request opens a new stream. Resuming a session that
SIGTERM killed mid-turn is unproven (open question 2).

Note for workflow authors: `retries` defaults to 0, so a stall on an
unconfigured leaf crashes named and bounded after one 15-minute window —
instead of hanging green for an hour, or forever. Set `retries` where
stall resilience is wanted.

### Visibility

- Heartbeats keep the existing shape; `agentIdleMs` climbs to the kill.
- `agentStallWarning` (`status.ts:302-313`) states the pending action,
  e.g.: `warn: agent stall suspected — dispatch killed and retried at
  15m idle`. The `monitor` line (`index.ts:821`) matches.
- Terminal exhaustion renders like any crash, with the `agent-stall`
  reason, `idleMs`, and `lastEvent` in the journal.

### stepCount ground truth (ticket gap 3)

Evidence: the whole 11-step run showed `agentStepCount` 0 while
`agentIdleMs` stayed faithful. Both derive from the same `onLine`
(`opencode.ts:310-325`); only the `step-finish` match failed. The
binary's own `publishLLMEvent` records `step-finish` internally without
publishing it to the run stream — the counter may be matching an event
that never reaches stdout.

Gate for build: capture one real `opencode run --format json` stdout
sample. Then:

- If step events exist in a different shape — fix `scanStepFinish` and
  `onLine` to the verified shape; add a fixture test from the sample.
- If no step events exist at all — drop `agentStepCount` from
  `AgentProgress` and status rendering. `agentIdleMs` is the faithful
  signal.

Blast radius beyond display: the same matcher gates `agentSessionId`
attach (`opencode.ts:347,352,366,374-377`). If it never fires,
session-nudge and the usage-limit continuation silently degrade to
fresh prompts today. The capture settles this too.

### Philosophy check

The map rules auto-kill/auto-restart out of scope: darkf informs, the
supervisor decides. Narrowed 2026-11-12 on this one signal, for the
detached-run case: an overnight run has no supervisor to decide at
3 a.m. — the ticket's own argument. The action stays bounded in every
direction the philosophy cares about:

- it targets only darkf's own child dispatch process, never the host or
  worker;
- it spends the retry budget the workflow author explicitly set;
- it is journaled with the stall facts;
- the supervisor can still kill the whole run at any moment.

Precedent: `usage-limit-backoff`'s framing — action inside the
already-bounded attempt machinery the author opted into, not a restart
of the run.

## Relationship to provider-health-gate

Two halves of the same hang family (`provider accepted the connection,
no completion, no error`):

- **provider-health-gate** (fog): the *pre-dispatch* half — probe before
  dispatch, fail in seconds when the backend is already dead.
- **stall-retry** (this spec): the *during-dispatch* half — the stream
  is healthy at start and dies mid-flight. Wait is the wrong response
  and warn-only is not enough for a detached run; kill and retry is.

## Testing

- **Runner** (unit, extending `opencode.test.ts`): a fake binary that
  emits lines then goes silent — assert the kill fires at `stallMs`
  (shortened timer), the `AgentFailure` carries kind `agent-stall` with
  `idleMs`, and the engine-classified path retries. A chatty-stderr
  fixture — stderr lines feed liveness (no kill while stderr flows), and
  a stderr-heavy run no longer blocks stdout (deadlock regression).
- **Engine** (unit, extending `run.test.ts`): a stub runner throwing
  `agent-stall` — the attempt is consumed, the retry dispatch is fresh
  (no resume prompt, no nudge), exhaustion crashes with `agent-stall`.
- **Status/monitor** (unit): warn text at the 5-minute threshold; no
  warn below it.
- **stepCount fixture** from the captured real sample (above).

## Non-goals

- No opencode-side stream timeout — that is upstream's timer to add.
  darkf bounds the damage on its side.
- No claude-code parity in this slice — its output surface is a JSON
  summary, not NDJSON + stderr; parity follows the agent-liveness
  precedent once opencode's slice proves the approach.
- No session continuation on a stall retry (open question 2).
- No provider or model switching — the supervisor's call.
- No tool-gap special-casing (an upstream `tool_start`/`tool_finish`
  ask) — the threshold handles it; revisit on the first false kill.

## Open questions

1. **The 15-minute act default** rests on one measurement (~4-minute
   human diagnosis) and one cited legit gap (a 10-minute build).
   Revisit on the first false kill or the first wasteful wait.
2. **Resume-after-stall.** `usage-limit` continues its session because
   the provider rejected cleanly. A stall kills opencode mid-turn with
   SIGTERM; resuming that session is unproven. Fresh for now; revisit
   with one captured post-kill resume attempt.
3. **Warn threshold is a fixed constant**, not proportional to
   `stallMs`. A leaf overriding `stallMs` below 5 minutes gets a kill
   with no preceding warn — harmless: the kill reason informs either
   way.
