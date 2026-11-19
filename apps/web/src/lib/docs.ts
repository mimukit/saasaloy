// The docs, as the pages and routes read them: the `docs` collection joined to
// .wikimap.yaml. `loadDocs()` returns every page in reading order with its entry, and fails
// the build when the wikimap and the wiki disagree (see lib/docs-nav.ts).
//
// The wikimap comes in through `?raw`, not `node:fs`: `astro dev` renders pages inside
// workerd, which has no `fs` or `child_process` that sees the repository (the spike in
// .afkkit/groups/g2-spike.md). The content collection itself loads in Node, so the Markdown
// reads fine either way.

import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

import wikimap from "../../../../docs/wiki/.wikimap.yaml?raw";
import { buildDocsPages, firstHeading } from "@web/lib/docs-nav";
import type { DocsPage } from "@web/lib/docs-nav";

export interface DocsItem {
  page: DocsPage;
  entry: CollectionEntry<"docs">;
}

/** Every wiki page with its collection entry, in sidebar-independent reading order. */
export async function loadDocs(): Promise<{
  items: DocsItem[];
  pages: DocsPage[];
}> {
  const entries = await getCollection("docs");
  const pages = buildDocsPages(
    wikimap,
    entries.map((entry) => ({
      path: entry.id,
      heading: firstHeading(entry.body ?? ""),
    }))
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const items = pages.map((page) => {
    const entry = byId.get(page.path);
    if (entry === undefined) {
      throw new Error(`docs: no entry for ${page.path}.`);
    }
    return { page, entry };
  });
  return { items, pages };
}
