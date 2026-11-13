---
status: implemented
feature: usage-limit-backoff
title: "Usage-limit backoff: wait out a provider quota instead of crashing"
---

# Usage-limit backoff: wait out a provider quota instead of crashing

A spec for the opencode runner (`darkf/src/kit/agents/opencode.ts`) and
`darkf-engine`'s dispatch loop (`darkf/src/engine/run.ts`). When a dispatch
fails because the provider's usage limit is exhausted, the engine pauses that
node and re-probes at a fixed interval (default 30 min) until the limit lifts
or a wait budget is spent — journaled the whole time, so `status`/`monitor`
show the wait instead of silence.

## Problem

Today a usage-limit failure is indistinguishable from any other runner crash.
opencode exits non-zero with the provider error in its stderr tail; the
runner throws a generic `runner-error` (`opencode.ts:283-292`), and the
engine re-dispatches immediately (`run.ts:207-315`). Every remaining retry
burns against the same quota wall within seconds, the run crashes, and the
supervisor must notice, wait out the quota window, and manually restart.

For an unattended run this is the worst outcome: the run dies at the first
quota wall, often overnight, with nothing to show until a human returns.
A quota wall is not a defect in the dispatch — it is a known, temporary
condition with a known recovery (wait). The run should survive it.

## Success criteria

- A dispatch classified as `usage-limit` does not consume a retry attempt
  and does not crash the run, while the wait budget lasts.
- During the wait, `darkf status` and `darkf monitor` show the probe count
  and the time of the next attempt.
- After the limit lifts, the run proceeds past the node that hit the wall,
  with no human action. When the failed attempt left persisted evidence,
  the agent continues its own session — pre-wall work is preserved, not
  replayed from a fresh prompt.
- When the wait budget is spent, the run crashes with `usage-limit` as the
  reason, and the journal carries probe count, total wait, and the
  provider message.
- Every other failure kind behaves exactly as before.

## Design

### Detection (runner)

`opencodeRunner` classifies the failure before throwing. Signals, matched
against stderr and non-JSON stdout lines only (never agent-authored content):

- a rate-limit marker in the output: HTTP status 429, or provider text
  matching `rate limit` / `usage limit` / `limit exceeded`;
- `step-finish`-sourced reasons are unaffected — a quota wall surfaces as an
  API-level error, not a step event.

On a match, the runner throws `AgentFailure` with a new `CrashReason` kind:

```ts
{ kind: "usage-limit"; detail: string } // detail: the matched line / stderr tail
```

The matcher runs on the **non-zero-exit branch only** (decided 2026-11-01
in review, from the observed case: the real limit exhaustion terminated
opencode with a non-zero exit code). The exit-0 + missing-handoff branch
keeps its existing classification — a limit-shaped string there stays a
`handoff-missing`, on its existing nudge/retry repair path. Rationale: an
API-level rejection makes the CLI fail loudly, so non-zero exit is the
expected surface; and a false classification on the exit-0 branch would
convert a real dispatch failure into a silent hours-long wait, while a
missed one only crashes with the facts in the journal. If a future quota
wall ever surfaces as exit 0, the recorded output makes that visible and
the rule can be widened then.

No match → existing behavior, unchanged. The matcher is one function with a
documented marker list, unit-tested against captured fixtures.

**Captured evidence (2026-11-01, live opencode session on this provider):**

```text
Usage limit reached for 5 hour. Your limit will reset at 2026-11-01 06:58:19
```

Marker matching is case-insensitive; `usage limit` matches this message.
The quoted reset time is display text only — see Wait for why darkf never
parses it. One surface detail is still unverified: which stream carries the
message (stderr vs a stdout error event). The matcher scans both, so the
unknown does not block the marker set.

Markers stay conservative. A false positive turns a real crash into a
silent hours-long wait — the worse error.

### Wait and resume (engine + runner)

In the attempt loop, a `usage-limit` reason is not a failed attempt:

- It does not consume one of `def.retries` (same spirit as nudges: a quota
  wall is not a defective dispatch).
- It is not nudgeable — there is no session defect to correct. It is
  deliberately absent from `NUDGEABLE_KINDS`.
- The engine sleeps `usageLimitRetryMs` (default 30 min), then
  re-dispatches.

**The re-dispatch resumes the failed attempt's own session** (revised
2026-11-01 in review; the original draft re-dispatched fresh):

- The runner sends `-s <agentSessionId>` with a short continuation prompt
  instead of replaying the full fresh prompt: "your previous turn was
  interrupted by a provider usage limit; continue where you left off",
  plus the usual handoff-contract text. This one dispatch doubles as the
  limit probe. While the limit holds, the provider rejects the request
  before processing it — probing costs nothing either way. When the limit
  lifts, the same dispatch continues the task mid-flight, with all
  pre-wall work intact. A separate "are you there" probe dispatch would
  add a round trip without adding information.
- No new plumbing: the engine already threads the failed attempt's
  `agentSessionId` into the next attempt's `DispatchInfo`
  (`run.ts:273,300`). The runner treats
  `previousFailure.kind === "usage-limit"` plus a session id as
  resume-eligible, alongside the existing nudge case.
- **Evidence gate.** Resume only when the failed attempt carries
  `stepCount > 0` — the bar every darkf session id already meets
  (`opencode.ts`'s resumability guard). Without persisted evidence there
  is nothing to resume: the post-wait dispatch starts fresh, exactly as
  before. A wall on the very first request leaves no session worth
  keeping.
- **`-s` exception.** "No `-s` outside a nudge" (the `opencode.ts`
  comment) gains its second, explicitly-scoped case: the post-limit
  continuation. The evidence gate is what makes this safe — the
  2026-10-08 hang came from resuming a session with zero persisted
  messages, which the gate excludes by construction.
- The total time spent waiting per node visit is capped at
  `usageLimitMaxWaitMs` (default 24 h). Exhausting the cap crashes the run
  with the last `usage-limit` reason — the journal then carries the facts:
  how long it waited, how many probes, the provider's own message.

Both values are leaf-level config (`usageLimitRetryMs` /
`usageLimitMaxWaitMs` on `BaseLeafDef`), sitting beside `retries` and
`timeoutMs`. The wait runs *between* attempts, outside any per-attempt
deadline — `timeoutMs` continues to bound a single dispatch, never a wait.
Each post-wait dispatch starts with a fresh `timeoutMs` budget: the
attempt loop recomputes its deadline after every wait, so a slept interval
never eats into the next dispatch's timeout (today's deadline is fixed
once per outer attempt, `run.ts:213` — the wait path is the exception).

**Why a fixed interval, not the message's reset time.** The captured
message quotes a reset timestamp, but its timezone is not the supervisor's
(observed 2026-11-01), so parsing it risks waking hours early or late.
The 30-min poll is the deliberate tradeoff: a bounded resume delay
against not spamming the service with probes.

### Visibility

While waiting, the engine keeps emitting `running` heartbeats extended with:

```ts
limitBackoff?: { probe: number; nextAttemptAt: number; waitedMs: number }
```

`status`/`monitor` print a one-line `limitWarning` in the same style as
`stallWarning`/`nudgeWarning`, e.g.:

```text
warn: usage limit — probe 3/48, next attempt in 22m
```

A terminal cap exhaustion renders like any crash, with `usage-limit` as the
reason. The supervisor sees the wait; nothing is hidden.

### Philosophy check

`PHILOSOPHY.md`: darkf informs, the supervisor decides. The wait is not an
auto-restart of a dead worker — it is pacing inside the already-bounded
retry machinery the workflow author opted into with `retries`. It is bounded
by an explicit cap, journaled per probe, and visible live. The supervisor
can still kill the worker at any moment; the journal says exactly where it
stopped.

## Relationship to provider-health-gate

Complementary halves of "the provider is not usable right now":

- **provider-health-gate** (fog): a *hung* backend → fail fast in seconds.
  Wait is the wrong response; nobody knows when it recovers.
- **usage-limit-backoff** (this spec): a *quota wall* → wait a known,
  quoted interval. Fail-fast is the wrong response; recovery is scheduled.

Both need the same underlying skill: telling the two apart. The detection
section above is this spec's half of that; the gate's spec owns the rest
when it is designed.

## Testing

- **Matcher** (unit): captured fixtures — the real limit-exhaustion
  message with a non-zero exit (see Detection), a non-limit API error, a
  limit string inside agent-authored output (must not match), and an
  exit-0 + missing-handoff output containing a limit string (must stay
  `handoff-missing`) — assert `usage-limit` vs existing kinds.
- **Engine loop** (unit, extending `run.test.ts`): a stub runner throwing
  `usage-limit` — assert the retry fires after the interval (fake or
  shortened timer), `def.retries` is not consumed, the cap crashes with
  `usage-limit`, and heartbeats carry `limitBackoff` during the wait.
- **Resume paths** (unit): with session evidence — the retry dispatch
  carries the session id and a continuation prompt, not the fresh prompt;
  without a session id, or with `stepCount = 0` — the retry is fresh.
- **Status/monitor** (unit): `limitWarning` rendering from a journal with
  waiting heartbeats; no warning for a plain `running` heartbeat.

## Non-goals

- No provider or model switching on a limit — that is the supervisor's call
  (and `silent-model-fallback` solved a different problem: missing pins).
- No blind resume — continuation requires persisted-session evidence
  (`stepCount > 0`); without it the post-wait dispatch is fresh.
- No claude-code parity in this slice — its error surface is a JSON summary,
  not NDJSON + stderr; parity follows once opencode's slice proves the
  marker approach (same precedent as agent-liveness).
- No honoring of provider `retry-after` headers, and no parsing of the
  quoted reset time — timestamps are not reliably in the supervisor's
  timezone (observed 2026-11-01); a fixed interval is honest about what
  darkf knows.

## Open questions

1. **On by default, or per-leaf opt-in?** Proposed: on by default with the
   24 h cap, because an unattended run dying at a quota wall is the exact
   failure this exists to prevent. Opt-in would preserve it only for
   workflows that remember to ask.
2. **Cap value.** 24 h (48 probes at 30 min) is a proposal, not a
   measurement. The right cap probably matches the consumer repo's longest
   unattended window.
3. **Interaction with `def.retries`.** Proposed: a `usage-limit` wait never
   consumes a retry attempt; the cap is the only bound. Alternative: count
   waits against `retries` so abusive providers can't stall a run forever —
   rejected for now because the cap already bounds it.
4. ~~Detection surface~~ — resolved 2026-11-01: a real limit-exhaustion
   message is captured in the Detection section and confirms the marker
   set. Remaining unknown (which stream carries the message) does not
   block — the matcher scans both.
5. **Script nodes.** A script calling an LLM itself can hit the same wall,
   outside the runner's classification. Out of scope here — scripts own
   their error handling — but worth a line in the docs.
