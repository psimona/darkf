import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchInfo } from "../../core/index.ts";

// Shared, harness-agnostic half of the agent-handoff contract. See
// docs/specs/agent-handoff/spec.md. Per-harness runners own everything else
// (invocation, native structured-output vs. prompt fallback, agentSessionId,
// subprocess lifecycle).

/** `.darkf/run/<runId>/handoff/<step, zero-padded to 4 digits>-<nodeId>.json` */
export function handoffPath(rootDir: string, runId: string, step: number, nodeId: string): string {
  const padded = String(step).padStart(4, "0");
  return join(rootDir, ".darkf", "run", runId, "handoff", `${padded}-${nodeId}.json`);
}

/**
 * Fixed instruction block for harnesses with no native "write structured
 * output to this path" flag. Appended to the node's own prompt; tells the
 * agent exactly what to write and where.
 */
export function handoffContractText(path: string): string {
  return `When you are done, write your result as JSON to this exact path: ${path}

The JSON object may have any of these optional fields:
- "event": a string naming the outcome (omit if this step has no outgoing choice to make)
- "output": any JSON value to hand to the next step
- "agentSessionId": omit unless you have a specific reason to set it

Write nothing else to that path. Create the file's parent directories if they don't exist yet.`;
}

/** Read + `JSON.parse`, nothing else. Shape validation is the engine's job (`isNodeResult`), not this file's. */
export async function readHandoff(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

/**
 * Shared same-session repair text for the three nudgeable `CrashReason`
 * kinds (docs/specs/session-nudge/spec.md). `undefined` means "don't
 * nudge" — either there's no `previousFailure`, no `agentSessionId` to
 * resume, or the failure isn't one of the three repairable kinds. Both
 * runners call this identically; only the CLI invocation that sends the
 * message differs per harness.
 */
export function nudgeMessage(info: DispatchInfo, path: string): string | undefined {
  const failure = info.previousFailure;
  if (!failure || !info.agentSessionId) return undefined;
  const validEvents = info.validEvents.join(", ");
  switch (failure.kind) {
    case "handoff-missing":
      return `Your previous turn ended without writing the result file. Ignore any blocked tool calls and write the JSON handoff to ${path} now. Valid events: ${validEvents}.`;
    case "handoff-unparseable":
      return `The JSON at ${path} failed to parse (${failure.parseError}). Rewrite it as a single valid JSON object with the contract fields.`;
    case "no-transition":
      return `You reported event ${failure.event}; this state only routes ${validEvents}. Re-issue the handoff with a routable event.`;
    default:
      return undefined;
  }
}

/** `.darkf/run/<runId>/usage/<step, zero-padded to 4 digits>-<nodeId>.json` — the
 *  per-dispatch usage sidecar (cost/tokens), written by runners, read by
 *  `status`/`report`. Usage is deliberately NOT part of the NodeResult data
 *  flow: it is telemetry about a dispatch, not data for the next node. */
export function usagePath(rootDir: string, runId: string, step: number, nodeId: string): string {
  const padded = String(step).padStart(4, "0");
  return join(rootDir, ".darkf", "run", runId, "usage", `${padded}-${nodeId}.json`);
}
