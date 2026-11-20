// Reads `docs/wiki/.wikimap.yaml` for the docs checks (plan 0114, Phase 5): which pages are
// hand-written, and which repo paths each one covers. `docs-stale.ts` and
// `docs-names.ts` share it, and `apps/web/src/lib/docs-nav.ts` reads the same file for the
// sidebar. Imports `yaml` and node: builtins only; Node 24 strips the types.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const WIKI_DIR = "docs/wiki";

/** One entry of the wikimap. */
export interface WikiPage {
  /** Path under `docs/wiki/`, such as `how-to/add-a-module.md`. */
  path: string;
  title: string;
  /** True for a page `pnpm docs:generate` writes. */
  generated: boolean;
  /** The repo globs the page covers. */
  documents: string[];
}

interface RawPage {
  path: string;
  title?: string;
  generated?: boolean;
  documents?: string[];
}

/** Every page of the wikimap, in file order. */
export function readWikimap(root: string): WikiPage[] {
  const text = readFileSync(join(root, WIKI_DIR, ".wikimap.yaml"), "utf-8");
  const map = parse(text) as { pages?: RawPage[] };
  return (map.pages ?? []).map((page) => ({
    path: page.path,
    title: page.title ?? page.path,
    generated: page.generated === true,
    documents: page.documents ?? [],
  }));
}

/** The hand-written pages: the ones a person has to keep true. */
export function handWritten(pages: readonly WikiPage[]): WikiPage[] {
  return pages.filter((page) => !page.generated);
}
