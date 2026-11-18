/** @jsxImportSource @opentui/solid */
import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { EXIT, type Task, type TaskStatus } from "@psimona/darkf/src/core/index.ts";
import { For, Show } from "solid-js";
import type { PlanNode, PlanView, TaskListView } from "./digest.ts";

// The run-scoped view building blocks: `PlanGraph` (the live plan tree, the
// active node highlighted), `TaskPane` (the tasks.json rows), and
// `SupervisorPanel` (status + last-message synopsis). They lived in
// `overlay.tsx` back when the overlay was one run's dialog; the tab container
// (docs/specs/opencode-overlay-tabs/spec.md) has no run scope of its own, and
// these now compose the `runs` tab's detail view — left the graph, right the
// tasks, the supervisor below (r6/r11). Their own module, not `overlay.tsx`:
// the container mounts the runs tab's content and the detail view mounts
// these, so one shared file would make the modules import each other (the
// same split `toggle-tab.tsx` already made for the same reason).

const TYPE_ICON: Record<"agent" | "script", string> = { agent: "🤖", script: "⚙️" };
const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });
const TASK_GLYPHS: Record<TaskStatus, string> = {
  pending: "○",
  "in-progress": "●",
  done: "✓",
  failed: "✗",
};

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

/** The run's workflow graph with the current active node highlighted — the
 *  detail view's left pane (r6), unchanged from its overlay-dialog days.
 *  Manual-open state is the caller's (`isOpen`/`toggleOpen`), so the pane
 *  carries none across mounts by itself. */
export function PlanGraph(props: {
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

/** The supervisor-output panel — the detail view's second line (r11),
 *  unchanged: status type plus last-message synopsis, bound session only. */
export function SupervisorPanel(props: { view: PlanView }): JSX.Element {
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

/** The run's plan/task tree — the detail view's right pane (r6), appearing
 *  once tasks.json exists (the `absent` state renders nothing). Absent is
 *  normal before the plan phase; invalid shows the parseTaskList error
 *  inline; valid renders the rows plus any stall warning. */
export function TaskPane(props: {
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
