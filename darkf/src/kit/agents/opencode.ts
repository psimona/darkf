import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentFailure,
  type AgentProgress,
  type AgentRunner,
  type AgentStateDef,
  type DispatchInfo,
  type NodeResult,
} from "../../core/index.ts";
import { handoffContractText, handoffPath, nudgeMessage, readHandoff } from "./handoff.ts";

// Mirrors darkf-engine's own DEFAULT_TIMEOUT_MS (run.ts), same reason
// claude-code.ts does: kill the subprocess in step with the engine's own
// timeout instead of leaving it running past the point the engine moved on.
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

export interface StepFinishScan {
  reason?: string;
  sessionId?: string;
  stepCount: number;
}

// opencode's `--format json` is NDJSON (one event object per line). The
// step-finish event carries `part.reason` — the terminal reason for the
// turn: "stop" (clean), "tool-calls" (ended between tool calls), "length"
// (output budget exhausted). Unattended runs 2026-10-09: THREE crash classes
// (silent resume hang, finish=length authoring abort, finish=tool-calls
// mid-turn death) all surfaced as `exit 0` + missing handoff → a bare
// ENOENT minutes after the real failure. Capture the reason and make a
// missing handoff fail loudly with it, so retries and RCA start from facts.
// NB: the type discriminator is hyphenated ("step-finish"), confirmed against
// both @opencode-ai/sdk's generated types and strings pulled from the
// installed opencode binary — matching on "step_finish" (underscore) here
// silently never matched, so this capture never actually fired.
//
// Extended (docs/specs/session-nudge/spec.md) to also pull `part.sessionID`
// and a count of step-finish events seen, in the same single pass:
// `stepCount` is the positive-evidence gate for ever reporting a session id
// at all — this is the resumability fix for the session that hung 15
// minutes on zero persisted messages (2026-10-08):
// 2026-10-08): the hang's root cause was resuming a session with no
// evidence it had done anything, not resuming as such.
export function scanStepFinish(stdout: string): StepFinishScan {
  let reason: string | undefined;
  let sessionId: string | undefined;
  let stepCount = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: { reason?: string; sessionID?: string };
      };
      if (event.type === "step-finish") {
        stepCount++;
        if (event.part?.reason) reason = event.part.reason;
        if (event.part?.sessionID) sessionId = event.part.sessionID;
      }
    } catch {
      // ignore: not every line is guaranteed parseable
    }
  }
  return { reason, sessionId, stepCount };
}

// Agent-liveness (docs/specs/agent-liveness/spec.md): a stalled LLM backend
// still produces a healthy engine heartbeat, because the engine only knows
// the process is alive, not whether the agent is making progress. Reading
// stdout incrementally (rather than once, at exit, as `scanStepFinish`'s
// caller used to) gives a real per-event liveness signal to fold into the
// heartbeat. No polyfill: Bun's stream primitives are enough for a line
// splitter this small.
const PROGRESS_THROTTLE_MS = 30_000;

/** Reads `stream` to completion, decoding incrementally and calling `onLine`
 *  for each newline-delimited line as it arrives (unterminated trailing
 *  content, if any, is flushed as a final line). Returns the full decoded
 *  text — the same value `await new Response(stream).text()` would have
 *  produced — so existing full-text parsing (`scanStepFinish`) keeps
 *  working unchanged. */
export async function readIncrementally(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    buffered += chunk;
    for (;;) {
      const newlineAt = buffered.indexOf("\n");
      if (newlineAt === -1) break;
      onLine(buffered.slice(0, newlineAt));
      buffered = buffered.slice(newlineAt + 1);
    }
  }
  const tail = decoder.decode();
  full += tail;
  buffered += tail;
  if (buffered.length > 0) onLine(buffered);
  return full;
}

// Retry-with-feedback (P0): the engine replays the identical prompt on
// retry — attempt 2 had no idea why attempt 1 failed. Record this
// dispatch's failure reason; if the same dispatch key runs again, the
// retry's prompt opens with the reason so it can correct course (e.g.
// "handoff not written", "handoff unparseable", exit stderr tail).
// Unaffected by same-session nudging (docs/specs/session-nudge/spec.md):
// this cache covers the fresh-session case, nudging covers the
// same-session case, and the two never fire on the same attempt.
const lastFailures = new Map<string, string>();

// Run-context digest (P1): the planning phase may publish a digest at
// .darkf/run/<runId>/context.md (the consumer repo's next_task builds it).
// Fresh-session-per-dispatch means every agent re-reads prd/design via tool
// calls (1–3 min each dispatch); a pre-extracted digest appended to the
// prompt replaces most of those round-trips. Absent file → empty string.
function contextBlock(rootDir: string, runId: string): string {
  const path = join(rootDir, ".darkf", "run", runId, "context.md");
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export const opencodeRunner: AgentRunner = {
  kind: "opencode",
  async run(id, def, handoff, info: DispatchInfo, onProgress?: (p: AgentProgress) => void) {
    const path = handoffPath(info.rootDir, info.runId, info.step, id);
    await mkdir(dirname(path), { recursive: true });

    const agentConfig = def.agent ?? {};
    // No default model: silent-model-fallback (run-resilience fog ticket)
    // moved silent → warn over time; shipping publicly finishes the arc.
    // The workflow's pins are the contract — their absence is a crash.
    const model = agentConfig.model as string | undefined;
    if (!model) {
      throw new Error(
        `agent state "${id}" has no model pin — pin agent: { model } in the workflow.`,
      );
    }
    // Opt-in per agent state: agent: { auto: true } passes opencode's --auto,
    // which approves every ask-level permission for the dispatch (explicit
    // deny rules still hold). Deliberately NOT a runner default — an
    // unattended run (2026-10-13) crashed twice on `rm -rf *` asks that
    // headless mode auto-rejects (finish=tool-calls, handoff not written),
    // but blanket --auto would also silently approve force-push asks in
    // unattended runs. Each workflow chooses.
    const auto = agentConfig.auto === true;

    const dispatchKey = `${info.runId}:${info.step}:${id}`;

    // Same-session nudge (docs/specs/session-nudge/spec.md): when the
    // previous attempt failed in a repairable way and we have its session
    // id, send a short corrective message into that session instead of a
    // fresh prompt. `-s` resume is scoped strictly to this case — see the
    // "No -s outside a nudge" note below.
    const nudge = nudgeMessage(info, path);

    let prompt: string;
    if (nudge) {
      prompt = nudge;
    } else {
      const promptParts: string[] = [];

      const feedback = lastFailures.get(dispatchKey);
      if (feedback) {
        promptParts.push(
          `Your previous attempt at this step failed: ${feedback}. Avoid that failure; if your output contract was the problem, follow it exactly.`,
        );
        lastFailures.delete(dispatchKey);
      }

      const digest = contextBlock(info.rootDir, info.runId);
      if (digest) {
        promptParts.push(
          `Run context digest (pre-extracted from the spec documents — use it to orient; consult the full docs only for depth):\n\n${digest}`,
        );
      }

      promptParts.push(buildPrompt(def, handoff, info, path));
      prompt = promptParts.join("\n\n");
    }

    // --auto is opt-in per agent state (see `auto` above): the global
    // ~/.config/opencode/opencode.json policy ("*": "allow", with
    // rm -rf/force-push asking, "question": "deny") is normally enough for
    // headless runs, but any ask a workflow's agents can plausibly hit
    // (e.g. scratch-dir `rm -rf`) needs --auto or a narrower config allow.
    // Resolve once: spawn can miss PATH lookups in daemonized workers.
    //
    // No -s outside a nudge: an unattended run (2026-10-08) — the
    // task_plan dispatch resumed req_gate's session via `-s` and hung 15
    // minutes with ZERO messages persisted (opencode.db: session's last row
    // predates the dispatch), then exited 0 without writing the handoff →
    // terminal runner crash. `scanStepFinish`'s `stepCount` guard (above) is
    // what makes `-s` safe again — the hang's root cause was resuming a
    // session with no evidence it had done anything, not resuming as such —
    // but it's deliberately only ever used for the one case this spec
    // scoped it to (a nudge, immediately after a nudgeable failure in the
    // same outer attempt). A fresh or exhausted-nudge dispatch always
    // starts a brand-new session, exactly as today, even when
    // `info.agentSessionId` happens to be set.
    const bin = Bun.which("opencode") ?? "opencode";
    const args = [
      bin,
      "run",
      ...(nudge ? ["-s", info.agentSessionId!] : []),
      ...(auto ? ["--auto"] : []),
      "-m",
      model,
      "--format",
      "json",
    ];
    args.push(prompt);

    // No --dir: verified live that opencode resolves relative paths against
    // the spawned process's actual OS cwd when --dir is omitted — Bun.spawn's
    // own `cwd` option (same mechanism claude-code.ts already uses) is
    // sufficient, no extra flag needed.
    const proc = Bun.spawn(args, { cwd: info.rootDir, stdout: "pipe", stderr: "pipe" });
    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const killTimer = setTimeout(() => proc.kill(), timeoutMs);

    let stdout = "";
    let exitCode: number;
    let stepCount = 0;
    let lastEventAt = Date.now();
    let lastEvent = "";
    let lastProgressAt = 0;
    const onLine = (line: string) => {
      if (!line.trim()) return;
      lastEventAt = Date.now();
      try {
        const event = JSON.parse(line) as { type?: string };
        if (event.type) lastEvent = event.type;
        if (event.type === "step-finish") stepCount++;
      } catch {
        // ignore: not every line is guaranteed parseable (same tolerance
        // scanStepFinish's final pass already has)
      }
      if (onProgress && lastEventAt - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        lastProgressAt = lastEventAt;
        onProgress({ at: lastEventAt, stepCount, lastEvent });
      }
    };
    try {
      stdout = await readIncrementally(proc.stdout, onLine);
      exitCode = await proc.exited;
    } finally {
      clearTimeout(killTimer);
    }

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      const reason = `opencode exited ${exitCode}: ${stderr.trim().slice(-400)}`;
      lastFailures.set(dispatchKey, reason);
      const scan = scanStepFinish(stdout);
      throw new AgentFailure(reason, {
        agentSessionId: scan.stepCount > 0 ? scan.sessionId : undefined,
        crashReason: { kind: "runner-error", error: reason },
      });
    }

    // agentSessionId is only ever attached — on the returned NodeResult
    // below or on a thrown AgentFailure above — when `stepCount > 0`;
    // absent that evidence, the engine runs the next attempt fresh exactly
    // as it does for a runner that never resumes.
    if (!existsSync(path)) {
      const scan = scanStepFinish(stdout);
      const reason = `handoff not written (opencode finish=${scan.reason ?? "unknown"})`;
      lastFailures.set(dispatchKey, reason);
      throw new AgentFailure(reason, {
        agentSessionId: scan.stepCount > 0 ? scan.sessionId : undefined,
        crashReason: { kind: "handoff-missing" },
      });
    }
    try {
      const raw = await readHandoff(path);
      lastFailures.delete(dispatchKey);
      const scan = scanStepFinish(stdout);
      if (scan.stepCount > 0 && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        const result = raw as Record<string, unknown>;
        if (result.agentSessionId === undefined) result.agentSessionId = scan.sessionId;
      }
      return raw as NodeResult;
    } catch (e) {
      const parseError = e instanceof Error ? e.message : String(e);
      const reason = `handoff unparseable: ${parseError}`;
      lastFailures.set(dispatchKey, reason);
      const scan = scanStepFinish(stdout);
      throw new AgentFailure(reason, {
        agentSessionId: scan.stepCount > 0 ? scan.sessionId : undefined,
        crashReason: { kind: "handoff-unparseable", parseError },
      });
    }
  },
};
