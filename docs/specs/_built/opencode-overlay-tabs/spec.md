# darkf-opencode-plugin: workflows + runs overlay (IMPLEMENTED)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/tabbed-overlay-views.md`.

**Reframed 2026-11-18, superseding this draft's earlier three-tab sketch
(current-run/search/journal).** The user's own framing, verbatim:

> workflows: lists all workflows can expand each to explore the full tree
> of each workflow incl outgoing edges. enter an edge begins the active
> navigation to that node. this view is default when opening the plugin
> with no active run
>
> runs: shows all runs with date and title searchable. when a run is
> active this tab is shown with the detail view of a run, left the
> workflow with the current active node right as soon as it exists the
> plan tree with the status. its possible to navigate back to the run
> overview where the active runs are displayed on top with a spinner and
> below all others

## Problem

Today's overlay (`overlay.tsx`) is a dialog bound to exactly one run (or,
with no `runId`, a separate native `ui.dialog.select` picker stacked on
top — `pickRun`). Once bound, it shows a two-tab strip scoped to *that run
only*: `workflow` (the run's live plan tree, `PlanGraph`) and `tasks`
(`TaskPane`, hidden until `tasks.json` exists). There is no way to browse
workflow *definitions* independent of a run, and the picker is a second,
disconnected dialog rather than a tab inside the same surface.

## Decisions

Locked 2026-11-18, from the user's framing above. Implementation
grounding (this session, read from source, not assumed) follows each one.

- **Two top-level tabs: `workflows` and `runs`.** Replaces today's
  run-scoped `workflow`/`tasks` strip and this draft's earlier
  current-run/search/journal sketch. The journal-log tab from that sketch
  is dropped from scope — not mentioned in the new framing; revisit later
  as its own ticket if still wanted.
- **`workflows` tab: a catalog of workflow *definitions*, not runs.** Each
  entry expands to the full static state graph — every node and its
  outgoing edges — not the run-scoped progress tree `PlanGraph` renders
  today (which only ever shows containment, `active`/`visits` on a bound
  run's nodes, never edges). The edge data this needs already exists and
  is already walked once, just never rendered in the TUI: `StateDef.on`
  (event → target id map) and `StateDef.next` (fallback target), walked by
  `darkf/src/core/mermaid.ts`'s `walk()` to emit Mermaid syntax. The
  workflows tab needs the same traversal, feeding a TUI tree instead of a
  Mermaid string — `renderMermaid`/`renderActive` themselves are not
  reusable as-is (string output), but the walk pattern is.
  `isComposite`/`DONE`/`FAILED` target handling carries over unchanged.
- **This tab is the default view when the overlay opens with no active
  run.** Replaces today's behavior where no-`runId` opens a *second*
  stacked native dialog (`pickRun`'s `ui.dialog.select`). Resolves the
  `tabbed-overlay-views` ticket's own open fog item (whether a tab's own
  picker needs to stack a second dialog) in the negative: no second
  dialog anywhere in this design — the workflows catalog and the runs list
  are both inline content inside the one tab-container dialog.
- **`runs` tab, default content: every run, with date + title, with a
  search box.** This is `opencode-search-candidates/spec.md`'s
  already-decided data source and sort — `listEntries` unfiltered,
  `(isActive, startedAt) desc`, `●`/`○` — but rendered as inline tab
  content with its own filter input, not `pickRun`'s native
  `ui.dialog.select` (which has no search box at all today; filtering, if
  any, is whatever the host's own select widget provides, unconfirmed).
  This also retires `pickRun` and its `NEXT_PAGE` synthetic paging row —
  see the no-paging decision below.
- **Selecting a run switches the `runs` tab to a two-pane detail view.**
  Left pane: the workflow graph with the current active node highlighted
  — this is exactly today's `PlanGraph`/`PlanView` (`digest.ts`'s
  `buildPlanView`, `active`/`isCurrentLeaf` already computed from
  `foldJournal` + `buildRegistry`), unchanged. Right pane: the plan/task
  tree with status — exactly today's `TaskPane`/`TaskListView`
  (`buildTaskListView`), which already degrades to "appears once
  `tasks.json` exists" (today's `absent` state) — matching "right, as
  soon as it exists" directly, no new state needed.
- **Back navigation returns to the runs-tab list**, not closing the
  overlay — a new piece of tab-local state (which run, if any, is
  selected within the `runs` tab), independent of the `workflows`/`runs`
  tab selector itself.
- **Run overview ordering: active runs on top, each with a spinner;
  inactive below.** The active/inactive split and sort already exist
  (`pickerOrder`'s `(isActive, startedAt) desc` already puts active
  first); the spinner itself is new — nothing in this plugin renders an
  animated glyph today (today's `●` is static, not a spinner).

Locked 2026-11-18 by grill walkthrough (second pass, resolving every item
this draft's own Open questions previously listed):

- **Workflow discovery: export and reuse, don't re-scan.** The scan
  convention isn't fog — it already exists and is already load-bearing:
  `darkf/src/cli/index.ts`'s `listWorkflows()` (lines 136–154) walks two
  roots, `<project>/darkf/<name>/workflow.ts` (workspace) and
  `<darkf-package>/workflows/<name>/workflow.ts` (built-in, e.g.
  `dev-loop`, `series-ordering`), and `resolveWorkflowDir` already resolves
  `darkf run <name>` against the same two roots. It's just private to the
  CLI module today. Export `listWorkflows` and its `WorkflowListing` type
  from the package's public surface; the `workflows` tab imports and
  reuses it rather than re-implementing the same two-root scan
  independently (which would drift the moment either definition changes).
  The plugin still does its own `import()` per listed entry — `listWorkflows`
  only returns `{ name, source }`, not a loaded `WorkflowDef`.
- **Edge-select semantics: UI focus only, no dispatch.** Selecting an edge
  in the static catalog tree moves the browser's cursor/expand-focus to
  the target node; it never starts a run. Matches the tab's own defining
  condition ("no active run") — a selection that silently launched a run
  from a read-only catalog view would be a materially different, bigger
  feature nothing else here asks for.
- **Detail-view layout: fixed two-column split, not width-driven; manual
  toggle to stack.** The top row is two fixed columns — workflow pane
  (left, current active node highlighted) and plan/task pane (right) —
  not reflowed by `overlaySize()`/terminal width (deliberately simpler to
  test than a measured-width branch). A manual, user-triggered toggle
  swaps that row between side-by-side and stacked top-bottom. Below the
  row, unconditionally, a second line: the supervisor-output panel
  (today's `SupervisorPanel`, unchanged — just now explicit in this
  layout rather than assumed).
- **Run "title": `message`, then workflow name, then `runId`.**
  `RegistryEntry.message?: string` already exists (`darkf/src/kit/registry.ts:18`
  — the free-text override passed at `darkf run <dir> [message]` time) and
  is the best available human description. Title = `entry.message` if
  set, else `workflowDir`'s basename, else the bare `runId` — same
  degrade-gracefully precedent as `supervisorViewFor`.
- **Search box scope: the displayed title, plus always `runId`.** Matches
  whichever of `message`/workflow-name/`runId` resolved as the shown
  title, and always matches `runId` too, so a run stays findable by id
  even when a message or workflow name is shown instead.
- **Spinner mechanics: piggyback the existing poll tick, no new timer.**
  No spinner primitive exists in the installed `@opentui/core` (0.9.1,
  checked) type surface. `store.ts`'s `setInterval(..., POLL_MS /* 1000 */)`
  (`store.ts:209`) already re-renders reactive picker state once a
  second — derive the spinner frame from a counter incremented once per
  that same tick, cycling a small glyph set (e.g. `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) on active
  rows only.
- **Paging: dropped. No windowing or incremental load either.** The full
  sorted + filtered list renders inside a `scrollbox`, same as every
  other list in this plugin (`PlanGraph`'s tree, `TaskPane`'s rows) — no
  pagination, no viewport windowing, no load-on-scroll for v1.
  `@opentui/core` (0.9.1) has no virtualized scrollbox, and nothing
  elsewhere in the plugin windows its lists; building one would be new,
  speculative complexity. `pickerPage`/`PICKER_PAGE_SIZE`/`NEXT_PAGE`
  retire along with `pickRun` itself. Revisit only if real usage shows the
  registry's unbounded, unpruned history (no retention policy exists —
  still flagged, unresolved, in `opencode-search-candidates/spec.md`)
  makes rendering visibly slow — same "defer until observed pain"
  precedent `compact-expanded-sizing` already set for content-level
  compactness.

## Non-goals

- The full-journal-event-log tab from this draft's earlier sketch —
  dropped from scope per the reframing above, not resolved either way.
- The tiled multi-run grid (`docs/specs/opencode-overlay-tiles/spec.md`)
  — a different feature (viewing N runs' detail panes at once). "Active
  runs on top with a spinner" in the run overview *list* is not that grid
  and doesn't resolve any of that spec's open questions; both efforts
  stay independent.
- Workflow *editing* — the workflows tab is read-only exploration of
  existing `WorkflowDef`s, not an authoring surface.

## Open questions

None remain. The residual item from the second grill pass —
whether `run-session-panels` belongs in this detail view — is resolved:
**kept separate, not bundled into this effort.** The detail view's second
line ships with today's lightweight, live-only `SupervisorPanel`
unchanged (status + last-message synopsis, bound session only).
`run-session-panels` (durable supervisor info across past runs, reopen
action, plus the new agent-dispatch-session panel — the session a
workflow's own leaf dispatch spawned to do the step's work, distinct from
whoever invoked `darkf start`/`run`) stays its own independently-shippable
ticket, same scope the roadmap already gave it. It's a drop-in upgrade to
the same second line later, not a redesign of it — nothing here needs to
change to accommodate it when it ships. Ready to build.

## Relationship to other drafts

- `docs/specs/opencode-search-candidates/spec.md` — its `darkf-cli`/
  `darkf-core` design (the schema/env-signal split, `foldJournal`
  `sessionId` passthrough) is unaffected and already shipped
  (`durable-run-session-schema`, `picker-all-runs` per the roadmap map).
  Its plugin-side picker design (unfiltered `listEntries`, sort, `●`/`○`,
  paging) is the `runs` tab's starting data source, per Decisions above —
  but its render target changes from a native `ui.dialog.select` to
  inline tab content, which retires that spec's own "tab-container UI
  this picker eventually moves into" non-goal note: it has now moved.
  The **run-session-panels** slice (the two session panels: agent-dispatch
  + supervisor) still applies to the `runs` tab's detail view as
  additional content alongside the left/right split above — not
  superseded, just not mentioned in the user's own framing; confirm
  whether it's still wanted there.
- `docs/specs/opencode-overlay-tiles/spec.md` — independent, see
  Non-goals above.
