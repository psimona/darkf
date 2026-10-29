---
title: Core types
description: The shared vocabulary every darkf folder builds on — @psimona/darkf/src/core/types.ts.
---

These types are `core`'s whole public surface. Everything else in
the repo is built on top of them.

```ts
export interface NodeResult {
  event?: string;
  output?: unknown;
  sessionId?: string;
}

export const EXIT = "[*]" as const;

export interface AgentStateDef {
  type: "agent";
  prompt: string;
  agent?: Record<string, unknown>;
  on?: Record<string, string>;
  next?: string;
  retries?: number;
  timeoutMs?: number;
  validate?: (result: NodeResult, handoff: NodeResult) => string | undefined;
}

export interface ScriptStateDef {
  type: "script";
  file: string;
  on?: Record<string, string>;
  next?: string;
  retries?: number;
  timeoutMs?: number;
  validate?: (result: NodeResult, handoff: NodeResult) => string | undefined;
}

export interface CompositeStateDef {
  initial: string;
  states: Record<string, StateDef>;
  maxCycles?: number;
}

export type StateDef = AgentStateDef | ScriptStateDef | CompositeStateDef;

export interface WorkflowDef {
  initial: string;
  states: Record<string, StateDef>;
}

export interface DispatchInfo {
  runId: string;
  validEvents: string[];
  hasFallback: boolean;
  attempt: number;
  sessionId?: string;
  previousFailure?: CrashReason;
  step: number;
  rootDir: string;
}

export interface AgentRunner {
  kind?: string;
  run(id: string, def: AgentStateDef, handoff: NodeResult, info: DispatchInfo): Promise<NodeResult>;
}

export interface ScriptRunner {
  run(id: string, def: ScriptStateDef, handoff: NodeResult, baseDir: string, info: DispatchInfo): Promise<NodeResult>;
}

export type NodeStatus =
  | { phase: "pending" }
  | { phase: "running"; attempt: number; startedAt: number; lastHeartbeat: number; sessionId?: string }
  | { phase: "succeeded"; result: NodeResult }
  | { phase: "crashed"; reason: CrashReason; attempt: number };

export type CrashReason =
  | { kind: "runner-error"; error: string }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "malformed-result" }
  | { kind: "validation-failed"; message: string }
  | { kind: "no-transition"; state: string; event?: string }
  | { kind: "unresolved-target"; from: string; target: string }
  | { kind: "duplicate-id"; id: string }
  | { kind: "max-steps"; steps: number; state: string }
  | { kind: "cycle-limit"; composite: string; cycles: number };

export interface StepTrace {
  state: string;
  scopePath: string[];
  result: NodeResult;
  timestamp: number;
}

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
```

`NodeEvent` is the journal's own line shape — see [Journal](../../concepts/journal/).
`StepTrace` is narrower: one entry per succeeded leaf dispatch, used
for routing and debugging rather than the full transition history.

See [Node types](../../concepts/node-types/) and [Failure
modes](../../concepts/failure-modes/) for what these mean in use, not just
their shape.
