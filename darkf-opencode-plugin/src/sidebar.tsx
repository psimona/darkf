/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { For, Show } from "solid-js";
import type { PlanNode, PlanView } from "./digest.ts";
import type { LiveStore } from "./store.ts";

const TYPE_ICON: Record<"agent" | "script", string> = { agent: "🤖", script: "▸" };

interface Row {
  node: PlanNode;
  depth: number;
}

function flatten(nodes: PlanNode[], depth: number): Row[] {
  const out: Row[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children) out.push(...flatten(node.children, depth + 1));
  }
  return out;
}

function lineFor({ node, depth }: Row): string {
  const indent = "  ".repeat(depth);
  const icon = node.kind === "composite" ? "" : `${TYPE_ICON[node.kind]} `;
  const visits = node.visits > 0 ? ` (${node.visits}x)` : "";
  return `${indent}${icon}${node.id}${visits}`;
}

// The run bound to this session, if any — never ambiguous at this tier,
// since the slot input already carries the session (see spec: Multiple
// live runs).
function runForSession(store: LiveStore, sessionID: string): PlanView | undefined {
  for (const [runId, view] of store.views()) {
    if (store.bindingFor(runId)?.supervisorSessionID === sessionID) return view;
  }
  return undefined;
}

/** The `sidebar.content` slot — detailed, per-session (see spec: Three
 *  tiers, not one). Renders nothing when this session has no bound run. */
export function registerSidebar(context: Plugin.Context, store: LiveStore): void {
  context.ui.slot({
    append: "sidebar.content",
    render: (props: { readonly sessionID: string }) => {
      const view = () => runForSession(store, props.sessionID);
      const rows = () => {
        const v = view();
        return v ? flatten(v.root, 0) : [];
      };
      const accent = () => context.theme.text.action.primary.base;
      const errorColor = () => context.theme.text.feedback.error.base;

      return (
        <Show when={view() !== undefined}>
          <box flexDirection="column" title="darkf">
            <Show when={view()?.workflowError}>
              <text fg={errorColor()}>workflow error: {view()!.workflowError}</text>
            </Show>
            <For each={rows()}>
              {(row) => <text fg={row.node.active ? accent() : undefined}>{lineFor(row)}</text>}
            </For>
            <Show when={view()?.crash}>
              <text fg={errorColor()}>
                crashed: {JSON.stringify(view()!.crash!.reason)} (attempt {view()!.crash!.attempt})
              </text>
            </Show>
            <Show when={view()?.stall}>
              <text fg={errorColor()}>{view()!.stall}</text>
            </Show>
          </box>
        </Show>
      );
    },
  });
}
