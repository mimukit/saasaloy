import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../client";
import { accounts, users } from "../schema/auth";

// What the `auth-phone` guards ask before a reset code or a password sign-in: does a
// user hold this phone, and can that user sign in with a password. Better Auth writes
// both rows; nothing here writes.

/** Better Auth's provider id for a password account. */
const CREDENTIAL_PROVIDER = "credential";

/** Whether the user has a password to sign in with. */
export async function hasPassword(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, CREDENTIAL_PROVIDER),
        isNotNull(accounts.password)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** The user `phone` signs in to and whether it has a password, or `null` for no user. */
export async function findPhoneLogin(
  db: Db,
  phone: string
): Promise<{ userId: string; hasPassword: boolean } | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1);
  if (!row) {
    return null;
  }
  return { hasPassword: await hasPassword(db, row.id), userId: row.id };
}
