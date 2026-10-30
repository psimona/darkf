import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  checkRegistry,
  isDue,
  isNewer,
  readState,
  type UpdateDeps,
  updateGate,
  upgradeCmd,
  writeState,
} from "./update.ts";

// --- fixtures: injectable clock, fetch, spawner, temp state file ---

const NOW = 1_793_000_000_000; // fixed epoch ms; every test's "today"
const INSTALLED = "0.3.0";
const HOUR_MS = 60 * 60 * 1000;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "darkf-update-"));
  roots.push(dir);
  return dir;
}

function tempStateFile(): string {
  // Parent deliberately absent — writeState must mkdir -p it.
  return join(tempDir(), "state", "darkf", "last-update-check.json");
}

function seedState(file: string, state: object): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

function rawFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function deps(overrides: Partial<UpdateDeps> = {}): UpdateDeps {
  return {
    now: () => NOW,
    fetchImpl: (async () => {
      throw new Error("unexpected registry access");
    }) as unknown as typeof fetch,
    spawnImpl: (() => {
      throw new Error("unexpected spawn");
    }) as unknown as typeof Bun.spawnSync,
    stateFile: tempStateFile(),
    installed: INSTALLED,
    ...overrides,
  };
}

/** 200-with-body fetch unless a status is given; records the requested URLs. */
function fetchReturning(body: string, status = 200): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    urls.push(String(input));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function fetchCounting(
  body: string,
  status = 200,
): { fetchImpl: typeof fetch; count: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, count: () => calls };
}

/** Hangs until the caller's AbortSignal fires — honors the signal like real fetch. */
const hangingFetch = ((_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener("abort", () => reject(signal.reason));
  })) as typeof fetch;

interface SpawnReply {
  exitCode: number;
  stdout?: string;
}

/** Scripted spawnSync: the reply fn answers each command; unscripted ones throw. */
function spawnStub(script: (cmd: string[]) => SpawnReply | undefined): {
  spawnImpl: typeof Bun.spawnSync;
  calls: string[][];
} {
  const calls: string[][] = [];
  const spawnImpl = ((cmd: unknown, _opts?: unknown) => {
    const argv = [...(cmd as string[])];
    calls.push(argv);
    const reply = script(argv);
    if (!reply) throw new Error(`unexpected spawn: ${argv.join(" ")}`);
    return {
      exitCode: reply.exitCode,
      success: reply.exitCode === 0,
      stdout: Buffer.from(reply.stdout ?? ""),
      stderr: Buffer.from(""),
    };
  }) as unknown as typeof Bun.spawnSync;
  return { spawnImpl, calls };
}

async function captured<T>(fn: () => Promise<T> | T): Promise<{
  result: T;
  out: string[];
  err: string[];
}> {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => void out.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void err.push(args.map(String).join(" "));
  try {
    return { result: await fn(), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function withOptOut<T>(fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.DARKF_NO_UPDATE_CHECK;
  process.env.DARKF_NO_UPDATE_CHECK = "1";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.DARKF_NO_UPDATE_CHECK;
    else process.env.DARKF_NO_UPDATE_CHECK = prev;
  }
}

// --- comparison and due-ness ---

test("isNewer: older, equal, newer, prerelease", () => {
  expect(isNewer("0.3.0", "0.4.0")).toBe(true);
  expect(isNewer("0.3.0", "0.3.0")).toBe(false);
  expect(isNewer("0.4.0", "0.3.0")).toBe(false);
  expect(isNewer("0.3.0", "0.4.0-beta.1")).toBe(true);
});

test("isDue: missing, corrupt, fresh, and the 24h boundary", () => {
  expect(isDue({}, NOW)).toBe(true);
  expect(isDue({ lastCheck: "not a timestamp" }, NOW)).toBe(true);
  expect(isDue({ lastCheck: new Date(NOW - 23 * HOUR_MS).toISOString() }, NOW)).toBe(false);
  // Data model: now - lastCheck >= 24h — exactly one day is due again.
  expect(isDue({ lastCheck: new Date(NOW - 24 * HOUR_MS).toISOString() }, NOW)).toBe(true);
  expect(isDue({ lastCheck: new Date(NOW - 24 * HOUR_MS + 1000).toISOString() }, NOW)).toBe(false);
});

// --- state file ---

test("readState: absent, corrupt, and wrong-shaped files all read as empty", () => {
  expect(readState(join(tempDir(), "does-not-exist.json"))).toEqual({});
  const dir = tempDir();
  const corrupt = join(dir, "state.json");
  writeFileSync(corrupt, "{not json");
  expect(readState(corrupt)).toEqual({});
  const array = join(dir, "array.json");
  writeFileSync(array, "[1,2,3]");
  expect(readState(array)).toEqual({});
  const wrongTypes = join(dir, "types.json");
  writeFileSync(wrongTypes, JSON.stringify({ lastCheck: 5, latestSeen: true }));
  expect(readState(wrongTypes)).toEqual({});
});

test("writeState round-trips and creates missing parent directories", () => {
  const file = tempStateFile();
  writeState(file, { lastCheck: "2026-10-30T08:00:00.000Z", latestSeen: "0.4.0" });
  expect(readState(file)).toEqual({
    lastCheck: "2026-10-30T08:00:00.000Z",
    latestSeen: "0.4.0",
  });
});

test("writeState swallows an unwritable location (REQ-4)", () => {
  const dir = tempDir();
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "a file, not a directory");
  expect(() => writeState(join(blocker, "darkf", "state.json"), {})).not.toThrow();
});

// --- checkRegistry ---

test("checkRegistry: 200 with a semver-shaped latest returns it, at the pinned endpoint", async () => {
  const { fetchImpl, urls } = fetchReturning('{"latest":"0.4.0","next":"0.5.0-rc.1"}');
  expect(await checkRegistry(fetchImpl)).toBe("0.4.0");
  expect(urls).toEqual(["https://registry.npmjs.org/-/package/@psimona%2Fdarkf/dist-tags"]);
});

test("checkRegistry: non-200, malformed JSON, and non-semver latest all return null", async () => {
  expect(await checkRegistry(fetchReturning('{"latest":"9.9.9"}', 503).fetchImpl)).toBeNull();
  expect(await checkRegistry(fetchReturning("not json at all").fetchImpl)).toBeNull();
  expect(await checkRegistry(fetchReturning('{"latest":"banana"}').fetchImpl)).toBeNull();
  expect(await checkRegistry(fetchReturning('{"latest":123}').fetchImpl)).toBeNull();
  expect(await checkRegistry(fetchReturning("{}").fetchImpl)).toBeNull();
});

test("checkRegistry: a fetch that rejects (no network) returns null, never throws", async () => {
  const rejecting = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  expect(await checkRegistry(rejecting)).toBeNull();
});

test("checkRegistry: a hanging request returns null at the 2s abort (NFR-1)", async () => {
  const start = Date.now();
  expect(await checkRegistry(hangingFetch)).toBeNull();
  expect(Date.now() - start).toBeGreaterThanOrEqual(1900);
});

// --- startup gate ---

test("gate on a due day: one request, stamped, newer latestSeen recorded, one notice line", async () => {
  const file = tempStateFile();
  const { fetchImpl, urls } = fetchReturning('{"latest":"9.9.9"}');
  const { out, err } = await captured(() =>
    updateGate("status", deps({ stateFile: file, fetchImpl })),
  );

  expect(urls).toEqual(["https://registry.npmjs.org/-/package/@psimona%2Fdarkf/dist-tags"]);
  expect(out).toEqual([`darkf 9.9.9 available (installed ${INSTALLED}) — run 'darkf upgrade'`]);
  expect(err).toEqual([]);
  expect(readState(file)).toEqual({
    lastCheck: new Date(NOW).toISOString(),
    latestSeen: "9.9.9",
  });
});

test("gate same-day re-run: no request, notice still printed from the record (REQ-2, REQ-11)", async () => {
  const file = tempStateFile();
  const { fetchImpl, count } = fetchCounting('{"latest":"9.9.9"}');
  await captured(() => updateGate("run", deps({ stateFile: file, fetchImpl })));
  expect(count()).toBe(1);

  const later = await captured(() =>
    updateGate("run", deps({ stateFile: file, fetchImpl, now: () => NOW + 3 * HOUR_MS })),
  );
  expect(count()).toBe(1); // no second request within 24 h
  expect(later.out).toEqual([
    `darkf 9.9.9 available (installed ${INSTALLED}) — run 'darkf upgrade'`,
  ]);
});

test("gate: a failed check still stamps and prints nothing (REQ-2, REQ-4)", async () => {
  const file = tempStateFile();
  const { out, err } = await captured(() => updateGate("status", deps({ stateFile: file })));

  expect(out).toEqual([]);
  expect(err).toEqual([]);
  expect(readState(file)).toEqual({ lastCheck: new Date(NOW).toISOString() });
});

test("gate: a stale notice survives a failed check (REQ-11)", async () => {
  const file = tempStateFile();
  seedState(file, { lastCheck: new Date(NOW - 48 * HOUR_MS).toISOString(), latestSeen: "9.9.9" });

  const { out } = await captured(() => updateGate("status", deps({ stateFile: file })));

  expect(out).toEqual([`darkf 9.9.9 available (installed ${INSTALLED}) — run 'darkf upgrade'`]);
  expect(readState(file)).toEqual({
    lastCheck: new Date(NOW).toISOString(), // restamped by the failed attempt
    latestSeen: "9.9.9", // untouched by the null result
  });
});

test("gate: finding the installed version clears the record (REQ-11)", async () => {
  const file = tempStateFile();
  seedState(file, { lastCheck: new Date(NOW - 48 * HOUR_MS).toISOString(), latestSeen: "9.9.9" });
  const { fetchImpl } = fetchReturning(`{"latest":"${INSTALLED}"}`);

  const { out } = await captured(() => updateGate("status", deps({ stateFile: file, fetchImpl })));

  expect(out).toEqual([]);
  expect(readState(file)).toEqual({ lastCheck: new Date(NOW).toISOString() });
});

test("gate: DARKF_NO_UPDATE_CHECK returns before any state read, request, or print (REQ-5)", async () => {
  const file = tempStateFile();
  const sentinel = '{"lastCheck":"kept-untouched"}';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, sentinel);
  const { fetchImpl, count } = fetchCounting('{"latest":"9.9.9"}');

  const { out, err } = await withOptOut(() =>
    captured(() => updateGate("status", deps({ stateFile: file, fetchImpl }))),
  );

  expect(count()).toBe(0);
  expect(out).toEqual([]);
  expect(err).toEqual([]);
  expect(rawFile(file)).toBe(sentinel); // not even a state read side effect
});

test("gate: `upgrade` is skipped — the command fetches on its own", async () => {
  const file = tempStateFile();
  const { fetchImpl, count } = fetchCounting('{"latest":"9.9.9"}');

  const { out, err } = await captured(() =>
    updateGate("upgrade", deps({ stateFile: file, fetchImpl })),
  );

  expect(count()).toBe(0);
  expect(out).toEqual([]);
  expect(err).toEqual([]);
  expect(rawFile(file)).toBeNull(); // no state written for the upgrade command
});

// --- upgrade ---

test("upgrade: already-current prints current and exits 0 (REQ-6)", async () => {
  const file = tempStateFile();
  const { fetchImpl } = fetchReturning(`{"latest":"${INSTALLED}"}`);
  const { spawnImpl, calls } = spawnStub(() => undefined);

  const { result, out, err } = await captured(() =>
    upgradeCmd(deps({ stateFile: file, fetchImpl, spawnImpl })),
  );

  expect(result).toBe(0);
  expect(out).toEqual([`darkf is current (installed ${INSTALLED})`]);
  expect(err).toEqual([]);
  expect(calls).toEqual([]); // no probe, no installer
});

test("upgrade: registry failure prints a reason and exits 1 (REQ-10)", async () => {
  const { result, out, err } = await captured(() => upgradeCmd(deps()));
  expect(result).toBe(1);
  expect(out).toEqual([]);
  expect(err).toHaveLength(1);
  expect(err[0]).toContain("update check failed");
});

test("upgrade: no manager lists the package — exit 1, no installer run (REQ-9)", async () => {
  const { spawnImpl, calls } = spawnStub(() => ({ exitCode: 1, stdout: "nothing here" }));
  const { fetchImpl } = fetchReturning('{"latest":"9.9.9"}');

  const { result, out, err } = await captured(() => upgradeCmd(deps({ spawnImpl, fetchImpl })));

  expect(result).toBe(1);
  expect(out).toEqual([]); // never claims to upgrade
  expect(err).toEqual([
    "cannot determine how this darkf was installed — not managed by bun or npm",
  ]);
  expect(calls.every((cmd) => cmd[1] !== "install")).toBe(true);
});

test("upgrade: bun is probed first and wins the install (design: D-4)", async () => {
  const { spawnImpl, calls } = spawnStub((cmd) => {
    if (cmd[0] === "bun" && cmd[1] === "pm")
      return { exitCode: 0, stdout: "└── @psimona/darkf@0.3.0" };
    if (cmd[0] === "npm") return { exitCode: 0, stdout: "└── @psimona/darkf@0.3.0" };
    if (cmd[0] === "bun" && cmd[1] === "install") return { exitCode: 0 };
    return undefined;
  });
  const { fetchImpl } = fetchReturning('{"latest":"9.9.9"}');

  const { result, out } = await captured(() => upgradeCmd(deps({ spawnImpl, fetchImpl })));

  expect(result).toBe(0);
  expect(out).toEqual([`upgrading ${INSTALLED} → 9.9.9`]);
  expect(calls[0]).toEqual(["bun", "pm", "ls", "-g"]);
  expect(calls[1]).toEqual(["bun", "install", "-g", "@psimona/darkf@9.9.9"]);
  expect(calls.some((cmd) => cmd[0] === "npm")).toBe(false); // npm never consulted
});

test("upgrade: falls back to npm when bun does not list the package", async () => {
  const { spawnImpl, calls } = spawnStub((cmd) => {
    if (cmd[0] === "bun" && cmd[1] === "pm") return { exitCode: 0, stdout: "nothing relevant" };
    if (cmd[0] === "npm") return { exitCode: 0, stdout: "└── @psimona/darkf@0.3.0" };
    if (cmd[0] === "npm" && cmd[1] === "install") return { exitCode: 0 };
    return undefined;
  });
  const { fetchImpl } = fetchReturning('{"latest":"9.9.9"}');

  const { result } = await captured(() => upgradeCmd(deps({ spawnImpl, fetchImpl })));

  expect(result).toBe(0);
  expect(calls.some((cmd) => cmd[0] === "npm" && cmd[1] === "install")).toBe(true);
  expect(calls[calls.length - 1]).toEqual(["npm", "install", "-g", "@psimona/darkf@9.9.9"]);
});

test("upgrade: installer failure propagates its exit code and writes no state", async () => {
  const file = tempStateFile();
  const { spawnImpl } = spawnStub((cmd) => {
    if (cmd[1] === "install") return { exitCode: 7 };
    return { exitCode: 0, stdout: "└── @psimona/darkf@0.3.0" };
  });
  const { fetchImpl } = fetchReturning('{"latest":"9.9.9"}');

  const { result } = await captured(() =>
    upgradeCmd(deps({ stateFile: file, spawnImpl, fetchImpl })),
  );

  expect(result).toBe(7);
  expect(rawFile(file)).toBeNull(); // a failed install leaves no record
});

test("upgrade: success clears latestSeen so no stale notice survives (REQ-7, REQ-8)", async () => {
  const file = tempStateFile();
  seedState(file, { lastCheck: new Date(NOW - HOUR_MS).toISOString(), latestSeen: "9.9.9" });
  const { spawnImpl, calls } = spawnStub((cmd) => {
    if (cmd[1] === "install") return { exitCode: 0 };
    return { exitCode: 0, stdout: "└── @psimona/darkf@0.3.0" };
  });
  const { fetchImpl } = fetchReturning('{"latest":"9.9.9"}');

  const { result } = await captured(() =>
    upgradeCmd(deps({ stateFile: file, spawnImpl, fetchImpl, now: () => NOW })),
  );

  expect(result).toBe(0);
  expect(calls[calls.length - 1]).toEqual(["bun", "install", "-g", "@psimona/darkf@9.9.9"]);
  expect(readState(file)).toEqual({ lastCheck: new Date(NOW).toISOString() }); // latestSeen gone
});

// --- smoke: the real CLI entrypoint (no network; state seeded or opted out) ---

const pkgDir = resolve(import.meta.dir, "..", "..");
const indexTs = join(pkgDir, "src", "cli", "index.ts");
const installedVersion = (
  JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
    version: string;
  }
).version;

async function runRealCli(
  args: string[],
  stateHome: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, indexTs, ...args], {
    cwd: tempDir(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XDG_STATE_HOME: stateHome, ...extraEnv },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

test("real CLI with the opt-out: no notice line and no state file (REQ-5, wiring)", async () => {
  const stateHome = tempDir();
  const res = await runRealCli(["workflows"], stateHome, { DARKF_NO_UPDATE_CHECK: "1" });
  expect(res.code).toBe(0);
  expect(res.stdout).not.toContain("available");
  expect(rawFile(join(stateHome, "darkf", "last-update-check.json"))).toBeNull();
});

test("real CLI with a fresh not-due record: the notice is the first stdout line, no request (REQ-3, REQ-11, NFR-3)", async () => {
  const stateHome = tempDir();
  seedState(join(stateHome, "darkf", "last-update-check.json"), {
    // Fresh stamp: the gate must print from the record without any registry request.
    lastCheck: new Date().toISOString(),
    latestSeen: "99.0.0",
  });

  const res = await runRealCli(["workflows"], stateHome, { DARKF_NO_UPDATE_CHECK: "" });

  expect(res.code).toBe(0);
  const firstLine = res.stdout.split("\n")[0];
  expect(firstLine).toBe(
    `darkf 99.0.0 available (installed ${installedVersion}) — run 'darkf upgrade'`,
  );
});
