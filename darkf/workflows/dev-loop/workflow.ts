import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { opencodeRunner } from "@psimona/darkf/src/kit/agents/opencode.ts";

// dev-loop — begin → implement → check → review → document → finish(squash) →
// feedback.
//
// The darkf-on-darkf pilot, expanded after its first real run built the CLI
// self-update feature (docs/specs/self-update/). Shape ported from
// blueprint's build-backend: Begin cuts the feature branch, the composite
// bounds the implement/fix/review cycle, Finish squash-merges onto master
// with blueprint's rails, Feedback writes the run retrospective under
// darkf/feedback/.
//
// Run from the target repo root with a globally installed darkf (never the
// workspace symlink — doctor's selfRoot guard fails inside the checkout):
//
//   bun run install:global   # once, to refresh the global binary
//   darkf doctor darkf/workflows/dev-loop
//   darkf start darkf/workflows/dev-loop "message" --allow-dirty-workflow
//
// Editing the FEATURE / RUN_DATE constants at the top of the begin/finish
// scripts and this file's agent prompts is the per-feature contract until
// engine-side input plumbing exists. Resume is the fresh-run semantics: a
// second run on an already-implemented tree verifies and ships it (see the
// Implement prompt). No other git automation: the human curates what the
// workflow leaves behind (spec archive, roadmap entry, feedback note).
//
// The implementer, fixer, reviewer, and documenter are separate dispatches.
// Their only
// shared channels are the repo itself (files, git diff, the spec docs) and
// the one-hop handoff — matching PHILOSOPHY.md: nothing rides along for
// free.

export const agentRunner = opencodeRunner;

const MODEL = "zai-coding-plan/glm-5.3-flash";
const RUN_DATE = "2026-11-01";
const FEATURE = "usage-limit-backoff";

export const workflow: WorkflowDef = {
  initial: "Begin",
  states: {
    Begin: {
      type: "script",
      file: "begin.ts",
      retries: 1,
      on: { started: "Loop", branch_failed: DONE },
    },
    Loop: {
      initial: "Implement",
      // The normal path is one cycle (Implement → Check → Review → Document
      // → Finish). Each Fix → Check re-entry costs another. 8 leaves room
      // for two fix rounds including the terminal Document dispatch before
      // the engine calls the run stuck.
      maxCycles: 8,
      states: {
        Implement: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `Implement the ${FEATURE} feature in this repository.

First read docs/specs/${FEATURE}/spec.md. It is the contract: its Detection, Wait-and-resume, and Non-goals sections are locked — implement exactly what they specify, nothing more. docs/specs/${FEATURE}/design.md carries the component wiring and test plan; read it second.

Resume semantics: if the working tree already implements the spec, verify that instead of re-implementing — read darkf/src/core/types.ts, darkf/src/engine/run.ts, and darkf/src/kit/agents/opencode.ts, confirm they match the spec, and finish "implemented" without rewriting.

Deliverables (when not already present):
- darkf/src/core/types.ts: CrashReason gains { kind: "usage-limit"; detail: string }; BaseLeafDef gains usageLimitRetryMs (default 30 * 60 * 1000) and usageLimitMaxWaitMs (default 24 * 60 * 60 * 1000) beside retries/timeoutMs; the running NodeStatus gains limitBackoff: { probe: number; nextAttemptAt: number; waitedMs: number }
- darkf/src/engine/run.ts: in the AgentFailure catch, a usage-limit reason takes a new branch — it does not advance the attempt counter and does not consume def.retries; it accumulates waitedMs per node visit and, while waitedMs + retryMs <= maxWaitMs, sleeps retryMs while emitting running heartbeats carrying limitBackoff (probe index, nextAttemptAt, waitedMs), recomputes the attempt deadline from timeoutMs, and re-dispatches the same attempt; at the cap it takes the existing crashed() path with the last usage-limit reason. usage-limit stays out of NUDGEABLE_KINDS. The engine forwards previousFailure and agentSessionId to the next dispatch unchanged
- darkf/src/kit/agents/opencode.ts: export function matchUsageLimit(stderr, stdout) — lowercase the non-JSON lines (skip lines that parse as JSON), match markers "usage limit", "rate limit", "limit exceeded", "429", return the first matched line. Call it ONLY in the existing exitCode !== 0 branch; on a match throw AgentFailure with crashReason { kind: "usage-limit", detail: matched line } and the evidence-gated agentSessionId (stepCount > 0, exactly as today); a no-match keeps the existing runner-error throw byte-for-byte. Beside the nudge path: when info.previousFailure?.kind === "usage-limit" AND info.agentSessionId is present, dispatch with -s <agentSessionId> and a short continuation prompt ("a provider usage limit interrupted your previous turn. Continue where you left off.") plus the handoff contract text, without replaying the full prompt; otherwise the fresh prompt path unchanged
- darkf/src/kit/status.ts: limitWarning folded from the latest running status's limitBackoff (denominator ceil(maxWaitMs / retryMs)), printed by the status and monitor commands in darkf/src/cli/index.ts in the same one-line warn style as stallWarning/nudgeWarning: "warn: usage limit — probe 3/48, next attempt in 22m"
- tests: matcher fixtures (the captured message "Usage limit reached for 5 hour." with a non-zero exit classifies usage-limit; a non-limit API error stays runner-error; a limit string inside an agent-authored JSON line does not match; an exit-0 + missing-handoff output containing a limit string stays handoff-missing), engine wait loop in darkf/src/engine/run.test.ts (retry fires after the interval with a shortened timer, def.retries not consumed, the cap crashes with probe count/total wait/detail, the deadline is recomputed after each wait), resume paths (with a session id the dispatch carries -s and the continuation prompt, without it the dispatch is fresh), and limitWarning rendering in darkf/src/kit/status.test.ts

Follow the existing code style of darkf/src/engine/run.ts, darkf/src/kit/agents/opencode.ts, and darkf/src/kit/status.ts. Do not commit. Do not touch files outside darkf/src/ and docs/specs/${FEATURE}/.

Finish with event "implemented". If the spec cannot be implemented as written, finish with event "blocked" and put the reason in the output. If a review demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { implemented: "Check", blocked: DONE, disputed: DONE },
        },
        Check: {
          type: "script",
          file: "check.ts",
          retries: 1,
          on: { passed: "Review", failed: "Fix" },
        },
        Fix: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are repairing the ${FEATURE} implementation after a failed gate.

The handoff you received carries either the failing tail of "bun run check" or the reviewer's change list. Read docs/specs/${FEATURE}/spec.md (component wiring in docs/specs/${FEATURE}/design.md) for the contract. Fix the code minimally. Do not redesign. Do not commit. Do not touch files outside darkf/src/.

Finish with event "fixed". If the failure exposes a spec defect you cannot resolve in code, finish with event "blocked" and the reason. If the demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { fixed: "Check", blocked: DONE, disputed: DONE },
        },
        Review: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are an independent reviewer. Do not modify any files.

Verify the working tree against docs/specs/${FEATURE}/spec.md (component wiring and test plan in docs/specs/${FEATURE}/design.md):
- inspect git status --porcelain in addition to git diff — agent-authored new files are invisible to git diff alone
- check the types match the spec field for field: the usage-limit CrashReason kind (detail field), the BaseLeafDef usageLimitRetryMs/usageLimitMaxWaitMs defaults (30 min / 24 h), and the running NodeStatus limitBackoff fields (probe, nextAttemptAt, waitedMs)
- check the engine branch: a usage-limit reason does not advance the attempt counter, does not consume def.retries, never sits in NUDGEABLE_KINDS, heartbeats carry limitBackoff during the wait, the deadline is recomputed after each wait, and the cap crash carries probe count, total wait, and detail
- check the runner: matchUsageLimit runs ONLY in the exitCode !== 0 branch, scans only non-JSON lines, uses the spec's marker set, gates the session id on stepCount > 0, and keeps every other failure path byte-for-byte; the continuation path requires BOTH previousFailure usage-limit AND a session id, dispatches -s with the short continuation prompt plus the handoff contract text, and does not replay the full prompt
- check the tests cover the spec: matcher fixtures including the exit-0 exclusion, the engine wait loop (interval, no retry consumption, cap crash facts, deadline recompute), resume vs fresh dispatch, and limitWarning rendering
- you may run "bun test darkf/src" and "bun run lint" yourself

Approve only if the implementation fulfills the spec. Otherwise list every required change concretely in the output.

Finish with event "approved" or event "changes_requested".`,
          on: { approved: "Document", changes_requested: "Fix" },
        },
        Document: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are updating user-facing documentation for the ${FEATURE} feature, after an independent review approved the implementation. Do not modify code or tests.

Read docs/specs/${FEATURE}/spec.md (or prd.md/design.md when present) for what the feature does, and run git diff master plus git status --porcelain to see what shipped.

Update only what the feature's user-facing surface touches:
- README.md — CLI flags/commands, plugin behavior, setup steps that changed
- docs-site pages under site/src/content/docs/ — the affected guide or reference page; add a short new guide only for a genuinely user-visible capability
- cross-references in docs/ that now point at moved or renamed paths

Do NOT touch: ROADMAP.md, darkf/feedback/, docs/specs/ (the spec archive move and roadmap entry are post-merge human curation), any file under darkf/src/ or darkf-opencode-plugin/.

If nothing user-facing changed, or the docs need no edit, finish with event "skipped" and put the one-line reason in the output. Otherwise make the edits and finish with event "documented". If the docs cannot be updated (for example the site is broken), finish with event "blocked" and the reason.`,
          on: { documented: "Finish", skipped: "Finish", blocked: DONE },
        },
      },
    },
    Finish: {
      type: "script",
      file: "finish.ts",
      retries: 1,
      on: { merged: "Feedback", merge_failed: DONE },
    },
    Feedback: {
      type: "agent",
      agent: { model: MODEL },
      retries: 1,
      prompt: `Write the run retrospective for the ${FEATURE} dev-loop run, in the style of a post-run feedback note.

Read the newest journal: the run directory under .darkf/run/ with the latest mtime, file journal.jsonl (one JSON event per line). Also run git log -3 --oneline to confirm the merge.

Write darkf/feedback/${RUN_DATE}-${FEATURE}.md with exactly this shape:
- a "# Run feedback — <title>" heading
- bullet fields: Date, Engine/workflow (darkf dev-loop), Run (the runId from the journal), Final outcome, Scopes (one line on what shipped)
- a "## What worked" section — factual bullets only
- a "## Failures and root causes" section — numbered, with cost where visible; write "none observed" if empty
- a "## Notes" section — anything the next run of this workflow should know

Do not modify any other file. Do not commit. Finish with event "recorded". If the journal is unreadable, finish with event "skipped".`,
      on: { recorded: DONE, skipped: DONE },
    },
  },
};
