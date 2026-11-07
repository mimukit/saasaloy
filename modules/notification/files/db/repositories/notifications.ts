import { config } from "@repo/config";
import { and, count, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { notificationOptOuts, notifications } from "../schema/notifications";
import type { Db } from "../client";

// Every query the two notification tables take, in one file, written once for both
// dialects. The table declarations are the only part of this feature that knows whether
// it talks to SQLite or Postgres, and Drizzle's query builder is neutral at call time, so
// this file ships once and `apps/api` never branches on the driver.
//
// **This file is the access boundary.** Every request-path function takes the session
// user's id and filters on it, so one user can never read or change another user's rows.
// A route that builds its own `db.select().from(notifications)` removes that guarantee.
// `pruneNotifications` is the one cross-user query, and it is housekeeping a scheduled job
// runs, not a request.

/** What a row looks like coming back. Named so a route can annotate without `typeof`. */
export type NotificationRow = typeof notifications.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewNotification {
  userId: string;
  category: string;
  title: string;
  body?: string | null;
  href?: string | null;
}

/** Insert one row and return its id. `notify` in `apps/api` checks the input first. */
export async function insertNotification(
  db: Db,
  input: NewNotification
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(notifications).values({
    body: input.body ?? null,
    category: input.category,
    href: input.href ?? null,
    id,
    title: input.title,
    userId: input.userId,
  });
  return id;
}

export interface NotificationPage {
  rows: NotificationRow[];
  /** The cursor for the next page, or `null` on the last one. */
  nextCursor: string | null;
}

/**
 * One page of the user's rows, newest first, after `cursor` when given.
 *
 * The cursor is keyset, not an offset: it carries the last row's `createdAt` and `id`, so
 * a page never skips or repeats a row when a new one arrives mid-scroll. Both halves are
 * needed, because two rows can share a millisecond. An unreadable cursor answers the first
 * page: the user filter applies either way, so a forged cursor reaches nothing.
 */
export async function listNotifications(
  db: Db,
  userId: string,
  cursor?: string,
  limit: number = config.notification.pageSize
): Promise<NotificationPage> {
  const after = decodeCursor(cursor);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        after
          ? or(
              lt(notifications.createdAt, after.createdAt),
              and(
                eq(notifications.createdAt, after.createdAt),
                lt(notifications.id, after.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    // One extra row answers "is there a next page" without a second query.
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    rows: page,
  };
}

/**
 * Every unread row of the user, in every category. An opt-out stops new rows only, so the
 * old rows of an opted-out category still show on the page and the count agrees with it.
 */
export async function countUnread(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.unread ?? 0;
}

/**
 * Mark one of the user's rows read. Returns false when the user has no row `id`, which is
 * also the answer for another user's row, so a caller cannot tell the two apart.
 *
 * Idempotent: a row already read keeps its first `readAt`. The update touches unread rows
 * only, and a second query tells "already read" from "not yours" when it changed nothing.
 */
export async function markRead(
  db: Db,
  userId: string,
  id: string,
  at: Date = new Date()
): Promise<boolean> {
  const own = and(eq(notifications.userId, userId), eq(notifications.id, id));
  const changed = await db
    .update(notifications)
    .set({ readAt: at })
    .where(and(own, isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (changed.length > 0) {
    return true;
  }
  const found = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(own)
    .limit(1);
  return found.length > 0;
}

/** Mark every unread row of the user read. Returns how many rows changed. */
export async function markAllRead(
  db: Db,
  userId: string,
  at: Date = new Date()
): Promise<number> {
  const changed = await db
    .update(notifications)
    .set({ readAt: at })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return changed.length;
}

/** The category ids the user turned off. */
export async function listOptOuts(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ category: notificationOptOuts.category })
    .from(notificationOptOuts)
    .where(eq(notificationOptOuts.userId, userId));
  return rows.map((row) => row.category);
}

/** Whether the user turned `category` off. */
export async function isOptedOut(
  db: Db,
  userId: string,
  category: string
): Promise<boolean> {
  const rows = await db
    .select({ category: notificationOptOuts.category })
    .from(notificationOptOuts)
    .where(
      and(
        eq(notificationOptOuts.userId, userId),
        eq(notificationOptOuts.category, category)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Turn one category on or off for the user. On deletes the opt-out row, off inserts it,
 * and both are no-ops when the row is already in that state.
 *
 * This function does not check the category: the route refuses an unknown or required one
 * before it gets here, against `config.notification.categories`.
 */
export async function setPreference(
  db: Db,
  userId: string,
  category: string,
  enabled: boolean
): Promise<void> {
  if (enabled) {
    await db
      .delete(notificationOptOuts)
      .where(
        and(
          eq(notificationOptOuts.userId, userId),
          eq(notificationOptOuts.category, category)
        )
      );
    return;
  }
  await db
    .insert(notificationOptOuts)
    .values({ category, userId })
    .onConflictDoNothing();
}

/**
 * Apply several `setPreference` calls, one per category in `changes`. A category the body
 * leaves out keeps its current state.
 *
 * One statement per category, not one transaction: D1 has no interactive transaction, and
 * each write is a no-op on a retry, so a half-applied body is fixed by sending it again.
 */
export async function setPreferences(
  db: Db,
  userId: string,
  changes: Readonly<Record<string, boolean>>
): Promise<void> {
  for (const [category, enabled] of Object.entries(changes)) {
    await setPreference(db, userId, category, enabled);
  }
}

export interface RetentionDays {
  /** Days a read row is kept. */
  readDays: number;
  /** Days an unread row is kept. */
  unreadDays: number;
}

/**
 * The retention rule, for every user at once: delete read rows written more than
 * `readDays` before `now`, and any row written more than `unreadDays` before it. Returns
 * how many rows went.
 *
 * `now` is a parameter so a test drives the clock instead of waiting. The days default to
 * the config section. The queue job calls this daily; without `queue`, call it from your
 * own cron.
 */
export async function pruneNotifications(
  db: Db,
  now: Date,
  days?: RetentionDays
): Promise<number> {
  const readDays = days?.readDays ?? config.notification.readRetentionDays;
  const unreadDays =
    days?.unreadDays ?? config.notification.unreadRetentionDays;
  const readBefore = new Date(now.getTime() - readDays * DAY_MS);
  const unreadBefore = new Date(now.getTime() - unreadDays * DAY_MS);
  const gone = await db
    .delete(notifications)
    .where(
      or(
        and(
          isNotNull(notifications.readAt),
          lt(notifications.createdAt, readBefore)
        ),
        lt(notifications.createdAt, unreadBefore)
      )
    )
    .returning({ id: notifications.id });
  return gone.length;
}

function encodeCursor(row: NotificationRow): string {
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
  if (!Number.isFinite(at) || id.length === 0) {
    return;
  }
  return { createdAt: new Date(at), id };
}
