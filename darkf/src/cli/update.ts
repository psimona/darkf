// CLI self-update (docs/specs/self-update): a daily startup version check and
// the `darkf upgrade` command. Every dependency arrives via UpdateDeps, so the
// whole module runs in tests without network, a real clock, or a real package
// manager. No module-level mutable state.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PACKAGE_SPEC = "@psimona/darkf";
const REGISTRY_URL = "https://registry.npmjs.org/-/package/@psimona%2Fdarkf/dist-tags";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 2_000;
// Design-originated: no REQ covers probe duration; the cap bounds a hung
// package manager.
const PROBE_TIMEOUT_MS = 10_000;
// Trust boundary: the registry response is untrusted input. `latest` must
// match this before any argv uses it (design: Security Considerations).
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export interface UpdateState {
  lastCheck?: string; // ISO timestamp of the last check attempt
  latestSeen?: string; // newest version known to exist; drives the notice
}

export interface UpdateDeps {
  now(): number; // injectable clock
  fetchImpl: typeof fetch; // injectable registry access
  spawnImpl: typeof Bun.spawnSync; // injectable probes and installer
  stateFile: string; // injectable state location
  installed: string; // version from the package package.json
}

/** Absent or corrupt file returns {}. Never throws. */
export function readState(file: string): UpdateState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const rec = parsed as Record<string, unknown>;
    const state: UpdateState = {};
    if (typeof rec.lastCheck === "string") state.lastCheck = rec.lastCheck;
    if (typeof rec.latestSeen === "string") state.latestSeen = rec.latestSeen;
    return state;
  } catch {
    return {};
  }
}

/** mkdir -p on the parent; best-effort — swallow write errors (REQ-4). */
export function writeState(file: string, state: UpdateState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // An unwritable state location degrades to re-checking next invocation.
  }
}

/** True when lastCheck is missing, unparseable, or older than 24 h. */
export function isDue(state: UpdateState, now: number): boolean {
  if (state.lastCheck === undefined) return true;
  const last = Date.parse(state.lastCheck);
  if (Number.isNaN(last)) return true;
  return now - last >= CHECK_INTERVAL_MS;
}

/** Bun.semver.order(installed, latest) < 0. */
export function isNewer(installed: string, latest: string): boolean {
  return Bun.semver.order(installed, latest) < 0;
}

/**
 * GET the dist-tags endpoint with AbortSignal.timeout(2000). Returns `latest`
 * when it is a semver-shaped string, else null. Never throws.
 */
export async function checkRegistry(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (res.status !== 200) return null;
    const tags: unknown = await res.json();
    const latest =
      typeof tags === "object" && tags !== null
        ? (tags as Record<string, unknown>).latest
        : undefined;
    return typeof latest === "string" && SEMVER_RE.test(latest) ? latest : null;
  } catch {
    // Rejects, aborts, and malformed JSON are all the same silent no-op.
    return null;
  }
}

/**
 * The startup path, called from main() before command dispatch. Sends at most
 * one registry request per invocation, bounded to one per 24 h across
 * invocations (REQ-1, REQ-2). Silent by contract: every failure continues the
 * started command with no added output (REQ-4).
 */
export async function updateGate(cmd: string | undefined, deps: UpdateDeps): Promise<void> {
  // `upgrade` fetches on its own; the opt-out never blocks it.
  if (cmd === "upgrade") return;
  // Opt-out (REQ-5): no state read, no request, no print.
  if (process.env.DARKF_NO_UPDATE_CHECK) return;

  const state = readState(deps.stateFile);
  if (isDue(state, deps.now())) {
    const latest = await checkRegistry(deps.fetchImpl);
    // null (failed check): leave latestSeen untouched — a stale notice survives.
    if (latest !== null) {
      if (isNewer(deps.installed, latest)) state.latestSeen = latest;
      else delete state.latestSeen;
    }
    // Stamp on attempt (REQ-2): a failed check counts as a check.
    state.lastCheck = new Date(deps.now()).toISOString();
    writeState(deps.stateFile, state);
  }
  // Notice from the record: no registry request (REQ-11), exactly one line,
  // printed before dispatch so it is the first line of stdout (NFR-3).
  if (state.latestSeen !== undefined && isNewer(deps.installed, state.latestSeen)) {
    console.log(
      `darkf ${state.latestSeen} available (installed ${deps.installed}) — run 'darkf upgrade'`,
    );
  }
}

/** Marker shared by `bun pm ls -g` and `npm ls -g --depth=0` output. */
const INSTALLED_MARKER = `${PACKAGE_SPEC}@`;

/** False when the manager fails, times out, or does not list the package. */
function probeManager(spawnImpl: typeof Bun.spawnSync, cmd: string[]): boolean {
  let out: { exitCode: number; stdout: Buffer };
  try {
    out = spawnImpl(cmd, { timeout: PROBE_TIMEOUT_MS });
  } catch {
    return false;
  }
  if (out.exitCode !== 0) return false;
  return new TextDecoder().decode(out.stdout).includes(INSTALLED_MARKER);
}

/**
 * bun first (the darkf bin runs under bun by construction), then npm when
 * present — so a pack:local snapshot resolves to bun (design: D-4).
 */
function pickManager(spawnImpl: typeof Bun.spawnSync): "bun" | "npm" | null {
  if (probeManager(spawnImpl, ["bun", "pm", "ls", "-g"])) return "bun";
  if (Bun.which("npm") !== null && probeManager(spawnImpl, ["npm", "ls", "-g", "--depth=0"])) {
    return "npm";
  }
  return null;
}

/**
 * The `darkf upgrade` command. Loud where the startup gate is silent: registry
 * and provenance failures print a one-line stderr reason and exit non-zero
 * (REQ-9, REQ-10). Returns the process exit code.
 */
export async function upgradeCmd(deps: UpdateDeps): Promise<number> {
  const latest = await checkRegistry(deps.fetchImpl);
  if (latest === null) {
    console.error(
      `update check failed: could not read the latest version of ${PACKAGE_SPEC} from the npm registry`,
    );
    return 1;
  }
  // Current, or a local snapshot newer than the published release: no
  // downgrade (REQ-6).
  if (Bun.semver.order(deps.installed, latest) >= 0) {
    console.log(`darkf is current (installed ${deps.installed})`);
    return 0;
  }
  const pm = pickManager(deps.spawnImpl);
  if (pm === null) {
    console.error("cannot determine how this darkf was installed — not managed by bun or npm");
    return 1;
  }
  // The before/after line REQ-7 requires, printed before anything changes.
  console.log(`upgrading ${deps.installed} → ${latest}`);
  if (!SEMVER_RE.test(latest)) {
    console.error(`registry returned a malformed version: ${JSON.stringify(latest)}`);
    return 1;
  }
  // Argv array, never a shell string; stdio inherited so the installer's own
  // output flows through (REQ-8, design: Security Considerations).
  const install = deps.spawnImpl([pm, "install", "-g", `${PACKAGE_SPEC}@${latest}`], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = install.exitCode;
  // On success clear any stale record so no notice survives the upgrade.
  if (code === 0) {
    writeState(deps.stateFile, { lastCheck: new Date(deps.now()).toISOString() });
  }
  return code;
}
