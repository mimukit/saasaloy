import { defineColumnClasses } from "../column-class";
import { cmsRevisions as cmsRevisionsTable } from "../schema/cms";

// How the production read-only role reads `cms_revisions`. See `../column-class.ts`.
// A revision is written only on publish, so its content is already public.

export const cmsRevisions = defineColumnClasses(cmsRevisionsTable, {
  authorId: "plain",
  createdAt: "plain",
  data: "plain",
  entryId: "plain",
  html: "plain",
  id: "plain",
  slug: "plain",
  title: "plain",
});
