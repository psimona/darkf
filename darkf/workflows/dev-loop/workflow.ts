import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { opencodeRunner } from "@psimona/darkf/src/kit/agents/opencode.ts";

// dev-loop — begin → implement → check → review → finish(squash) → feedback.
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
// The implementer, fixer, and reviewer are separate dispatches. Their only
// shared channels are the repo itself (files, git diff, the spec docs) and
// the one-hop handoff — matching PHILOSOPHY.md: nothing rides along for
// free.

export const agentRunner = opencodeRunner;

const MODEL = "zai-coding-plan/glm-5.3-flash";
const RUN_DATE = "2026-10-31";
const FEATURE = "task-list-json";

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
      // The normal path is one cycle (Implement → Check → Review → Finish).
      // Each Fix → Check re-entry costs another. 6 leaves room for several
      // fix rounds before the engine calls the run stuck.
      maxCycles: 6,
      states: {
        Implement: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `Implement the ${FEATURE} feature in this repository.

First read docs/specs/${FEATURE}/spec.md. It is the contract: its Design sketch and both Decisions sections are locked — implement exactly what they specify, nothing more.

Resume semantics: if the working tree already implements the spec, verify that instead of re-implementing — read the existing darkf/src/core/tasks.ts and darkf-opencode-plugin/src/digest.ts, confirm they match the spec, and finish "implemented" without rewriting.

Deliverables (when not already present):
- the TaskList type family in darkf/src/core/types.ts per the spec's Design sketch (TaskStatus, TaskPriority, Task, TaskRequirement, TaskList), re-exported from darkf/src/core/index.ts
- parseTaskList in darkf/src/core/tasks.ts: hand-written, zero-dependency, narrowing unknown JSON to TaskList | { error } (Decisions: Validation)
- foldTaskList alongside foldJournal in darkf/src/kit/status.ts: a pure function returning done/total counts, the current in-progress item, and stall state
- the plugin (darkf-opencode-plugin/src/): TaskListView in digest.ts; store.ts reads .darkf/run/<runId>/tasks.json on the existing poll with an fs.watch next to the journal watcher; overlay.tsx grows a tab bar — tab "workflow" (today's PlanGraph, unchanged, the default) and tab "tasks nn/mm" (strict done/total in the title, hidden while tasks.json is absent, "?" counter plus the inline parse error when invalid); task rows per the plugin Decisions (glyph + id + title, "!" before the title for must priority, the active row's dim "↳ REQ-…" satisfies line, ○ pending / ● in-progress accent bold / ✓ done dim / ✗ failed error); keys "1"/"2" and clicking a tab title switch tabs; the supervisor pane stays below, shared by both tabs
- tests: parseTaskList narrowing cases (valid list, missing/wrong-typed fields, bad status and priority unions, tasks not an array), foldTaskList counts/current/stall, and the TaskListView digest in darkf-opencode-plugin/src/digest.test.ts

Follow the existing code style of darkf/src/kit/status.ts and darkf-opencode-plugin/src/. Do not commit. Do not touch files outside darkf/src/, darkf-opencode-plugin/src/, and docs/specs/${FEATURE}/.

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

The handoff you received carries either the failing tail of "bun run check" or the reviewer's change list. Read docs/specs/${FEATURE}/spec.md for the contract. Fix the code minimally. Do not redesign. Do not commit. Do not touch files outside darkf/src/ and darkf-opencode-plugin/src/.

Finish with event "fixed". If the failure exposes a spec defect you cannot resolve in code, finish with event "blocked" and the reason. If the demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { fixed: "Check", blocked: DONE, disputed: DONE },
        },
        Review: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are an independent reviewer. Do not modify any files.

Verify the working tree against docs/specs/${FEATURE}/spec.md:
- inspect git status --porcelain in addition to git diff — agent-authored new files are invisible to git diff alone
- check the types match the spec's Design sketch field for field, and that both Decisions sections are each reflected in code (parseTaskList zero-dep narrowing; tasks.json read from .darkf/run/<runId>/; satisfies + lowercase MoSCoW; row format, glyph mapping, strict done/total counter, hidden-when-absent tab, file-status active row)
- check the test suites cover the spec: parseTaskList narrowing, foldTaskList, and the TaskListView digest
- you may run "bun test darkf/src/core darkf/src/kit darkf-opencode-plugin/src" yourself

Approve only if the implementation fulfills the spec. Otherwise list every required change concretely in the output.

Finish with event "approved" or event "changes_requested".`,
          on: { approved: "Finish", changes_requested: "Fix" },
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
