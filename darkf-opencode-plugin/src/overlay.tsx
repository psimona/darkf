/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { createTextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { EXIT, type Task, type TaskStatus } from "@psimona/darkf/src/core/index.ts";
import { createSignal, For, onCleanup, Show } from "solid-js";
import type { PlanNode, PlanView, TaskListView } from "./digest.ts";
import type { RunBinding } from "./locate.ts";
import type { LiveStore } from "./store.ts";
import { ToggleTab } from "./toggle-tab.tsx";

const MODE = "darkf.plan";
const TYPE_ICON: Record<"agent" | "script", string> = { agent: "🤖", script: "⚙️" };
const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });
const TASK_GLYPHS: Record<TaskStatus, string> = {
  pending: "○",
  "in-progress": "●",
  done: "✓",
  failed: "✗",
};

interface OverlayState {
  runId?: string;
}

// Module-level, not component-local — `openOverlay`/`closeOverlay` are called
// from `toggle.tsx`'s slot handlers and `tui.tsx`'s `onNewRun`/command, none
// of which sit inside this module's own render tree. `null` = closed;
// `{ runId }` (runId possibly absent) = open. Same "plugin-owned, in-memory,
// not persisted" shape `locate.ts`'s `bindings` map already uses.
const [overlay, setOverlay] = createSignal<OverlayState | null>(null);

/** Opens the overlay bound to `runId`, or with no run resolved (the
 *  `Picker` renders) when omitted. Never touches `api.route.current` — see
 *  spec: docs/specs/opencode-overlay-dialog/spec.md. Safe to call whether
 *  or not the overlay is already open; it just replaces the shown run. */
export function openOverlay(runId?: string): void {
  setOverlay({ runId });
}

export function closeOverlay(): void {
  setOverlay(null);
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
  accent: string,
  errorColor: string,
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
  accent: string;
  errorColor: string;
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
  accent: string;
  errorColor: string;
}): JSX.Element {
  const task = props.task;
  const style = (() => {
    switch (task.status) {
      case "in-progress":
        return { fg: props.accent as string | undefined, attributes: BOLD };
      case "done":
        return { fg: undefined, attributes: DIM };
      case "failed":
        return { fg: props.errorColor as string | undefined, attributes: undefined };
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
  accent: string;
  errorColor: string;
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
  accent: string;
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

function Picker(props: {
  api: TuiPluginApi;
  candidates: Array<{ runId: string; rootDir: string }>;
}): JSX.Element {
  const { DialogSelect } = props.api.ui;
  return (
    <DialogSelect
      title="Multiple darkf runs — pick one"
      options={props.candidates.map((c) => ({
        title: c.runId,
        value: c.runId,
        description: c.rootDir,
      }))}
      onSelect={(option) => openOverlay(option.value as string)}
    />
  );
}

/** The overlay's content, hosted inside `api.ui.Dialog` (see
 *  `registerOverlay` below) instead of a registered route — opening it
 *  never changes `api.route.current`, so a run first detected while it's
 *  open still binds to the real session (see spec:
 *  docs/specs/opencode-overlay-dialog/spec.md). `api.mode.push` and the
 *  explicit escape binding are kept even though the host `Dialog` may
 *  already close on escape on its own (unconfirmed — see the spec's Open
 *  decisions): redundant-but-harmless beats silently unreachable. */
function OverlayContent(props: {
  api: TuiPluginApi;
  store: LiveStore;
  runId: string | undefined;
}): JSX.Element {
  const { api, store } = props;
  const popMode = api.mode.push(MODE);
  onCleanup(popMode);

  const disposeLayer = api.keymap.registerLayer({
    mode: MODE,
    commands: [
      {
        name: "darkf.toggle",
        title: "Back to chat",
        category: "darkf",
        run: () => closeOverlay(),
      },
      {
        name: "darkf.tab.workflow",
        title: "Workflow tab",
        category: "darkf",
        run: () => setTab("workflow"),
      },
      {
        name: "darkf.tab.tasks",
        title: "Tasks tab",
        category: "darkf",
        run: () => setTab("tasks"),
      },
    ],
    bindings: [
      { key: "escape", cmd: "darkf.toggle", desc: "Back to chat" },
      { key: "1", cmd: "darkf.tab.workflow", desc: "Workflow tab" },
      { key: "2", cmd: "darkf.tab.tasks", desc: "Tasks tab" },
    ],
  });
  onCleanup(disposeLayer);

  const view = () => (props.runId ? store.views().get(props.runId) : undefined);
  const taskView = () => (props.runId ? store.taskViews().get(props.runId) : undefined);
  const candidates = () =>
    props.runId
      ? []
      : store.unboundCandidates().map((e) => ({ runId: e.runId, rootDir: e.rootDir }));

  // Tab "workflow" (the workflow graph) is the default, so auto-open behavior
  // is unchanged; "tasks" only exists while tasks.json does (see TabBar).
  const [tab, setTab] = createSignal<"workflow" | "tasks">("workflow");
  const tasksTabTitle = (): string | undefined => {
    const tv = taskView();
    if (tv?.state === "invalid") return "tasks ?";
    if (tv?.state === "valid") return `tasks ${tv.done}/${tv.total}`;
    return undefined;
  };

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
      <TabBar
        active={tab()}
        tasksTitle={tasksTabTitle()}
        accent={api.theme.current.accent as unknown as string}
        onSelect={setTab}
      />
      <scrollbox flexGrow={1} minHeight={0} scrollY border>
        <Show when={view()} fallback={<Picker api={api} candidates={candidates()} />}>
          {(resolvedView: () => PlanView) => (
            <Show
              when={tab() === "workflow"}
              fallback={
                <TaskPane
                  view={taskView()}
                  accent={api.theme.current.accent as unknown as string}
                  errorColor={api.theme.current.error as unknown as string}
                />
              }
            >
              <PlanGraph
                view={resolvedView()}
                accent={api.theme.current.accent as unknown as string}
                errorColor={api.theme.current.error as unknown as string}
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
          accent={api.theme.current.accent as unknown as string}
          onPress={() => closeOverlay()}
        />
      </box>
    </box>
  );
}

/** Registers the `app` slot — top-level, mounted for the plugin's whole
 *  lifetime regardless of which route (`home`/`session`/anything else) is
 *  current, same tier `app_bottom`'s band already relies on (see
 *  `band.tsx`). The dialog mounts/unmounts (and `OverlayContent`'s
 *  `onCleanup`s fire) purely from `overlay()` going truthy/falsy — no
 *  route involved at any point. */
export function registerOverlay(api: TuiPluginApi, store: LiveStore): void {
  api.slots.register({
    order: 50,
    slots: {
      app: (_ctx: Readonly<TuiSlotContext>) => (
        <Show when={overlay()}>
          {(state: () => OverlayState) => (
            <api.ui.Dialog size="xlarge" onClose={closeOverlay}>
              <OverlayContent api={api} store={store} runId={state().runId} />
            </api.ui.Dialog>
          )}
        </Show>
      ),
    },
  });
}

export type { RunBinding };
