# Task-list JSON: one shared type vocabulary for plan/dispatch task lists

An investigation draft, not yet a decision. Two ad-hoc definitions of
"task list" exist in this ecosystem today, and a third consumer (the
OpenCode TUI plugin) needs the same shape for rendering. This spec proposes
one set of shared types in `darkf`'s core vocabulary, so plan/dispatch
workflows, the item-loop helper, and visualizations all speak the same
JSON.

## Problem

The consumer repo's build-backend workflow (its `plan/` phase) writes a
`tasks.json` with requirement-level structure:

```json
{
  "id": "ips-csv-load",
  "spec": { "prd": "...", "design": "..." },
  "requirements": [
    { "id": "REQ-1", "kind": "req", "text": "...", "moscow": "Must" }
  ],
  "tasks": [ { "id": "T-1", "requirements": ["REQ-1"], "title": "...", "status": "pending" } ]
}
```

This repo's `examples/task-queue` scripts define their own minimal shape:

```ts
interface Task {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "done";
}
```

Same concept, two schemas, zero shared validation. The OpenCode TUI plugin
wants to render a run's task list — progress, current item, stalls — and
today must guess which schema it is looking at, or render nothing.

## Goals

- One `TaskList` type family in `darkf/src/core/types.ts` (vocabulary, not
  machinery), covering: the list envelope, per-task status, task-to-
  requirement links, and MoSCoW priority.
- Both existing shapes either validate against it or have an explicit,
  tiny migration path.
- The OpenCode plugin reads a `tasks.json` colocated with the run's
  `.darkf/run/<runId>/` artifacts (or the project-level one) and renders
  status without importing consumer code.

## Non-goals

- Making darkf manage task lists (no CRUD commands, no locking semantics
  beyond what `item-loop.ts` already defines).
- Genericizing to arbitrary board shapes (columns, assignees, sprints).
- Requiring workflows to use task lists at all — plain agent/script graphs
  stay first-class.

## Design sketch

```ts
export type TaskStatus = "pending" | "in-progress" | "done" | "failed";
export type TaskPriority = "must" | "should" | "could" | "won't";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** Requirement ids this task satisfies, when the list carries requirements. */
  satisfies?: string[];
  priority?: TaskPriority;
}

export interface TaskRequirement {
  id: string;              // "REQ-1", "NFR-2", "NG-1"
  kind: "req" | "nfr" | "ng";
  text: string;
  priority?: TaskPriority;
}

export interface TaskList {
  id: string;
  /** Paths to the spec documents the tasks implement, when present. */
  spec?: { prd?: string; design?: string };
  requirements?: TaskRequirement[];
  tasks: Task[];
}
```

Deliberate choices to challenge: status `failed` is new (the consumer repo
uses `pending`-requeue instead); `satisfies` replaces the consumer's
task-side `requirements` array name; MoSCoW drops to lowercase union
members. `item-loop-convention` (`item-loop.ts`, born in `src/kit/`) is the
first in-repo consumer: its crash-safe "next pending item" pick operates on
`TaskList` directly, and the plugin gets `foldTaskList` alongside
`foldJournal` in `src/kit/status.ts` — a pure function returning counts,
current item, and stall state for rendering.

## Open decisions

- **Validation depth.** A `parseTaskList` that narrows unknown JSON to
  `TaskList | error` (hand-written, zero deps) versus trusting the writing
  workflow. The item-loop path must not crash on malformed lists — a small
  hand-rolled validator is probably the whole cost.
- **Colocation convention.** Project-level `tasks.json` (today) versus a
  per-run copy under `.darkf/run/<runId>/` (resume-safe, per the
  resume-from-journal draft). Recommendation: project-level stays the
  source of truth; the run journal's task events carry item ids, and the
  plugin joins the two.
- **Does the consumer repo migrate?** Its `requirements` field name and
  `"Must"`-capitalized MoSCoW differ from this proposal. Its workflow is
  the only writer, so migration is one script — but it is outside this
  repo's control.
