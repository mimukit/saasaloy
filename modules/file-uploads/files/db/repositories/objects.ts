import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { storageObjects } from "../schema/file-uploads";
import type { Db } from "../client";

// Every query the `storage_objects` table takes, in one file, written once for both
// dialects. The table declaration is the only part of this feature that knows whether it
// is talking to SQLite or Postgres (`schema/file-uploads.sqlite.ts` and `.pg.ts`), and
// Drizzle's query builder is neutral at call time — so this file ships once and
// `apps/api` never branches on the driver.
//
// **This file is the tenant boundary.** `file-uploads` does not depend on `multitenant`,
// so there is no `forTenant` wrapper to make a cross-tenant read impossible. What carries
// the guarantee instead is that every read below takes a tenant id and filters on it, and
// that no route issues a raw query against the table. A route that builds its own
// `db.select().from(storageObjects)` is a review failure, not a style preference.
//
// Two functions are deliberately not tenant-scoped, and both say so where they are
// defined: `findPublicObjectByKey`, which serves an unauthenticated request that has no
// tenant to scope by, and the three sweep queries, which are cross-tenant housekeeping
// run by a scheduled job rather than by a request.

/** What a row looks like coming back. Named so a route can annotate without `typeof`. */
export type StorageObjectRow = typeof storageObjects.$inferSelect;

export interface NewObjectInput {
  /** `crypto.randomUUID()`. Also the unguessable `<id>` segment of the key. */
  id: string;
  key: string;
  provider: string;
  tenantId: string;
  ownerId: string;
  contentType: string;
  /** The size the uploader declared. `complete` replaces it with the real one. */
  size: number;
  visibility: "private" | "public";
  metadata?: unknown;
}

/** Insert the `pending` row `POST /files/uploads` hands an upload target for. */
export function createObject(db: Db, input: NewObjectInput) {
  return db.insert(storageObjects).values({
    contentType: input.contentType,
    id: input.id,
    key: input.key,
    metadata: input.metadata ?? null,
    ownerId: input.ownerId,
    provider: input.provider,
    size: input.size,
    status: "pending",
    tenantId: input.tenantId,
    visibility: input.visibility,
  });
}

/** One live row, by id, inside one tenant. `undefined` when there is no such row. */
export async function findObject(
  db: Db,
  tenantId: string,
  id: string
): Promise<StorageObjectRow | undefined> {
  const rows = await db
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.id, id),
        eq(storageObjects.tenantId, tenantId),
        isNull(storageObjects.deletedAt)
      )
    )
    .limit(1);
  return rows[0];
}

/**
 * One live, ready, **public** row by its key.
 *
 * The one read with no tenant argument, because `GET /files/public/*` carries no session
 * and therefore has no tenant to scope by. Three filters stand in for that: the row has to
 * be `public`, it has to be `ready`, and it has to be undeleted. The route additionally
 * refuses any key whose scope segment is not `public-uploads` before it calls this, so a
 * private key never reaches the table at all.
 */
export async function findPublicObjectByKey(
  db: Db,
  key: string
): Promise<StorageObjectRow | undefined> {
  const rows = await db
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.key, key),
        eq(storageObjects.visibility, "public"),
        eq(storageObjects.status, "ready"),
        isNull(storageObjects.deletedAt)
      )
    )
    .limit(1);
  return rows[0];
}

export interface ListObjectsOptions {
  /** Rows per page. The route clamps this before it gets here. */
  limit: number;
  /** An opaque cursor from a previous page. See `encodeCursor`. */
  cursor?: string;
}

export interface ListObjectsResult {
  rows: StorageObjectRow[];
  /** The cursor for the next page, or `undefined` when this was the last one. */
  cursor?: string;
}

/**
 * One tenant's live rows, newest first, one page at a time.
 *
 * The cursor is keyset, not an offset: it carries the last row's `createdAt` and `id`, so
 * a page never skips or repeats a row when one is uploaded mid-scroll. Both halves are
 * needed — two rows can share a millisecond, and a cursor on the timestamp alone would
 * drop whichever one lost the tie.
 */
export async function listObjects(
  db: Db,
  tenantId: string,
  options: ListObjectsOptions
): Promise<ListObjectsResult> {
  const after = decodeCursor(options.cursor);
  const rows = await db
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.tenantId, tenantId),
        isNull(storageObjects.deletedAt),
        after
          ? or(
              lt(storageObjects.createdAt, after.createdAt),
              and(
                eq(storageObjects.createdAt, after.createdAt),
                lt(storageObjects.id, after.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(storageObjects.createdAt), desc(storageObjects.id))
    // One extra row is the "is there a next page" answer, and it costs one row rather
    // than a second `count(*)` over the same filter.
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    rows: page,
    ...(rows.length > options.limit && last
      ? { cursor: encodeCursor(last) }
      : {}),
  };
}

/** Mark a `pending` row finished, with the size and type the real object turned out to have. */
export function markReady(
  db: Db,
  tenantId: string,
  id: string,
  actual: { size: number; contentType: string }
) {
  return db
    .update(storageObjects)
    .set({
      completedAt: new Date(),
      contentType: actual.contentType,
      size: actual.size,
      status: "ready",
    })
    .where(scopedTo(tenantId, id));
}

/**
 * Mark a row the object failed its checks on.
 *
 * The object itself is deleted by the route before this runs. The row stays, undeleted, so
 * the uploader sees why their file did not appear rather than watching it vanish.
 */
export function markRejected(db: Db, tenantId: string, id: string) {
  return db
    .update(storageObjects)
    .set({ completedAt: new Date(), status: "rejected" })
    .where(scopedTo(tenantId, id));
}

/**
 * Mark a row the object delete is about to run for.
 *
 * Written before the object delete, not after, so a Worker that dies mid-delete leaves a
 * row the sweep can finish rather than a row that still claims to have bytes behind it.
 */
export function markDeleting(db: Db, tenantId: string, id: string) {
  return db
    .update(storageObjects)
    .set({ status: "deleting" })
    .where(scopedTo(tenantId, id));
}

/** Mark a row whose object is gone. `deletedAt` is what every read above filters on. */
export function markDeleted(db: Db, tenantId: string, id: string) {
  return db
    .update(storageObjects)
    .set({ deletedAt: new Date(), status: "deleted" })
    .where(scopedTo(tenantId, id));
}

// The sweep's three queries. Cross-tenant on purpose: `@queue/jobs/storage-sweep.ts` runs
// on a schedule, not on a request, so there is no tenant to scope by and scoping by one
// would leave every other tenant's rubbish behind. Nothing on a request path may call
// them, which is why each one names the job in its own doc comment.

/** Rows stuck in `deleting`, for the job that finishes the object delete. */
export function listDeletingObjects(db: Db, limit: number) {
  return db
    .select()
    .from(storageObjects)
    .where(eq(storageObjects.status, "deleting"))
    .limit(limit);
}

/** `pending` rows older than `before` — uploads nobody ever completed. Sweep only. */
export function listAbandonedObjects(db: Db, before: Date, limit: number) {
  return db
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.status, "pending"),
        lt(storageObjects.createdAt, before)
      )
    )
    .limit(limit);
}

/** Rows soft-deleted before `before`, for the purge past `STORAGE_PURGE_AFTER_DAYS`. Sweep only. */
export function listPurgeableObjects(db: Db, before: Date, limit: number) {
  return db
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.status, "deleted"),
        lt(storageObjects.deletedAt, before)
      )
    )
    .limit(limit);
}

/** Remove a row outright. Sweep only, and only after its object is gone. */
export function purgeObject(db: Db, id: string) {
  return db.delete(storageObjects).where(eq(storageObjects.id, id));
}

/** The write-side scope. Every update above goes through it, so none can miss the tenant. */
function scopedTo(tenantId: string, id: string) {
  return and(
    eq(storageObjects.id, id),
    eq(storageObjects.tenantId, tenantId),
    isNull(storageObjects.deletedAt)
  );
}

/** `<epoch-ms>.<id>`. Opaque to the caller, and stable across both dialects. */
function encodeCursor(row: StorageObjectRow): string {
  return `${row.createdAt.getTime()}.${row.id}`;
}

function decodeCursor(
  cursor: string | undefined
): { createdAt: Date; id: string } | undefined {
  if (!cursor) {
    return;
  }
  const separator = cursor.indexOf(".");
  if (separator <= 0) {
    return;
  }
  const at = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  // A cursor is client-supplied text. An unreadable one falls back to the first page
  // rather than throwing: the caller cannot forge anything with it (the tenant filter is
  // applied separately), so refusing buys nothing.
  if (!Number.isFinite(at) || id.length === 0) {
    return;
  }
  return { createdAt: new Date(at), id };
}
