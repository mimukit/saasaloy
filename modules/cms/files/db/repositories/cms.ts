import { and, count, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { users } from "../schema/auth";
import { cmsEntries, cmsRedirects, cmsRevisions } from "../schema/cms";
import type { Db } from "../client";
import {
  assertDeletable,
  CmsRepositoryError,
  hasUnpublishedEdits,
  pageWindow,
  publishedAtFor,
  redirectSlugFor,
  revisionsToPrune,
} from "./cms-rules";
import type { CmsStatus, Snapshot } from "./cms-rules";

// Every query the CMS tables need, written once for both dialects (the table declarations
// in `schema/cms.sqlite.ts` and `.pg.ts` are the only driver-specific part).
//
// The repository checks versions, statuses and slugs, and throws `CmsRepositoryError` with
// a stable code. It never checks `data` against a collection and never renders: that needs
// `@repo/cms`, and `packages/db` stays free of it. A publish takes a `render` callback, and
// the api passes one built from `renderRichText`.
//
// D1 has no interactive transaction, so a multi-step write is ordered to fail safe. A
// publish inserts the revision first, then moves the entry with a version-checked update,
// and deletes the revision again when that update loses the race.

export { CmsRepositoryError, REVISION_LIMIT } from "./cms-rules";
export type { CmsErrorCode, CmsStatus } from "./cms-rules";

export type CmsEntryRow = typeof cmsEntries.$inferSelect;
export type CmsRevisionRow = typeof cmsRevisions.$inferSelect;

/** The admin list filters. `current` is draft plus published; archived hides by default. */
export type CmsEntryFilter = "current" | CmsStatus | "all";

/** An entry as the admin screens see it: the working draft plus its publishing state. */
export interface CmsEntry extends CmsEntryRow {
  authorName: string | null;
  /** The name of the user `updated_by` names, or null. A `409 conflict` reports it. */
  updatedByName: string | null;
  /** The live revision's slug, or null when the entry is not published. */
  liveSlug: string | null;
  /** True when a published entry's draft differs from its live revision. */
  unpublishedEdits: boolean;
}

/** One row of the admin list. The same as `CmsEntry` without `data`. */
export type CmsEntrySummary = Omit<CmsEntry, "data">;

/** One revision in the revisions drawer, without its body. */
export interface CmsRevisionSummary {
  id: string;
  title: string;
  slug: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  live: boolean;
}

/** A published entry as the public routes return it. */
export interface CmsPublicEntry {
  id: string;
  collection: string;
  title: string;
  slug: string;
  data: unknown;
  authorName: string | null;
  /** The first publish. */
  publishedAt: Date;
  /** The latest publish: the live revision's date. Show "Updated" when it differs. */
  updatedAt: Date;
}

/** A page of published entries, newest `publishedAt` first. */
export interface CmsPublicPage {
  entries: CmsPublicEntry[];
  page: number;
  pageCount: number;
  total: number;
}

/** The answer to a public read by slug. */
export type CmsPublicRead =
  | { kind: "entry"; entry: CmsPublicEntry & { html: string } }
  | { kind: "redirect"; slug: string }
  | { kind: "missing" };

/** Renders a snapshot's body to HTML. The api passes one built from `renderRichText`. */
export type CmsRender = (snapshot: Snapshot & { collection: string }) => string;

function newId(): string {
  return crypto.randomUUID();
}

/** A live revision joined on the entry that points at it. */
const liveRevision = eq(cmsRevisions.id, cmsEntries.publishedRevisionId);

/**
 * The last editor's name, as a scalar subquery. The outer query already joins `users` for
 * the author, so the editor cannot take a second plain join without a dialect-specific
 * alias. Inside the parentheses `users` names the inner table, and SQLite and Postgres both
 * resolve the bare reference to the nearest scope.
 */
const updatedByName = sql<
  string | null
>`(select ${users.name} from ${users} where ${users.id} = ${cmsEntries.updatedBy})`;

const entryColumns = {
  authorId: cmsEntries.authorId,
  authorName: users.name,
  collection: cmsEntries.collection,
  createdAt: cmsEntries.createdAt,
  id: cmsEntries.id,
  liveData: cmsRevisions.data,
  liveSlug: cmsRevisions.slug,
  liveTitle: cmsRevisions.title,
  publishedAt: cmsEntries.publishedAt,
  publishedRevisionId: cmsEntries.publishedRevisionId,
  slug: cmsEntries.slug,
  status: cmsEntries.status,
  title: cmsEntries.title,
  updatedAt: cmsEntries.updatedAt,
  updatedBy: cmsEntries.updatedBy,
  updatedByName,
  version: cmsEntries.version,
};

/** What `entryColumns` selects, without `data`. */
type JoinedEntry = Omit<CmsEntryRow, "data"> & {
  authorName: string | null;
  updatedByName: string | null;
  liveData: unknown;
  liveSlug: string | null;
  liveTitle: string | null;
};

function toEntry(row: JoinedEntry, data: unknown): CmsEntry {
  const { liveData, liveSlug, liveTitle, ...rest } = row;
  const live =
    liveSlug === null || liveTitle === null
      ? null
      : { data: liveData, slug: liveSlug, title: liveTitle };
  return {
    ...rest,
    data,
    liveSlug,
    unpublishedEdits: hasUnpublishedEdits(
      { data, slug: row.slug, status: row.status, title: row.title },
      live
    ),
  };
}

function filterCondition(filter: CmsEntryFilter): SQL | undefined {
  switch (filter) {
    case "all": {
      return undefined;
    }
    case "current": {
      return inArray(cmsEntries.status, ["draft", "published"]);
    }
    default: {
      return eq(cmsEntries.status, filter);
    }
  }
}

/**
 * Throw `slug_taken` when another entry in the collection uses `slug` as its draft slug or
 * as its live slug. The unique index covers draft slugs only, and a live slug can differ
 * from its entry's draft, so both are checked here.
 */
async function assertSlugFree(
  db: Db,
  collection: string,
  slug: string,
  exceptId: string | null
): Promise<void> {
  const clash = await db
    .select({ id: cmsEntries.id })
    .from(cmsEntries)
    .leftJoin(cmsRevisions, liveRevision)
    .where(
      and(
        eq(cmsEntries.collection, collection),
        or(eq(cmsEntries.slug, slug), eq(cmsRevisions.slug, slug)),
        exceptId === null ? undefined : ne(cmsEntries.id, exceptId)
      )
    )
    .limit(1);
  if (clash.length > 0) {
    throw new CmsRepositoryError(
      "slug_taken",
      `Another entry in "${collection}" already uses the slug "${slug}".`
    );
  }
}

/** Load the raw row, or throw `not_found`. */
async function requireRow(
  db: Db,
  collection: string,
  id: string
): Promise<CmsEntryRow> {
  const [row] = await db
    .select()
    .from(cmsEntries)
    .where(and(eq(cmsEntries.id, id), eq(cmsEntries.collection, collection)))
    .limit(1);
  if (!row) {
    throw new CmsRepositoryError("not_found", "No such entry.");
  }
  return row;
}

function conflict(): CmsRepositoryError {
  return new CmsRepositoryError(
    "conflict",
    "Someone else saved this entry after you opened it. Reload to see their changes."
  );
}

/**
 * Run a version-checked update. Returns the updated row; throws `not_found` when the entry
 * is gone and `conflict` when its version moved on.
 */
async function updateAtVersion(
  db: Db,
  collection: string,
  id: string,
  version: number,
  values: Partial<typeof cmsEntries.$inferInsert>
): Promise<CmsEntryRow> {
  const [row] = await db
    .update(cmsEntries)
    .set({
      ...values,
      updatedAt: new Date(),
      version: sql`${cmsEntries.version} + 1`,
    })
    .where(
      and(
        eq(cmsEntries.id, id),
        eq(cmsEntries.collection, collection),
        eq(cmsEntries.version, version)
      )
    )
    .returning();
  if (row) {
    return row;
  }
  await requireRow(db, collection, id);
  throw conflict();
}

// --- Admin reads -----------------------------------------------------------------------

/** One entry with its publishing state, or `undefined`. */
export async function getEntry(
  db: Db,
  collection: string,
  id: string
): Promise<CmsEntry | undefined> {
  const [row] = await db
    .select({ ...entryColumns, data: cmsEntries.data })
    .from(cmsEntries)
    .leftJoin(cmsRevisions, liveRevision)
    .leftJoin(users, eq(users.id, cmsEntries.authorId))
    .where(and(eq(cmsEntries.id, id), eq(cmsEntries.collection, collection)))
    .limit(1);
  if (!row) {
    return undefined;
  }
  const { data, ...rest } = row;
  return toEntry(rest, data);
}

/** The admin list, most recently updated first. */
export async function listEntries(
  db: Db,
  collection: string,
  options: { filter?: CmsEntryFilter; page?: number; pageSize: number }
): Promise<{
  entries: CmsEntrySummary[];
  page: number;
  pageCount: number;
  total: number;
  /** Entries per status in the whole collection, whatever the filter. The chip counts. */
  counts: Record<CmsStatus, number>;
}> {
  const where = and(
    eq(cmsEntries.collection, collection),
    filterCondition(options.filter ?? "current")
  );
  const window = pageWindow(options.page ?? 1, options.pageSize);
  const [rows, [totals], byStatus] = await Promise.all([
    db
      .select({ ...entryColumns, data: cmsEntries.data })
      .from(cmsEntries)
      .leftJoin(cmsRevisions, liveRevision)
      .leftJoin(users, eq(users.id, cmsEntries.authorId))
      .where(where)
      .orderBy(desc(cmsEntries.updatedAt))
      .limit(window.limit)
      .offset(window.offset),
    db.select({ total: count() }).from(cmsEntries).where(where),
    db
      .select({ status: cmsEntries.status, total: count() })
      .from(cmsEntries)
      .where(eq(cmsEntries.collection, collection))
      .groupBy(cmsEntries.status),
  ]);
  const total = totals?.total ?? 0;
  const counts: Record<CmsStatus, number> = {
    archived: 0,
    draft: 0,
    published: 0,
  };
  for (const row of byStatus) {
    counts[row.status as CmsStatus] = row.total;
  }
  return {
    counts,
    entries: rows.map(({ data, ...rest }) => {
      const { data: _data, ...summary } = toEntry(rest, data);
      return summary;
    }),
    page: window.page,
    pageCount: Math.max(1, Math.ceil(total / options.pageSize)),
    total,
  };
}

/** The revisions drawer: every revision of an entry, newest first, the live one marked. */
export async function listRevisions(
  db: Db,
  collection: string,
  id: string
): Promise<CmsRevisionSummary[]> {
  const entry = await requireRow(db, collection, id);
  const rows = await db
    .select({
      authorId: cmsRevisions.authorId,
      authorName: users.name,
      createdAt: cmsRevisions.createdAt,
      id: cmsRevisions.id,
      slug: cmsRevisions.slug,
      title: cmsRevisions.title,
    })
    .from(cmsRevisions)
    .leftJoin(users, eq(users.id, cmsRevisions.authorId))
    .where(eq(cmsRevisions.entryId, id))
    .orderBy(desc(cmsRevisions.createdAt));
  return rows.map((row) => ({
    ...row,
    live: row.id === entry.publishedRevisionId,
  }));
}

// --- Admin writes ----------------------------------------------------------------------

/** Create a draft. `data` must already pass the collection's `dataSchema`. */
export async function createEntry(
  db: Db,
  input: Snapshot & { collection: string; authorId: string | null }
): Promise<CmsEntryRow> {
  await assertSlugFree(db, input.collection, input.slug, null);
  const [row] = await db
    .insert(cmsEntries)
    .values({
      authorId: input.authorId,
      collection: input.collection,
      data: input.data,
      id: newId(),
      slug: input.slug,
      status: "draft",
      title: input.title,
      updatedBy: input.authorId,
    })
    .returning();
  return row as CmsEntryRow;
}

/** Save the working draft. Never changes the live post. */
export async function saveDraft(
  db: Db,
  input: Snapshot & {
    collection: string;
    id: string;
    version: number;
    editorId: string | null;
  }
): Promise<CmsEntryRow> {
  await assertSlugFree(db, input.collection, input.slug, input.id);
  return updateAtVersion(db, input.collection, input.id, input.version, {
    data: input.data,
    slug: input.slug,
    title: input.title,
    updatedBy: input.editorId,
  });
}

/**
 * Publish the working draft: copy it into a new revision with its rendered HTML, point the
 * entry at it, set `published_at` on the first publish only, write a redirect when the live
 * slug changes, and prune old revisions.
 */
export async function publishEntry(
  db: Db,
  input: {
    collection: string;
    id: string;
    version: number;
    authorId: string | null;
    render: CmsRender;
  }
): Promise<{ entry: CmsEntryRow; revision: CmsRevisionRow }> {
  const { collection, id, version } = input;
  const current = await requireRow(db, collection, id);
  if (current.version !== version) {
    throw conflict();
  }
  await assertSlugFree(db, collection, current.slug, id);

  let previousLiveSlug: string | null = null;
  if (current.publishedRevisionId !== null) {
    const [previous] = await db
      .select({ slug: cmsRevisions.slug })
      .from(cmsRevisions)
      .where(eq(cmsRevisions.id, current.publishedRevisionId))
      .limit(1);
    previousLiveSlug = previous?.slug ?? null;
  }

  const snapshot = {
    collection,
    data: current.data,
    slug: current.slug,
    title: current.title,
  };
  const html = input.render(snapshot);
  const now = new Date();

  const [revision] = await db
    .insert(cmsRevisions)
    .values({
      authorId: input.authorId,
      createdAt: now,
      data: current.data,
      entryId: id,
      html,
      id: newId(),
      slug: current.slug,
      title: current.title,
    })
    .returning();
  const created = revision as CmsRevisionRow;

  let entry: CmsEntryRow;
  try {
    entry = await updateAtVersion(db, collection, id, version, {
      publishedAt: publishedAtFor(current.publishedAt, now),
      publishedRevisionId: created.id,
      status: "published",
      updatedBy: input.authorId,
    });
  } catch (error) {
    await db.delete(cmsRevisions).where(eq(cmsRevisions.id, created.id));
    throw error;
  }

  // The new live slug belongs to this entry now, so no redirect may point it elsewhere.
  await db
    .delete(cmsRedirects)
    .where(
      and(
        eq(cmsRedirects.collection, collection),
        eq(cmsRedirects.oldSlug, current.slug)
      )
    );
  const oldSlug = redirectSlugFor(previousLiveSlug, current.slug);
  if (oldSlug !== null) {
    await db
      .insert(cmsRedirects)
      .values({ collection, entryId: id, id: newId(), oldSlug })
      .onConflictDoUpdate({
        set: { entryId: id },
        target: [cmsRedirects.collection, cmsRedirects.oldSlug],
      });
  }

  await pruneRevisions(db, id, created.id);
  return { entry, revision: created };
}

/** Take a published entry offline. It becomes a draft; its revisions stay. */
export function unpublishEntry(
  db: Db,
  input: {
    collection: string;
    id: string;
    version: number;
    editorId: string | null;
  }
): Promise<CmsEntryRow> {
  return updateAtVersion(db, input.collection, input.id, input.version, {
    publishedRevisionId: null,
    status: "draft",
    updatedBy: input.editorId,
  });
}

/** Archive an entry: offline, and hidden from the default admin list. */
export function archiveEntry(
  db: Db,
  input: {
    collection: string;
    id: string;
    version: number;
    editorId: string | null;
  }
): Promise<CmsEntryRow> {
  return updateAtVersion(db, input.collection, input.id, input.version, {
    publishedRevisionId: null,
    status: "archived",
    updatedBy: input.editorId,
  });
}

/** Hard delete a draft or archived entry. Revisions and redirects go with it (cascade). */
export async function deleteEntry(
  db: Db,
  input: { collection: string; id: string }
): Promise<void> {
  const row = await requireRow(db, input.collection, input.id);
  assertDeletable(row.status);
  await db
    .delete(cmsEntries)
    .where(
      and(
        eq(cmsEntries.id, input.id),
        inArray(cmsEntries.status, ["draft", "archived"])
      )
    );
}

/** Copy a revision's snapshot into the working draft. The live post changes on the next publish. */
export async function restoreRevision(
  db: Db,
  input: {
    collection: string;
    id: string;
    revisionId: string;
    version: number;
    editorId: string | null;
  }
): Promise<CmsEntryRow> {
  const [revision] = await db
    .select()
    .from(cmsRevisions)
    .where(
      and(
        eq(cmsRevisions.id, input.revisionId),
        eq(cmsRevisions.entryId, input.id)
      )
    )
    .limit(1);
  if (!revision) {
    throw new CmsRepositoryError("not_found", "No such revision.");
  }
  await assertSlugFree(db, input.collection, revision.slug, input.id);
  return updateAtVersion(db, input.collection, input.id, input.version, {
    data: revision.data,
    slug: revision.slug,
    title: revision.title,
    updatedBy: input.editorId,
  });
}

/** Keep the newest `REVISION_LIMIT` revisions of an entry, and the live one. Returns the count pruned. */
export async function pruneRevisions(
  db: Db,
  entryId: string,
  liveRevisionId: string | null
): Promise<number> {
  const rows = await db
    .select({ createdAt: cmsRevisions.createdAt, id: cmsRevisions.id })
    .from(cmsRevisions)
    .where(eq(cmsRevisions.entryId, entryId));
  const doomed = revisionsToPrune(rows, liveRevisionId);
  if (doomed.length > 0) {
    await db.delete(cmsRevisions).where(inArray(cmsRevisions.id, doomed));
  }
  return doomed.length;
}

// --- Public reads ----------------------------------------------------------------------

const publicColumns = {
  authorName: users.name,
  collection: cmsEntries.collection,
  data: cmsRevisions.data,
  id: cmsEntries.id,
  publishedAt: cmsEntries.publishedAt,
  slug: cmsRevisions.slug,
  title: cmsRevisions.title,
  updatedAt: cmsRevisions.createdAt,
};

function isLive(collection: string): SQL | undefined {
  return and(
    eq(cmsEntries.collection, collection),
    eq(cmsEntries.status, "published")
  );
}

/** Published entries only, newest `published_at` first, paged. Drafts never leave here. */
export async function listPublished(
  db: Db,
  collection: string,
  options: { page?: number; pageSize: number }
): Promise<CmsPublicPage> {
  const window = pageWindow(options.page ?? 1, options.pageSize);
  const [rows, [totals]] = await Promise.all([
    db
      .select(publicColumns)
      .from(cmsEntries)
      .innerJoin(cmsRevisions, liveRevision)
      .leftJoin(users, eq(users.id, cmsEntries.authorId))
      .where(isLive(collection))
      .orderBy(desc(cmsEntries.publishedAt), desc(cmsEntries.id))
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({ total: count() })
      .from(cmsEntries)
      .innerJoin(cmsRevisions, liveRevision)
      .where(isLive(collection)),
  ]);
  const total = totals?.total ?? 0;
  return {
    entries: rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt ?? row.updatedAt,
    })),
    page: window.page,
    pageCount: Math.max(1, Math.ceil(total / options.pageSize)),
    total,
  };
}

/**
 * One published entry by its live slug. A miss checks `cms_redirects` and answers with the
 * entry's current live slug, so a chain of renames ends in one hop. A redirect to an entry
 * that is no longer live is a miss.
 */
export async function readPublished(
  db: Db,
  collection: string,
  slug: string
): Promise<CmsPublicRead> {
  const [row] = await db
    .select({ ...publicColumns, html: cmsRevisions.html })
    .from(cmsEntries)
    .innerJoin(cmsRevisions, liveRevision)
    .leftJoin(users, eq(users.id, cmsEntries.authorId))
    .where(and(isLive(collection), eq(cmsRevisions.slug, slug)))
    .limit(1);
  if (row) {
    return {
      entry: { ...row, publishedAt: row.publishedAt ?? row.updatedAt },
      kind: "entry",
    };
  }

  const [redirect] = await db
    .select({ liveSlug: cmsRevisions.slug })
    .from(cmsRedirects)
    .innerJoin(cmsEntries, eq(cmsEntries.id, cmsRedirects.entryId))
    .innerJoin(cmsRevisions, liveRevision)
    .where(
      and(
        eq(cmsRedirects.collection, collection),
        eq(cmsRedirects.oldSlug, slug),
        isLive(collection)
      )
    )
    .limit(1);
  if (redirect && redirect.liveSlug !== slug) {
    return { kind: "redirect", slug: redirect.liveSlug };
  }
  return { kind: "missing" };
}

// --- Maintenance -----------------------------------------------------------------------

/**
 * Rebuild `html` for every live revision. `pnpm cms:rerender` calls it after a renderer
 * upgrade or a `STORAGE_PUBLIC_URL` change. `render` returns `null` to leave a revision as it
 * is, such as one whose collection is no longer registered. Returns the number rewritten.
 */
export async function rerenderLiveRevisions(
  db: Db,
  render: (snapshot: Snapshot & { collection: string }) => string | null
): Promise<number> {
  const rows = await db
    .select({
      collection: cmsEntries.collection,
      data: cmsRevisions.data,
      id: cmsRevisions.id,
      slug: cmsRevisions.slug,
      title: cmsRevisions.title,
    })
    .from(cmsEntries)
    .innerJoin(cmsRevisions, liveRevision)
    .where(eq(cmsEntries.status, "published"));
  let rewritten = 0;
  for (const row of rows) {
    const html = render(row);
    if (html !== null) {
      await db
        .update(cmsRevisions)
        .set({ html })
        .where(eq(cmsRevisions.id, row.id));
      rewritten += 1;
    }
  }
  return rewritten;
}
