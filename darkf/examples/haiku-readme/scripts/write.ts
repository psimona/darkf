import type { NodeResult } from "@psimona/darkf/src/core/index.ts";

interface WriteHandoff {
  writeAttempts?: number;
}

export default function write(handoff: NodeResult): NodeResult {
  const writeAttempts = ((handoff.output as WriteHandoff | undefined)?.writeAttempts ?? 0) + 1;
  return { output: { writeAttempts } };
}
