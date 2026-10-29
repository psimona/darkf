import type { NodeEvent } from "./types.ts";

/**
 * Parse a JSONL event log's text content back into NodeEvents. Pure and
 * synchronous — no filesystem access — so a web viewer can fetch the file's
 * contents itself and hand the text here. Tolerates a torn trailing line
 * (e.g. the process crashed mid-append): unparsable lines are skipped rather
 * than failing the whole read.
 */
export function parseEventLog(text: string): NodeEvent[] {
  const events: NodeEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as NodeEvent);
    } catch {
      // skip malformed/torn line
    }
  }
  return events;
}
