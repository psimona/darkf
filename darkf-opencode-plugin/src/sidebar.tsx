/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { For, Show } from "solid-js";
import type { PlanNode, PlanView } from "./digest.ts";
import type { LiveStore } from "./store.ts";
import { tileRunIds } from "./tiles.ts";

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

/** The run's compact view: the flattened node lines with the active node
 *  highlighted in accent, plus the workflow-error, crash, and stall lines —
 *  this file's own sidebar content, extracted so another surface reuses it
 *  verbatim instead of restating it. The tile grid renders this as each
 *  non-focused tile's content (spec:
 *  docs/specs/opencode-overlay-tiles/spec.md — decision 10), which is why
 *  it is exported rather than folded into the slot render below. Takes the
 *  resolved `PlanView` directly — which run that is (by session here, by
 *  tile membership in the grid) stays the caller's job. The plain column
 *  box keeps the content self-contained without the sidebar's `darkf`
 *  chrome, which only the slot render below wants. */
export function CompactRunView(props: {
  view: PlanView;
  accent: RGBA;
  errorColor: RGBA;
}): JSX.Element {
  return (
    <box flexDirection="column">
      <Show when={props.view.workflowError}>
        <text fg={props.errorColor}>workflow error: {props.view.workflowError}</text>
      </Show>
      <For each={flatten(props.view.root, 0)}>
        {(row) => <text fg={row.node.active ? props.accent : undefined}>{lineFor(row)}</text>}
      </For>
      <Show when={props.view.crash}>
        <text fg={props.errorColor}>
          crashed: {JSON.stringify(props.view.crash!.reason)} (attempt {props.view.crash!.attempt})
        </text>
      </Show>
      <Show when={props.view.stall}>
        <text fg={props.errorColor}>{props.view.stall}</text>
      </Show>
    </box>
  );
}

// The run bound to this session, if any — never ambiguous at this tier,
// since the slot input already carries the session (see spec: Multiple
// live runs). Returns the `runId` alongside the view: suppression below
// checks tile membership by `runId`, and the view alone can't answer it.
function runForSession(
  store: LiveStore,
  sessionID: string,
): { runId: string; view: PlanView } | undefined {
  for (const [runId, view] of store.views()) {
    if (store.bindingFor(runId)?.supervisorSessionID === sessionID) return { runId, view };
  }
  return undefined;
}

/** What the `sidebar.content` slot renders for this session, after decision
 *  12's duplication suppression: the run bound to the session, unless the
 *  open panel currently shows that same run as a tile — then `undefined`,
 *  the same render-nothing the no-bound-run case gets. The docs don't say
 *  whether `sidebar.content` and an open `session.panel` can coexist
 *  showing the same run twice, so the plugin doesn't depend on unspecified
 *  host behavior — it suppresses the duplicate itself (spec:
 *  docs/specs/opencode-overlay-tiles/spec.md — decision 12). Membership
 *  comes from `tiles.ts`'s `tileRunIds` — the store read, not the panel's
 *  component tree, exactly the "readable from `sidebar.tsx` without
 *  depending on the panel's own component tree" shape the spec requires —
 *  and it is `[]` while the panel is closed, so the sidebar shows again the
 *  moment nothing tiles the run. Called inside the slot render's reactive
 *  scope, the membership re-evaluates per poll tick and per open/close, so
 *  a run leaving the grid (its next poll tick) un-suppresses the entry on
 *  that same tick. */
export function sidebarRunForSession(store: LiveStore, sessionID: string): PlanView | undefined {
  const resolved = runForSession(store, sessionID);
  if (resolved === undefined) return undefined;
  if (tileRunIds(store).includes(resolved.runId)) return undefined;
  return resolved.view;
}

/** The `sidebar.content` slot — detailed, per-session (see spec: Three
 *  tiers, not one). Renders nothing when this session has no bound run, and
 *  nothing when that run is currently shown as a tile in the open panel —
 *  decision 12's suppression of the duplicate, via `sidebarRunForSession`. */
export function registerSidebar(context: Plugin.Context, store: LiveStore): void {
  context.ui.slot({
    append: "sidebar.content",
    render: (props: { readonly sessionID: string }) => {
      const view = () => sidebarRunForSession(store, props.sessionID);
      const accent = () => context.theme.text.action.primary.base;
      const errorColor = () => context.theme.text.feedback.error.base;

      return (
        <Show when={view() !== undefined}>
          <box flexDirection="column" title="darkf">
            <CompactRunView view={view()!} accent={accent()} errorColor={errorColor()} />
          </box>
        </Show>
      );
    },
  });
}
