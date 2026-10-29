/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { openOverlay } from "./overlay.tsx";
import type { LiveStore } from "./store.ts";
import { ToggleTab } from "./toggle-tab.tsx";

function runIdForSession(store: LiveStore, sessionID: string): string | undefined {
  for (const runId of store.views().keys()) {
    if (store.bindingFor(runId)?.supervisorSessionID === sessionID) return runId;
  }
  return undefined;
}

/** The closed-state half of the toggle — `home_prompt_right`/
 *  `session_prompt_right`, bottom right next to the prompt box (see spec:
 *  docs/specs/opencode-overlay-dialog/spec.md). Opens straight to this
 *  session's bound run when it has one, mirroring auto-open; otherwise
 *  behaves like the `darkf.open` command (overlay dialog, `DialogSelect`
 *  if ambiguous). Opening never navigates — see `openOverlay`. */
export function registerPromptToggle(api: TuiPluginApi, store: LiveStore): void {
  api.slots.register({
    order: 50,
    slots: {
      home_prompt_right: (ctx: Readonly<TuiSlotContext>) => (
        <ToggleTab
          active={false}
          width={6}
          accent={ctx.theme.current.accent as unknown as string}
          onPress={() => openOverlay()}
        />
      ),
      session_prompt_right: (ctx: Readonly<TuiSlotContext>, props: { session_id: string }) => (
        <ToggleTab
          active={false}
          width={6}
          accent={ctx.theme.current.accent as unknown as string}
          onPress={() => openOverlay(runIdForSession(store, props.session_id))}
        />
      ),
    },
  });
}
