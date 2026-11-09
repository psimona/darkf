// Skill setup (docs/specs/skill-setup): the shared skills-check core, the
// `darkf setup` sync, and the daily first-invocation probe. The bundled
// darkf-* skills ship inside the package (darkf/skills/); every dependency
// arrives via deps objects, so the whole module runs in tests without a real
// HOME, PATH, or the packaged skills dir. No module-level mutable state.
import {
  cpSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// The known harnesses are a table in code — adding one is a row plus a test
// fixture, not a feature (spec: Host detection). `dir` is relative to HOME;
// a host is detected when its skills dir exists OR its binary is on PATH.
// A harness whose skills support or path cannot be confirmed drops from the
// table rather than creating dirs nothing reads.
export interface KnownHost {
  name: string;
  dir: string; // relative to HOME
  binary: string;
}

export const KNOWN_HOSTS: KnownHost[] = [
  { name: "claude", dir: ".claude/skills", binary: "claude" },
  { name: "opencode", dir: ".opencode/skills", binary: "opencode" },
  { name: "codex", dir: ".codex/skills", binary: "codex" },
  { name: "gemini", dir: ".gemini/skills", binary: "gemini" },
  { name: "cursor", dir: ".cursor/skills", binary: "cursor-agent" },
];

export type SkillState = "missing" | "ok" | "differs";

export interface SkillsDeps {
  home: string; // expands the table's ~/. paths
  bundledDir: string; // the package's skills/ dir
  existsBinary(name: string): boolean;
}

export interface SyncDeps extends SkillsDeps {
  log?(line: string): void;
}

export interface ProbeDeps extends SkillsDeps {
  stateFile: string; // injectable last-skills-check location
  today?(): string; // injectable local calendar date
  log?(line: string): void;
}

/** Bundled skill names: subdirs of bundledDir containing a SKILL.md, sorted. */
export function bundledSkills(bundledDir: string): string[] {
  try {
    return readdirSync(bundledDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(bundledDir, e.name, "SKILL.md")))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * The three per-skill states, by byte equality on SKILL.md — the only file
 * either skill has. A dir without SKILL.md is a partial install: missing.
 */
export function skillState(skillsDir: string, skill: string, bundledDir: string): SkillState {
  try {
    const installed = readFileSync(join(skillsDir, skill, "SKILL.md"));
    const bundled = readFileSync(join(bundledDir, skill, "SKILL.md"));
    return installed.equals(bundled) ? "ok" : "differs";
  } catch {
    return "missing";
  }
}

export interface HostSkills {
  host: string;
  dir: string; // absolute, HOME-expanded
  display: string; // the ~/. form for output lines
  present: boolean;
  /** Per bundled skill; empty for an absent host. */
  states: Record<string, SkillState>;
}

/**
 * The read-only skills check every consumer shares (doctor's skills section,
 * the daily probe, setup's state model): one entry per known harness, every
 * harness always named. Reads nothing outside darkf-* skill dirs; writes
 * nothing.
 */
export function skillsCheck(deps: SkillsDeps): HostSkills[] {
  const skills = bundledSkills(deps.bundledDir);
  return KNOWN_HOSTS.map((host) => {
    const dir = join(deps.home, host.dir);
    const present = existsSync(dir) || deps.existsBinary(host.binary);
    const states: Record<string, SkillState> = {};
    if (present) {
      for (const skill of skills) states[skill] = skillState(dir, skill, deps.bundledDir);
    }
    return { host: host.name, dir, display: `~/${host.dir}`, present, states };
  });
}

/** Per-skill failing names for a checked host, in reporting order. */
export function failingSkills(h: HostSkills): Array<[string, SkillState]> {
  return Object.entries(h.states).filter(([, state]) => state !== "ok") as Array<
    [string, SkillState]
  >;
}

/** "darkf-usage differs from bundled" / "darkf-usage missing". */
export function describeFailure(skill: string, state: SkillState): string {
  return state === "missing" ? `${skill} missing` : `${skill} differs from bundled`;
}

// The write itself is dir replacement, not a file-by-file merge: copy the
// bundled dir to a dot-prefixed temp dir inside the skills dir (hosts ignore
// dot-dirs when listing skills), remove the installed dir, rename the temp
// into place. The swap is one rename; a crash mid-copy at worst leaves a
// temp dir that the next sync replaces. The destination is an exact mirror
// of the bundled dir after every sync.
const TEMP_PREFIX = ".darkf-tmp-";

function copySkill(skillsDir: string, skill: string, bundledDir: string): void {
  const temp = join(skillsDir, `${TEMP_PREFIX}${skill}`);
  rmSync(temp, { recursive: true, force: true });
  cpSync(join(bundledDir, skill), temp, { recursive: true });
  rmSync(join(skillsDir, skill), { recursive: true, force: true });
  renameSync(temp, join(skillsDir, skill));
}

/** Dot-prefixed temp dirs are darkf's namespace too — the next sync replaces them. */
function clearTempDirs(skillsDir: string): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name.startsWith(TEMP_PREFIX)) {
      rmSync(join(skillsDir, e.name), { recursive: true, force: true });
    }
  }
}

/**
 * Sync every bundled darkf-* skill into every detected host: copy when
 * missing, replace when differs, no-op when ok. One host-detection line, then
 * one line per host per skill. An undetected host is skipped without creating
 * anything. Foreign skill dirs (no darkf- prefix) are never read or written.
 * Returns 0 on success; 1 when a present host still ends missing/differs
 * after the sync attempt.
 */
export function syncAll(deps: SyncDeps): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  const skills = bundledSkills(deps.bundledDir);
  const width = Math.max(...skills.map((s) => s.length), 0);
  let failed = false;
  for (const host of KNOWN_HOSTS) {
    const dir = join(deps.home, host.dir);
    if (!existsSync(dir) && !deps.existsBinary(host.binary)) {
      log(`host ${host.name} — harness not present`);
      continue;
    }
    log(`host ${host.name} (~/${host.dir})`);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o755 });
      clearTempDirs(dir);
      for (const skill of skills) {
        const before = skillState(dir, skill, deps.bundledDir);
        let after = before;
        if (before !== "ok") {
          try {
            copySkill(dir, skill, deps.bundledDir);
            after = skillState(dir, skill, deps.bundledDir);
          } catch (err) {
            log(
              `  ${skill.padEnd(width)}  failed (${err instanceof Error ? err.message : String(err)})`,
            );
            failed = true;
            continue;
          }
        }
        const label =
          after === "ok"
            ? before === "missing"
              ? "installed"
              : before === "differs"
                ? "updated (was stale)"
                : "ok"
            : after;
        if (after !== "ok") failed = true;
        log(`  ${skill.padEnd(width)}  ${label}`);
      }
    } catch (err) {
      log(`  failed (${err instanceof Error ? err.message : String(err)})`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

// --- daily probe (spec: Daily probe on first invocation) ---

export interface ProbeState {
  lastProbe?: string; // local calendar date YYYY-MM-DD of the last probe attempt
}

/** Absent or corrupt file returns {}. Never throws. */
export function readProbeState(file: string): ProbeState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const rec = (parsed as Record<string, unknown>).lastProbe;
    return typeof rec === "string" ? { lastProbe: rec } : {};
  } catch {
    return {};
  }
}

/** mkdir -p on the parent; best-effort — swallow write errors. */
export function writeProbeState(file: string, state: ProbeState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // An unwritable state location degrades to re-probing next invocation.
  }
}

/** The local calendar date — the day a probe compares against, not UTC. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * One compact block for the failing harnesses plus the fix hint; null when
 * every present harness is ok (and for absent ones — silent by contract).
 */
export function probeBlock(checks: HostSkills[]): string[] | null {
  const lines: string[] = [];
  for (const h of checks) {
    if (!h.present) continue;
    const failing = failingSkills(h).map(([skill, state]) => describeFailure(skill, state));
    if (failing.length > 0) lines.push(`skills (${h.host}): ${failing.join(", ")}`);
  }
  if (lines.length === 0) return null;
  lines.push("fix: run darkf setup");
  return lines;
}

/**
 * The startup path, called from main() after the update gate. First
 * invocation of a local calendar day probes; same-day invocations skip
 * silently. Missing or corrupt state counts as never probed. `setup` and
 * `upgrade` skip the probe and refresh the state file so the next command
 * starts a fresh day window. Never fatal: a slow or erroring probe is
 * swallowed and never changes the invoking command's exit code.
 */
export async function skillsProbeGate(cmd: string | undefined, deps: ProbeDeps): Promise<void> {
  const today = deps.today ?? (() => todayLocal());
  const stamp = () => writeProbeState(deps.stateFile, { lastProbe: today() });
  if (cmd === "setup" || cmd === "upgrade") {
    stamp();
    return;
  }
  const state = readProbeState(deps.stateFile);
  if (state.lastProbe === today()) return;
  try {
    const block = probeBlock(skillsCheck(deps));
    if (block) for (const line of block) (deps.log ?? console.log)(line);
  } catch {
    // swallowed — today's run matters more than the report
  }
  stamp();
}
