# Provider health gate: pre-dispatch probe for a hung backend

**Draft — future work.** This captures the problem as found; it does not
propose a design yet. Not reviewed, not scheduled. A spec for the agent
runners (`darkf-cli/src/agents/*`) and/or `darkf-engine`'s dispatch path —
pure runtime mechanics, no workflow-authoring content.

## How it came up

Flagged as fog in `docs/roadmap/run-resilience/map.md`, from the same
Oct 12/13 postmortem that produced `agent-liveness`: a hung LLM provider
was one of the observed failure families. `agent-liveness` covers the
during-dispatch half (stall detection once an agent is already running)
but nothing covers the before-dispatch half.

## Problem

Today, a hung backend is discovered the slow way: a dispatch starts,
produces no useful signal, and the run burns its full timeout (observed:
31 minutes) before `agent-liveness`'s stall warning or the outer timeout
ever fires. A completion-level pre-dispatch probe — confirm the provider
can actually complete a trivial request, not just that an endpoint
responds — would fail fast with a `provider-unhealthy` reason in seconds
instead of minutes.

## Open questions (not yet designed)

- **Probe level.** Completion-level (send a trivial real prompt, costs
  tokens and real latency) vs. endpoint/health-check level (cheaper,
  but per `agent-liveness`'s own framing a responsive endpoint can still
  hang mid-completion — the exact failure this is meant to catch)?
- **Cost and placement.** Probing before every dispatch adds latency and
  (if completion-level) token cost to every node visit. Does the probe
  run once per run, once per worker-session, or once per dispatch? Is
  there a cheaper "still healthy" recheck distinct from the first
  "is this provider even up" check?
- **Caching.** How long does a "healthy" result stay trusted before the
  next dispatch re-probes, and does a probe failure invalidate the cache
  for other in-flight or queued dispatches against the same provider?
- **Failure shape.** What `CrashReason` kind does a failed probe produce,
  and how does it interact with `silent-model-fallback` (today's
  unpinned-model fallback warning) — does an unhealthy primary model
  trigger the same fallback path, or is "provider down" a different class
  of problem the fallback was never meant to solve?
- **Relationship to `agent-liveness`.** Confirm the dividing line stays
  clean: this spec owns the decision of whether to dispatch at all;
  `agent-liveness` owns detecting staleness once dispatched. Any shared
  plumbing (e.g. a common health/stall state) should be named here once
  the probe's own shape is settled.

## Non-goals (tentative — revisit once scoped)

- No auto-retry-elsewhere or auto-switch-provider behavior — per
  `PHILOSOPHY.md`, darkf informs, the supervisor decides. A failed probe
  stops the dispatch with a reason; it does not pick a different
  provider on its own.
- Not a replacement for `agent-liveness`'s during-dispatch stall
  detection — this is the before-dispatch half only.
