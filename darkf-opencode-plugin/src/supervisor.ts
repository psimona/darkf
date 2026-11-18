import type { Plugin } from "@opencode/plugin/tui";
import type { SupervisorStatus, SupervisorView } from "./digest.ts";

const SYNOPSIS_MAX_LEN = 200;

// `data.session.message.list(sessionID)` returns the host's synced message
// rows. The discriminator is `type` (not V1's `role`), and an assistant
// message's text lives in its `content` parts — no second per-message part
// lookup like V1's `api.state.part(messageID)` needed. The supervisor
// session is the one this run bound to (the session route current at first
// detection), which an open TUI keeps synced; when it doesn't resolve the
// list is simply empty and the view degrades.
function lastAssistantSynopsis(
  data: Plugin.Context["data"],
  sessionID: string,
): string | undefined {
  const messages = data.session.message.list(sessionID);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.type !== "assistant") continue;
    const text = message.content
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text.slice(0, SYNOPSIS_MAX_LEN);
  }
  return undefined;
}

// The V2 session data cache only carries a coarse "idle" | "running" flag.
// The richer retry state comes from the newest assistant message that is
// still in retry — its `retry` field holds attempt, timestamp, and error.
function retryStatus(
  data: Plugin.Context["data"],
  sessionID: string,
): Extract<SupervisorStatus, { type: "retry" }> | undefined {
  const messages = data.session.message.list(sessionID);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.type !== "assistant") continue;
    const retry = message.retry;
    if (!retry) return undefined;
    const error = retry.error;
    const messageText =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? "unknown error")
        : "unknown error";
    return { type: "retry", attempt: retry.attempt, message: messageText, next: retry.at };
  }
  return undefined;
}

/** `undefined` whenever there's nothing to show: no bound session, or the
 *  bound session no longer resolves (deleted/compacted away since binding —
 *  see spec: Error handling). Never throws. */
export function supervisorViewFor(
  data: Plugin.Context["data"],
  sessionID: string | undefined,
): SupervisorView | undefined {
  if (!sessionID) return undefined;
  let running: "idle" | "running" | undefined;
  try {
    running = data.session.status(sessionID);
  } catch {
    return undefined;
  }
  if (!running) return undefined;
  const status: SupervisorStatus =
    retryStatus(data, sessionID) ?? (running === "running" ? { type: "busy" } : { type: "idle" });
  return { sessionID, status, lastMessage: lastAssistantSynopsis(data, sessionID) };
}
