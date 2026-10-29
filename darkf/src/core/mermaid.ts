import { DONE, FAILED, isComposite, type StateDef, type WorkflowDef } from "./types.ts";

const TYPE_ICON: Record<"agent" | "script", string> = {
  agent: "🤖",
  script: "▸",
};

const CLASS_COLORS = {
  darkfAgent: "#6d8dfa",
  darkfScript: "#3fae6a",
  darkfActive: "#f96",
  darkfFailed: "#e05252",
} as const;

// A node id, never rendered as literal "[-]" — `[*]` is stateDiagram-v2's one
// hardcoded pseudostate token; `[-]` has no built-in meaning, so left as the
// literal sentinel it would render as a structurally broken diagram (a plain
// state named "[-]"), not merely an unlabeled one.
const FAILED_NODE_ID = "FAILED";

function target(t: string): string {
  if (t === DONE) return "[*]";
  if (t === FAILED) return FAILED_NODE_ID;
  return t;
}

function walk(
  states: Record<string, StateDef>,
  lines: string[],
  agentIds: string[],
  scriptIds: string[],
  usesFailed: { value: boolean },
): void {
  for (const [id, def] of Object.entries(states)) {
    if (isComposite(def)) {
      lines.push(`state ${id} {`);
      lines.push(`  [*] --> ${def.initial}`);
      walk(def.states, lines, agentIds, scriptIds, usesFailed);
      lines.push(`}`);
      continue;
    }

    if (def.type === "agent") agentIds.push(id);
    else scriptIds.push(id);
    lines.push(`${id} : ${TYPE_ICON[def.type]} ${id}`);

    for (const [event, dest] of Object.entries(def.on ?? {})) {
      const t = target(dest);
      if (t === FAILED_NODE_ID) usesFailed.value = true;
      lines.push(`${id} --> ${t} : ${event}`);
    }
    if (def.next) {
      const t = target(def.next);
      if (t === FAILED_NODE_ID) usesFailed.value = true;
      lines.push(`${id} --> ${t}`);
    }
  }
}

export function renderMermaid(workflow: WorkflowDef): string {
  const lines: string[] = ["stateDiagram-v2", `[*] --> ${workflow.initial}`];
  const agentIds: string[] = [];
  const scriptIds: string[] = [];
  const usesFailed = { value: false };

  walk(workflow.states, lines, agentIds, scriptIds, usesFailed);

  if (usesFailed.value) {
    lines.push(`${FAILED_NODE_ID} : ✗ failed`);
  }
  lines.push(`classDef darkfAgent fill:${CLASS_COLORS.darkfAgent}`);
  lines.push(`classDef darkfScript fill:${CLASS_COLORS.darkfScript}`);
  if (agentIds.length) lines.push(`class ${agentIds.join(",")} darkfAgent`);
  if (scriptIds.length) lines.push(`class ${scriptIds.join(",")} darkfScript`);
  if (usesFailed.value) {
    lines.push(`classDef darkfFailed fill:${CLASS_COLORS.darkfFailed}`);
    lines.push(`class ${FAILED_NODE_ID} darkfFailed`);
  }

  return lines.join("\n");
}

export function renderActive(
  workflow: WorkflowDef,
  state: string,
  ancestors: string[] = [],
): string {
  const base = renderMermaid(workflow);
  const activeIds = [state, ...ancestors].join(",");
  return [
    base,
    `classDef darkfActive fill:${CLASS_COLORS.darkfActive}`,
    `class ${activeIds} darkfActive`,
  ].join("\n");
}
