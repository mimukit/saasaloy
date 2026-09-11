import { eq } from "drizzle-orm";
import { organizations } from "../schema/teams";
import type { Db } from "../client";

// The existence check behind the `superadmin` header path, and it lives here for the
// reason `organization-roles.ts` gives: `packages/auth` may not write `eq(...)` itself
// (ADR 0020).

/**
 * Does this organization exist?
 *
 * `x-organization-id` is a raw request value, and `asTenantId` brands whatever it is
 * given. Without this query a typo mints a `TenantId` for an organization that is not
 * there, every scoped read returns nothing, and the first scoped write fails on the
 * foreign key as a 500. One `limit(1)` per superadmin header request buys a 404 instead.
 *
 * Selects one constant column rather than the row: nothing here reads a field, and a
 * narrow select keeps the query from growing a dependency on the table's shape.
 */
export async function organizationExists(
  db: Db,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return rows.length > 0;
}
