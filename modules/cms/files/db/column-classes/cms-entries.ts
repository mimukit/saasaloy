import { defineColumnClasses } from "../column-class";
import { cmsEntries as cmsEntriesTable } from "../schema/cms";

// How the production read-only role reads `cms_entries`. See `../column-class.ts`.

export const cmsEntries = defineColumnClasses(cmsEntriesTable, {
  authorId: "plain",
  collection: "plain",
  createdAt: "plain",
  // The working draft's fields, free text an author wrote and may not have published.
  data: "pii",
  id: "plain",
  publishedAt: "plain",
  publishedRevisionId: "plain",
  slug: "plain",
  status: "plain",
  // The working draft's title, free text an author wrote and may not have published.
  title: "pii",
  updatedAt: "plain",
  updatedBy: "plain",
  version: "plain",
});
