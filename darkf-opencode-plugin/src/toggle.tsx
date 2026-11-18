/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { openOverlay } from "./overlay.tsx";
import type { LiveStore } from "./store.ts";
import { ToggleTab } from "./toggle-tab.tsx";

function runIdForSession(store: LiveStore, sessionID: string): string | undefined {
  for (const runId of store.views().keys()) {
    if (store.bindingFor(runId)?.supervisorSessionID === sessionID) return runId;
  }
  return undefined;
}

/** The closed-state half of the toggle — the prompt footer's right end (V1
 *  used the dedicated `home_prompt_right`/`session_prompt_right` slots,
 *  which V2's slot tree no longer publishes). Opens straight to this
 *  session's bound run when it has one, mirroring auto-open; otherwise
 *  behaves like the `darkf.open` command (run picker if ambiguous). Opening
 *  never navigates — see `openOverlay`. */
export function registerPromptToggle(context: Plugin.Context, store: LiveStore): void {
  context.ui.slot({
    append: "prompt.footer",
    render: (props: { readonly sessionID?: string }) => (
      <ToggleTab
        active={false}
        width={6}
        accent={context.theme.text.action.primary.base}
        onPress={() =>
          openOverlay(props.sessionID ? runIdForSession(store, props.sessionID) : undefined)
        }
      />
    ),
  });
}
