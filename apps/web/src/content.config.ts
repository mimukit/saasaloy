// The `docs` collection: every Markdown page under docs/wiki/, read in place with the
// `glob` loader. Nothing is copied into apps/web, so the wiki stays the one source (plan 0114).
//
// The id is the page's path under docs/wiki/, `.md` included, such as
// `generated/modules/email.md`. src/lib/docs-slug.ts turns it into a URL, and
// src/lib/docs-nav.ts joins it to .wikimap.yaml for the title and the section. The wiki has no
// front matter, because GitHub renders front matter as a table, so the collection has no schema.

import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "../../docs/wiki",
    generateId: ({ entry }) => entry,
  }),
});

export const collections = { docs };
