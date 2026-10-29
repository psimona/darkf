import { describe, expect, test } from "bun:test";
import { parseClaudeUsage } from "./claude-code.ts";

describe("parseClaudeUsage", () => {
  test("parses a full claude -p json envelope", () => {
    const u = parseClaudeUsage(
      JSON.stringify({
        type: "result",
        total_cost_usd: 0.421,
        duration_ms: 134_000,
        num_turns: 12,
        session_id: "s1",
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 200,
          output_tokens: 4_500,
        },
      }),
    );
    expect(u.costUsd).toBe(0.421);
    expect(u.durationMs).toBe(134_000);
    expect(u.numTurns).toBe(12);
    expect(u.inputTokens).toBe(1000);
    expect(u.cacheReadTokens).toBe(50_000);
    expect(u.outputTokens).toBe(4_500);
  });

  test("degrades to zeros/nulls on missing fields and invalid json", () => {
    const empty = parseClaudeUsage(JSON.stringify({}));
    expect(empty.costUsd).toBeNull();
    expect(empty.inputTokens).toBe(0);
    const junk = parseClaudeUsage("not json at all");
    expect(junk.costUsd).toBeNull();
    expect(junk.outputTokens).toBe(0);
  });
});
