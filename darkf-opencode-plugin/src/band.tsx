/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { Show } from "solid-js";
import type { LiveStore } from "./store.ts";
import { summaryLine } from "./summary.ts";

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
