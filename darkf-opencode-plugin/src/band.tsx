/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { Show } from "solid-js";
import type { LiveStore } from "./store.ts";
import { summaryLine } from "./summary.ts";

/** The compact, always-visible tier (V1's `app_bottom`, now the prompt
 *  footer's status row — present on the home and session screens alike).
 *  Renders nothing when no run is live. */
export function registerBand(context: Plugin.Context, store: LiveStore): void {
  context.ui.slot({
    append: "prompt.footer.status",
    render: () => {
      const summary = () => summaryLine(store);
      return (
        <box paddingX={1}>
          <Show when={summary().length > 0}>
            <text>{summary()}</text>
          </Show>
        </box>
      );
    },
  });
}
