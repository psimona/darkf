import type { WorkflowValidationError } from "./graph.ts";

// What a leaf node's dispatch produces when it succeeds. This is also the
// ONLY data a node ever receives from its predecessor — see `handoff` on
// DispatchInfo. There is no separate accumulating context: if a value needs
// to survive past the very next node, some node's own code must choose to
// re-emit it in its own `output`. See PHILOSOPHY.md.
export interface NodeResult {
  event?: string;
  output?: unknown;
  /**
   * Opaque harness-native session/thread id, meaningful only to the runner
   * that returned it. The engine carries it forward into `DispatchInfo` on
   * the next retry attempt of this same node, so a stateless runner can
   * resume the same session instead of starting fresh — darkf-core never
   * interprets or persists it beyond that.
   */
  agentSessionId?: string;
}

export function isNodeResult(value: unknown): value is NodeResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if ("event" in v && v.event !== undefined && typeof v.event !== "string") return false;
  if (
    "agentSessionId" in v &&
    v.agentSessionId !== undefined &&
    typeof v.agentSessionId !== "string"
  )
    return false;
  return true;
}

// Sentinel target meaning "the whole workflow completed its work". Renders
// as mermaid's own end pseudostate.
export const DONE = "[*]" as const;
// Sentinel target meaning "the graph gave up — it could not proceed". Mirrors
// DONE's pseudostate notation; `mermaid.ts` special-cases it the same way,
// since `[-]` has no built-in meaning to stateDiagram-v2 the way `[*]` does.
export const FAILED = "[-]" as const;
// Deprecated alias — kept only for a consumer repo's give-up edges, which still
// route to EXIT on its own schedule (docs/specs/failed-terminal/spec.md).
// Removed in the same change that lands the `run_failure` node + retarget
// table there; any surviving `EXIT` import then fails to compile.
export { DONE as EXIT };

export type Target = string;

export interface BaseLeafDef {
  on?: Record<string, Target>;
  next?: Target;
  /** Bounded re-dispatch attempts after a crash, before giving up. Default 0 (no retry). Leaf-only. */
  retries?: number;
  /** Engine-enforced ceiling on one dispatch attempt. Default 1h. */
  timeoutMs?: number;
  /**
   * Plain code check run against a well-formed NodeResult before it's accepted
   * as `succeeded`. Return a failure message to reject it, or undefined to
   * accept. A rejection consumes a retry attempt exactly like a runner crash.
   */
  validate?: (result: NodeResult, handoff: NodeResult) => string | undefined;
}

export interface AgentStateDef extends BaseLeafDef {
  type: "agent";
  prompt: string;
  agent?: Record<string, unknown>;
}

export interface ScriptStateDef extends BaseLeafDef {
  type: "script";
  file: string;
}

// Pure organizational nesting — no on/next of its own. The engine only ever executes leaves.
export interface CompositeStateDef {
  initial: string;
  states: Record<string, StateDef>;
  /**
   * Opt-in circuit breaker: max leaf dispatches anywhere in this composite's
   * subtree during one continuous pass through it. Unlike a leaf's `retries`
   * (bounded reattempts of one dispatch), this bounds a runaway loop that
   * spans multiple leaves (e.g. two nodes flapping between each other)
   * without ever tripping a per-dispatch timeout. Resets whenever execution
   * re-enters this composite after having left it (dispatched some leaf
   * outside its subtree in between) — a workflow that's re-entered once per
   * item processed (e.g. once per scope in a multi-scope build phase) gets
   * this budget fresh each time, not accumulated across unrelated passes.
   * Undefined = no scoped limit; the engine-wide `maxSteps` remains the
   * unconditional backstop regardless.
   */
  maxCycles?: number;
}

export type StateDef = AgentStateDef | ScriptStateDef | CompositeStateDef;

export interface WorkflowDef {
  initial: string;
  states: Record<string, StateDef>;
}

export function isComposite(def: StateDef): def is CompositeStateDef {
  return "states" in def;
}

// What a leaf gets alongside its own def/ctx on every dispatch attempt.
// `validEvents` + `hasFallback` are how a runner does options-injection/
// classification — e.g. an LLM harness can constrain its structured output or
// list choices in the prompt. `agentSessionId` is never generated or stored by
// darkf-core — it's only ever a value a runner itself returned via a prior
// attempt's NodeResult, relayed back so a stateless runner can resume the
// same harness-native session rather than starting fresh. `previousFailure`
// is what rejected the previous attempt, letting a runner build a repair
// turn (e.g. resume the session and add a corrective prompt) on its own.
export interface DispatchInfo {
  runId: string;
  validEvents: string[];
  hasFallback: boolean;
  attempt: number;
  agentSessionId?: string;
  previousFailure?: CrashReason;
  /**
   * The engine's own step counter for this node's current visit — constant
   * across every retry attempt of that visit. Combined with `rootDir` and
   * `runId`, this is what a runner needs to compute a deterministic path
   * under `.darkf/run/<runId>/` for its own artifacts (e.g. `darkf-cli`'s
   * agent-handoff file convention), with no in-memory visit map of its own.
   */
  step: number;
  /**
   * Mirrors `RunOptions.rootDir` — the root a runner should resolve its own
   * `.darkf/run/<runId>/...` paths against. `ScriptRunner` gets `baseDir` as
   * a dedicated param for an unrelated reason (locating script files);
   * `AgentRunner` has no equivalent, so it's carried here instead.
   */
  rootDir: string;
}

// Open literal union (`LiteralUnion` idiom): the `(string & {})` branch
// stops TypeScript collapsing this back down to plain `string` the way
// `"claude-code" | "opencode" | string` would on its own — an editor still
// autocompletes/typo-catches the two built-ins, but a third-party runner's
// own string still typechecks.
export type AgentRunnerKind = "claude-code" | "opencode" | (string & {});

/**
 * Incremental liveness signal a runner may report via `AgentRunner.run`'s
 * optional `onProgress` callback, throttled to roughly once per 30s —
 * see docs/specs/agent-liveness/spec.md. The engine owns the journal: a
 * runner only ever reports its latest snapshot, never writes anything
 * itself.
 */
export interface AgentProgress {
  /** When this snapshot was taken. */
  at: number;
  /** Cumulative step-level events seen so far this dispatch attempt. */
  stepCount: number;
  /** The most recent event's raw type string — runner-defined (e.g.
   *  opencode's `"step-finish"`), display-only. */
  lastEvent: string;
}

export interface AgentRunner {
  /** Self-identification (e.g. `"opencode"`, `"claude-code"`), set once per
   *  runner implementation. Read by darkf-cli at run-start time to record
   *  which runner executed a run; absent for runners that don't identify
   *  themselves. */
  kind?: AgentRunnerKind;
  run(
    id: string,
    def: AgentStateDef,
    handoff: NodeResult,
    info: DispatchInfo,
    onProgress?: (progress: AgentProgress) => void,
  ): Promise<NodeResult>;
}

export interface ScriptRunner {
  run(
    id: string,
    def: ScriptStateDef,
    handoff: NodeResult,
    baseDir: string,
    info: DispatchInfo,
  ): Promise<NodeResult>;
}

// --- Node execution state machine ---
//
// One shape, used recursively: a leaf dispatching a runner, a composite whose
// current descendant leaf is running, and the whole run itself (the root
// composite's execution) are all "a node executing". Same four phases at
// every depth. A crash at any depth propagates straight to the top — nothing
// in between can catch or reroute it, because composites don't own transitions.
export type NodeStatus =
  | { phase: "pending" }
  | {
      phase: "running";
      attempt: number;
      startedAt: number;
      lastHeartbeat: number;
      agentSessionId?: string;
      /** Latest step count from the agent's own event stream, when the
       *  runner reports progress (`AgentRunner.run`'s optional
       *  `onProgress`) — see docs/specs/agent-liveness/spec.md. Absent for
       *  script dispatches or runners that don't report progress. */
      agentStepCount?: number;
      /** Milliseconds since the last agent-reported progress event, as of
       *  this heartbeat's own timestamp (not live at read time — `status`/
       *  `monitor` add elapsed-since-heartbeat themselves, the same way
       *  they already do for `lastHeartbeat`). Absent under the same
       *  conditions as `agentStepCount`. */
      agentIdleMs?: number;
      /** Set only while the engine is nudging this attempt (1..3) — see
       *  docs/specs/session-nudge/spec.md. Absent on an ordinary dispatch. */
      nudgeAttempt?: number;
      /** The nudgeable `CrashReason` kind that triggered this nudge. */
      nudgeReason?: CrashReason["kind"];
    }
  | { phase: "succeeded"; result: NodeResult }
  | { phase: "failed"; result: NodeResult }
  | { phase: "crashed"; reason: CrashReason; attempt: number };

export type CrashReason =
  | { kind: "runner-error"; error: string }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "handoff-missing" }
  | { kind: "handoff-unparseable"; parseError: string }
  | { kind: "malformed-result" }
  | { kind: "validation-failed"; message: string }
  | { kind: "no-transition"; state: string; event?: string }
  | { kind: "unresolved-target"; from: string; target: string }
  | { kind: "duplicate-id"; id: string }
  | { kind: "max-steps"; steps: number; state: string }
  | { kind: "cycle-limit"; composite: string; cycles: number }
  | { kind: "invalid-workflow"; errors: WorkflowValidationError[] };

/**
 * Thrown by an `AgentRunner` in place of a plain `Error` when the harness
 * session may still be resumable despite the failure. Carries what a plain
 * `Error` can't: the session id to resume, and which `CrashReason` kind this
 * is — so the engine can route the correct nudge template without
 * inspecting the error message string. See
 * docs/specs/session-nudge/spec.md.
 */
export class AgentFailure extends Error {
  agentSessionId?: string;
  crashReason?: CrashReason;
  constructor(message: string, opts?: { agentSessionId?: string; crashReason?: CrashReason }) {
    super(message);
    this.agentSessionId = opts?.agentSessionId;
    this.crashReason = opts?.crashReason;
  }
}

export interface StepTrace {
  state: string;
  scopePath: string[];
  result: NodeResult;
  timestamp: number;
}

// One of these per transition of ANY node's execution machine — a dispatch
// starting, a retry re-entering `running`, a terminal succeeded/crashed. This
// is the full recording; `trace` (below) is just the succeeded-leaf summary
// used for routing/debugging, `onEvent` is the complete stream.
export interface NodeEvent {
  runId: string;
  state: string;
  scopePath: string[];
  status: NodeStatus;
  timestamp: number;
}

export interface RunResult {
  runId: string;
  trace: StepTrace[];
  node: NodeStatus;
}
