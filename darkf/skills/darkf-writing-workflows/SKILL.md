---
name: darkf-writing-workflows
description: Use when authoring or editing a darkf workflow.ts state graph of agent, script, and composite states, especially to bound implement-verify-review loops, design events, or wire agent runners and the handoff contract
---

# Writing darkf Workflows

## Overview

A darkf workflow is a TypeScript module. It exports a state graph. `agent` states dispatch an AI agent. `script` states run TypeScript. `composite` states nest subgraphs. Put deterministic checks in scripts. Reserve agent states for judgment.

Shipped workflows live in `workflows/` inside the darkf package. Find the package: `readlink -f "$(which darkf)"`. Treat them as examples. Check any example against the bounded-loops rule before you copy its shape.

## Bounded loops: the critical rule

Every state that can route backward must live inside ONE composite. `maxCycles` counts leaf dispatches per continuous pass. It resets when execution re-enters the composite. A composite `Fix{Implement,Verify}` with `Review` outside it has no cycle cap. `changes_requested → Implement` re-enters `Fix` and clears the counter. Put Implement, Verify, and Review inside one composite.

- `maxCycles` counts dispatches, not cycles. 15 means five rounds of three states.
- `retries` do not consume the cycle budget. Give every agent and script state `retries: 1`. A transient spawn failure then costs one attempt, not the run.
- An event with no matching `on` route is a terminal `no-transition` crash. Cover every declared event.

## Skeleton

```ts
import { DONE, type AgentRunner, type WorkflowDef } from "/abs/path/to/darkf/src/core/index.ts";
import { claudeCodeRunner } from "/abs/path/to/darkf/src/kit/agents/claude-code.ts";

export const agentRunner: AgentRunner = claudeCodeRunner;

export const workflow: WorkflowDef = {
  initial: "Loop",
  states: {
    Loop: {
      initial: "Implement",
      // maxCycles counts dispatches: rounds = maxCycles / states-per-round.
      // Budget above your expected worst case. Legitimate review loops can
      // exceed 5 rounds; a tight budget trips the breaker mid-run.
      maxCycles: 24,
      states: {
        Implement: {
          type: "agent", retries: 1, prompt: IMPL,
          on: { implemented: "Verify", disputed: DONE, blocked: DONE },
        },
        Verify: {
          // Review only sees Verify output. Relay what Implement reported:
          // return { event: "green", output: { implemented: handoff.output } }
          type: "script", file: "verify.ts", retries: 1,
          on: { green: "Review", red: "Implement", blocked: DONE },
        },
        Review: {
          type: "agent", retries: 1, prompt: REVIEW,
          on: { done: DONE, changes_requested: "Implement" },
        },
      },
    },
  },
};
```

## Imports

Workflows outside the darkf package use absolute paths into the package, as in the skeleton. A target repo with `@psimona/darkf` as a dependency can import the package name instead: `@psimona/darkf/src/core/index.ts`. Other bare imports do not resolve through node_modules from other directories.

## Runners and the handoff contract

- Use the built-in runners (`claudeCodeRunner`, `opencodeRunner` from `src/kit/agents/`). Never parse agent stdout. The runner injects the event contract into the prompt and reads the handoff JSON file the agent writes.
- The handoff contains only the immediate predecessor result. If Verify must report what Implement did, Verify must relay it in its own output. Nothing carries forward unless each node re-emits it.
- Do not ask the agent to echo events in prose. Describe the event semantics. The runner appends the mechanics.

### Reading an agent claim off the handoff

Agents emit the claim in several shapes: flat at the handoff top level,
nested under `output`, or hybrid — flat claim plus a nested summary block.
Never read `handoff.output ?? handoff`. A truthy `output` without the claim
field shadows a correct flat verdict (run 0a1b2ca3: a passing
`behavior_ok: true` verdict was declared invalid, and the repair loop
tripped the composite's cycle budget on a healthy tree). Scan the
candidates and prefer whichever shape actually carries the claim field:

```ts
const claim = [handoff.output, handoff].find(
  (c) => c != null && typeof (c as Claim).verdict_field === "boolean",
);
```

Pair this with the maxCycles rule above: one false rejection costs a full
repair round, and the budget counts dispatches, not repairs.

## Scripts

A script default export receives `(handoff, info)` and returns a `NodeResult`. `info.rootDir` is the invocation cwd (the target repo). Use it for every repo path so the workflow stays location-independent. `file:` resolves against `<workflow-dir>/scripts/`, not the workflow dir.

## Validate agent output with `outputType`

An agent state accepts an optional `outputType`: a shape check the engine runs against the node's `output` payload, before `validate`. Use it for structure ("does the output have these fields?"), keep `validate` for logic ("is the value acceptable?"). A state may set both. Type runs first, so a `validate` script can read `output.tasks[2].title` without re-checking the shape itself. `outputType` is agent-only: a script's output comes from code you already wrote and control. `validate` stays available on both agent and script states.

### The `OutputSchema` interface

`outputType` is typed `OutputSchema` (`src/core/types.ts`), deliberately narrow and Zod-free:

```ts
export interface OutputSchema {
  safeParse(value: unknown): { success: true } | { success: false; message: string };
}
```

Any schema library with a `.safeParse()` can implement it in a few lines. darkf-core's public types never reference a schema library, so your Zod version can never conflict with darkf's.

### The shipped Zod adapter

darkf ships exactly one adapter, for Zod (`src/kit/validation/zod.ts`):

```ts
import { zodOutputType } from "@psimona/darkf/src/kit/validation/zod.ts";
```

It joins every issue from one failed parse into a single message — `summary: Invalid input: expected string, received number; count: Invalid input: expected number, received string` — so one corrective round names every bad field, not just the first. Valibot or ArkType follow the same two-method shape; write your own, darkf ships no others.

### Schema-first: the schema lives in its own file

Define the Zod schema once in its own file, derive the type with `z.infer`, and export the built adapter value. The workflow definition imports only that value — never Zod directly — and stays what it already is, a plain TypeScript object:

```ts
// workflows/dev-loop/schemas/plan-output.ts
import { z } from "zod";
import { zodOutputType } from "@psimona/darkf/src/kit/validation/zod.ts";

const PlanOutputSchema = z.object({
  summary: z.string(),
  tasks: z.array(z.object({ id: z.string(), title: z.string() })),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export const planOutputType = zodOutputType(PlanOutputSchema);
```

```ts
// workflow.ts
import { planOutputType } from "./schemas/plan-output.ts";

Plan: { type: "agent", prompt: PLAN_PROMPT, outputType: planOutputType, on: { planned: "ValidatePlan" } },
```

A failed check rejects the dispatch as `validation-failed`, with the joined message as the reason. It nudges before it retries: up to three corrective nudges in the same agent session, each fed the message, then a fresh attempt against `retries`. The whole sequence is one node visit — no extra `retries` consumed, no extra `maxCycles` count — but each nudge is still a full dispatch call.

## Three-phase vs. one lane: only plan when planning earns its keep

The two sections below (generate a `TaskList`, walk it with a `Dispatch`
node) describe a three-phase shape: a planning phase that distills a spec
into a list of items, a loop that works through that list one item at a
time, and whatever finishes the run. Treat this as the shape to reach for
when a workflow justifies it, not the default shape for every workflow:

- **Use it** when the spec implies more than one independently-buildable,
  independently-verifiable deliverable, and you can't enumerate them by
  hand at authoring time — the count and shape of the work only become
  known once an agent actually reads the spec. A backend feature with an
  unknown number of files/behaviors to add is the motivating case.
- **Skip it** when the workflow already does one well-defined thing, or a
  small fixed number of known steps you can enumerate yourself while
  writing the workflow. One fix, one script change, one narrowly-scoped
  task — hardcode the lane directly (the Skeleton above: one composite,
  `Implement → Verify → Review`, no `TaskList`, no `Plan`, no `Dispatch`).
  Forcing a planning phase onto a workflow with nothing real to plan adds
  two more dispatches and a loop with nothing to walk, for zero benefit.

The tell: if you can write out every state the graph needs just from
reading the spec's title, skip planning — build that lane directly. If
you can't say in advance how many deliverables the spec implies, that's
exactly what a planning phase is for.

## Keep prompts feature-agnostic

A workflow's `prompt` strings are fixed at authoring time — they cannot read the spec per dispatch. The temptation, once a workflow targets one real feature, is to hand-transcribe spec content straight into the prompt: a deliverables checklist, a review checklist, extracted requirements. Don't. That content drifts the moment the spec changes after the prompt was written, and someone has to hand-rewrite it for every new feature the same workflow file later dispatches.

If a node needs a concrete artifact derived from the spec, add a dedicated pair of steps that generates and persists it, and have every downstream node read what was persisted instead of carrying feature-specific prose in the workflow file:

- **Generating** is almost always an **agent**, not a script — distilling free-form spec prose into a checklist takes judgment. Have it emit the artifact as structured JSON in its own `output`, not as a file it writes itself.
- If the artifact is a plan or task breakdown, don't invent a one-off shape: darkf already has a shared `TaskList`/`Task`/`TaskRequirement` vocabulary (`darkf/src/core/types.ts`) with a hand-written, zero-dep validator (`parseTaskList`) and a canonical location the OpenCode plugin already renders live progress from. Emit that shape, not markdown prose — you get free validation, a `satisfies`-linked requirement/task map (a review checklist falls out of it: for each requirement, is there a `done` task that satisfies it?), and live status in the plugin's "tasks" tab if the runner is `opencodeRunner`.
- **Persisting** is a script, immediately after the generating agent: it validates the candidate (`parseTaskList`, or your own check for a non-TaskList artifact) and writes it to the canonical run-scoped path, `.darkf/run/<runId>/<name>.json` — a script gets `info.rootDir`/`info.runId` to compute that path; a static agent prompt cannot interpolate a per-dispatch `runId`, only a compile-time constant like `FEATURE`. Route an invalid candidate back to the generating step (bounded by the same composite's `maxCycles`, per the Bounded loops rule above), not forward to a node that can't use it.
- Every downstream node's prompt reads the file back by finding the run's own directory — "the directory under `.darkf/run/` with the latest mtime" (there is exactly one active run per dispatch) — the same pattern a run-retrospective step already needs to locate its own journal. Never by the engine handoff, which only ever carries the immediately preceding node's result, and never by pasting the artifact's content into the prompt by hand.
- A review checklist is exactly as spec-specific as a deliverables list, and belongs in the same generated artifact, not hand-copied into the Review prompt either — if you used a `TaskList`, it's the `requirements` array, already there.
- One generating/persisting pair can feed several downstream nodes several hops apart (e.g. the planner feeding both the implementer and a much later reviewer) without anything carrying it through every hop in between — it's a file on disk, not a handoff value, so the "nothing rides along for free" rule doesn't apply to it. `.darkf/` is already gitignored, so nothing here needs its own ignore rule or merge-time cleanup.

## Walk a plan one item at a time, with a dedicated Dispatch node

Once you have a `TaskList` (previous section), don't hand it whole to one agent and ask it to work through every task in a single dispatch. That hides the per-task state inside one agent's own judgment about what it already finished, has no node any run status can point at ("which task is this run on right now?"), and a crash mid-plan loses track of exactly where it was.

This is the `item-loop-convention` shape (a design doc, not shipped `darkf-core`/`kit` code as of this writing; hand-roll its algorithm directly in your own `scripts/` rather than importing a module that doesn't exist yet):

- **Dispatch** (a script) is the node that walks the plan. It reads the persisted `TaskList`, picks the first task whose status is not yet `"done"` (`"pending"` normally; an `"in-progress"` one found on resume means a crash interrupted it — dispatch that same one again, no special case needed), flips it `"in-progress"`, writes the file back, and hands that one task to the next node as its `output`. If every task is `"done"`, route to whatever follows the loop. If any are `"failed"` with none left `"pending"`, that's a distinct blocked outcome, not "exhausted."
- The lane that follows (implement, test, fix, review — whatever one task's own work needs) operates on that single task only. It gets the task directly via the one-hop handoff from Dispatch if it's the very next node; anything further downstream (e.g. a reviewer several hops past Dispatch, past a fix-retry loop) rediscovers the right task by reading the plan file itself and finding the one still `"in-progress"` — never by relying on a value threaded through every intervening node.
- Only flip a task to `"done"` once its result is independently confirmed, not when the implementing step merely claims it finished. If judgment is needed to confirm that (a reviewer checking the claim against the working tree), split it into the judging agent (which never touches the file) and a small script right after it that does the actual write — same agent/script split as everywhere else in this document.
- The lane's last node routes back to Dispatch by its state id — a flat edge, which is fine even across composite boundaries (`buildRegistry` is one flat map keyed by state id; routing doesn't care which composite either side lives in). Dispatch gets re-entered once per task until the plan is exhausted.
- Size `maxCycles` for the composite this loop lives in by hand: `(dispatches per task in the worst case) × (expected task count)`. `WorkflowDef` is static and built before the real task count is known, so there's no way to compute this automatically — that's `item-loop-convention`'s explicit non-goal, not an oversight. A plan that turns out bigger than assumed needs a bigger number.
- This loop and the plan-generation loop from the previous section are usually two separate composites with two separate `maxCycles` budgets, not one — they bound unrelated things (a small, fixed number of generation retries vs. a budget that scales with however many tasks the plan turns out to have), per the Bounded loops rule above.

## Event design

Keep event sets small and semantic: `implemented`/`blocked`, `green`/`red`, `done`/`changes_requested`. Use `DONE` for terminal human gates. A crash is not a verdict. A blocked agent is not a crash either: exit cleanly and let a human re-enter.

### The `disputed` event

Give the implementer a reserved `disputed` event. When a review demand contradicts the spec, the implementer objects and routes `disputed → DONE`. The demand and a spec-grounded rationale go in `output`. The run ends with the disagreement recorded for a human. Compliance must never be the only path.

## Review prompts

Agent-authored extra files are invisible to `git diff`. Every review prompt must say: inspect `git status --porcelain` in addition to `git diff`.

## Verify before you run

From the target repo: `darkf validate <ref>`, then `darkf render <ref>`. The packaged guide is the long form: `docs/guides/write-your-first-workflow.md` inside the darkf package.
