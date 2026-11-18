/** @jsxImportSource @opentui/solid */
import { type Plugin, usePlugin } from "@opencode/plugin/tui";
import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { EXIT, type Task, type TaskStatus } from "@psimona/darkf/src/core/index.ts";
import { createSignal, For, onCleanup, Show } from "solid-js";
import type { PlanNode, PlanView, TaskListView } from "./digest.ts";
import { type PickerEntry, pickerOrder, pickerPage, type RunBinding } from "./locate.ts";
import type { LiveStore } from "./store.ts";
import { ToggleTab } from "./toggle-tab.tsx";

const TYPE_ICON: Record<"agent" | "script", string> = { agent: "🤖", script: "⚙️" };
const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });
const TASK_GLYPHS: Record<TaskStatus, string> = {
  pending: "○",
  "in-progress": "●",
  done: "✓",
  failed: "✗",
};

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

/** Opens the overlay bound to `runId`, or the run picker when omitted. Never
 *  touches the router — the overlay is a host dialog (see spec:
 *  docs/specs/_built/opencode-overlay-dialog/spec.md). Safe to call whether
 *  or not the overlay is already open; showing over the active dialog
 *  replaces it (and re-reads the terminal width — replacing the shown run is
 *  a new open). */
export function openOverlay(runId?: string): void {
  const host = registered;
  if (!host) return;
  if (runId === undefined) {
    void pickRun(host);
    return;
  }
  host.context.ui.dialog.show(() => <OverlayContent store={host.store} runId={runId} />);
  host.context.ui.dialog.set({ size: overlaySize() });
}

export function closeOverlay(): void {
  registered?.context.ui.dialog.clear();
}

const NEXT_PAGE = "__next_page__";

/** The run picker, as a native select dialog (V1 rendered `DialogSelect`
 *  inside the overlay dialog). Escape closes it, leaving nothing open.
 *  Selecting "→ more…" re-opens one page deeper; selecting a run re-opens
 *  as the run view. Only bounds display — `listEntries` still returns
 *  everything, so no historical data is lost, just how far back one page
 *  shows. Reopening history starts back at page 1. */
async function pickRun(host: { context: Plugin.Context; store: LiveStore }): Promise<void> {
  let page = 0;
  for (;;) {
    const paged = pickerPage(pickerOrder(host.store.pickerCandidates()), page);
    const value = await host.context.ui.dialog.select<string>({
      title: "darkf runs — pick one",
      options: [
        ...paged.rows.map((c) => ({
          title: `${c.active ? "●" : "○"} ${c.entry.runId}`,
          value: c.entry.runId,
          description: c.entry.rootDir,
        })),
        ...(paged.hasMore
          ? [{ title: "→ more…", value: NEXT_PAGE, description: "next 50 runs" }]
          : []),
      ],
    });
    if (value === undefined) return;
    if (value === NEXT_PAGE) {
      page += 1;
      continue;
    }
    openOverlay(value);
    return;
  }
}

/** A composite's expanded state is `isOpen(path) || node.active` — clicking
 *  toggles the manual half, and the active half follows execution on its
 *  own: a composite that was only auto-expanded (never clicked) collapses
 *  again the instant execution leaves it, with no extra bookkeeping.
 *
 *  `prefix` carries the accumulated `│   `/`    ` connectors from ancestor
 *  levels and `isLast` picks this node's own `├── `/`└── ` branch, so the
 *  tree reads like a standard directory listing instead of nested boxes. */
function renderNode(
  node: PlanNode,
  path: string,
  prefix: string,
  isLast: boolean,
  accent: RGBA,
  errorColor: RGBA,
  isOpen: (path: string) => boolean,
  toggleOpen: (path: string) => void,
): JSX.Element {
  const color = node.active ? accent : undefined;
  const visits = node.visits > 0 ? ` (${node.visits}x)` : "";
  const branch = prefix + (isLast ? "└── " : "├── ");
  const dot = node.active ? "●" : "○";

  if (node.kind !== "composite") {
    return (
      <text fg={color} attributes={BOLD}>
        {branch}
        {dot} {TYPE_ICON[node.kind]} {node.id}
        {visits}
      </text>
    );
  }

  const expanded = () => isOpen(path) || node.active;
  const childPrefix = prefix + (isLast ? "    " : "│   ");
  const children = node.children ?? [];
  return (
    <box flexDirection="column">
      <box onMouseDown={() => toggleOpen(path)}>
        <text fg={color} attributes={BOLD}>
          {branch}
          {dot} {expanded() ? "⏷ " : "▶ "}
          {node.id}
          {visits}
        </text>
      </box>
      <Show when={expanded()}>
        <For each={children}>
          {(child, i) =>
            renderNode(
              child,
              `${path}/${child.id}`,
              childPrefix,
              i() === children.length - 1,
              accent,
              errorColor,
              isOpen,
              toggleOpen,
            )
          }
        </For>
      </Show>
    </box>
  );
}

function PlanGraph(props: {
  view: PlanView;
  accent: RGBA;
  errorColor: RGBA;
  isOpen: (path: string) => boolean;
  toggleOpen: (path: string) => void;
}): JSX.Element {
  return (
    <box flexDirection="column">
      <Show when={props.view.workflowError}>
        <text fg={props.errorColor}>workflow definition error: {props.view.workflowError}</text>
      </Show>
      <For each={props.view.root}>
        {(node, i) =>
          renderNode(
            node,
            node.id,
            "",
            i() === props.view.root.length - 1,
            props.accent,
            props.errorColor,
            props.isOpen,
            props.toggleOpen,
          )
        }
      </For>
      <Show when={props.view.crash}>
        <text fg={props.errorColor}>
          crashed: {JSON.stringify(props.view.crash!.reason)} (attempt {props.view.crash!.attempt})
        </text>
      </Show>
      <Show when={props.view.stall}>
        <text fg={props.errorColor}>{props.view.stall}</text>
      </Show>
      <Show when={props.view.current?.state === EXIT}>
        <text>finished successfully</text>
      </Show>
    </box>
  );
}

function SupervisorPanel(props: { view: PlanView }): JSX.Element {
  return (
    <Show when={props.view.supervisor}>
      <box flexDirection="column">
        <text>{props.view.supervisor!.status.type}</text>
        <Show when={props.view.supervisor!.lastMessage}>
          <text>{props.view.supervisor!.lastMessage}</text>
        </Show>
      </box>
    </Show>
  );
}

// One task row: `<glyph> <id> <title>`, `!` before the title for must
// priority. Glyph/color per the locked mapping — the dot pair (○/●) stays
// "where the run is", ✓/✗ read terminal state. Only the active (in-progress)
// row grows a second, dim `↳` line with its satisfies links.
function TaskRow(props: {
  task: Task;
  active: boolean;
  accent: RGBA;
  errorColor: RGBA;
}): JSX.Element {
  const task = props.task;
  const style = (() => {
    switch (task.status) {
      case "in-progress":
        return { fg: props.accent, attributes: BOLD };
      case "done":
        return { fg: undefined, attributes: DIM };
      case "failed":
        return { fg: props.errorColor, attributes: undefined };
      default:
        return { fg: undefined, attributes: undefined };
    }
  })();
  const must = task.priority === "must";
  return (
    <box flexDirection="column">
      <text fg={style.fg} attributes={style.attributes}>
        {TASK_GLYPHS[task.status]} {task.id}
        {must ? " ! " : " "}
        {task.title}
      </text>
      <Show when={props.active && (task.satisfies?.length ?? 0) > 0}>
        <text attributes={DIM}>↳ {(task.satisfies ?? []).join(", ")}</text>
      </Show>
    </box>
  );
}

// The tasks tab's pane. Absent renders nothing (the tab itself is hidden —
// this only shows if it was selected before the file disappeared); invalid
// shows the parseTaskList error inline; valid renders the rows plus any
// stall warning.
function TaskPane(props: {
  view: TaskListView | undefined;
  accent: RGBA;
  errorColor: RGBA;
}): JSX.Element {
  const view = () => props.view;
  const valid = () => {
    const v = view();
    return v?.state === "valid" ? v : undefined;
  };
  const invalidError = () => {
    const v = view();
    return v?.state === "invalid" ? v.error : undefined;
  };
  return (
    <box flexDirection="column">
      <Show when={invalidError()}>
        <text fg={props.errorColor}>tasks.json is invalid: {invalidError()}</text>
      </Show>
      <For each={valid()?.tasks ?? []}>
        {(task) => (
          <TaskRow
            task={task}
            active={valid()?.current?.id === task.id}
            accent={props.accent}
            errorColor={props.errorColor}
          />
        )}
      </For>
      <Show when={valid()?.stall}>
        <text fg={props.errorColor}>{valid()?.stall}</text>
      </Show>
    </box>
  );
}

// The tab strip: the run's own progress bar — "tasks nn/mm" carries strict
// done/total in its title, and hides entirely while tasks.json is absent.
// "workflow" is the default tab, so auto-open behavior is unchanged.
function TabBar(props: {
  active: "workflow" | "tasks";
  tasksTitle: string | undefined;
  accent: RGBA;
  onSelect: (tab: "workflow" | "tasks") => void;
}): JSX.Element {
  return (
    <box flexDirection="row" gap={1}>
      <text
        fg={props.active === "workflow" ? props.accent : undefined}
        attributes={props.active === "workflow" ? BOLD : undefined}
        onMouseDown={() => props.onSelect("workflow")}
      >
        workflow
      </text>
      <Show when={props.tasksTitle !== undefined}>
        <text>│</text>
        <text
          fg={props.active === "tasks" ? props.accent : undefined}
          attributes={props.active === "tasks" ? BOLD : undefined}
          onMouseDown={() => props.onSelect("tasks")}
        >
          {props.tasksTitle}
        </text>
      </Show>
    </box>
  );
}

/** The overlay's content, hosted in the host's own dialog (`ui.dialog.show`)
 *  instead of a registered route — opening it never changes
 *  `ui.router.current()`, so a run first detected while it's open still
 *  binds to the real session (see spec:
 *  docs/specs/_built/opencode-overlay-dialog/spec.md). Escape closing is the
 *  host dialog's own behavior; the layer here only carries the tab keys.
 *  The `darkf.plan` mode push keeps those keys out of the base layer while
 *  the dialog is up. */
function OverlayContent(props: { store: LiveStore; runId: string }): JSX.Element {
  const context = usePlugin();
  const popMode = context.keymap.mode.push("darkf.plan");
  onCleanup(popMode);

  const accent = context.theme.text.action.primary.base;
  const errorColor = context.theme.text.feedback.error.base;

  const view = () => props.store.views().get(props.runId);
  const taskView = () => props.store.taskViews().get(props.runId);

  // Tab "workflow" (the workflow graph) is the default, so auto-open behavior
  // is unchanged; "tasks" only exists while tasks.json does (see TabBar).
  const [tab, setTab] = createSignal<"workflow" | "tasks">("workflow");
  const tasksTabTitle = (): string | undefined => {
    const tv = taskView();
    if (tv?.state === "invalid") return "tasks ?";
    if (tv?.state === "valid") return `tasks ${tv.done}/${tv.total}`;
    return undefined;
  };

  // Created after the tab signal: the layer factory runs once untracked at
  // registration, so `setTab` must already exist. Scoped to this mount —
  // the host disposes it when the dialog closes.
  context.keymap.layer(() => ({
    mode: "darkf.plan",
    commands: [
      {
        id: "darkf.tab.workflow",
        title: "Workflow tab",
        group: "darkf",
        bind: "1",
        run: () => {
          setTab("workflow");
        },
      },
      {
        id: "darkf.tab.tasks",
        title: "Tasks tab",
        group: "darkf",
        bind: "2",
        run: () => {
          setTab("tasks");
        },
      },
    ],
    bindings: ["darkf.tab.workflow", "darkf.tab.tasks"],
  }));

  // Manually clicked-open composite paths (see `renderNode`'s doc
  // comment). Scoped to this mount, not persisted — reopening the overlay
  // starts every composite collapsed again, same as a fresh auto-open.
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
    <box flexDirection="column" height="100%" padding={1}>
      <TabBar active={tab()} tasksTitle={tasksTabTitle()} accent={accent} onSelect={setTab} />
      <scrollbox flexGrow={1} minHeight={0} scrollY border>
        {/* The auto-open fires the instant a run is first observed, which can
            be a tick ahead of the store's first view for it — a brief
            placeholder, not the V1 picker fallback. */}
        <Show when={view()} fallback={<text attributes={DIM}>loading run…</text>}>
          {(resolvedView: () => PlanView) => (
            <Show
              when={tab() === "workflow"}
              fallback={<TaskPane view={taskView()} accent={accent} errorColor={errorColor} />}
            >
              <PlanGraph
                view={resolvedView()}
                accent={accent}
                errorColor={errorColor}
                isOpen={isOpen}
                toggleOpen={toggleOpen}
              />
            </Show>
          )}
        </Show>
      </scrollbox>
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
          {(resolvedView: () => PlanView) => <SupervisorPanel view={resolvedView()} />}
        </Show>
      </scrollbox>
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

export type { PickerEntry, RunBinding };
