import { withDb } from "@repo/db/client";
import { listOrganizationRoles } from "@repo/db/repositories/organization-roles";
import { roles } from "./access";
import type { AuthRequestContext } from "./server";
import { resolveStatements } from "./tenant-rules";
import type { ResolvedStatements } from "./tenant-rules";

// The statements a member's role grants, read from the base roles and the organization's
// custom ones. It sits apart from `./tenant.ts` because `api-keys`' plugin calls it, and
// that plugin loads inside `./auth.ts`. `./tenant.ts` imports `./auth.ts`, so a plugin
// that imported `./tenant.ts` would close a cycle through the auth instance. Keep this
// file free of `./auth.ts` and everything that imports it.

/** The three static roles from `./access.ts`, flattened to the shape the rules take. */
function baseRoleStatements(): Record<string, ResolvedStatements> {
  const flattened: Record<string, ResolvedStatements> = {};
  for (const [name, role] of Object.entries(roles)) {
    flattened[name] = role.statements;
  }
  return flattened;
}

/**
 * What a member holding `roleName` may do in `organizationId`.
 *
 * One query per request, and it is the only one tenant resolution runs. `rbac`'s
 * `requireCan` reads the answer off the principal rather than asking again, so a route
 * with three permission checks still pays for one round trip.
 *
 * Exported because `api-keys`' `apiKeyScopeGuard()` resolves the caller's statements the
 * same way before it decides whether a requested key scope exceeds them. Two callers, one
 * merge rule.
 */
export async function loadStatements(
  c: AuthRequestContext,
  organizationId: string,
  roleName: string
): Promise<ResolvedStatements> {
  const stored = await withDb(c, (db) =>
    listOrganizationRoles(db, organizationId)
  );
  return resolveStatements(roleName, baseRoleStatements(), stored);
}
