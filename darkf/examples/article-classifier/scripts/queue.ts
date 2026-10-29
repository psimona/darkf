import { type Article, articles } from "../data/articles.ts";

export interface ClassifiedArticle extends Article {
  category: string;
}

// This is run-scoped bookkeeping shared by next.ts and record.ts via plain
// module scope — not the handoff, and not a file. It doesn't need to be a
// file: it's private coordination between two script nodes, invisible to the
// engine, and doesn't need to survive past this one process. See
// PHILOSOPHY.md's "no global, accumulating context" — this is the sanctioned
// escape hatch (a node's own code choosing to carry state), scoped as
// narrowly as possible instead of riding through the handoff or the agent.
let index = 0;
const results: ClassifiedArticle[] = [];

export function isDone(): boolean {
  return index >= articles.length;
}

export function currentArticle(): Article {
  return articles[index]!;
}

export function recordCategory(category: string): ClassifiedArticle[] {
  results.push({ ...currentArticle(), category });
  index++;
  return results;
}

export function allResults(): ClassifiedArticle[] {
  return results;
}
