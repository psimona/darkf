import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { todayLocal, writeProbeState } from "./setup.ts";

// doctor/validate split, `darkf setup`, and the daily probe — the CLI-level
// wiring from docs/specs/skill-setup. These spawn the real CLI entrypoint:
// a temp HOME (host skill dirs), a temp XDG_STATE_HOME (probe stamp), and a
// temp cwd keep the suite off the real ~ and off the network.

const pkgDir = resolve(import.meta.dir, "..", "..");
const indexTs = join(pkgDir, "src", "cli", "index.ts");
const bundledDir = join(pkgDir, "skills");
const SKILLS = ["darkf-usage", "darkf-writing-workflows"];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix = "darkf-cli-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

interface Env {
  home: string;
  stateHome: string;
  cwd: string;
}

function makeEnv({ git = false, stamp = true } = {}): Env {
  const home = tempDir();
  const stateHome = tempDir();
  const cwd = tempDir();
  if (git) mkdirSync(join(cwd, ".git"));
  if (stamp) {
    writeProbeState(join(stateHome, "darkf", "last-skills-check.json"), {
      lastProbe: todayLocal(),
    });
  }
  return { home, stateHome, cwd };
}

function seedOk(env: Env, host: string, skill: string): void {
  const dir = join(env.home, host, "skills", skill);
  mkdirSync(dir, { recursive: true });
  cpSync(join(bundledDir, skill), dir, { recursive: true });
}

function seedStale(env: Env, host: string, skill: string, content = "a stale copy\n"): void {
  const file = join(env.home, host, "skills", skill, "SKILL.md");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
}

async function runCli(
  args: string[],
  env: Env,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, indexTs, ...args], {
    cwd: env.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: env.home,
      XDG_STATE_HOME: env.stateHome,
      DARKF_NO_UPDATE_CHECK: "1",
      ...extraEnv,
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function lines(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l.length > 0);
}

// --- doctor: environment only ---

test("doctor with no ref checks the environment only and never loads a workflow module", async () => {
  const env = makeEnv({ git: true });
  seedOk(env, ".claude", "darkf-usage");
  seedOk(env, ".claude", "darkf-writing-workflows");
  seedOk(env, ".opencode", "darkf-usage");
  seedOk(env, ".opencode", "darkf-writing-workflows");

  const res = await runCli(["doctor"], env);

  const out = lines(res.stdout);
  // Environment only — no workflow check ever ran.
  expect(out.some((l) => l.includes("workflow"))).toBe(false);
  expect(out.some((l) => l.includes("agent binary 'claude'"))).toBe(true);
  expect(out.some((l) => l.includes("agent binary 'opencode'"))).toBe(true);
  expect(out).toContain("ok   skills (claude) — 2/2 installed");
  expect(out).toContain("ok   skills (opencode) — 2/2 installed");
  // Every known harness is always named; undetected ones are informational.
  for (const host of ["codex", "gemini", "cursor"]) {
    expect(out.some((l) => l === `ok   skills (${host}) — harness not present`)).toBe(true);
  }
  const binariesReady = Bun.which("claude") !== null && Bun.which("opencode") !== null;
  expect(res.code).toBe(binariesReady ? 0 : 1); // git repo cwd, skills ok
});

test("doctor reports a differing copy via FAIL with the run darkf setup hint, and writes nothing", async () => {
  const env = makeEnv({ git: true });
  seedStale(env, ".claude", "darkf-usage", "locally edited\n");
  seedOk(env, ".claude", "darkf-writing-workflows");
  seedOk(env, ".opencode", "darkf-usage");
  seedOk(env, ".opencode", "darkf-writing-workflows");

  const res = await runCli(["doctor"], env);

  expect(lines(res.stdout)).toContain(
    "FAIL skills (claude) — darkf-usage differs from bundled — run: darkf setup",
  );
  expect(res.code).toBe(1);
  // Read-only: the installed (stale) copy was not touched.
  expect(readFileSync(join(env.home, ".claude", "skills", "darkf-usage", "SKILL.md"), "utf8")).toBe(
    "locally edited\n",
  );
});

test("doctor reports a missing copy and fails the exit code", async () => {
  const env = makeEnv({ git: true });
  mkdirSync(join(env.home, ".claude", "skills"), { recursive: true });
  seedOk(env, ".opencode", "darkf-usage");
  seedOk(env, ".opencode", "darkf-writing-workflows");

  const res = await runCli(["doctor"], env);

  expect(lines(res.stdout)).toContain(
    "FAIL skills (claude) — darkf-usage missing; darkf-writing-workflows missing — run: darkf setup",
  );
  expect(res.code).toBe(1);
});
test("doctor <ref> prints the new usage and exits 1", async () => {
  const env = makeEnv({ git: true });
  const res = await runCli(["doctor", "my-workflow"], env);
  expect(lines(res.stdout)).toEqual([
    "usage: darkf doctor takes no ref — darkf validate <ref> for workflow checks",
  ]);
  expect(res.code).toBe(1);
});

// --- validate: the inherited workflow checks ---

const RUNNER_IMPORTS = `import { EXIT, type AgentRunner, type WorkflowDef } from "${pkgDir}/src/core/index.ts";
import { claudeCodeRunner } from "${pkgDir}/src/kit/agents/claude-code.ts";

export const agentRunner: AgentRunner = claudeCodeRunner;
`;

function writeFixture(env: Env, name: string, states: string): string {
  const dir = join(env.cwd, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "workflow.ts"),
    `${RUNNER_IMPORTS}\nexport const workflow: WorkflowDef = {\n  initial: "A",\n  states: { ${states} },\n};\n`,
  );
  return dir;
}

test("validate inherits the workflow checks: happy path, same lines, exit 0", async () => {
  const env = makeEnv();
  const dir = writeFixture(env, "happy", `A: { type: "agent", prompt: "p", on: { done: EXIT } }`);

  const res = await runCli(["validate", dir], env);

  // The same lines doctor's workflow path has always printed — including the
  // runner hint detail on the passing exports check.
  expect(lines(res.stdout)).toEqual([
    `ok   workflow resolves — ${dir}`,
    "ok   workflow.ts loads",
    "ok   exports `workflow`",
    "ok   exports `agentRunner` — agent states need a runner; built-ins live in src/kit/agents/",
    "ok   workflow structure",
  ]);
  expect(res.code).toBe(0);
});

test("validate reports unresolved targets", async () => {
  const env = makeEnv();
  const dir = writeFixture(
    env,
    "unresolved",
    `A: { type: "agent", prompt: "p", on: { done: "nope" } }`,
  );
  const res = await runCli(["validate", dir], env);
  expect(lines(res.stdout)).toContain('FAIL workflow structure — A -> "nope": no such state');
  expect(res.code).toBe(1);
});

test("validate reports dead-end leaves", async () => {
  const env = makeEnv();
  const dir = writeFixture(env, "dead-end", `A: { type: "agent", prompt: "p" }`);
  const res = await runCli(["validate", dir], env);
  expect(lines(res.stdout)).toContain('FAIL workflow structure — "A": dead end, no on/next');
  expect(res.code).toBe(1);
});

test("validate reports initial cycles", async () => {
  const env = makeEnv();
  const dir = join(env.cwd, "cycle");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "workflow.ts"),
    `${RUNNER_IMPORTS}
export const workflow: WorkflowDef = {
  initial: "A",
  states: {
    A: { initial: "B", states: { LeafA: { type: "script", file: "l.ts", next: EXIT } } },
    B: { initial: "A", states: { LeafB: { type: "script", file: "l.ts", next: EXIT } } },
  },
};
`,
  );
  const res = await runCli(["validate", dir], env);
  expect(lines(res.stdout)).toContain("FAIL workflow structure — initial cycle: A -> B -> A");
  expect(res.code).toBe(1);
});

test("validate with no ref prints its usage and exits 1", async () => {
  const env = makeEnv();
  const res = await runCli(["validate"], env);
  expect(lines(res.stdout)).toContain("FAIL workflow ref — usage: darkf validate <ref-or-path>");
  expect(res.code).toBe(1);
});

test("validate with an unresolvable ref skips the load and exports checks", async () => {
  const env = makeEnv();
  const missing = join(env.cwd, "no-such-workflow");
  const res = await runCli(["validate", missing], env);
  const out = lines(res.stdout);
  expect(out[0]).toContain("FAIL workflow resolves");
  expect(out).toContain("FAIL workflow.ts loads — skipped — no resolved workflow");
  expect(out).toContain("FAIL exports `workflow` — skipped — no resolved workflow");
  expect(out).toContain("FAIL exports `agentRunner` — skipped — no resolved workflow");
  expect(out).toHaveLength(4);
  expect(res.code).toBe(1);
});

test("validate does not check skills — stale copies never touch its verdict", async () => {
  const env = makeEnv();
  seedStale(env, ".claude", "darkf-usage");
  const dir = writeFixture(env, "happy", `A: { type: "agent", prompt: "p", on: { done: EXIT } }`);

  const res = await runCli(["validate", dir], env);

  expect(res.code).toBe(0);
  expect(res.stdout).not.toContain("skills");
});

// --- daily probe wiring: silent unless actionable, never fatal ---

test("the first invocation of the day prints the block before the command output", async () => {
  const env = makeEnv({ stamp: false });
  seedStale(env, ".claude", "darkf-usage");
  seedOk(env, ".claude", "darkf-writing-workflows");

  const res = await runCli(["workflows"], env);

  const out = lines(res.stdout);
  // One compact block — failing harness lines, then the fix — before the
  // command's own output. (The opencode line depends on the machine's PATH;
  // claude is seeded stale, so it always leads the block.)
  expect(out[0]).toBe("skills (claude): darkf-usage differs from bundled");
  const fixIdx = out.indexOf("fix: run darkf setup");
  expect(fixIdx).toBeGreaterThan(0);
  // The invoked command's own output follows the block.
  expect(out.slice(fixIdx + 1)).toContain("dev-loop                 built-in");
  expect(res.code).toBe(0); // never changes the invoking command's exit code
  // Stamped, so the rest of the day stays silent.
  expect(readFileSync(join(env.stateHome, "darkf", "last-skills-check.json"), "utf8")).toContain(
    todayLocal(),
  );
});

test("a stamped same-day invocation skips the probe silently", async () => {
  const env = makeEnv({ stamp: true });
  seedStale(env, ".claude", "darkf-usage");

  const res = await runCli(["workflows"], env);

  expect(res.stdout).not.toContain("fix: run darkf setup");
  expect(res.code).toBe(0);
});

test("setup and upgrade skip the probe; setup refreshes the stamp", async () => {
  const env = makeEnv({ stamp: false });
  seedStale(env, ".claude", "darkf-usage");

  const res = await runCli(["setup"], env);

  expect(res.stdout).not.toContain("fix: run darkf setup");
  expect(readFileSync(join(env.stateHome, "darkf", "last-skills-check.json"), "utf8")).toContain(
    todayLocal(),
  );
});

// --- setup wiring ---

test("darkf setup syncs a detected host and skips an absent one; exits 0", async () => {
  const env = makeEnv({ stamp: true });
  seedStale(env, ".claude", "darkf-usage", "stale\n");

  const res = await runCli(["setup"], env);

  expect(res.code).toBe(0);
  const out = lines(res.stdout);
  expect(out).toContain("host claude (~/.claude/skills)");
  expect(out.some((l) => l.startsWith("  darkf-usage") && l.endsWith("updated (was stale)"))).toBe(
    true,
  );
  expect(out).toContain("host codex — harness not present");
  for (const skill of SKILLS) {
    expect(readFileSync(join(env.home, ".claude", "skills", skill, "SKILL.md"), "utf8")).toBe(
      readFileSync(join(bundledDir, skill, "SKILL.md"), "utf8"),
    );
  }
});

test("darkf setup takes no positional args — a stray arg is still just a sync", async () => {
  // No flags, no positionals: the arg list is ignored by contract.
  const env = makeEnv({ stamp: true });
  const res = await runCli(["setup", "--check"], env);
  expect(res.stdout).toContain("host claude");
  expect(res.code).toBe(0);
});
