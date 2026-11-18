import { describe, expect, test } from "bun:test";
import { isNodeResult } from "./types.ts";

describe("isNodeResult", () => {
  test("accepts the full envelope: typed event, output, agentSessionId", () => {
    expect(isNodeResult({ event: "done", output: { ok: true }, agentSessionId: "ses_1" })).toBe(
      true,
    );
  });

  test("accepts a bare object with no fields at all — everything is optional", () => {
    expect(isNodeResult({})).toBe(true);
  });

  test("accepts partial envelopes: event only, output only, agentSessionId only", () => {
    expect(isNodeResult({ event: "planned" })).toBe(true);
    expect(isNodeResult({ output: [1, 2, 3] })).toBe(true);
    expect(isNodeResult({ agentSessionId: "ses_abc" })).toBe(true);
  });

  test("accepts extra fields — the check is non-strict", () => {
    expect(isNodeResult({ event: "done", agentSessionId: "ses_1", extra: "ignored" })).toBe(true);
  });

  test("rejects null", () => {
    expect(isNodeResult(null)).toBe(false);
  });

  test("rejects other non-object values", () => {
    expect(isNodeResult(undefined)).toBe(false);
    expect(isNodeResult("done")).toBe(false);
    expect(isNodeResult(42)).toBe(false);
    expect(isNodeResult(true)).toBe(false);
  });

  test("rejects a wrong-typed event", () => {
    expect(isNodeResult({ event: 7 })).toBe(false);
    expect(isNodeResult({ event: null })).toBe(false);
  });

  test("rejects a wrong-typed agentSessionId", () => {
    expect(isNodeResult({ agentSessionId: 42 })).toBe(false);
    expect(isNodeResult({ agentSessionId: null })).toBe(false);
  });

  test("rejects an array — new behavior; the hand-rolled check let it through", () => {
    expect(isNodeResult(["done"])).toBe(false);
    expect(isNodeResult([])).toBe(false);
    // An array carrying the right keys on its elements still is not a NodeResult.
    expect(isNodeResult([{ event: "done", agentSessionId: "ses_1" }])).toBe(false);
  });
});
