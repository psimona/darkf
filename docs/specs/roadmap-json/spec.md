# Roadmap JSON: a machine-readable sidecar for decision maps

An investigation draft, not yet a decision. This repo steers itself with
markdown decision maps (`docs/roadmap/<effort>/map.md` plus per-ticket
files): decisions, their dependencies, and the frontier — the set of
pending decisions nothing else waits on. The format works for humans and
loses nothing for the OpenCode TUI plugin and the docs site, which cannot
render prose reliably. This spec proposes a JSON sidecar per map, written
and read alongside the markdown.

## Problem

The frontier lives in prose. Answering "what can I decide next?" means
reading every map. A visualizer (the TUI plugin's roadmap pane, or a site
page) would have to parse markdown headings and ticket filenames — fragile,
lossy, and blind to decision status (open / decided / shipped) unless the
prose happens to state it.

## Goals

- One JSON sidecar per effort map (`map.json` next to `map.md`), carrying:
  decisions (id, title, status, decided-date), dependency edges, and the
  derived frontier.
- The markdown map stays the source of truth for reasoning; the sidecar is
  derivable state, and a tiny check script fails CI when they drift.
- Both renderers (TUI pane, site) read only the JSON.

## Non-goals

- Replacing markdown maps with a database or a web app.
- Cross-repo roadmap aggregation (blueprint and darkf keep separate maps).
- Ticket-level detail in the sidecar — decisions and edges only; ticket
  files stay linked by name.

## Design sketch

```ts
export type DecisionStatus = "open" | "decided" | "shipped";

export interface RoadmapDecision {
  id: string;            // stable slug, e.g. "package-name"
  title: string;
  status: DecisionStatus;
  decided?: string;      // ISO date; required when status != open
  outcome?: string;      // one-line resolution, e.g. "@psimona/darkf"
  dependsOn?: string[];  // ids of decisions that must resolve first
}

export interface RoadmapMap {
  effort: string;        // slug, e.g. "oss-publish"
  updated: string;       // ISO date
  decisions: RoadmapDecision[];
}
```

The frontier is derived, not stored: open decisions whose `dependsOn` are
all non-open. `docs/specs/oss-publish`'s own grill session would have been
exactly a `RoadmapMap` with ten decisions — the format is proven by the
work this repo already does.

Drift check: `darkf` gains no command for this initially; a `scripts/`
check (or an `item-loop`-style script node inside darkf's own CI workflow)
validates `map.json` against `map.md` by requiring every decision id to
appear as a heading or bullet anchor in the markdown. Exact-anchor rules
are the main open question.

## Open decisions

- **Sidecar vs single-source JSON.** Two files can drift (hence the check);
  one JSON file with a markdown renderer avoids drift but makes the maps
  unpleasant to write and review in diffs. Recommendation: sidecar + drift
  check, revisited if the check gets noisy.
- **Where renderers live.** The TUI plugin pane is in-repo; a site page
  ("current frontier") is cheap for Starlight once the JSON exists — same
  decision, two consumers.
- **Status vocabulary.** `open/decided/shipped` mirrors this repo's
  specs-pipeline (`docs/specs/` vs `_built/`). Enough, or does the site
  need `superseded`?
