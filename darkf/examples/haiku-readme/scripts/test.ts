import type { NodeResult } from "@psimona/darkf/src/core/index.ts";

interface TestHandoff {
  writeAttempts?: number;
}

export default function test(handoff: NodeResult): NodeResult {
  const writeAttempts = (handoff.output as TestHandoff | undefined)?.writeAttempts ?? 0;
  // Must re-emit writeAttempts: if Test fails and routes back to Write, Write
  // only ever sees THIS result as its next handoff — nothing carries forward
  // unless this node's own code chooses to relay it.
  return { event: writeAttempts >= 2 ? "passed" : "failed", output: { writeAttempts } };
}
