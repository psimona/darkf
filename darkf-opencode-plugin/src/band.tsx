/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { EXIT } from "@psimona/darkf/src/core/index.ts";
import { Show } from "solid-js";
import type { LiveStore } from "./store.ts";

// Same vocabulary `darkf status`/`darkf monitor` already use (see
// darkf-cli/src/index.ts's `printTransition`) — one way to say "what state
// is this run in," not a second one invented for this band.
function summaryLine(store: LiveStore): string {
  const views = [...store.views().values()];
  if (views.length === 0) return "";
  if (views.length > 1) return `${views.length} darkf runs active`;

  const view = views[0]!;
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

/** The `app_bottom` slot — compact, always-visible, never scoped to a
 *  session (see spec: Three tiers, not one). Renders nothing when no run
 *  is live. */
export function registerBand(api: TuiPluginApi, store: LiveStore): void {
  api.slots.register({
    order: 50,
    slots: {
      app_bottom: (_ctx: Readonly<TuiSlotContext>) => {
        const summary = () => summaryLine(store);
        return (
          <box paddingX={1}>
            <Show when={summary().length > 0}>
              <text>{summary()}</text>
            </Show>
          </box>
        );
      },
    },
  });
}
