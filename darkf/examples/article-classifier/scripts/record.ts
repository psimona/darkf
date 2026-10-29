import type { NodeResult } from "@psimona/darkf/src/core/index.ts";
import { recordCategory } from "./queue.ts";

export default function record(handoff: NodeResult): NodeResult {
  // Classify's event IS the category — this script's only job is the
  // "useful thing to do" with it (here: file it away for the final report).
  const results = recordCategory(handoff.event ?? "other");
  return { output: { results } };
}
