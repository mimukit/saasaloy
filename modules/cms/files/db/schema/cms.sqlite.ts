import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

// The SQLite half of the CMS tables, selected by `onlyWith: "database-d1"`. Its Postgres
// twin sits beside it as `cms.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/cms.ts`. Change one and change the other: the repository is
// written once against both.
//
// Three tables (plan 0105, the Storage row):
//
//   cms_entries    the working draft of every entry, one row each
//   cms_revisions  a snapshot per publish; the public site reads the one an entry points at
//   cms_redirects  the old live slugs, each pointing at its entry
//
// `published_revision_id` is a plain column with no foreign key, on purpose. A key would
// close a cycle (entries -> revisions -> entries) that the seed engine cannot order, and
// the repository already keeps the pointer valid: a prune never deletes the live revision,
// and a revision is otherwise deleted only by its entry's cascade.
//
// Ids are `crypto.randomUUID()` text, set by the repository. A publish has to know the new
// revision's id before it points the entry at it, and D1 has no transaction to read it back.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const cmsEntries = sqliteTable(
  "cms_entries",
  {
    /** The author. `set null` keeps the post when the user is deleted; it shows no byline. */
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** The registered collection name, e.g. `blog`. */
    collection: text("collection").notNull(),
    createdAt: timestampMs("created_at").notNull().default(nowMs),
    /** Every field but title and slug, as JSON. The collection's Zod schema checks it. */
    data: text("data", { mode: "json" }).notNull(),
    id: text("id").primaryKey(),
    /** Set on the first publish only. A later publish changes the live revision's date. */
    publishedAt: timestampMs("published_at"),
    /** The live revision, or null when the entry is not published. No foreign key; see above. */
    publishedRevisionId: text("published_revision_id"),
    /** The working draft's slug. The live slug is the live revision's. */
    slug: text("slug").notNull(),
    /** `draft`, `published` or `archived`. */
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    updatedAt: timestampMs("updated_at").notNull().default(nowMs),
    /**
     * The last user who saved, published, unpublished, archived or restored the entry. A
     * `409 conflict` names them. `set null` keeps the entry when the user is deleted.
     */
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Bumped on every write. A save or publish that names an older one is a conflict. */
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("cms_entries_collection_slug_idx").on(
      table.collection,
      table.slug
    ),
    // The admin list and the public list both filter by collection and status.
    index("cms_entries_collection_status_idx").on(
      table.collection,
      table.status,
      table.publishedAt
    ),
  ]
);

export const cmsRevisions = sqliteTable(
  "cms_revisions",
  {
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** When this revision was published. The public page's "Updated" date. */
    createdAt: timestampMs("created_at").notNull().default(nowMs),
    data: text("data", { mode: "json" }).notNull(),
    entryId: text("entry_id")
      .notNull()
      .references(() => cmsEntries.id, { onDelete: "cascade" }),
    /** The body rendered at publish. `pnpm cms:rerender` rebuilds it. */
    html: text("html").notNull(),
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    index("cms_revisions_entry_id_created_at_idx").on(
      table.entryId,
      table.createdAt
    ),
    // The public read looks a live revision up by slug.
    index("cms_revisions_slug_idx").on(table.slug),
  ]
);

export const cmsRedirects = sqliteTable(
  "cms_redirects",
  {
    collection: text("collection").notNull(),
    createdAt: timestampMs("created_at").notNull().default(nowMs),
    /** The entry, not a slug: a chain of renames always ends at the current live slug. */
    entryId: text("entry_id")
      .notNull()
      .references(() => cmsEntries.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    oldSlug: text("old_slug").notNull(),
  },
  (table) => [
    uniqueIndex("cms_redirects_collection_old_slug_idx").on(
      table.collection,
      table.oldSlug
    ),
  ]
);
