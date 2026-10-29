import type { NodeResult } from "@psimona/darkf/src/core/index.ts";
import { allResults, currentArticle, isDone } from "./queue.ts";

export default function next(_handoff: NodeResult): NodeResult {
  if (isDone()) return { event: "done", output: { results: allResults() } };
  return { event: "have_item", output: { article: currentArticle() } };
}
