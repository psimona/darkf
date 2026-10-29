/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui";
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
// since it's already scoped to `session_id` (see spec: Multiple live runs).
function runForSession(store: LiveStore, sessionID: string): PlanView | undefined {
  for (const [runId, view] of store.views()) {
    if (store.bindingFor(runId)?.supervisorSessionID === sessionID) return view;
  }
  return undefined;
}

/** The `sidebar_content` slot — detailed, per-session (see spec: Three
 *  tiers, not one). Renders nothing when this session has no bound run. */
export function registerSidebar(api: TuiPluginApi, store: LiveStore): void {
  api.slots.register({
    order: 450,
    slots: {
      sidebar_content: (ctx: Readonly<TuiSlotContext>, props: { session_id: string }) => {
        const view = () => runForSession(store, props.session_id);
        const rows = () => {
          const v = view();
          return v ? flatten(v.root, 0) : [];
        };
        const accent = () => ctx.theme.current.accent;
        const errorColor = () => ctx.theme.current.error;

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
                  crashed: {JSON.stringify(view()!.crash!.reason)} (attempt {view()!.crash!.attempt}
                  )
                </text>
              </Show>
              <Show when={view()?.stall}>
                <text fg={errorColor()}>{view()!.stall}</text>
              </Show>
            </box>
          </Show>
        );
      },
    },
  });
}
