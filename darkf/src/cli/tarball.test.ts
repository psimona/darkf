import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { todayLocal, writeProbeState } from "./setup.ts";

// Tarball smoke test (skill-setup spec: Testing): npm pack the package, then
// install the tarball into a temp prefix and run the installed CLI — proving
// the files allowlist ships every runtime dir (src, workflows, skills, docs)
// and nothing the CLI reads was dropped. Skipped when npm is absent.

const pkgDir = resolve(import.meta.dir, "..", "..");

test("tarball smoke: allowlist ships the runtime dirs and the installed CLI works", async () => {
  const npm = Bun.which("npm");
  if (!npm) {
    console.warn("npm not on PATH — skipping tarball smoke test");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "darkf-tarball-"));
  try {
    // Pack and inspect the tarball's contents.
    const pack = Bun.spawnSync([npm, "pack", "--json", "--pack-destination", root], {
      cwd: pkgDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(pack.exitCode).toBe(0);
    const filename = (
      JSON.parse(new TextDecoder().decode(pack.stdout)) as Array<{ filename: string }>
    )[0]?.filename;
    expect(filename).toBeTruthy();
    const tgz = join(root, filename!);
    const list = Bun.spawnSync(["tar", "-tzf", tgz], { stdout: "pipe", stderr: "pipe" });
    expect(list.exitCode).toBe(0);
    const entries = new TextDecoder()
      .decode(list.stdout)
      .split("\n")
      .filter((l) => l.startsWith("package/"));
    const top = new Set(entries.map((l) => l.split("/")[1]).filter(Boolean));
    // Exactly the allowlist plus the auto-included package.json and README.
    expect(top).toEqual(
      new Set(["README.md", "docs", "package.json", "skills", "src", "workflows"]),
    );
    const all = entries.join("\n");
    expect(all).not.toContain("package/examples/");
    expect(all).not.toContain("bunfig.toml");
    expect(all).not.toContain("tsconfig.json");
    expect(all).not.toContain("package/feedback/");

    // Install into a temp prefix — the offline global-install shape.
    const prefix = join(root, "prefix");
    const install = Bun.spawnSync(
      [npm, "install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", tgz],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(install.exitCode).toBe(0);
    const libRoot = join(prefix, "lib", "node_modules", "@psimona", "darkf");
    expect(existsSync(join(libRoot, "src", "cli", "index.ts"))).toBe(true);
    expect(existsSync(join(prefix, "bin", "darkf"))).toBe(true);

    // Temp HOME and state; the probe stamped so its block stays out of the way.
    // The home carries a .claude/skills dir so host detection works by dir
    // alone — CI runners have no claude binary on PATH.
    const home = join(root, "home");
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const stateHome = join(root, "state");
    mkdirSync(stateHome, { recursive: true });
    writeProbeState(join(stateHome, "darkf", "last-skills-check.json"), {
      lastProbe: todayLocal(),
    });
    const env = {
      ...process.env,
      HOME: home,
      XDG_STATE_HOME: stateHome,
      DARKF_NO_UPDATE_CHECK: "1",
    };
    const runBin = (args: string[]) => {
      const proc = Bun.spawnSync(
        [process.execPath, join(libRoot, "src", "cli", "index.ts"), ...args],
        {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          env,
        },
      );
      return {
        code: proc.exitCode,
        out: new TextDecoder().decode(proc.stdout),
        err: new TextDecoder().decode(proc.stderr),
      };
    };

    // `setup` installs both skills into a detected host.
    const setup = runBin(["setup"]);
    expect(setup.code).toBe(0);
    expect(setup.out).toContain("host claude (~/.claude/skills)");
    expect(existsSync(join(home, ".claude", "skills", "darkf-usage", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "darkf-writing-workflows", "SKILL.md"))).toBe(
      true,
    );

    // `doctor` renders the skills section from the installed package's bundle.
    const doctor = runBin(["doctor"]);
    expect(doctor.out).toContain("skills (claude) — 2/2 installed");

    // `render` loads a built-in workflow from the packaged workflows/.
    const render = runBin(["render", "series-ordering"]);
    expect(render.code).toBe(0);
    expect(render.out).toContain("stateDiagram-v2");

    // Every skill-referenced docs path resolves inside the installed package,
    // offline — the deep-reference pointers work for a global install.
    for (const skill of ["darkf-usage", "darkf-writing-workflows"]) {
      const text = readFileSync(join(libRoot, "skills", skill, "SKILL.md"), "utf8");
      const refs = [...text.matchAll(/docs\/[A-Za-z0-9][A-Za-z0-9/._-]*\.md/g)].map((m) => m[0]!);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(existsSync(join(libRoot, ref))).toBe(true);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 240_000);
