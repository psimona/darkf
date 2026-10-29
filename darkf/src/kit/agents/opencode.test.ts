import { describe, expect, test } from "bun:test";
import { readIncrementally, scanStepFinish } from "./opencode.ts";

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
