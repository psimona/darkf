# Visibility, sharing, and indexing: positioning copy + crawler surface

## The problem

darkf is public (npm, GitHub, a docs site) but carries no signal for
either a human skimming it or a crawler indexing it. Two gaps, not
one:

- **Positioning.** The one differentiator that answers the obvious
  skepticism about a "dark factory" — that it means nobody is ever
  watching — was implicit at best. Real lights-out manufacturing runs
  dark when things go well and stops itself when they don't (jidoka).
  darkf already does the mechanical half of that (a crash ends the
  run at the failing step instead of guessing or looping forever) but
  never said so in the one sentence a skimming reader actually reads.
- **Crawler surface.** No `robots.txt`, no `llms.txt`, no npm keywords
  for the category terms ("dark factory", "software factory") a
  reader hunting for this kind of tool would type.

## Goals

- Every public entry point (`README.md`, the docs homepage) states the
  jidoka framing in the same words, so a reader lands on the same
  story everywhere.
- The framing isn't just marketing copy — it's recorded in
  `PHILOSOPHY.md` as the reason the existing crash/failure-mode design
  looks the way it does, not a new claim bolted on top of it.
- Crawlers (search + LLM-training bots) get an explicit allow and a
  machine-readable summary, without claiming control this repo
  doesn't actually have.
- The npm keyword surface includes the category terms.
- The darkf-backplane idea (chat access, cloud scheduling, trace
  analytics — still at ideation) gets exactly one durable pointer so
  it isn't lost, without promising a timeline or scope it doesn't have
  yet.

## Non-goals

- **Actually posting** to HN, Reddit, X/Bluesky, Product Hunt, dev.to,
  or awesome-list PRs. That's an operator action list, not a doc
  change — tracked as a follow-up below, not shipped here.
- **A custom domain.** Flagged as the real fix for `robots.txt`'s
  authority problem (below), not undertaken.
- **Building darkf-backplane.** Roadmap pointer only.
- **The 30-second demo asset** and the journal-replay mechanism it
  needs. Split out to `docs/specs/demo-visibility/spec.md` — a
  genuinely open design, not a documentation change.

## What shipped

**Positioning copy**, the same two sentences in both public entry
points:

> Lights out when a run is clean. Lights on the moment it isn't.
> That's jidoka — the line stops itself at the failing step and calls
> for help, instead of an agent running on past broken work.

- `README.md` — added right after the existing tagline.
- `darkf/docs/index.mdx` (the docs site homepage) — added as a closer,
  immediately before "Start with one workflow. Grow it into your dark
  factory."
- `PHILOSOPHY.md` — a new principle, "Jidoka, not full autonomy",
  placed first (before "Simplicity, not options"), explicitly naming
  "Crash is not a verdict" as the mechanism this principle is the
  reason for.
- `ROADMAP.md` — one `## Not started` bullet for darkf-backplane:
  chat access, cloud scheduling, trace analytics (overlapping the
  existing observability/learning-loop item), build order not
  committed.

**Crawler surface**, both under `site/public/` (Astro copies this
directory verbatim to the build root, so these ship at
`https://psimona.github.io/darkf/<file>`):

- `robots.txt` — `Allow: /` for `*`, and explicit `Allow: /` entries
  for `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, plus
  a `Sitemap:` line pointing at the sitemap Astro/Starlight already
  generates (`dist/sitemap-index.xml`, confirmed present in a local
  build — no new sitemap integration needed).
- `llms.txt` — project summary plus a link to every page in the docs
  sidebar, per the `llms.txt` convention.

**npm metadata** — `darkf/package.json`'s `keywords` gained
`dark-factory`, `software-factory`, `automation`, `llm-agents`
alongside the existing `workflow`, `agent`, `state-graph`,
`claude-code`, `opencode`, `bun`.

## Known limitation: `robots.txt`'s authority

GitHub Pages serves a project page's `robots.txt` only at its own
subpath (`psimona.github.io/darkf/robots.txt`), never at the domain
root. Confirmed directly: `https://psimona.github.io/robots.txt`
currently 404s, so there's no existing apex file this one conflicts
with — but a crawler that only checks the apex (the spec-compliant
behavior) won't see this file either way. The real fix is a custom
domain (e.g. `darkf.dev`), which also makes the project read as more
credible on its own. Not undertaken here; recorded as a follow-up.

## Follow-ups (not blocking, tracked so they aren't lost)

- **GitHub repo topics** (`gh repo edit psimona/darkf --add-topic
  llm-agents,workflow-engine,bun,typescript,dark-factory,software-factory`)
  — left for the operator to run deliberately; it's an external,
  shared-state change, not a file in this repo.
- **The posting plan itself** (Show HN copy, Reddit threads, an X/
  Bluesky clip, a PH/dev.to write-up, awesome-list PRs) — sequencing
  is "ship the `demo-visibility` recording first, then post," since
  the single biggest traction lever is the demo, not the copy.
- **Custom domain** — see above.

## Verification

- `cd site && bun run build` — confirms `robots.txt` and `llms.txt`
  land in `dist/` unchanged, alongside the existing
  `sitemap-index.xml`.
- After deploy: `curl https://psimona.github.io/darkf/robots.txt` and
  `.../llms.txt` resolve with the expected content.
- Manual read-through: `README.md`, the docs homepage, and
  `PHILOSOPHY.md` all state the same two-sentence framing, in the
  same words.
