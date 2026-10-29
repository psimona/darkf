import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { SupervisorStatus, SupervisorView } from "./digest.ts";

const SYNOPSIS_MAX_LEN = 200;

// `api.state.session.messages(sessionID)` returns flat `Message` rows
// (`role` directly on the message — confirmed against `@opencode-ai/sdk/v2`'s
// `AssistantMessage`/`UserMessage`), unlike the wrapped `{info, parts}` shape
// the REST client's `session.messages()` response uses. Parts are fetched
// separately per message via `api.state.part(messageID)`.
function lastAssistantSynopsis(api: TuiPluginApi, sessionID: string): string | undefined {
  const messages = api.state.session.messages(sessionID);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") continue;
    const text = api.state
      .part(message.id)
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text.slice(0, SYNOPSIS_MAX_LEN);
  }
  return undefined;
}

/** `undefined` whenever there's nothing to show: no bound session, or the
 *  bound session no longer resolves (deleted/compacted away since binding —
 *  see spec: Error handling). Never throws. */
export function supervisorViewFor(
  api: TuiPluginApi,
  sessionID: string | undefined,
): SupervisorView | undefined {
  if (!sessionID) return undefined;
  let status: SupervisorStatus | undefined;
  try {
    status = api.state.session.status(sessionID) as SupervisorStatus | undefined;
  } catch {
    return undefined;
  }
  if (!status) return undefined;
  return { sessionID, status, lastMessage: lastAssistantSynopsis(api, sessionID) };
}
