import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentFailure, type AgentStateDef, type DispatchInfo } from "../../core/index.ts";
import { handoffPath } from "./handoff.ts";
import { matchUsageLimit, opencodeRunner, readIncrementally, scanStepFinish } from "./opencode.ts";

function ndjson(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

/** A stream that yields exactly `chunks`, as given — lets a test control
 *  chunk boundaries precisely (mid-line). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

/** Same, but splits raw bytes at `splitAt` — lets a test put a chunk
 *  boundary in the middle of a multi-byte UTF-8 character. */
function streamOfBytesSplitAt(text: string, splitAt: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i++]!);
    },
  });
}

describe("scanStepFinish", () => {
  test("reports stepCount 0 and no session id on an empty stream", () => {
    const scan = scanStepFinish("");
    expect(scan.stepCount).toBe(0);
    expect(scan.sessionId).toBeUndefined();
    expect(scan.reason).toBeUndefined();
  });

  test("ignores lines that aren't step-finish or aren't parseable JSON", () => {
    const stdout = ndjson([
      { type: "message", part: { sessionID: "sess-x" } },
      { type: "step-finish", part: { reason: "stop", sessionID: "sess-1" } },
    ]);
    const scan = scanStepFinish(`not json\n${stdout}\n`);
    expect(scan.stepCount).toBe(1);
    expect(scan.sessionId).toBe("sess-1");
    expect(scan.reason).toBe("stop");
  });

  test("counts every step-finish event and keeps the LAST reason/sessionID seen", () => {
    const stdout = ndjson([
      { type: "step-finish", part: { reason: "tool-calls", sessionID: "sess-1" } },
      { type: "step-finish", part: { reason: "stop", sessionID: "sess-1" } },
      { type: "step-finish", part: { reason: "length" } }, // no sessionID on this one
    ]);
    const scan = scanStepFinish(stdout);
    expect(scan.stepCount).toBe(3);
    expect(scan.reason).toBe("length");
    // sessionID carries forward from the last event that had one.
    expect(scan.sessionId).toBe("sess-1");
  });

  test("does not match the underscore spelling step_finish", () => {
    const stdout = ndjson([{ type: "step_finish", part: { reason: "stop", sessionID: "sess-1" } }]);
    const scan = scanStepFinish(stdout);
    expect(scan.stepCount).toBe(0);
    expect(scan.sessionId).toBeUndefined();
  });

  test("stepCount is the positive-evidence gate: zero means no session id should ever be attached", () => {
    // No step-finish at all — e.g. the process died before any turn
    // completed. A caller must not attach `sessionId` in this case even if
    // one happened to be present on a non-step-finish event.
    const stdout = ndjson([{ type: "message", part: { sessionID: "sess-ghost" } }]);
    const scan = scanStepFinish(stdout);
    expect(scan.stepCount).toBe(0);
    expect(scan.sessionId).toBeUndefined();
  });
});

describe("readIncrementally", () => {
  test("returns the full text unchanged, equivalent to reading the stream whole", async () => {
    const text = "line one\nline two\nline three\n";
    const full = await readIncrementally(streamOf([text]), () => {});
    expect(full).toBe(text);
  });

  test("calls onLine once per line, in order, as they arrive — not all at once at the end", async () => {
    const seen: string[] = [];
    const full = await readIncrementally(
      streamOf(["line one\nli", "ne two\n", "line three\n"]),
      (line) => seen.push(line),
    );
    expect(seen).toEqual(["line one", "line two", "line three"]);
    expect(full).toBe("line one\nline two\nline three\n");
  });

  test("flushes an unterminated trailing line once the stream ends", async () => {
    const seen: string[] = [];
    const full = await readIncrementally(streamOf(["line one\nno newline here"]), (line) =>
      seen.push(line),
    );
    expect(seen).toEqual(["line one", "no newline here"]);
    expect(full).toBe("line one\nno newline here");
  });

  test("an empty stream produces no lines and empty text", async () => {
    const seen: string[] = [];
    const full = await readIncrementally(streamOf([]), (line) => seen.push(line));
    expect(seen).toEqual([]);
    expect(full).toBe("");
  });

  test("decodes a multi-byte UTF-8 character split across a chunk boundary", async () => {
    // "café\n" — "é" is 2 bytes (0xC3 0xA9); split the stream mid-character.
    const text = "café\n";
    const bytes = new TextEncoder().encode(text);
    const splitAt = bytes.length - 2; // inside "é"'s 2-byte sequence
    const seen: string[] = [];
    const full = await readIncrementally(streamOfBytesSplitAt(text, splitAt), (line) =>
      seen.push(line),
    );
    expect(full).toBe(text);
    expect(seen).toEqual(["café"]);
  });
});

// --- usage-limit-backoff (docs/specs/usage-limit-backoff/spec.md) ---

describe("matchUsageLimit", () => {
  test("matches the captured usage-limit line, case-insensitively, returning the line itself", () => {
    const captured = "Usage limit reached for 5 hour. Your limit will reset at 2026-11-01 06:58:19";
    expect(matchUsageLimit(`${captured}\n`, "")).toBe(captured);
    expect(matchUsageLimit("", "USAGE LIMIT EXHAUSTED — retry later\n")).toBe(
      "USAGE LIMIT EXHAUSTED — retry later",
    );
  });

  test("matches the full conservative marker set: rate limit, limit exceeded, 429", () => {
    expect(matchUsageLimit("rate limit exceeded for org\n", "")).toBe(
      "rate limit exceeded for org",
    );
    expect(matchUsageLimit("", "limit exceeded: reduce your request rate\n")).toBe(
      "limit exceeded: reduce your request rate",
    );
    expect(matchUsageLimit("HTTP 429: too many requests\n", "")).toBe(
      "HTTP 429: too many requests",
    );
  });

  test("scans stderr first, then stdout, returning the first matched line", () => {
    expect(matchUsageLimit("first stderr rate limit\n", "second stdout usage limit\n")).toBe(
      "first stderr rate limit",
    );
    expect(matchUsageLimit("", "stdout usage limit\n")).toBe("stdout usage limit");
  });

  test("never matches an agent-authored JSON line, even when its text contains a marker", () => {
    const json = JSON.stringify({
      type: "message",
      part: { text: "the agent mused about the usage limit" },
    });
    expect(matchUsageLimit("", json)).toBeUndefined();
    expect(matchUsageLimit(`${json}\nplain usage limit line\n`, "")).toBe("plain usage limit line");
  });

  test("an ordinary non-limit API error does not match", () => {
    expect(matchUsageLimit("opencode: API error 500: backend exploded\n", "")).toBeUndefined();
    expect(matchUsageLimit("", '{"type":"step-finish","part":{"reason":"stop"}}')).toBeUndefined();
  });
});

// Runner-level classification and resume paths. A fake `opencode` binary
// stands in for the real CLI: it records argv (NUL-separated, prompts contain
// newlines), emits NDJSON, optionally writes the handoff file, and exits with
// a scripted code — so `Bun.spawn` runs unmocked. `Bun.which` is mocked to
// resolve it: it snapshots PATH at process start, so mutating the env at
// test time has no effect.
describe("opencodeRunner usage-limit classification + resume", () => {
  let fakeDir: string;
  let realWhich: typeof Bun.which;

  beforeAll(() => {
    fakeDir = mkdtempSync(join(tmpdir(), "darkf-opencode-fake-"));
    realWhich = Bun.which;
    Bun.which = ((bin: string) =>
      bin === "opencode" ? join(fakeDir, "opencode") : realWhich(bin)) as typeof Bun.which;
  });

  afterAll(() => {
    Bun.which = realWhich;
    rmSync(fakeDir, { recursive: true, force: true });
  });

  const RUN_ID = "f1e2d3c4-1111-4222-8333-444455556666";
  const def: AgentStateDef = {
    type: "agent",
    prompt: "FRESH-PROMPT-MARKER do the task",
    agent: { model: "test-model" },
  };

  /** Installs a scripted fake binary and a per-test scratch rootDir. The
   *  builder receives the rootDir and the argv log path, both baked into the
   *  script text. */
  function install(build: (rootDir: string, argvFile: string) => string): {
    rootDir: string;
    argvFile: string;
  } {
    const rootDir = mkdtempSync(join(tmpdir(), "darkf-opencode-run-"));
    const argvFile = join(rootDir, "argv.bin");
    writeFileSync(join(fakeDir, "opencode"), `#!/bin/sh\n${build(rootDir, argvFile)}\n`);
    chmodSync(join(fakeDir, "opencode"), 0o755);
    return { rootDir, argvFile };
  }

  function readArgv(argvFile: string): string[] {
    return readFileSync(argvFile, "utf8")
      .split("\0")
      .filter((arg) => arg.length > 0);
  }

  function info(rootDir: string, over: Partial<DispatchInfo> = {}): DispatchInfo {
    return {
      runId: RUN_ID,
      validEvents: ["ok"],
      hasFallback: false,
      attempt: 1,
      step: 1,
      rootDir,
      ...over,
    };
  }

  function successScript(rootDir: string, argvFile: string, sessionId: string): string {
    const handoffFile = handoffPath(rootDir, RUN_ID, 1, "N");
    return [
      `printf '%s\\0' "$@" > "${argvFile}"`,
      `echo '{"type":"step-finish","part":{"reason":"stop","sessionID":"${sessionId}"}}'`,
      `mkdir -p "$(dirname "${handoffFile}")"`,
      `echo '{"event":"ok"}' > "${handoffFile}"`,
    ].join("\n");
  }

  test("a non-zero exit with the captured limit message classifies usage-limit, with the evidence-gated session id", async () => {
    const { rootDir } = install((_rootDir, _argvFile) =>
      [
        `echo 'Usage limit reached for 5 hour. Your limit will reset at 2026-11-01 06:58:19' 1>&2`,
        `echo '{"type":"step-finish","part":{"reason":"stop","sessionID":"sess-wall"}}'`,
        `exit 3`,
      ].join("\n"),
    );

    let thrown: unknown;
    try {
      await opencodeRunner.run("N", def, {}, info(rootDir));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AgentFailure);
    const failure = thrown as AgentFailure;
    expect(failure.crashReason).toEqual({
      kind: "usage-limit",
      detail: "Usage limit reached for 5 hour. Your limit will reset at 2026-11-01 06:58:19",
    });
    expect(failure.agentSessionId).toBe("sess-wall");
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("a non-zero exit with a non-limit API error stays runner-error", async () => {
    const { rootDir } = install((_rootDir, _argvFile) =>
      [`echo 'API error: 500 backend exploded' 1>&2`, `exit 1`].join("\n"),
    );

    let thrown: unknown;
    try {
      await opencodeRunner.run("N", def, {}, info(rootDir));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AgentFailure);
    const failure = thrown as AgentFailure;
    expect(failure.crashReason).toEqual({
      kind: "runner-error",
      error: expect.stringContaining("500 backend exploded"),
    });
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("an exit-0 + missing-handoff output with a limit string inside an agent JSON line stays handoff-missing", async () => {
    const { rootDir } = install((_rootDir, _argvFile) =>
      [
        `echo '{"type":"message","part":{"text":"note to self: mind the usage limit"}}'`,
        `exit 0`,
      ].join("\n"),
    );

    let thrown: unknown;
    try {
      await opencodeRunner.run("N", def, {}, info(rootDir));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AgentFailure);
    expect((thrown as AgentFailure).crashReason).toEqual({ kind: "handoff-missing" });
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("resume: previousFailure usage-limit + agentSessionId dispatches -s and the continuation prompt, not the fresh prompt", async () => {
    const { rootDir, argvFile } = install((dir, argv) => successScript(dir, argv, "sess-9"));

    const result = await opencodeRunner.run("N", def, {}, {
      ...info(rootDir),
      previousFailure: { kind: "usage-limit", detail: "Usage limit reached for 5 hour." },
      agentSessionId: "sess-9",
    } as DispatchInfo);

    expect(result).toEqual({ event: "ok", agentSessionId: "sess-9" });
    const argv = readArgv(argvFile);
    expect(argv).toContain("-s");
    expect(argv).toContain("sess-9");
    const prompt = argv.at(-1)!;
    expect(prompt).toContain("A provider usage limit interrupted your previous turn.");
    expect(prompt).toContain("Continue where you left off.");
    // The handoff contract text still closes the continuation prompt...
    expect(prompt).toContain("write your result as JSON to this exact path");
    // ...and the full fresh prompt is NOT replayed.
    expect(prompt).not.toContain("FRESH-PROMPT-MARKER");
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("resume without a session id (no persisted evidence) dispatches fresh, without -s", async () => {
    const { rootDir, argvFile } = install((dir, argv) => successScript(dir, argv, "sess-unused"));

    const result = await opencodeRunner.run("N", def, {}, {
      ...info(rootDir),
      previousFailure: { kind: "usage-limit", detail: "Usage limit reached for 5 hour." },
    } as DispatchInfo);

    expect(result).toEqual({ event: "ok", agentSessionId: "sess-unused" });
    const argv = readArgv(argvFile);
    expect(argv).not.toContain("-s");
    const prompt = argv.at(-1)!;
    // The fresh prompt path, unchanged.
    expect(prompt).toContain("FRESH-PROMPT-MARKER");
    expect(prompt).not.toContain("Continue where you left off");
    rmSync(rootDir, { recursive: true, force: true });
  });
});
