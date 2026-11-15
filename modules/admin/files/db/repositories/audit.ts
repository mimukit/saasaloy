import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Db } from "../client";
import { users } from "../schema/auth";
import { auditEvents } from "../schema/audit";
import type { AuditEventRow, NewAuditEvent } from "../schema/audit";

// Every query the admin audit log needs, in one file, written once for both dialects. The
// table declarations are the only part that knows whether it talks to SQLite or Postgres
// (`schema/audit.sqlite.ts` and `.pg.ts`), and Drizzle's query builder is neutral at call
// time, so this file ships once and `apps/api` never branches on the driver. The one
// dialect gap it closes by hand is the label search: Postgres `like` is case-sensitive and
// SQLite's is not, and only Postgres has `ilike`, so the search lowers both sides.
//
// `insertAuditEvents` is called only by `adminWrite` and `adminAuthWrite` in
// `apps/api/src/lib/admin-write.ts`. The Activity page reads the rest. Newest first, paged
// by a cursor that is the last row's time and id, because an id does not sort by time: a
// row's id is random, and a seed row's is a UUIDv5 of its slug.

/** Rows per page on the Activity page. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Rows per insert statement. D1 binds at most 100 parameters to one statement and a row
 * binds 10, so a long write goes in several statements. Postgres would take them all at
 * once; one size keeps the file driver-blind.
 */
const ROWS_PER_INSERT = 9;

/** One row to insert. The id and the time are filled in when left out. */
export type AuditEventInput = Omit<NewAuditEvent, "id"> & { id?: string };

/**
 * Insert the audit rows of one write. Every row gets the same `createdAt`, one JS time for
 * the whole write: Postgres keeps microseconds, which the page cursor (milliseconds) cannot
 * carry, so rows of one write that straddle a page boundary would lose the later rows on
 * the next page. A row without an `id` gets a random UUID.
 */
export async function insertAuditEvents(
  db: Db,
  rows: readonly AuditEventInput[]
): Promise<void> {
  const at = new Date();
  const values = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt ?? at,
    id: row.id ?? crypto.randomUUID(),
  }));
  for (let start = 0; start < values.length; start += ROWS_PER_INSERT) {
    // oxlint-disable-next-line no-await-in-loop -- the statements run in order on one client, inside the caller's transaction on Postgres
    await db
      .insert(auditEvents)
      .values(values.slice(start, start + ROWS_PER_INSERT));
  }
}

/** Where the next page starts: the last row of the page before. */
export interface AuditCursor {
  createdAt: Date;
  id: string;
}

export interface AuditFilter {
  actorUserId?: string | undefined;
  /** Only these actions. An area passes its actions; an empty list matches nothing. */
  actions?: readonly string[] | undefined;
  /** Part of the target's label, in any case. `%` and `_` match themselves. */
  search?: string | undefined;
  /** Rows at or after this time. */
  from?: Date | undefined;
  /** Rows at or before this time. */
  to?: Date | undefined;
}

/** One row with the actor's name and email, joined on read, so a renamed admin shows their new name. */
export interface AuditEventView extends AuditEventRow {
  actorName: string;
  actorEmail: string;
}

export interface AuditPage {
  rows: AuditEventView[];
  /** The cursor of the next, older page, or `null` on the last page. */
  nextCursor: AuditCursor | null;
}

/** `%` and `_` are wildcards in `like`; a typed one means the character itself. */
function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (match) => `\\${match}`);
}

function conditions(filter: AuditFilter): SQL[] {
  const where: SQL[] = [];
  if (filter.actorUserId !== undefined) {
    where.push(eq(auditEvents.actorUserId, filter.actorUserId));
  }
  if (filter.actions !== undefined) {
    where.push(
      filter.actions.length === 0
        ? sql`1 = 0`
        : inArray(auditEvents.action, [...filter.actions])
    );
  }
  const search = filter.search?.trim() ?? "";
  if (search !== "") {
    // `escape` is spelled out: SQLite has no default escape character for `like`.
    const pattern = `%${escapeLike(search.toLowerCase())}%`;
    where.push(
      sql`lower(${auditEvents.targetLabel}) like ${pattern} escape '\\'`
    );
  }
  if (filter.from !== undefined) {
    where.push(gte(auditEvents.createdAt, filter.from));
  }
  if (filter.to !== undefined) {
    where.push(lte(auditEvents.createdAt, filter.to));
  }
  return where;
}

/**
 * One page, newest first, after `cursor` when given. It reads `limit + 1` rows, so it
 * knows whether an older page exists without a second count query.
 */
export async function listAuditEvents(
  db: Db,
  filter: AuditFilter,
  cursor: AuditCursor | null,
  limit = AUDIT_PAGE_SIZE
): Promise<AuditPage> {
  const where = conditions(filter);
  if (cursor !== null) {
    const older = or(
      lt(auditEvents.createdAt, cursor.createdAt),
      and(
        eq(auditEvents.createdAt, cursor.createdAt),
        lt(auditEvents.id, cursor.id)
      )
    );
    if (older) {
      where.push(older);
    }
  }
  const rows = await db
    .select({
      actorEmail: users.email,
      actorName: users.name,
      event: auditEvents,
    })
    .from(auditEvents)
    .innerJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(...where))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map((row) => ({
    ...row.event,
    actorEmail: row.actorEmail,
    actorName: row.actorName,
  }));
  const last = page.at(-1);
  return {
    nextCursor:
      rows.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    rows: page,
  };
}

/**
 * When each target last had `action` logged, by target id. A target with no such row is
 * absent from the map. The members screen reads a removal date this way.
 */
export async function lastAuditTimes(
  db: Db,
  action: string,
  targetIds: readonly string[]
): Promise<Map<string, Date>> {
  if (targetIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      // `mapWith` turns the driver's value back into a `Date` the way the column does: an
      // epoch number on SQLite, a timestamp string on Postgres.
      at: sql<Date>`max(${auditEvents.createdAt})`.mapWith(
        auditEvents.createdAt
      ),
      targetId: auditEvents.targetId,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, action),
        inArray(auditEvents.targetId, [...targetIds])
      )
    )
    .groupBy(auditEvents.targetId);
  return new Map(rows.map((row) => [row.targetId, row.at]));
}

/** The newest row of one action on a target: when, and who made it. */
export interface LatestAuditEvent {
  at: Date;
  /** The actor's name now, so a renamed admin shows their new name. */
  by: string;
}

/**
 * The newest row of `action` on each target, by target id, with its actor's name. A
 * target with no such row is absent from the map. The members screen reads "Added by" and
 * "Removed by" this way. It reads every matching row and keeps the first per target, which
 * suits the admin group: a few rows per member.
 */
export async function latestAuditEvents(
  db: Db,
  action: string,
  targetIds: readonly string[]
): Promise<Map<string, LatestAuditEvent>> {
  if (targetIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      at: auditEvents.createdAt,
      by: users.name,
      targetId: auditEvents.targetId,
    })
    .from(auditEvents)
    .innerJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.action, action),
        inArray(auditEvents.targetId, [...targetIds])
      )
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));
  const latest = new Map<string, LatestAuditEvent>();
  for (const row of rows) {
    if (!latest.has(row.targetId)) {
      latest.set(row.targetId, { at: row.at, by: row.by });
    }
  }
  return latest;
}

/** How many rows match the filter, by action. The Activity page sums these by area. */
export async function countAuditEventsByAction(
  db: Db,
  filter: AuditFilter
): Promise<Record<string, number>> {
  const rows = await db
    .select({ action: auditEvents.action, total: count() })
    .from(auditEvents)
    .where(and(...conditions(filter)))
    .groupBy(auditEvents.action);
  return Object.fromEntries(rows.map((row) => [row.action, row.total]));
}

export interface AuditActor {
  id: string;
  name: string;
  email: string;
  role: string | null;
  /** A removed admin is banned. They stay in the person filter, marked removed. */
  removed: boolean;
}

/**
 * Everyone the Activity page's person filter lists: each account in `roles` (the admins
 * who can act now), and each account with a row in the log, removed admins included. By
 * name.
 */
export async function listAuditActors(
  db: Db,
  roles: readonly string[]
): Promise<AuditActor[]> {
  const logged = db
    .selectDistinct({ id: auditEvents.actorUserId })
    .from(auditEvents);
  const rows = await db
    .select({
      banned: users.banned,
      email: users.email,
      id: users.id,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(
      roles.length === 0
        ? inArray(users.id, logged)
        : or(inArray(users.role, [...roles]), inArray(users.id, logged))
    )
    .orderBy(users.name);
  return rows.map(({ banned, ...row }) => ({
    ...row,
    removed: banned === true,
  }));
}
