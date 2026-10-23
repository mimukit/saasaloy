import { count, eq } from "drizzle-orm";
import { sessions, users } from "../schema/auth";
import type { Db } from "../client";

// The reads behind the rank guard in `packages/auth/src/plugins/rank-guard.ts`. They live
// here for the reason `multitenant`'s repositories give: `packages/auth` may not write
// `eq(...)` itself (ADR 0020).
//
// They go straight to the tables, not through Better Auth's adapter, on purpose. Each
// instance's adapter finds a session by token only when the row carries its own audience
// (`packages/auth/src/scoped-adapter.ts`), so the admin instance cannot see who owns a
// client session through it. The rank guard has to see that owner before an `admin`
// revokes the session, so it reads the row here.

/** The site role of a user, or `null` when the user does not exist or has none. */
export async function roleOfUser(
  db: Db,
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.role ?? null;
}

/** The site role of the user who owns a session token, of either audience. */
export async function roleOfSessionOwner(
  db: Db,
  token: string
): Promise<string | null> {
  const rows = await db
    .select({ role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, token))
    .limit(1);
  return rows[0]?.role ?? null;
}

/** How many users hold this role. The rank guard asks it for `superadmin`. */
export async function countUsersWithRole(
  db: Db,
  role: string
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.role, role));
  return rows[0]?.total ?? 0;
}
