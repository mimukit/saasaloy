import { cmsEntries as cmsEntriesTable } from "../../schema/cms";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// Two blog posts, one for each state the admin list and the public site show first: a
// published post with one revision, and a draft that the public site never serves.
//
// The welcome post points at its revision in `cms-revisions.ts` through
// `published_revision_id`. That column has no foreign key, so the two slices need no order
// beyond the revision's own key on this table. The dates are fixed, so a rerun writes the
// same rows.

const PUBLISHED = new Date("2026-11-01T09:00:00.000Z");
const DRAFTED = new Date("2026-11-03T15:30:00.000Z");

/** The welcome post's body. `cms-revisions.ts` snapshots the same document. */
export const WELCOME_BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "This is the first post on the new blog. Every post is written, saved and published from the admin app, and the public site shows it within a minute.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "What you can do" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Save a draft without changing the live post.",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Publish, then restore any earlier revision.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Read the " },
        {
          type: "text",
          text: "privacy policy",
          marks: [{ type: "link", attrs: { href: "/privacy" } }],
        },
        { type: "text", text: " to see a relative link." },
      ],
    },
  ],
};

/** The welcome post's body as `renderRichText` renders it. `pnpm cms:rerender` rebuilds it. */
export const WELCOME_HTML =
  '<p>This is the first post on the new blog. Every post is written, saved and published from the admin app, and the public site shows it within a minute.</p><h2>What you can do</h2><ul><li><p>Save a draft without changing the live post.</p></li><li><p>Publish, then restore any earlier revision.</p></li></ul><p>Read the <a href="/privacy">privacy policy</a> to see a relative link.</p>';

export const WELCOME_DATA = {
  body: WELCOME_BODY,
  cover: null,
  excerpt:
    "What the blog is for, and how a post gets from a draft to the public site.",
  seo: {},
};

export const cmsEntries = defineSlice(cmsEntriesTable, {
  rows: {
    welcome: {
      authorId: seedId("users", "superadmin"),
      collection: "blog",
      createdAt: PUBLISHED,
      data: WELCOME_DATA,
      publishedAt: PUBLISHED,
      publishedRevisionId: seedId("cms_revisions", "welcome-1"),
      slug: "welcome-to-the-blog",
      status: "published",
      title: "Welcome to the blog",
      updatedAt: PUBLISHED,
      updatedBy: seedId("users", "superadmin"),
      version: 2,
    },
    "second-post": {
      authorId: seedId("users", "admin"),
      collection: "blog",
      createdAt: DRAFTED,
      data: {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "A draft stays in the admin app until someone publishes it. The public blog returns 404 for this slug.",
                },
              ],
            },
          ],
        },
        cover: null,
        excerpt: "",
        seo: {},
      },
      slug: "drafting-the-second-post",
      status: "draft",
      title: "Drafting the second post",
      updatedAt: DRAFTED,
      updatedBy: seedId("users", "admin"),
      version: 1,
    },
  },
});
