---
status: approved
feature: usage-limit-backoff
title: "Usage-limit backoff: wait out a provider quota instead of crashing"
related: spec.md
---

# Usage-limit backoff — PRD

## Context

darkf runs unattended, multi-agent workflows. Each agent dispatch talks to an
LLM provider through the opencode CLI. Providers cap usage in time windows.
When a run hits the cap, opencode exits non-zero, darkf records a generic
runner crash, and every remaining retry burns against the same cap within
seconds. The run dies, often overnight. A human must notice, wait out the
window, and restart. A real capture from 2026-11-01: "Usage limit reached
for 5 hour. Your limit will reset at 2026-11-01 06:58:19". The full design
history lives in the approved `spec.md` beside this file.

## Goals

An unattended run survives a provider usage cap. It waits, re-probes, and
resumes work when the cap lifts. The supervisor sees the wait the whole time.

## Non-goals

- NG-1 — No provider or model switching on a limit. The supervisor chooses
  to switch.
- NG-2 — No parsing of the reset time the provider quotes. Its timezone is
  unknown and unreliable (observed 2026-11-01).
- NG-3 — No claude-code runner parity in this slice. Its error surface is a
  JSON summary, not NDJSON plus stderr.
- NG-4 — No limit handling for scripts that call an LLM themselves. Scripts
  own their error handling.
- NG-5 — darkf does not detect a hung backend. That work belongs to the
  provider-health-gate effort
  (`docs/specs/provider-health-gate/spec.md`).

## Requirements

### REQ-1 — Usage-limit classification (Must)

When a dispatch fails with a non-zero exit whose output carries a
usage-limit marker, the system shall record the failure as a usage-limit
failure, separate from every other failure kind. If the output carries no
marker, then the system shall classify the failure exactly as before.

### REQ-2 — Wait and re-probe (Must)

When a node records a usage-limit failure, the system shall wait 30 minutes
and re-dispatch the node. The system shall not consume a retry attempt for
a usage-limit failure.

### REQ-3 — Resume or fresh (Must)

If the failed attempt left persisted session evidence, then the system
shall resume that session on the re-dispatch, so the session preserves
the work done before the limit. If it left no such evidence, then the
system shall re-dispatch from a fresh session.

### REQ-4 — Wait cap (Must)

When the total wait for one node visit reaches 24 hours, the system shall
crash the run and record the probe count, the total wait, and the provider
message.

### REQ-5 — Visible wait (Must)

While a node waits out a usage limit, the system shall show the probe count
and the next attempt time in `darkf status` and `darkf monitor` output.

## Constraints

- CON-1 — Classification reads the exit code and error text from opencode.
  opencode controls that surface. darkf can only match what opencode
  emits. The observed surface (2026-11-01) is a non-zero exit.
- CON-2 — `PHILOSOPHY.md`: darkf informs, the supervisor decides. The
  wait has a bound, a journal trail, and visible output. Nothing
  auto-kills or restarts the worker.
- CON-3 — The published package has zero dependencies. This feature adds
  none.
- CON-4 — darkf runs on Bun only. This is a repo-wide commitment.

## NFRs

- NFR-1 (Must) — While the limit holds, the system shall spend no provider
  processing on a re-probe. The provider rejects the request before it
  runs.
- NFR-2 (Must) — The system shall add no latency and no behavior change to
  dispatches that do not fail as usage-limit failures.

## Cut-lines

Deferred past this increment:

- Support for provider `retry-after` headers.
- Per-provider marker configuration.
- Custom continuation-prompt text per workflow.

## Decisions, assumptions, open questions

Decisions:

- D-1 — On by default. No opt-in flag. Interval 30 minutes, cap 24 hours,
  both leaf-configurable (`usageLimitRetryMs`, `usageLimitMaxWaitMs`).
  Approved 2026-11-01.
- D-2 — Fixed-interval polling, not timestamp parsing (NG-2). The 30-minute
  poll trades a bounded resume delay against not spamming the service.
- D-3 — Waits never consume retry attempts. The cap is the only bound.
- D-4 — Marker set from the live capture: `usage limit`, `rate limit`,
  `limit exceeded`, HTTP 429. Case-insensitive. Non-zero exit only. Never
  agent-authored output.
- D-5 — The post-wait re-dispatch doubles as the limit probe: a short
  in-session continuation attempt. A rejected request means still limited
  and costs nothing (NFR-1). An accepted request means the limit lifted,
  and the task continues mid-flight. No separate "are you there" dispatch.
- D-6 — Resume requires persisted-session evidence (at least one step
  event). No evidence means nothing to preserve, so the re-dispatch starts
  fresh. This excludes the 2026-10-08 zero-evidence hang class.
- D-7 — The wait runs between attempts, outside any per-attempt timeout.
  The engine recomputes the attempt deadline after each wait.

Assumptions:

- A-1 — opencode persists the pre-wall session durably, and a `-s` resume
  continues it. Same mechanism the nudge path already relies on.
- A-2 — The captured marker set covers the message from the current
  provider. Other providers may need wider sets (see cut-lines).

Open questions: none. The spec review resolved every decision on
2026-11-01.

## Changelog

- 2026-11-01 — First draft. Transcribed from the approved `spec.md`. It
  carries the review decisions from that spec (D-1 through D-7) and the
  live capture from the same day.
