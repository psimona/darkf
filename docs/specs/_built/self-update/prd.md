---
status: approved
---

# CLI self-update — PRD

## Context

darkf publishes to npm as `@psimona/darkf`. A `v*` tag stages a release, and a
maintainer approves it (`release.yml`). An installed copy never learns about a
new release. Updating means remembering `bun install -g @psimona/darkf`. This
feature adds a daily startup check and a `darkf upgrade` command.

## Goals

Installed users learn about new releases without doing anything. A user
updates darkf with one command. The check never disturbs agent-driven use.

## Non-goals

- NG-1 — No auto-install at startup. Startup only notifies. Updating stays explicit.
- NG-2 — No updating of non-npm installs. A `pack:local` HEAD snapshot and
  the `file:` pin in the consumer repo keep their own scripts.
- NG-3 — No release channels, prerelease switching, or version pinning.
- NG-4 — No config file or settings surface. The opt-out is one environment variable.
- NG-5 — No per-project state. Nothing goes in `.darkf/`.

## Requirements

### REQ-1 — Daily update check (Must)

When a `darkf` command other than `upgrade` starts, and the last check is
older than 24 hours, the system shall compare the installed version with the
latest version published on npm.

### REQ-2 — One check per day (Must)

The system shall start at most one update check in any 24-hour period. A
failed attempt counts as a check.

### REQ-3 — Newer-version notice (Must)

While an update is available and `DARKF_NO_UPDATE_CHECK` is unset, the
system shall print one notice line as the first line of stdout on every
darkf command. The line names the latest version, the installed version,
and `darkf upgrade`.

### REQ-4 — Silent failure (Must)

If the check fails (no network, non-200 response, bad JSON, or timeout), then
the system shall continue the started command with no added output and a
normal result.

### REQ-5 — Opt-out (Should)

When a user sets `DARKF_NO_UPDATE_CHECK` to a non-empty value, the system
shall run no check, make no registry request, and print no notice. The
update feature acts as absent. This does not block an explicit
`darkf upgrade`.

### REQ-6 — Upgrade when current (Must)

When a user runs `darkf upgrade` and the installed version equals the latest
published version, the system shall print that darkf is current and exit 0.

### REQ-7 — Upgrade when newer (Must)

When a user runs `darkf upgrade` and npm has a newer version, the system
shall update the installed darkf to that version and print the previous and
new versions.

### REQ-8 — Update the owning installation (Must)

When `darkf upgrade` runs, the system shall update the installation that owns
the running `darkf` command. After the upgrade, the `darkf` command runs the
new version.

### REQ-9 — Refuse unknown provenance (Must)

If no supported package manager lists `@psimona/darkf` as installed, then the
system shall print a short explanation and exit non-zero without changing the
installation.

### REQ-10 — Surface upgrade failures (Must)

If the registry fetch fails during `darkf upgrade`, then the system shall
print the failure reason and exit non-zero.

### REQ-11 — Notice survives between checks (Must)

When the daily check finds a newer version, the system shall record it, so
later invocations print the notice with no new registry request. Finding
the current version installed clears the record.

## Constraints

- CON-1 — darkf runs on Bun only: `#!/usr/bin/env bun` shebang,
  `engines.bun >=1.2`, and `Bun.*` APIs across the codebase. Node
  compatibility is a repo-wide question and outside this feature.
- CON-2 — The published package has zero dependencies. The check uses `fetch`
  and `Bun.semver` only.
- CON-3 — The CLI adds no flags. Behavior varies through code, per
  `PHILOSOPHY.md`. An environment variable is not a flag.

## NFRs

- NFR-1 (Must) — While an update check runs, the system shall finish it or
  abandon it within 2 seconds.
- NFR-2 (Must) — The feature adds zero package dependencies.
- NFR-3 (Must) — While the notice prints, the system shall print exactly one
  line before the output of the command itself.

## Cut-lines

Deferred past this increment:

- "Skip this version" memory (the `skipped_version` pattern in opencode).
- A `--method` override for the installer probe.
- A `darkf version` command.

## Decisions, assumptions, open questions

Decisions:

- D-1 — Check at most once per 24 hours, stamped on every attempt. A
  bad-network day costs one timeout. It does not start a retry on every
  command.
- D-2 — Stamp at `~/.local/state/darkf/last-update-check.json`. XDG state
  semantics fit. opencode keeps the same class of data in
  `~/.local/state/opencode/kv.json`. `.config/darkf/` would create a config
  home that nothing uses yet. The file also carries the newest known
  version, which keeps the notice alive between daily checks (REQ-11).
- D-3 — Notice on stdout, first line, on every invocation while an update
  is available. Agents and humans both see it. Cost accepted: the line
  shifts the output of each command down, so anything that parses stdout
  line-by-line must skip it. The one-line bound (NFR-3) keeps that cheap.
- D-4 — Choose the installer by probing bun, then npm. Refuse when neither
  lists the package. opencode probes the same way and refuses "unknown".
- D-5 — No Node support in this feature. Bun-only is a repo-wide commitment
  (CON-1). Recorded here because it limits who can run darkf.

Assumptions:

- A-1 — `dist-tags.latest` on the npm packument is "the latest version".
- A-2 — `Bun.semver.order` orders every version darkf publishes correctly.
- A-3 — The state directory is writable. If it is not, the check degrades
  per REQ-4.

Open questions: none. We resolved the four open decisions on 2026-10-30.

## Changelog

- 2026-10-30 — Opt-out strengthened. `DARKF_NO_UPDATE_CHECK` now skips the
  check, the network call, and the notice (REQ-3, REQ-5). `darkf upgrade`
  stays available.
- 2026-10-30 — Notice moved to stdout as a persistent first line. REQ-3
  rewritten, REQ-11 and the new NFR-3 added, D-2 and D-3 updated. This
  replaces the earlier stderr-only decision.
- 2026-10-30 — First draft. Converted from the `spec.md` design sketch. It
  carries the four decisions from that sketch.
