import { eq } from "drizzle-orm";
import { organizationRole } from "../schema/teams";
import type { Db } from "../client";

// The one query the tenant resolver runs, and the reason it lives here rather than in
// `packages/auth`: `packages/auth` depends on `@repo/db` but not on `drizzle-orm`, so it
// cannot write `eq(...)` itself (ADR 0020 — a workspace does not reach past the package
// that owns the vendor dependency).
//
// One call per request, whatever a route asks afterwards. `requireTenant` reads the rows
// once, resolves the caller's statements from them, and hands `can()` the answer, so a
// route with three permission checks still pays for one query. See
// `packages/auth/src/tenant.ts`.

/** A role one organization defined at runtime, with its permission JSON still a string. */
export interface StoredRole {
  role: string;
  permission: string;
}

/**
 * Every runtime-defined role of one organization.
 *
 * Returns the raw rows. Parsing `permission` is `resolveStatements`' job in
 * `packages/auth/src/tenant-rules.ts`, which is import-free and therefore testable; a
 * `JSON.parse` here would put the merge rule in a file no test can execute.
 *
 * An organization that has defined no roles of its own returns `[]`, and every member
 * then resolves to the static role of their name from `packages/auth/src/access.ts`.
 */
export function listOrganizationRoles(
  db: Db,
  organizationId: string
): Promise<StoredRole[]> {
  return db
    .select({
      permission: organizationRole.permission,
      role: organizationRole.role,
    })
    .from(organizationRole)
    .where(eq(organizationRole.organizationId, organizationId));
}
