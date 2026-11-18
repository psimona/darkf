/** @jsxImportSource @opentui/solid */
import { type Plugin, usePlugin } from "@opencode/plugin/tui";
import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { createSignal, onCleanup, Show } from "solid-js";
import { RunsTabContent } from "./run-detail.tsx";
import type { LiveStore } from "./store.ts";
import { ToggleTab } from "./toggle-tab.tsx";
import { WorkflowsTab } from "./workflows-tab.tsx";

const BOLD = createTextAttributes({ bold: true });

// Module-level, not component-local — `openOverlay`/`closeOverlay` are called
// from `toggle.tsx`'s slot handler and `tui.tsx`'s auto-open/command, none of
// which sit inside this module's own render tree. `undefined` = not
// initialized (setup hasn't run); once set, open state lives entirely in the
// host dialog (an open host dialog = open overlay). Same "plugin-owned,
// in-memory, not persisted" shape `locate.ts`'s `bindings` map already uses.
let registered: { context: Plugin.Context; store: LiveStore } | undefined;

/** Captures the context and store the overlay opens against. Called once
 *  from `setup`; before it runs, `openOverlay`/`closeOverlay` no-op. */
export function initOverlay(context: Plugin.Context, store: LiveStore): void {
  registered = { context, store };
}

/** Compact under ~100 cols (narrow terminal / mobile), expanded otherwise.
 *  Unknown or 0 width also compacts — the content is fluid, so medium never
 *  breaks, while xlarge can overflow a host that never reported a width.
 *  Read at open time only: a mid-session terminal resize doesn't reflow an
 *  open overlay (see spec: docs/specs/_built/opencode-overlay-sizing/spec.md). */
function overlaySize(): "medium" | "xlarge" {
  const width = registered?.context.renderer.width ?? 0;
  return width >= 100 ? "xlarge" : "medium";
}

/** The tab the overlay opens on (r3): `workflows` — the catalog of workflow
 *  definitions — unless a specific run was asked for, which lands on `runs`.
 *  Every no-`runId` open (`/darkf`, the footer toggle with no bound run)
 *  therefore opens with no run context at all: the catalog, not the stacked
 *  `pickRun` dialog this replaces. */
export function initialTab(runId?: string): "workflows" | "runs" {
  return runId !== undefined ? "runs" : "workflows";
}

/** Opens the overlay: one dialog hosting the `workflows`/`runs` tab container
 *  (r1). `runId` — auto-open and the footer toggle's bound run — selects the
 *  `runs` tab; without one the `workflows` catalog is the default (r3). Never
 *  touches the router — the overlay is a host dialog (see spec:
 *  docs/specs/_built/opencode-overlay-dialog/spec.md). Safe to call whether
 *  or not the overlay is already open; showing over the active dialog
 *  replaces it (and re-reads the terminal width — a re-open is a new open).
 *  There is no second dialog anywhere (r4): both tabs are inline content in
 *  this one container. */
export function openOverlay(runId?: string): void {
  const host = registered;
  if (!host) return;
  host.context.ui.dialog.show(() => <OverlayContent store={host.store} runId={runId} />);
  host.context.ui.dialog.set({ size: overlaySize() });
}

export function closeOverlay(): void {
  registered?.context.ui.dialog.clear();
}

// The top-level tab strip (r1): `workflows │ runs`, replacing the run-scoped
// `workflow/tasks` strip the dialog used to carry when bound to one run.
// Both tabs are unconditional — unlike the old `tasks` tab (hidden until
// tasks.json existed), a tab never disappears here.
function TabBar(props: {
  active: "workflows" | "runs";
  accent: RGBA;
  onSelect: (tab: "workflows" | "runs") => void;
}): JSX.Element {
  return (
    <box flexDirection="row" gap={1}>
      <text
        fg={props.active === "workflows" ? props.accent : undefined}
        attributes={props.active === "workflows" ? BOLD : undefined}
        onMouseDown={() => props.onSelect("workflows")}
      >
        workflows
      </text>
      <text>│</text>
      <text
        fg={props.active === "runs" ? props.accent : undefined}
        attributes={props.active === "runs" ? BOLD : undefined}
        onMouseDown={() => props.onSelect("runs")}
      >
        runs
      </text>
    </box>
  );
}

/** The overlay's content: the tab container. Hosted in the host's own dialog
 *  (`ui.dialog.show`) instead of a registered route — opening it never
 *  changes `ui.router.current()`, so a run first detected while it's open
 *  still binds to the real session (see spec:
 *  docs/specs/_built/opencode-overlay-dialog/spec.md). Escape closing is the
 *  host dialog's own behavior; the layer here only carries the tab keys. The
 *  `darkf.plan` mode push keeps those keys out of the base layer while the
 *  dialog is up. The `runs` tab's content — the list (r5) or, once a run is
 *  selected, its detail view (r6/r7) — lives in `run-detail.tsx`'s
 *  `RunsTabContent` and renders as the `Show` fallback; the shared scrollbox
 *  stays on the `workflows` branch, because the runs side owns its scroll
 *  regions (the list's filter input must stay put while its rows scroll, and
 *  the detail view's panes scroll under a pinned header). */
function OverlayContent(props: { store: LiveStore; runId?: string }): JSX.Element {
  const context = usePlugin();
  const popMode = context.keymap.mode.push("darkf.plan");
  onCleanup(popMode);

  const accent = context.theme.text.action.primary.base;
  const errorColor = context.theme.text.feedback.error.base;

  // r3: `workflows` is the default with no active run. Auto-open passes the
  // run it observed and lands on `runs`; that run seeds the tab's tab-local
  // selection (`RunsTabContent`'s `initialRunId`), so an auto-open opens on
  // the observed run's detail view — back from there is the list (r7).
  const [tab, setTab] = createSignal<"workflows" | "runs">(initialTab(props.runId));

  // Created after the tab signal: the layer factory runs once untracked at
  // registration, so `setTab` must already exist. Scoped to this mount —
  // the host disposes it when the dialog closes.
  context.keymap.layer(() => ({
    mode: "darkf.plan",
    commands: [
      {
        id: "darkf.tab.workflows",
        title: "Workflows tab",
        group: "darkf",
        bind: "1",
        run: () => {
          setTab("workflows");
        },
      },
      {
        id: "darkf.tab.runs",
        title: "Runs tab",
        group: "darkf",
        bind: "2",
        run: () => {
          setTab("runs");
        },
      },
    ],
    bindings: ["darkf.tab.workflows", "darkf.tab.runs"],
  }));

  return (
    <box flexDirection="column" height="100%" padding={1}>
      <TabBar active={tab()} accent={accent} onSelect={setTab} />
      <Show
        when={tab() === "workflows"}
        fallback={
          <RunsTabContent
            store={props.store}
            initialRunId={props.runId}
            accent={accent}
            errorColor={errorColor}
          />
        }
      >
        <scrollbox flexGrow={1} minHeight={0} scrollY border>
          <WorkflowsTab accent={accent} errorColor={errorColor} />
        </scrollbox>
      </Show>
      <box flexDirection="row" justifyContent="flex-end">
        <ToggleTab
          active={true}
          width={6}
          rows={2}
          accent={accent}
          onPress={() => closeOverlay()}
        />
      </box>
    </box>
  );
}
