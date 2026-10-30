# Harness adapters: which agent harnesses ship next, and what the third one teaches

An investigation draft, not yet a decision. darkf ships two concrete
`AgentRunner` adapters: `claudeCodeRunner` (Claude Code CLI) and
`opencodeRunner` (OpenCode CLI). ROADMAP names pi, codex, and deepseek as
deferred. With the package now public, the deciding input changes from
"what would the author use" to "what do outsiders ask for".

## Problem

Each shipped adapter has proven to teach something structural:
`claudeCodeRunner` established the handoff-file contract and the
per-harness flags; `opencodeRunner` forced session-id plumbing
(`sessionId` resume, nudge resume, the `scanStepFinish` positive-evidence
gate) and output-format divergence (NDJSON vs blob). The third adapter will
either confirm the interface is complete or expose its next missing seam —
worth doing deliberately, not on demand at midnight.

## Goals

- Pick the next adapter by expected learning + demand, not alphabetical order.
- Extract any interface generalizations the third adapter forces (e.g.
  output-format negotiation, install-presence detection, model catalogs).
- Keep the adapter surface small: the handoff contract stays the one
  non-negotiable.

## Non-goals

- Supporting every harness: the `AgentRunner` interface is public and
  open-string (`AgentRunnerKind`), so any workflow can ship its own runner
  inline. This spec covers only built-in, tested adapters.
- Windows packaging concerns for any harness.

## Candidate notes

- **codex (OpenAI CLI)** — most requested in adjacent ecosystems;
  non-interactive mode + JSON output exist. Likely teaches: another
  session/resume model, different permission posture.
- **pi (parser-model CLI)** — self-hosted-friendly; aligns with the
  zero-cost self-hosted model path already proven for opencode.
- **deepseek** — an API-first harness (no local CLI session semantics);
  would test whether the interface holds for stateless runners that cannot
  resume sessions at all.

## Open decisions

- **Which one first.** Recommendation: codex, for demand + structural
  contrast with both existing adapters.
- **Shared adapter test kit.** The live-smoke tests for the first two were
  ad-hoc. A third adapter justifies a small harness-contract test suite
  (fake CLI binary that emits a scripted session) so adapters are tested
  without real LLM spend.
- **Presence checking.** Should runners detect a missing CLI binary and
  crash with an install hint (config-crash class) before spending a
  dispatch?
