/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { createSignal, Show } from "solid-js";
import type { PlanView, TaskListView } from "./digest.ts";
import { PlanGraph, SupervisorPanel, TaskPane } from "./run-view.tsx";
import { RunsTab, runTitle } from "./runs-tab.tsx";
import type { LiveStore } from "./store.ts";
import { TileGrid } from "./tile-grid.tsx";
import { tileRunIds } from "./tiles.ts";

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
 *  measured. */
export type DetailLayout = "side-by-side" | "stacked";

/** The flex direction the pane row takes for a layout (r11): the manual
 *  toggle swaps the row between side-by-side and stacked top-bottom. */
export function layoutDirection(layout: DetailLayout): "row" | "column" {
  return layout === "side-by-side" ? "row" : "column";
}

/** One run's detail view's body (decision 10): the two-pane row inside its
 *  own scroll region — left `PlanGraph` (the active node highlighted),
 *  right `TaskPane` (present once tasks.json exists) — and today's
 *  `SupervisorPanel` below, unchanged (r6/r11). Extracted from `RunDetail`
 *  so the region-focused tile renders exactly this body — the full detail
 *  view inside the still-visible grid — instead of restating it: the
 *  header chrome (`← back`, the layout toggle) is the list↔detail view's,
 *  not a tile's. `layout` sets the pane-row direction; the tile takes the
 *  default side-by-side. Manually clicked-open composite paths are this
 *  body's own state — each mounted body (list detail, tile) toggles its
 *  own. */
export function RunDetailBody(props: {
  view: PlanView | undefined;
  taskView: TaskListView | undefined;
  accent: RGBA;
  errorColor: RGBA;
  layout?: DetailLayout;
}): JSX.Element {
  // Manually clicked-open composite paths, read by `PlanGraph` — the same
  // shape the old run-scoped dialog carried, now scoped to this body.
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
      <scrollbox flexGrow={1} minHeight={0} scrollY border>
        {/* The auto-open can fire a tick ahead of the store's first view for
            the run (same placeholder the old run-scoped dialog showed). A run
            picked from the list is already in the map, so this is never seen
            for it. */}
        <Show when={props.view} fallback={<text attributes={DIM}>loading run…</text>}>
          {(resolved: () => PlanView) => (
            <box flexDirection={layoutDirection(props.layout ?? "side-by-side")} gap={2}>
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
                <TaskPane
                  view={props.taskView}
                  accent={props.accent}
                  errorColor={props.errorColor}
                />
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
        <Show when={props.view}>
          {(resolved: () => PlanView) => <SupervisorPanel view={resolved()} />}
        </Show>
      </scrollbox>
    </box>
  );
}

/** One run's detail view (r6/r11): a header line (back, title, layout
 *  toggle) over `RunDetailBody` — the pane row and supervisor panel.
 *  `onBack` is the list return (r7); the caller owns the selected-run
 *  signal. */
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

  // The detail view's own keys (spec:
  // docs/specs/opencode-overlay-tiles/spec.md — Cross-Component Contracts,
  // keymap-region-participation): this view's own `keymap.layer`, scoped to
  // this mount — live only while the detail view is what the content area
  // shows (the container's `Show` unmounts it with the view), the same
  // "layer disposes with its owner" shape the runs list's layer already
  // relies on. `mode: "global"`, not a custom mode name — see overlay.tsx's
  // `OverlayContent` doc comment for why a custom mode never activates from
  // dialog/panel-hosted content. No `tab` binding: the panel container owns
  // the region cycle (`darkf.region.next` in overlay.tsx) — the cycle order
  // and its current region are the container's, and this view participates
  // in that order by carrying only its own keys. The one key the view
  // carries is the r11 toggle's keyboard twin — `space`, not `return`:
  // `return` is globally claimed by the host's default `input.submit`
  // binding and never reaches a layer when nothing editable has focus
  // (confirmed live; nothing here is an editor — see workflows-tab.tsx's
  // layer note), while `space` is confirmed to reach global-mode layers
  // from panel content. `escape` stays unbound here by decision 11: close
  // is the container's key (`darkf.panel.close` in overlay.tsx), and
  // whether that binding wins dispatch on a live panel stays unverified
  // until checked live.
  const context = usePlugin();
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "darkf.detail.layout",
        title: "Toggle layout",
        group: "darkf",
        bind: "space",
        run: () => {
          setLayout((prev) => (prev === "side-by-side" ? "stacked" : "side-by-side"));
        },
      },
    ],
    bindings: ["darkf.detail.layout"],
  }));

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
      <RunDetailBody
        view={view()}
        taskView={taskView()}
        accent={props.accent}
        errorColor={props.errorColor}
        layout={layout()}
      />
    </box>
  );
}

/** The `runs` tab's content, in precedence order: the tile grid while any
 *  active run exists (spec:
 *  docs/specs/opencode-overlay-tiles/spec.md — decisions 2 and 9: tiling is
 *  what the runs view does, not a bolted-on third view; every
 *  currently-active run tiles automatically each poll tick), falling back
 *  to the plain runs list once no tiles remain — the content area's own
 *  default (Runtime View) — and from the list into a selected run's detail
 *  view as before. Tiling takes precedence over the list↔detail selection:
 *  the detail view is what a region-focused tile promotes to (decision 10 —
 *  the grid renders that promotion in place, `tile-grid.tsx`), not
 *  something the grid steps aside for. The selection still survives a
 *  tiled stretch — its fallback renders again when the last active run
 *  finishes and the grid empties. The selection itself is container-held
 *  (`selectedRunId`/`onSelectRun` props, not a signal here): the panel
 *  container needs the same three-way fact this component renders — grid,
 *  list, or detail — to decide which of them is the content region's native
 *  focus holder (overlay.tsx's region box, decision 6). `contentFocused` is
 *  that container-side verdict for the plain list: the content region is
 *  current, the panel owns input, and the list's filter input is therefore
 *  the region's native focus holder (runs-tab.tsx explains the input side).
 *  The panel input is here only to hand the grid its reactive `width`; the
 *  list and detail view need nothing from it. */
export function RunsTabContent(props: {
  store: LiveStore;
  panel: PanelInput;
  selectedRunId: string | undefined;
  contentFocused: boolean;
  onSelectRun: (runId: string | undefined) => void;
  accent: RGBA;
  errorColor: RGBA;
}): JSX.Element {
  // Re-derived per poll tick from the same active-classification
  // `pickerCandidates` already computes (decision 9) — no extra store
  // field, no open/close bookkeeping here. Reads the panel-open signal
  // inside `tileRunIds`, so this stays the plain list whenever the panel
  // is closed, whatever the registry says is active.
  const tiles = () => tileRunIds(props.store);
  return (
    <Show
      when={tiles().length > 0}
      fallback={
        <Show
          when={props.selectedRunId}
          fallback={
            <RunsTab
              store={props.store}
              contentFocused={props.contentFocused}
              onSelect={props.onSelectRun}
            />
          }
        >
          {(runId: () => string) => (
            <RunDetail
              runId={runId()}
              store={props.store}
              accent={props.accent}
              errorColor={props.errorColor}
              onBack={() => props.onSelectRun(undefined)}
            />
          )}
        </Show>
      }
    >
      <TileGrid
        store={props.store}
        panel={props.panel}
        accent={props.accent}
        errorColor={props.errorColor}
      />
    </Show>
  );
}
