import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { NodeEvent } from "../core/index.ts";

/**
 * The default event sink: appends one JSON line per NodeEvent to `path`.
 * Synchronous by design — events are emitted sequentially within a single
 * run (the engine awaits each dispatch before the next), so a sync append
 * is enough to guarantee line order without a queue. Pair with
 * `parseEventLog` from darkf-core to read one back (e.g. in a web viewer).
 */
export function createJsonlEventLogger(path: string): (event: NodeEvent) => void {
  mkdirSync(dirname(path), { recursive: true });
  return (event: NodeEvent) => {
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  };
}
