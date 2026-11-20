---
type: C4 Component
title: Article classifier example
status: stable
groma:
  id: article-classifier-example
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/examples/article-classifier/workflow.ts
    - scanner: typescript
      file: darkf/examples/article-classifier/scripts/next.ts
      symbol: next
    - scanner: typescript
      file: darkf/examples/article-classifier/scripts/record.ts
      symbol: record
    - scanner: typescript
      file: darkf/examples/article-classifier/scripts/queue.ts
    - scanner: typescript
      file: darkf/examples/article-classifier/data/articles.ts
  group: Example workflows
description: Demo workflow that classifies a fixed set of sample articles with one real LLM call per article.
---

Loop{Next → Classify → Record}, bounded by maxCycles, over the sample data in data/articles.ts; queue.ts holds the in-memory run-scoped bookkeeping shared between the Next and Record scripts. The one example actually wired to the real claudeCodeRunner for every dispatch.
