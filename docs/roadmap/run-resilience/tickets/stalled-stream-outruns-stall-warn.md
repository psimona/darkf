# Stalled provider stream outruns the stall warn

## Question

Live evidence from a consumer run (frontier, harden-spec on
ADV-PROP-proposal, run `b5f76215`, 2026-11-11): the `simplify` agent made
11 internal steps, then its next glm-5.3-flash stream went silent at
18:14:54. TCP stayed healthy (ESTABLISHED, RTT 12 ms, no retransmits,
`lastsnd` 220 s — request out, response never came). The agent process
sat in `epoll_wait` forever: no stream inactivity timeout on the opencode
side. darkf kept reporting `running` with a green worker heartbeat while
`agentIdleMs` climbed past 273 s in the journal. `agentStallWarning` never
fired (below the 15-minute placeholder), and nothing below the warning
acts anyway — the supervisor diagnosed the stall by hand (journal idle
counter + `ss -tni` socket ages) and hand-killed the agent process to
reach the designed retry.

Three gaps, one incident:

1. **The 15-minute `stallMs` default is an unmeasured placeholder**
   (known agent-liveness follow-up, now measured once: a human diagnosed
   this stall in ~4 minutes from data darkf already had — idle counter
   plus socket age. 15 minutes of green-before-warn is not credible for
   an unattended detached run.)
2. **Warn-only at every layer.** agent-liveness informs; opencode never
   times the stream out; the runner never kills a stalled dispatch. The
   philosophy says darkf informs, the supervisor decides — but a detached
   overnight run has no supervisor watching. Record: what is the decided
   action for a stall (kill+retry through the existing attempt path, or
   nothing), and who owns it?
3. **`agentStepCount` reads a different event stream than the agent's
   real progress**: the runner showed 0 for the whole 11-step agent run,
   while `agentIdleMs` was the only faithful signal. Either fix the
   counter or stop surfacing it.

Secondary observation: the provider health gate (fog, below) covers the
pre-dispatch half; this incident is the during-dispatch half — a stream
that starts fine and dies mid-flight — and shows the during-dispatch half
is not actually covered by warn-only liveness.

## Type

question (the threshold and the decided action both need an owner call;
the measurement above is one data point, not a distribution)

## Blocked by

nothing

## Status

Claimed by: session-2026-11-12-run-resilience

Decided (2026-11-12). The owner call: a real stall is killed and
auto-retried through the existing attempt bound. Spec drafted at
`docs/specs/stall-retry/spec.md` — not yet built. Per gap:

1. **Thresholds, now measured once.** Warn at 5 min (`AGENT_STALL_MS`
   15 → 5; the ~4-minute human diagnosis is the measurement). Act (kill +
   retry) at `stallMs`, default 15 min — above the longest cited legit
   gap (a 10-minute tool run), far below the 1h timeout ceiling.
   Per-leaf override beside `retries`/`timeoutMs`.
2. **The decided action is the runner's**: kill its own child dispatch
   after `stallMs` of silence on stdout *and* stderr, throw a new
   `agent-stall` `CrashReason`, and let the attempt loop retry — consumes
   an attempt, bounded by `def.retries`. Not nudgeable; fresh dispatch,
   no `-s`. Detached-run rationale: there is no supervisor to decide at
   3 a.m., so the philosophy's "inform, supervisor decides" is narrowed
   on this one signal.
3. **`agentStepCount` ground truth before build**: the counter reads a
   stream that never carried the event it counts (0 through this run's
   11 steps). Capture one real `--format json` stdout sample; fix the
   matcher to the verified shape, or drop the counter if no step events
   exist. Blast radius beyond display: the same matcher gates
   `agentSessionId` — session-nudge and usage-limit continuation both
   depend on it.

Recorded 2026-11-11 with live evidence from run
`b5f76215-e853-4285-a4d9-eb3cdd54d40a` (journal retained in the consumer
repo: `frontier/.darkf/run/b5f76215-e853-4285-a4d9-eb3cdd54d40a/`).
