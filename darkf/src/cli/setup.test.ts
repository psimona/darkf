import { afterAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundledSkills,
  KNOWN_HOSTS,
  type ProbeDeps,
  probeBlock,
  readProbeState,
  type SyncDeps,
  skillState,
  skillsCheck,
  skillsProbeGate,
  syncAll,
  todayLocal,
  writeProbeState,
} from "./setup.ts";

// --- fixtures: temp HOME, a spied bundled dir, injectable binary lookup ---

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix = "darkf-setup-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

const USAGE = "usage skill content v1\n";
const WRITING = "writing-workflows skill content v1\n";

/** A bundled skills dir with the two real skill names and fixture content. */
function makeBundle(usage = USAGE, writing = WRITING): string {
  const dir = tempDir("darkf-bundle-");
  mkdirSync(join(dir, "darkf-usage"), { recursive: true });
  mkdirSync(join(dir, "darkf-writing-workflows"), { recursive: true });
  writeFileSync(join(dir, "darkf-usage", "SKILL.md"), usage);
  writeFileSync(join(dir, "darkf-writing-workflows", "SKILL.md"), writing);
  return dir;
}

function deps(overrides: Partial<SyncDeps & ProbeDeps> = {}): SyncDeps & ProbeDeps {
  return {
    home: tempDir(),
    bundledDir: makeBundle(),
    existsBinary: () => false,
    stateFile: join(tempDir(), "state", "darkf", "last-skills-check.json"),
    ...overrides,
  };
}

/** A host skills dir the test created itself — detection via existing dir. */
function seedSkillsDir(home: string, host = ".claude/skills"): string {
  const dir = join(home, host);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedOk(dir: string, bundledDir: string, skill: string): void {
  cpSync(join(bundledDir, skill), join(dir, skill), { recursive: true });
}

/** A stale/edited skill copy: parent dirs created, fixture content written. */
function putSkill(dir: string, name: string, content: string, file = "SKILL.md"): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, file), content);
}

function capturedLog() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

// --- the known-harness table ---

test("the table names every known harness with its documented dir and binary", () => {
  expect(KNOWN_HOSTS).toEqual([
    { name: "claude", dir: ".claude/skills", binary: "claude" },
    { name: "opencode", dir: ".opencode/skills", binary: "opencode" },
    { name: "codex", dir: ".codex/skills", binary: "codex" },
    { name: "gemini", dir: ".gemini/skills", binary: "gemini" },
    { name: "cursor", dir: ".cursor/skills", binary: "cursor-agent" },
  ]);
});

test("bundledSkills lists bundled dirs with a SKILL.md, sorted; missing dir lists none", () => {
  expect(bundledSkills(deps().bundledDir)).toEqual(["darkf-usage", "darkf-writing-workflows"]);
  expect(bundledSkills(join(tempDir(), "does-not-exist"))).toEqual([]);
  const partial = tempDir();
  writeFileSync(join(partial, "lonely-file.txt"), "not a skill");
  mkdirSync(join(partial, "dir-without-skillmd"));
  expect(bundledSkills(partial)).toEqual([]);
});

// --- skill state ---

test("skillState: missing, ok, and differs by byte equality on SKILL.md", () => {
  const bundledDir = makeBundle();
  const dir = seedSkillsDir(tempDir());
  expect(skillState(dir, "darkf-usage", bundledDir)).toBe("missing");
  seedOk(dir, bundledDir, "darkf-usage");
  expect(skillState(dir, "darkf-usage", bundledDir)).toBe("ok");
  writeFileSync(join(dir, "darkf-usage", "SKILL.md"), "locally edited\n");
  expect(skillState(dir, "darkf-usage", bundledDir)).toBe("differs");
  // A partial install — dir without SKILL.md — is missing, not differs.
  mkdirSync(join(dir, "darkf-writing-workflows"));
  expect(skillState(dir, "darkf-writing-workflows", bundledDir)).toBe("missing");
});

// --- skillsCheck (the read-only shared check) ---

test("skillsCheck names every known harness; absent host has no states", () => {
  const d = deps();
  const checks = skillsCheck(d);
  expect(checks.map((h) => h.host)).toEqual(KNOWN_HOSTS.map((h) => h.name));
  for (const h of checks) {
    expect(h.present).toBe(false);
    expect(h.states).toEqual({});
  }
});

test("skillsCheck: detection by existing dir alone, states per bundled skill", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  seedOk(dir, d.bundledDir, "darkf-usage");
  const claude = skillsCheck(d).find((h) => h.host === "claude")!;
  expect(claude.present).toBe(true);
  expect(claude.states).toEqual({ "darkf-usage": "ok", "darkf-writing-workflows": "missing" });
});

test("skillsCheck: detection by binary when the dir does not exist yet", () => {
  const d = deps({ existsBinary: (b) => b === "codex" });
  const codex = skillsCheck(d).find((h) => h.host === "codex")!;
  expect(codex.present).toBe(true);
  expect(codex.states).toEqual({
    "darkf-usage": "missing",
    "darkf-writing-workflows": "missing",
  });
  expect(existsSync(join(d.home, ".codex", "skills"))).toBe(false); // read-only
});

// --- sync ---

test("sync: missing target is copied, byte-identical to bundled", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  expect(syncAll(d)).toBe(0);
  expect(readFileSync(join(dir, "darkf-usage", "SKILL.md"), "utf8")).toBe(USAGE);
  expect(readFileSync(join(dir, "darkf-writing-workflows", "SKILL.md"), "utf8")).toBe(WRITING);
});

test("sync: partial install (dir without SKILL.md) is repaired by copy", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  putSkill(dir, "darkf-usage", "leftover note\n", "NOTES.txt"); // no SKILL.md
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  expect(readFileSync(join(dir, "darkf-usage", "SKILL.md"), "utf8")).toBe(USAGE);
  expect(readdirSync(join(dir, "darkf-usage"))).toEqual(["SKILL.md"]); // exact mirror
  const line = lines.find((l) => l.includes("darkf-usage"))!;
  expect(line.trimEnd().endsWith("installed")).toBe(true); // reported missing, then copied
});

test("sync: identical target is untouched and reported ok", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  seedOk(dir, d.bundledDir, "darkf-usage");
  const sentinel = statSync(join(dir, "darkf-usage", "SKILL.md")).ino;
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  const okLine = lines.find((l) => l.includes("darkf-usage"))!;
  expect(okLine.trimEnd().endsWith("ok")).toBe(true);
  expect(statSync(join(dir, "darkf-usage", "SKILL.md")).ino).toBe(sentinel); // no rewrite
});

test("sync: differing target is overwritten, byte-identical to bundled", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  putSkill(dir, "darkf-usage", "a stale or edited copy\n");
  expect(syncAll(d)).toBe(0);
  expect(readFileSync(join(dir, "darkf-usage", "SKILL.md"), "utf8")).toBe(USAGE);
});

test("sync: leftover files are wiped — the destination is an exact mirror", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  const staleDir = join(dir, "darkf-usage");
  putSkill(staleDir, ".", "older bundled version\n");
  writeFileSync(join(staleDir, "reference-removed.md"), "left by an older bundled version");
  writeFileSync(join(staleDir, "someone-elses-note.txt"), "added inside the skill dir");
  expect(syncAll(d)).toBe(0);
  expect(readdirSync(staleDir)).toEqual(["SKILL.md"]);
  expect(readFileSync(join(staleDir, "SKILL.md"), "utf8")).toBe(USAGE);
});

test("sync: a dot-prefixed temp dir from a crashed sync is replaced, never a skill state", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  putSkill(dir, ".darkf-tmp-darkf-usage", "half-written junk\n");
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  expect(existsSync(join(dir, ".darkf-tmp-darkf-usage"))).toBe(false);
  expect(readFileSync(join(dir, "darkf-usage", "SKILL.md"), "utf8")).toBe(USAGE);
  for (const line of lines) expect(line).not.toContain(".darkf-tmp");
});

test("sync: a foreign skill dir is never read or written", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  putSkill(dir, "my-own-skill", "mine, not darkf's\n");
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  expect(readFileSync(join(dir, "my-own-skill", "SKILL.md"), "utf8")).toBe("mine, not darkf's\n");
  for (const line of lines) expect(line).not.toContain("my-own-skill");
});

test("sync: dir absent + binary absent — harness skipped, nothing created", () => {
  const d = deps({ existsBinary: () => false });
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  expect(lines).toContain("host claude — harness not present");
  expect(existsSync(join(d.home, ".claude"))).toBe(false);
  expect(existsSync(join(d.home, ".opencode"))).toBe(false);
});

test("sync: dir absent + binary present — dir created 0755, skill copied", () => {
  const umask = process.umask();
  const d = deps({ existsBinary: (b) => b === "gemini" });
  expect(syncAll(d)).toBe(0);
  const dir = join(d.home, ".gemini", "skills");
  expect(statSync(dir).mode & 0o777).toBe(0o755 & ~umask);
  expect(readFileSync(join(dir, "darkf-usage", "SKILL.md"), "utf8")).toBe(USAGE);
});

test("sync: one table row per known harness — every row syncs through the same loop", () => {
  const d = deps({ existsBinary: (b) => KNOWN_HOSTS.some((h) => h.binary === b) });
  expect(syncAll(d)).toBe(0);
  for (const host of KNOWN_HOSTS) {
    const installed = join(d.home, host.dir, "darkf-usage", "SKILL.md");
    expect(readFileSync(installed, "utf8")).toBe(USAGE);
  }
});

test("sync: state reporting — ok, installed, and updated (was stale)", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  seedOk(dir, d.bundledDir, "darkf-usage"); // stays ok
  putSkill(dir, "darkf-writing-workflows", "stale\n"); // differs
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  expect(lines).toContain("host claude (~/.claude/skills)");
  expect(lines.some((l) => l.startsWith("  darkf-usage") && l.trimEnd().endsWith("ok"))).toBe(true);
  expect(
    lines.some(
      (l) => l.startsWith("  darkf-writing-workflows") && l.endsWith("updated (was stale)"),
    ),
  ).toBe(true);
  // And a second run is a no-op: everything ok.
  const again: string[] = [];
  expect(syncAll({ ...d, log: again.push.bind(again) })).toBe(0);
  expect(
    again.filter((l) => l.startsWith("  darkf-")).every((l) => l.trimEnd().endsWith("ok")),
  ).toBe(true);
});

test("sync: a fresh install reports installed", () => {
  const d = deps({ existsBinary: (b) => b === "claude" });
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(0);
  expect(
    lines.some((l) => l.startsWith("  darkf-usage") && l.trimEnd().endsWith("installed")),
  ).toBe(true);
});

test("sync: exit 1 when a present host still ends missing/differs", () => {
  const d = deps({ existsBinary: (b) => b === "claude" });
  // The host skills "dir" is a file — every copy op fails, nothing crashes.
  mkdirSync(join(d.home, ".claude"));
  writeFileSync(join(d.home, ".claude", "skills"), "a file, not a dir");
  const { lines } = capturedLog();
  expect(syncAll({ ...d, log: lines.push.bind(lines) })).toBe(1);
  expect(lines.some((l) => l.includes("failed ("))).toBe(true);
});

// --- daily probe ---

const TODAY = new Date(2026, 10, 9, 13, 0, 0); // local 2026-11-09 13:00

test("todayLocal renders the local calendar date, not UTC", () => {
  // 23:30 local in a UTC+13 zone is already tomorrow in UTC.
  expect(todayLocal(new Date(2026, 10, 9, 23, 30))).toBe("2026-11-09");
  expect(todayLocal(TODAY)).toBe("2026-11-09");
});

test("probe state: absent and corrupt files read as never probed; writes round-trip", () => {
  expect(readProbeState(join(tempDir(), "absent.json"))).toEqual({});
  const corrupt = join(tempDir(), "corrupt.json");
  writeFileSync(corrupt, "{not json");
  expect(readProbeState(corrupt)).toEqual({});
  const wrongType = join(tempDir(), "wrong.json");
  writeFileSync(wrongType, JSON.stringify({ lastProbe: 42 }));
  expect(readProbeState(wrongType)).toEqual({});
  const file = join(tempDir(), "state", "darkf", "last-skills-check.json");
  writeProbeState(file, { lastProbe: "2026-11-09" });
  expect(readProbeState(file)).toEqual({ lastProbe: "2026-11-09" });
});

test("probeBlock: silent when every present harness is ok or absent", () => {
  const d = deps();
  seedOk(seedSkillsDir(d.home), d.bundledDir, "darkf-usage");
  seedOk(seedSkillsDir(d.home), d.bundledDir, "darkf-writing-workflows");
  expect(probeBlock(skillsCheck(d))).toBeNull();
});

test("probeBlock: failing lines plus the fix hint, one line per failing harness", () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  putSkill(dir, "darkf-usage", "edited locally\n");
  seedOk(dir, d.bundledDir, "darkf-writing-workflows");
  const block = probeBlock(skillsCheck(d))!;
  expect(block).toEqual([
    "skills (claude): darkf-usage differs from bundled",
    "fix: run darkf setup",
  ]);
});

async function capturedProbe(d: ProbeDeps): Promise<{ lines: string[] }> {
  const lines: string[] = [];
  await skillsProbeGate("status", { ...d, log: lines.push.bind(lines) });
  return { lines };
}

test("probe: first invocation of a day runs and stamps; same-day skips silently", async () => {
  const d = deps();
  const dir = seedSkillsDir(d.home);
  seedOk(dir, d.bundledDir, "darkf-usage");
  seedOk(dir, d.bundledDir, "darkf-writing-workflows");
  const first = await capturedProbe({ ...d, today: () => "2026-11-09" });
  expect(first.lines).toEqual([]); // all ok — silent by contract
  expect(readProbeState(d.stateFile).lastProbe).toBe("2026-11-09");
  // Same-day: skipped even when the state changed under the probe.
  rmSync(join(dir, "darkf-usage"), { recursive: true });
  rmSync(join(dir, "darkf-writing-workflows"), { recursive: true });
  const second = await capturedProbe({ ...d, today: () => "2026-11-09" });
  expect(second.lines).toEqual([]);
  // Next day: runs again — only darkf-usage is drifted, so one named line.
  seedOk(dir, d.bundledDir, "darkf-writing-workflows");
  const nextDay = await capturedProbe({ ...d, today: () => "2026-11-10" });
  expect(nextDay.lines).toEqual(["skills (claude): darkf-usage missing", "fix: run darkf setup"]);
});

test("probe: a corrupt state file counts as never probed", async () => {
  const d = deps();
  putSkill(seedSkillsDir(d.home), "darkf-usage", "edited locally\n"); // a present harness with drift
  mkdirSync(d.stateFile.slice(0, d.stateFile.lastIndexOf("/")), { recursive: true });
  writeFileSync(d.stateFile, "{corrupt");
  const { lines } = await capturedProbe({ ...d, today: () => "2026-11-09" });
  expect(lines).toContain("fix: run darkf setup"); // probed despite the corrupt file
  expect(readProbeState(d.stateFile).lastProbe).toBe("2026-11-09"); // and stamped
});

test("probe: exempt commands skip the probe and refresh the state file", async () => {
  const d = deps(); // nothing installed — a probe would loudly report missing
  for (const cmd of ["setup", "upgrade"]) {
    const lines: string[] = [];
    await skillsProbeGate(cmd, { ...d, today: () => "2026-11-09", log: lines.push.bind(lines) });
    expect(lines).toEqual([]);
    expect(readProbeState(d.stateFile)).toEqual({ lastProbe: "2026-11-09" });
  }
});
