import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { opencodeRunner } from "@psimona/darkf/src/kit/agents/opencode.ts";

// dev-loop — begin → PlanPhase{plan → validate} → BuildPhase{dispatch →
// implement → test → [fix → test]* → review → mark done}* → document →
// finish(squash) → feedback.
//
// The darkf-on-darkf pilot, expanded after its first real run built the CLI
// self-update feature (docs/specs/_built/self-update/). Shape ported from
// blueprint's build-backend: Begin cuts the feature branch, Finish
// squash-merges onto master with blueprint's rails, Feedback writes the run
// retrospective under darkf/feedback/.
//
// Run from the target repo root with the released engine from the npm
// registry (never the workspace symlink — doctor's selfRoot guard fails
// inside the checkout; never a source-tarball install — repeated
// install:global runs corrupt bun's global manifest with duplicate
// dependency keys):
//
//   bun install -g @psimona/darkf@latest   # released engine; the working
//                                          # tree's workflow rides the branch
//   darkf validate darkf/workflows/dev-loop
//   darkf start darkf/workflows/dev-loop "message" --allow-dirty-workflow
//
// Editing the FEATURE / RUN_DATE constants at the top of the begin/finish
// scripts and this file is the per-feature contract until engine-side input
// plumbing exists — but the agent prompts below are feature-agnostic, so
// that's the only edit a new dispatch needs. Resume is the fresh-run
// semantics: a second run on an already-implemented tree verifies and ships
// it. No other git automation: the human curates what the workflow leaves
// behind (spec archive, roadmap entry, feedback note).
//
// Two composites, not one, because they bound two unrelated kinds of
// backward routing (Bounded loops rule, darkf-writing-workflows) and need
// very different maxCycles budgets:
//
// - PlanPhase: Plan (an agent — distilling free-form spec prose into a
//   task list takes judgment, not parsing) emits a candidate TaskList in
//   its output, reusing darkf-core's existing shared vocabulary
//   (docs/specs/_built/task-list-json/spec.md) rather than a one-off
//   shape. ValidatePlan (a script) runs parseTaskList on it and, once
//   valid, persists it at the canonical .darkf/run/<runId>/tasks.json — a
//   script gets info.rootDir/info.runId to compute that path; a static
//   agent prompt cannot interpolate a per-dispatch runId, only a
//   compile-time constant like FEATURE. An invalid candidate loops back to
//   Plan; budget is a small, fixed number of retry rounds.
//
// - BuildPhase is darkf's item-loop-convention shape
//   (docs/specs/item-loop-convention/spec.md — a design, not shipped code
//   yet, so Dispatch below hand-rolls its algorithm rather than importing
//   it): Dispatch (a script) is the node that actually walks the plan — it
//   picks the first "pending" task out of tasks.json, flips it
//   "in-progress", and hands it to Implement as the one thing to build
//   this pass. Implement → Test → (Fix → Test)* run on that one task.
//   Review (an agent, reads tasks.json itself to find the in-progress
//   task — it never receives it via handoff, which is several hops away
//   by the time Review runs) verifies the task's claim against the actual
//   working tree and never edits anything; MarkDone (a script) does the
//   one mechanical write that follows an approval, then loops back to
//   Dispatch for the next task. Budget scales with the plan's expected
//   task count (see the comment on BuildPhase below), which
//   item-loop-convention's own design explicitly leaves to the workflow
//   author — WorkflowDef is static, built before the real item count is
//   known.
//
// Every node's only shared channels are the repo itself (files, git diff,
// the spec docs, the run's tasks.json) and the one-hop handoff — matching
// PHILOSOPHY.md: nothing rides along for free. A node several hops past
// whoever produced something it needs (Review past Dispatch; Document past
// everything) rediscovers it from disk — "the task with status
// in-progress," "the directory under .darkf/run/ with the latest mtime" —
// never by a value hand-threaded through every intervening node's output.
// See darkf-writing-workflows's "Keep prompts feature-agnostic". The same
// tasks.json also feeds the OpenCode plugin's live "tasks nn/mm" tab for
// free, since MarkDone flips a task's status the moment its claim is
// actually verified, not merely claimed.

export const agentRunner = opencodeRunner;

const MODEL = "zai-coding-plan/glm-5.3-flash";
const RUN_DATE = "2026-11-18";
const FEATURE = "output-validation";

export const workflow: WorkflowDef = {
  initial: "Begin",
  states: {
    Begin: {
      type: "script",
      file: "begin.ts",
      retries: 1,
      on: { started: "Plan", branch_failed: DONE },
    },
    PlanPhase: {
      initial: "Plan",
      // Two dispatches per round (Plan, ValidatePlan); budget three full
      // retry rounds. Unrelated to BuildPhase's budget — see the top
      // comment on why these are two composites, not one.
      maxCycles: 6,
      states: {
        Plan: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are planning the ${FEATURE} run. Do not write or modify any code.

Read docs/specs/${FEATURE}/. It holds the contract as either a single spec.md, or a split prd.md (requirements) + design.md (implementation) pair — read whichever is present.

Distill the contract into one TaskList JSON object (shape: id, optional spec: { prd?, design? }, requirements?: TaskRequirement[], tasks: Task[] — TaskRequirement is { id, kind: "req"|"nfr"|"ng", text, priority? }; Task is { id, title, status, satisfies?, priority? }; priority is one of "must"|"should"|"could"|"won't"; status starts "pending" for every task):

- requirements: one entry per concrete requirement, NFR, or non-goal in the contract, kind "req"/"nfr"/"ng" accordingly, text stated the way the contract states it — don't paraphrase, don't add anything beyond it.
- tasks: one entry per concrete file to create or change and concrete behavior to add that the contract calls for. Each task's satisfies lists the requirement ids it implements. id is a short kebab-case slug; title is one line.

Put this object directly in your output — do not write any file yourself; the next step persists and validates it.

Finish with event "planned". If the contract is missing, contradictory, or too vague to distill a concrete task list from, finish with event "blocked" and the reason.`,
          on: { planned: "ValidatePlan", blocked: DONE },
        },
        ValidatePlan: {
          type: "script",
          file: "validate-plan.ts",
          retries: 1,
          on: { valid: "Dispatch", invalid: "Plan" },
        },
      },
    },
    BuildPhase: {
      initial: "Dispatch",
      // Dispatch re-enters this composite once per task — the whole
      // per-task loop is one continuous pass through BuildPhase, so this
      // one budget covers the entire plan, not one task. Sized for up to
      // 18 tasks at up to 9 dispatches each in the worst case (Dispatch +
      // Implement + Test + 2 Fix/Test rounds + Review + MarkDone):
      // 18 * 9 = 162. A plan with more tasks than that needs a bigger
      // number — item-loop-convention leaves this to the workflow author
      // on purpose, since WorkflowDef is static and the real task count
      // isn't known until Plan runs. (Raised from the pilot's original
      // 72/8-task estimate after the output-validation run's real plan
      // came out at 17 tasks and hit the old budget.)
      maxCycles: 162,
      states: {
        Dispatch: {
          type: "script",
          file: "dispatch.ts",
          retries: 1,
          on: { next_item: "Implement", plan_exhausted: "Document", blocked: DONE },
        },
        Implement: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `Implement exactly the one task you were handed for the ${FEATURE} feature — see "Input from the previous step" below for its id, title, and which requirements it satisfies. Nothing else.

First read docs/specs/${FEATURE}/. It holds the contract as either a single spec.md, or a split prd.md (requirements) + design.md (implementation) pair — read whichever is present. Use it to understand what the handed-off task actually requires; its locked decisions and explicit non-goals bound the work.

Resume semantics: if the working tree already implements this task, verify it instead of re-implementing.

Do not commit. Do not touch tasks.json — Review verifies your claim and MarkDone updates it once that verification passes.

Finish with event "implemented". If the task cannot be implemented as specified, finish with event "blocked" and put the reason in the output. If a review demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { implemented: "Test", blocked: DONE, disputed: DONE },
        },
        Test: {
          type: "script",
          file: "test.ts",
          retries: 1,
          on: { passed: "Review", failed: "Fix" },
        },
        Fix: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are repairing the ${FEATURE} implementation after a failed gate.

The handoff you received carries either the failing tail of "bun run check" or the reviewer's change list. Read docs/specs/${FEATURE}/'s contract (spec.md if present, otherwise prd.md + design.md). Fix the code minimally. Do not redesign. Do not commit.

Finish with event "fixed". If the failure exposes a spec defect you cannot resolve in code, finish with event "blocked" and the reason. If the demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { fixed: "Test", blocked: DONE, disputed: DONE },
        },
        Review: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are an independent reviewer. Do not modify any files.

Find the run directory under .darkf/run/ with the latest mtime and read its tasks.json. Find the one task whose status is "in-progress" — that is the task just implemented and tested. A task reaching you is a claim to verify, not a fact to trust:

- inspect git status --porcelain in addition to git diff — agent-authored new files are invisible to git diff alone
- read docs/specs/${FEATURE}/'s contract (spec.md if present, otherwise prd.md + design.md) for what each id in the task's "satisfies" list actually requires, and confirm the working tree genuinely satisfies every one of them
- you may run the project's own test/lint commands yourself

Approve only if the task's claim holds in full. Otherwise list every required change concretely in the output.

Finish with event "approved" or event "changes_requested".`,
          on: { approved: "MarkDone", changes_requested: "Fix" },
        },
        MarkDone: {
          type: "script",
          file: "mark-done.ts",
          retries: 1,
          on: { marked: "Dispatch" },
        },
      },
    },
    Document: {
      type: "agent",
      agent: { model: MODEL },
      retries: 1,
      prompt: `You are updating user-facing documentation for the ${FEATURE} feature, after every task in its plan was implemented and independently reviewed. Do not modify code or tests.

Read docs/specs/${FEATURE}/spec.md (or prd.md/design.md when present) for what the feature does, and run git diff master plus git status --porcelain to see what shipped.

Docs must match the spec when this run lands — drift accumulates one stale page at a time. Update everything the feature's surface touches:
- README.md — CLI flags/commands, plugin behavior, setup steps that changed
- packaged docs under darkf/docs/ — the site renders from these files, so they are the docs:
  - reference/cli-commands.md for any CLI surface change (new command, flag, exit code, default)
  - the guides and concepts pages the feature's surface touches — re-read them and fix stale paths, stale command names, and claims the feature made wrong
  - start-here/install.md when setup, packaging, or install steps changed
- cross-references anywhere in darkf/docs/ or README.md that now point at moved or renamed paths

Do NOT touch: ROADMAP.md, darkf/feedback/, docs/specs/ (the spec archive move and roadmap entry are post-merge human curation), any file under darkf/src/ or darkf-opencode-plugin/.

If nothing user-facing changed and no doc drifted, finish with event "skipped" and put the one-line reason in the output. Otherwise make the edits and finish with event "documented". If the docs cannot be updated (for example the site is broken), finish with event "blocked" and the reason.`,
      on: { documented: "Finish", skipped: "Finish", blocked: DONE },
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
