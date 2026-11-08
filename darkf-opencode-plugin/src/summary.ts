import { EXIT } from "@psimona/darkf/src/core/index.ts";
import type { LiveStore } from "./store.ts";

// Same vocabulary `darkf status`/`darkf monitor` already use (see
// darkf-cli/src/index.ts's `printTransition`) — one way to say "what state
// is this run in," not a second one invented for this band. Active runs
// come from `pickerCandidates`' classification, never from `views()` —
// since picker-all-runs that map holds every run ever recorded, and the
// band must not count finished ones (or bury the one live run's real
// status under a count). Plain module, not `band.tsx`: unit-testable
// without loading the TUI JSX runtime.
export function summaryLine(store: LiveStore): string {
  const activeIds = store
    .pickerCandidates()
    .filter((c) => c.active)
    .map((c) => c.entry.runId);
  if (activeIds.length === 0) return "";
  if (activeIds.length > 1) return `${activeIds.length} darkf runs active`;

  const view = store.views().get(activeIds[0]!);
  if (view === undefined) return "";
  if (view.workflowError) return `darkf: workflow definition error — ${view.workflowError}`;
  if (view.stall) return `darkf: ${view.stall}`;
  if (view.crash) {
    return `darkf: crashed — ${JSON.stringify(view.crash.reason)} (attempt ${view.crash.attempt})`;
  }
  if (view.current === null) return "darkf: starting…";
  if (view.current.state === EXIT) return "darkf: finished";
  const { state, phase, startedAt } = view.current;
  const elapsed =
    startedAt !== undefined ? `, ${Math.round((Date.now() - startedAt) / 1000)}s` : "";
  return `darkf: ${state} (${phase}${elapsed})`;
}
