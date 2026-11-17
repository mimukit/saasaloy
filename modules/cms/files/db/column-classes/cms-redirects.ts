import { defineColumnClasses } from "../column-class";
import { cmsRedirects as cmsRedirectsTable } from "../schema/cms";

// How the production read-only role reads `cms_redirects`. See `../column-class.ts`.

export const cmsRedirects = defineColumnClasses(cmsRedirectsTable, {
  collection: "plain",
  createdAt: "plain",
  entryId: "plain",
  id: "plain",
  oldSlug: "plain",
});
