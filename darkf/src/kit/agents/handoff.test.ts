import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DispatchInfo } from "../../core/index.ts";
import { handoffContractText, handoffPath, nudgeMessage, readHandoff } from "./handoff.ts";

const testRootDir = await mkdtemp(join(tmpdir(), "darkf-cli-handoff-test-"));
afterAll(() => rm(testRootDir, { recursive: true, force: true }));

test("handoffPath zero-pads step to 4 digits under the run's handoff dir", () => {
  expect(handoffPath("/root", "run-1", 1, "Plan")).toBe(
    join("/root", ".darkf", "run", "run-1", "handoff", "0001-Plan.json"),
  );
  expect(handoffPath("/root", "run-1", 42, "Review")).toBe(
    join("/root", ".darkf", "run", "run-1", "handoff", "0042-Review.json"),
  );
});

test("handoffPath disambiguates the same nodeId revisited at different steps", () => {
  const first = handoffPath("/root", "run-1", 2, "Write");
  const second = handoffPath("/root", "run-1", 4, "Write");
  expect(first).not.toBe(second);
  expect(first).toBe(join("/root", ".darkf", "run", "run-1", "handoff", "0002-Write.json"));
  expect(second).toBe(join("/root", ".darkf", "run", "run-1", "handoff", "0004-Write.json"));
});

test("handoffContractText names the exact path the agent must write to", () => {
  const text = handoffContractText("/some/path/0001-Plan.json");
  expect(text).toContain("/some/path/0001-Plan.json");
});

test("readHandoff parses a well-formed handoff file", async () => {
  const path = join(testRootDir, "0001-Plan.json");
  await writeFile(path, JSON.stringify({ event: "approved", output: { plan: "x" } }));

  await expect(readHandoff(path)).resolves.toEqual({ event: "approved", output: { plan: "x" } });
});

test("readHandoff throws when the file is missing", async () => {
  const path = join(testRootDir, "missing", "0002-Nope.json");
  await expect(readHandoff(path)).rejects.toThrow();
});

test("readHandoff throws on malformed JSON, un-validated otherwise", async () => {
  const dir = join(testRootDir, "malformed");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "0003-Bad.json");
  await writeFile(path, "{not json");

  await expect(readHandoff(path)).rejects.toThrow();
});

test("readHandoff returns whatever parses, with no shape check of its own", async () => {
  const path = join(testRootDir, "0004-Anything.json");
  await writeFile(path, JSON.stringify({ notAtAllANodeResult: true, count: 3 }));

  await expect(readHandoff(path)).resolves.toEqual({ notAtAllANodeResult: true, count: 3 });
});

test("readHandoff round-trips a plain array or primitive without objecting", async () => {
  const path = join(testRootDir, "0005-Primitive.json");
  await writeFile(path, "42");

  await expect(readHandoff(path)).resolves.toBe(42);
});

function baseInfo(overrides: Partial<DispatchInfo> = {}): DispatchInfo {
  return {
    runId: "run-1",
    validEvents: ["ok", "changes_requested"],
    hasFallback: false,
    attempt: 1,
    step: 1,
    rootDir: "/root",
    ...overrides,
  };
}

test("nudgeMessage is undefined with no previousFailure, even with a session id", () => {
  expect(nudgeMessage(baseInfo({ agentSessionId: "sess-1" }), "/path")).toBeUndefined();
});

test("nudgeMessage is undefined with a nudgeable failure but no session id", () => {
  const info = baseInfo({ previousFailure: { kind: "handoff-missing" } });
  expect(nudgeMessage(info, "/path")).toBeUndefined();
});

test("nudgeMessage is undefined for a non-nudgeable failure, even with a session id", () => {
  const info = baseInfo({
    agentSessionId: "sess-1",
    previousFailure: { kind: "runner-error", error: "boom" },
  });
  expect(nudgeMessage(info, "/path")).toBeUndefined();
});

test("nudgeMessage builds the handoff-missing repair text", () => {
  const info = baseInfo({
    agentSessionId: "sess-1",
    previousFailure: { kind: "handoff-missing" },
  });
  const msg = nudgeMessage(info, "/root/.darkf/run/run-1/handoff/0001-Plan.json")!;
  expect(msg).toContain("without writing the result file");
  expect(msg).toContain("/root/.darkf/run/run-1/handoff/0001-Plan.json");
  expect(msg).toContain("ok, changes_requested");
});

test("nudgeMessage builds the handoff-unparseable repair text, quoting the parse error", () => {
  const info = baseInfo({
    agentSessionId: "sess-1",
    previousFailure: { kind: "handoff-unparseable", parseError: "Unexpected token x" },
  });
  const msg = nudgeMessage(info, "/path/0001-Plan.json")!;
  expect(msg).toContain("failed to parse");
  expect(msg).toContain("Unexpected token x");
  expect(msg).toContain("/path/0001-Plan.json");
});

test("nudgeMessage builds the no-transition repair text, naming the bad event and valid ones", () => {
  const info = baseInfo({
    agentSessionId: "sess-1",
    previousFailure: { kind: "no-transition", state: "Review", event: "maybe" },
  });
  const msg = nudgeMessage(info, "/path")!;
  expect(msg).toContain("maybe");
  expect(msg).toContain("ok, changes_requested");
  expect(msg).toContain("routable event");
});
