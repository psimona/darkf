import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AgentFailure,
  type AgentRunner,
  type AgentStateDef,
  type NodeResult,
} from "../../core/index.ts";
import {
  handoffContractText,
  handoffPath,
  nudgeMessage,
  readHandoff,
  usagePath,
} from "./handoff.ts";

// Mirrors darkf-engine's own DEFAULT_TIMEOUT_MS (run.ts) so this runner can
// kill its own subprocess in step with the engine's timeout instead of
// leaving it running past the point where the engine has moved on — see
// docs/specs/agent-handoff/spec.md's retry-overwrite race note.
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

function buildPrompt(
  def: AgentStateDef,
  handoff: NodeResult,
  info: { validEvents: string[]; hasFallback: boolean },
  path: string,
): string {
  const parts = [def.prompt, `Input from the previous step:\n${JSON.stringify(handoff)}`];

  if (info.validEvents.length > 0) {
    const fallbackNote = info.hasFallback ? ` If none apply, you may omit "event" instead.` : "";
    parts.push(
      `Your "event" must be exactly one of: ${info.validEvents.join(", ")}.${fallbackNote}`,
    );
  }

  parts.push(handoffContractText(path));
  return parts.join("\n\n");
}

interface ClaudeCodeStdout {
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
}

export interface AgentUsage {
  costUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

/** Parse the `claude -p --output-format json` envelope into usage telemetry.
 *  Tolerant: any missing/invalid field degrades to null/0, never throws. */
export function parseClaudeUsage(stdout: string): AgentUsage {
  let parsed: ClaudeCodeStdout | undefined;
  try {
    parsed = JSON.parse(stdout) as ClaudeCodeStdout;
  } catch {
    parsed = undefined;
  }
  const u = parsed?.usage;
  const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    costUsd: typeof parsed?.total_cost_usd === "number" ? parsed.total_cost_usd : null,
    durationMs: typeof parsed?.duration_ms === "number" ? parsed.duration_ms : null,
    numTurns: typeof parsed?.num_turns === "number" ? parsed.num_turns : null,
    inputTokens: n(u?.input_tokens),
    cacheReadTokens: n(u?.cache_read_input_tokens),
    cacheCreationTokens: n(u?.cache_creation_input_tokens),
    outputTokens: n(u?.output_tokens),
  };
}

function parseAgentSessionId(stdout: string): string | undefined {
  try {
    return (JSON.parse(stdout) as ClaudeCodeStdout).session_id;
  } catch {
    return undefined;
  }
}

export const claudeCodeRunner: AgentRunner = {
  kind: "claude-code",
  async run(id, def, handoff, info) {
    const path = handoffPath(info.rootDir, info.runId, info.step, id);
    await mkdir(dirname(path), { recursive: true });

    const agentConfig = def.agent ?? {};
    const permissionMode =
      (agentConfig.permissionMode as string | undefined) ?? "bypassPermissions";
    const model = agentConfig.model as string | undefined;
    // Same-session nudge (docs/specs/session-nudge/spec.md): when the
    // previous attempt failed in a repairable way and we have its session
    // id, send a short corrective message into that session instead of
    // replaying the full prompt. `--resume` itself is unconditional on
    // `info.agentSessionId` either way (see below) — only the prompt text
    // changes for a nudge.
    const nudge = nudgeMessage(info, path);
    const prompt = nudge ?? buildPrompt(def, handoff, info, path);

    // Resolve once: spawn can miss PATH lookups in daemonized workers.
    const bin = Bun.which("claude") ?? "claude";
    const args = [bin, "-p", "--output-format", "json", "--permission-mode", permissionMode];
    if (model) args.push("--model", model);
    if (info.agentSessionId) args.push("--resume", info.agentSessionId);
    args.push(prompt);

    const proc = Bun.spawn(args, { cwd: info.rootDir, stdout: "pipe", stderr: "pipe" });
    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const killTimer = setTimeout(() => proc.kill(), timeoutMs);

    let stdout: string;
    let exitCode: number;
    try {
      stdout = await new Response(proc.stdout).text();
      exitCode = await proc.exited;
    } finally {
      clearTimeout(killTimer);
    }

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      const reason = `claude exited ${exitCode}: ${stderr.trim()}`;
      // stdout is already read into memory above — a second parse against
      // data already in hand, not new capture plumbing. There's no
      // partial-progress signal on this path the way opencode's incremental
      // NDJSON has one: a crash before the terminal result object prints
      // leaves nothing parseable, and that's a plain Error, same as today.
      const sessionId = parseAgentSessionId(stdout);
      if (sessionId) {
        throw new AgentFailure(reason, {
          agentSessionId: sessionId,
          crashReason: { kind: "runner-error", error: reason },
        });
      }
      throw new Error(reason);
    }

    const usagePath_ = usagePath(info.rootDir, info.runId, info.step, id);
    await mkdir(dirname(usagePath_), { recursive: true });
    await Bun.write(usagePath_, JSON.stringify(parseClaudeUsage(stdout)));

    const agentSessionId = parseAgentSessionId(stdout) ?? info.agentSessionId;
    let raw: unknown;
    try {
      raw = await readHandoff(path);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        throw new AgentFailure("handoff not written", {
          agentSessionId,
          crashReason: { kind: "handoff-missing" },
        });
      }
      const parseError = err instanceof Error ? err.message : String(err);
      throw new AgentFailure(`handoff unparseable: ${parseError}`, {
        agentSessionId,
        crashReason: { kind: "handoff-unparseable", parseError },
      });
    }
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const result = raw as Record<string, unknown>;
      if (result.agentSessionId === undefined) result.agentSessionId = agentSessionId;
    }
    return raw as NodeResult;
  },
};
