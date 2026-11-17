import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DispatchInfo, type NodeResult, parseTaskList } from "@psimona/darkf/src/core/index.ts";

// Plan (agent) distills the spec into a candidate TaskList and hands it on
// as its own output — judgment work, free-form prose in, structured JSON
// out, not something a deterministic script could do. Persisting it to the
// canonical .darkf/run/<runId>/tasks.json path (docs/specs/_built/task-list-json/spec.md,
// Decisions: Colocation) needs info.rootDir/info.runId — only a script
// gets those; a static agent prompt can't interpolate a per-dispatch runId.
// Validating once here with parseTaskList means every downstream node
// (Implement, Fix, Review) trusts the file on disk instead of re-checking
// Plan's own judgment call.
export default async function validatePlan(
  handoff: NodeResult,
  info: DispatchInfo,
): Promise<NodeResult> {
  const parsed = parseTaskList(handoff.output);
  if ("error" in parsed) {
    return { event: "invalid", output: { error: parsed.error } };
  }
  const dir = join(info.rootDir, ".darkf", "run", info.runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks.json"), JSON.stringify(parsed, null, 2));
  return { event: "valid", output: parsed };
}
