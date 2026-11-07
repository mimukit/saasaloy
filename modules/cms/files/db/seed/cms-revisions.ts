import { cmsRevisions as cmsRevisionsTable } from "../../schema/cms";
import { seedId } from "../id";
import { defineSlice } from "../slice";
import { WELCOME_DATA, WELCOME_HTML } from "./cms-entries";

// The welcome post's one revision, the one `cms-entries.ts` points at as live. The draft
// post has none: a revision exists only once an entry is published.

export const cmsRevisions = defineSlice(cmsRevisionsTable, {
  rows: {
    "welcome-1": {
      authorId: seedId("users", "superadmin"),
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      data: WELCOME_DATA,
      entryId: seedId("cms_entries", "welcome"),
      html: WELCOME_HTML,
      slug: "welcome-to-the-blog",
      title: "Welcome to the blog",
    },
  },
});
