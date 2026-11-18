import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { zodOutputType } from "./zod.ts";

function expectFailure(result: { success: true } | { success: false; message: string }): string {
  if (result.success) throw new Error("expected a failing parse");
  return result.message;
}

describe("zodOutputType", () => {
  test("a passing schema returns { success: true }, with no message field", () => {
    const outputType = zodOutputType(z.object({ title: z.string() }));
    const result = outputType.safeParse({ title: "hi" });
    expect(result).toEqual({ success: true });
    expect("message" in result).toBe(false);
  });

  test("a failing schema with one bad field returns one issue, its path joined by dots", () => {
    const outputType = zodOutputType(z.object({ tasks: z.array(z.object({ title: z.string() })) }));
    const message = expectFailure(
      outputType.safeParse({ tasks: [{ title: "a" }, { title: "b" }, {}] }),
    );
    // path ["tasks", 2, "title"] -> "tasks.2.title", one issue only (no "; " join)
    expect(message.startsWith("tasks.2.title: ")).toBe(true);
    expect(message).not.toContain("; ");
  });

  test("a root-level failure, with no path, falls back to the word `output`", () => {
    const outputType = zodOutputType(z.string());
    const message = expectFailure(outputType.safeParse(42));
    expect(message.startsWith("output: ")).toBe(true);
  });

  test("a schema with two failing fields returns every issue, joined together, not just the first", () => {
    const outputType = zodOutputType(z.object({ summary: z.string(), count: z.number() }));
    const message = expectFailure(outputType.safeParse({ summary: 1, count: "two" }));
    const parts = message.split("; ");
    expect(parts).toHaveLength(2);
    expect(parts[0].startsWith("summary: ")).toBe(true);
    expect(parts[1].startsWith("count: ")).toBe(true);
  });
});
