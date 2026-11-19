/** @jsxImportSource @opentui/solid */

import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { createSignal, Show } from "solid-js";
import type { PlanView } from "./digest.ts";
import { PlanGraph, SupervisorPanel, TaskPane } from "./run-view.tsx";
import { RunsTab, runTitle } from "./runs-tab.tsx";
import type { LiveStore } from "./store.ts";

// The `runs` tab's detail view (docs/specs/opencode-overlay-tabs/spec.md):
// selecting a run in the list swaps the tab to a two-pane view — left
// `PlanGraph` (the active node highlighted), right `TaskPane` (present once
// tasks.json exists) — with today's `SupervisorPanel` below, unchanged
// (r6/r11). Which run, if any, is selected is the tab's own tab-local state
// (r7): a signal here, independent of the `workflows`/`runs` selector — back
// returns to the list instead of closing the overlay. The panes themselves
// live in `run-view.tsx` (their own module for the same import-cycle reason
// `toggle-tab.tsx` split out); this module composes them and owns the view
// chrome — back, title, and the layout toggle.

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

/** The pane row's two layouts (r11). `side-by-side` is the default: two fixed
 *  columns, never reflowed by terminal width — the split is deliberate, not
 *  measured (overlaySize() is not consulted here). */
export type DetailLayout = "side-by-side" | "stacked";

/** The flex direction the pane row takes for a layout (r11): the manual
 *  toggle swaps the row between side-by-side and stacked top-bottom. */
export function layoutDirection(layout: DetailLayout): "row" | "column" {
  return layout === "side-by-side" ? "row" : "column";
}

/** One run's detail view (r6/r11): a header line (back, title, layout
 *  toggle), the two-pane row inside its own scroll region, and the supervisor
 *  panel below — mounted unconditionally, its own internal `Show` still
 *  renders nothing while no supervisor session is bound. `onBack` is the
 *  list return (r7); the caller owns the selected-run signal. */
export function RunDetail(props: {
  runId: string;
  store: LiveStore;
  accent: RGBA;
  errorColor: RGBA;
  onBack: () => void;
}): JSX.Element {
  // The same maps the list reads — `views()` holds every registry run, so a
  // past run's graph renders exactly like a live one's.
  const view = () => props.store.views().get(props.runId);
  const taskView = () => props.store.taskViews().get(props.runId);
  const title = () => {
    const entry = props.store
      .pickerCandidates()
      .find((candidate) => candidate.entry.runId === props.runId)?.entry;
    return entry ? runTitle(entry) : props.runId;
  };

  // r11: the split is fixed until the user flips it. Not persisted — the
  // overlay keeps no state across a close/reopen (same as the list's filter).
  const [layout, setLayout] = createSignal<DetailLayout>("side-by-side");

  // Manually clicked-open composite paths, read by `PlanGraph` — the same
  // shape the old run-scoped dialog carried, now scoped to this detail view.
  const [manualOpen, setManualOpen] = createSignal<ReadonlySet<string>>(new Set());
  const isOpen = (path: string) => manualOpen().has(path);
  const toggleOpen = (path: string): void => {
    setManualOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={2}>
          {/* r7: back goes to the list — the host dialog's Escape would close
              the whole overlay, which is exactly what back must not do. */}
          <box onMouseDown={() => props.onBack()}>
            <text attributes={BOLD}>← back</text>
          </box>
          <text attributes={DIM}>{title()}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text
            fg={layout() === "side-by-side" ? props.accent : undefined}
            attributes={layout() === "side-by-side" ? BOLD : undefined}
            onMouseDown={() => setLayout("side-by-side")}
          >
            side-by-side
          </text>
          <text attributes={DIM}>│</text>
          <text
            fg={layout() === "stacked" ? props.accent : undefined}
            attributes={layout() === "stacked" ? BOLD : undefined}
            onMouseDown={() => setLayout("stacked")}
          >
            stacked
          </text>
        </box>
      </box>
      <scrollbox flexGrow={1} minHeight={0} scrollY border>
        {/* The auto-open can fire a tick ahead of the store's first view for
            the run (same placeholder the old run-scoped dialog showed). A run
            picked from the list is already in the map, so this is never seen
            for it. */}
        <Show when={view()} fallback={<text attributes={DIM}>loading run…</text>}>
          {(resolved: () => PlanView) => (
            <box flexDirection={layoutDirection(layout())} gap={2}>
              <box flexDirection="column" flexGrow={1}>
                <PlanGraph
                  view={resolved()}
                  accent={props.accent}
                  errorColor={props.errorColor}
                  isOpen={isOpen}
                  toggleOpen={toggleOpen}
                />
              </box>
              {/* `TaskPane` takes `undefined` fine — the absent state (no
                  tasks.json yet) renders nothing, so the right pane appears
                  as soon as the file exists (r6). */}
              <box flexDirection="column" flexGrow={1}>
                <TaskPane view={taskView()} accent={props.accent} errorColor={props.errorColor} />
              </box>
            </box>
          )}
        </Show>
      </scrollbox>
      {/* r11: below the row, unconditionally — today's panel and its
          scrollbox, unchanged from the old dialog. */}
      <scrollbox
        flexGrow={0}
        flexShrink={0}
        height="auto"
        minHeight={1}
        maxHeight="33%"
        scrollY
        border
        title="supervisor"
      >
        <Show when={view()}>
          {(resolved: () => PlanView) => <SupervisorPanel view={resolved()} />}
        </Show>
      </scrollbox>
    </box>
  );
}

/** The `runs` tab's content: the list until a run is selected, then that
 *  run's detail view. The selection is the tab's own tab-local state (r7) —
 *  a signal here, independent of the `workflows`/`runs` selector, seeded by
 *  `initialRunId` (the run an auto-open observed) and cleared by the detail
 *  view's back control. Not persisted: reopening the overlay starts from the
 *  list again, like every other in-dialog state. */
export function RunsTabContent(props: {
  store: LiveStore;
  initialRunId?: string;
  accent: RGBA;
  errorColor: RGBA;
}): JSX.Element {
  const [selectedRunId, setSelectedRunId] = createSignal<string | undefined>(props.initialRunId);
  return (
    <Show
      when={selectedRunId()}
      fallback={<RunsTab store={props.store} accent={props.accent} onSelect={setSelectedRunId} />}
    >
      {(runId: () => string) => (
        <RunDetail
          runId={runId()}
          store={props.store}
          accent={props.accent}
          errorColor={props.errorColor}
          onBack={() => setSelectedRunId(undefined)}
        />
      )}
    </Show>
  );
}
