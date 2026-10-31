# Task-list JSON: one shared type vocabulary for plan/dispatch task lists

An investigation draft whose design decisions were locked (see Decisions
below) and whose implementation shipped via the dev-loop workflow run of
2026-10-31 (see `darkf/feedback/2026-10-31-task-list-json.md`). Two ad-hoc
definitions of
"task list" exist in this ecosystem today, and a third consumer (the
OpenCode TUI plugin) needs the same shape for rendering. This spec proposes
one set of shared types in `darkf`'s core vocabulary, so plan/dispatch
workflows, the item-loop helper, and visualizations all speak the same
JSON.

## Decisions

Locked 2026-10-31 by decision walkthrough:

- **Validation: hand-written `parseTaskList`.** `parseTaskList(json: unknown):
  TaskList | { error }` in darkf core, zero deps. The item-loop path must not
  crash on malformed lists, and the plugin shares the same validator.
- **Colocation: `.darkf/run/<runId>/tasks.json` is the canonical location.**
  The run generates the plan, so the task list is written there — not copied
  there. Plugin discovery joins the run root (via `locate.ts`) to this file.
  Project-level `tasks.json` (the `task-queue` example) becomes a legacy
  alternate shape, not the convention the plugin targets.
- **Consumer repo migrates to the standard.** Tasks use `satisfies` and
  lowercase MoSCoW (`"must"`); the consumer repo's plan phase adopts these
  via a one-shot script. It has exactly one writer and the plugin has no
  legacy readers, so no dual-schema tolerance in the validator.

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

None — all resolved, see Decisions above. The former open questions
(validation depth, colocation, consumer migration) are decided there.

## Plugin visualization: Workflow and Tasks tabs

With a run's task list canonical at `.darkf/run/<runId>/tasks.json` (see
Decisions), the OpenCode TUI plugin's overlay dialog (`overlay.tsx`) grows
a tab bar. Today it renders one "plan" pane (the workflow graph) above a
supervisor pane:

```
┌─ Dialog ──────────────────────────────────────────┐
│ workflow │ tasks 3/9                              │
│ ┌ workflow graph (today's "plan" pane) ─────────┐ │
│ │ ...                                           │ │
│ └───────────────────────────────────────────────┘ │
│ ┌ supervisor (shared by both tabs) ─────────────┐ │
│ └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

- **Tab "workflow"** — today's `PlanGraph`, unchanged, just rehomed under a
  tab. The scrollbox's `title="plan"` goes away; the tab bar names it.
- **Tab "tasks nn/mm"** — the title always carries `done/total`, so the
  tab strip itself is the progress bar; the run advances a visible counter
  even while the user never opens the tab. The pane renders the run's
  `TaskList`, read from `<rootDir>/.darkf/run/<runId>/tasks.json` and
  narrowed by `parseTaskList`.
- **Supervisor pane** — run-level, not view-level; stays below, shared.
- **Data path** — `store.ts` reads the file on its existing 1s poll and
  adds an `fs.watch` next to the journal watcher; `digest.ts` grows a
  `TaskListView` next to `PlanView`. No new dependency, no new loop.
- **Switching** — keys `1`/`2` and clicking a tab title; "workflow" is the
  default so auto-open behavior is unchanged.

### Decisions (plugin UI)

Locked 2026-10-31 by decision walkthrough:

- **Row contents.** Base row is `<glyph> <id> <title>`; must-priority tasks
  get a `!` before the title. Only the active task carries a second, dim
  line with its `satisfies` links (`↳ REQ-1, REQ-4`). Full detail stays in
  the JSON.
- **Glyph/color mapping.** `○` pending (default fg) · `●` in-progress
  (accent, bold — same as the workflow view's active node) · `✓` done
  (dim, title text also dims) · `✗` failed (error). The dot pair stays
  reserved for "where the run is" across both tabs; `✓`/`✗` say terminal
  state and read in monochrome. Only `accent`/`error`/default/dim are
  used — no theme colors beyond what the plugin already touches.
- **Counter.** Strict `done/total`: `nn` counts `done` only; pending,
  in-progress, and failed all count as not-done. Tab hidden entirely when
  `tasks.json` is absent; shown with a `?` counter and the `parseTaskList`
  error inline when the file exists but is invalid.
- **Current-task highlight.** The file's `in-progress` status is
  authoritative — the plugin renders what `tasks.json` says, no journal
  join (that was the pre-amendment colocation recommendation; see
  Decisions above). Freshness is the writer's responsibility; the
  workflow stall warning covers the stale-row case.
