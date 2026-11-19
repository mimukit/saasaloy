// The docs, as the pages and routes read them: the `docs` collection joined to
// .wikimap.yaml. `loadDocs()` returns every page in reading order with its entry, and fails
// the build when the wikimap and the wiki disagree (see lib/docs-nav.ts).
//
// The wikimap comes in through `?raw`, not `node:fs`: `astro dev` renders pages inside
// workerd, which has no `fs` or `child_process` that sees the repository (the spike in
// "Loader spike result" in PR #364). The content collection itself loads in Node, so the
// Markdown reads fine either way.
//
// A remark plugin (lib/docs-links.ts, lib/docs-blocks.ts) throws on a link to a missing page or
// a bad `saasaloy-*` block. Astro's glob loader catches that throw, logs it and stores the
// entry with no `rendered` field, so the build would go on and ship an empty page.
// `loadDocs()` throws on such an entry, and both docs routes call it from `getStaticPaths`,
// which Astro does not catch, so the build fails.

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
  const broken = entries.filter((entry) => entry.rendered === undefined);
  if (broken.length > 0) {
    throw new Error(
      `docs: ${broken.map((entry) => entry.id).join(", ")} did not render. The "[glob-loader] Error rendering" line above names the cause.`
    );
  }
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
