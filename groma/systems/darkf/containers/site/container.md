---
type: C4 Container
title: site
status: draft
groma:
  id: site
  parent: darkf
  technology: Astro, Starlight
description: The public darkf documentation site, published to psimona.github.io/darkf.
---

An Astro + Starlight static site. Renders the same Markdown the darkf-cli container ships under darkf/docs/ (npm's files allowlist), so the site and the published package read from one source of truth. Supports Mermaid diagrams (rehype-mermaid) for rendering workflow graphs in docs.
