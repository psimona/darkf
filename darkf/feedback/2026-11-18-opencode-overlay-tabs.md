# Run feedback — opencode-overlay-tabs

- Date: 2026-11-18
- Engine/workflow: darkf dev-loop
- Run: d94b3041-616d-4379-8927-99ec6f37a3a8
- Final outcome: succeeded. Squash-merged to master as `fbd5981` "feat: opencode-overlay-tabs (opencode-overlay-tabs)"; branch deleted.
- Scopes: The opencode plugin overlay now has two top-level tabs — a workflows catalog with expandable static state graphs, and a runs list with search, active-first spinner rows, and a two-pane run detail view with back navigation. Eight tasks shipped: five new plugin modules, an overlay.tsx rewrite, a `listWorkflows` export, and three docs pages.

## What worked

- All eight plan tasks completed. Every review approved. Seven of eight tasks passed every gate on the first loop.
- Task order matched dependencies. The `listWorkflows` export landed before the workflows tab reused it. `workflow-graph.ts` landed before the tab that renders it. The `run-view.tsx` extraction landed before the detail view mounted it.
- The export task caught a real hazard. Re-exporting `cli/index.ts` through the public surface would have run CLI dispatch on import. The implement step added an `import.meta.main` guard and proved both entry points still work.
- Checks stayed green at every gate. The core suite passed 289 tests at all eight test phases. The plugin suite grew from 31 to 70 tests with no regressions.
- Each implement step listed its deliberately-untouched leftovers (spinner frames, paging removal). Reviewers could tell gaps from deferrals.
- The one lint failure was repaired with Biome's own safe fixes. No behavior changed.
- The docs phase updated three packaged pages for the two-tab overlay. It correctly left CLI and install docs untouched.

## Failures and root causes

1. Test gate failed after the run-detail-view implementation (task 7 of 8). `bun run lint` reported unsorted imports plus three format diffs in `run-detail.tsx` and `runs-tab.tsx`. Root cause: the implement step did not run Biome on its new files before handoff. Cost: one fix-and-retest cycle, about 1 minute of wall time. No token or cost figures are recorded in the journal.

## Notes

- The root check script's typecheck covers `darkf/` only. The plugin needs its own `tsc --noEmit` and `bun test`. Reviewers re-ran the plugin checks by hand at seven of eight task reviews.
- The Test phase tail shows only core-package output, so a green tail does not prove the plugin suite ran. Consider adding the plugin suite to whatever produces that tail.
- The `import.meta.main` guard on `darkf/src/cli/index.ts` is now load-bearing: `src/exports.ts` re-exports from that module. Do not remove the guard.
- `LiveStore` grew a `tick` signal for the spinner. Test stubs in `band.test.ts` needed a matching field. Expect the same ripple when extending the store interface.
- The runs list renders the full list in a scrollbox. Pagination, windowing, and load-on-scroll are gone by spec decision (r15). Do not reintroduce them.
- The run took about 80 minutes from branch creation to merge, with the plan exhausted in a single dispatch sequence and no replan.
