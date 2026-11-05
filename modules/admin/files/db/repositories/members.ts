import { and, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../client";
import { sessions } from "../schema/auth";

// The one query the members screen needs that the audit log cannot answer: when each
// member last signed in to the admin app. Written once for both dialects, like
// `./audit.ts`.
//
// Better Auth keeps no sign-in time on the account, so the answer is the newest admin
// session still on record. A sign-out, a ban and a password change that signs out other
// sessions all delete rows, so a member who signed out shows no time at all. The members
// screen shows a dash for that, never "Never".

/** The newest admin session still on record, by user id. A user with none is absent. */
export async function lastAdminSignIns(
  db: Db,
  userIds: readonly string[]
): Promise<Map<string, Date>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      // `max` loses the column's mapping, so `mapWith` turns the driver's value back into
      // a `Date`: an epoch number on SQLite, a timestamp string on Postgres.
      at: max(sessions.createdAt).mapWith(sessions.createdAt),
      userId: sessions.userId,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.audience, "admin"),
        inArray(sessions.userId, [...userIds])
      )
    )
    .groupBy(sessions.userId);
  return new Map(
    rows.flatMap((row) => (row.at === null ? [] : [[row.userId, row.at]]))
  );
}
