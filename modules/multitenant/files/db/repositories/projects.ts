import { eq } from "drizzle-orm";
import { projects } from "../schema/projects";
import { forTenant } from "../tenant";
import type { TenantId } from "../tenant";
import type { Db } from "../client";

// The worked example's repository, and the reason it is a repository rather than three
// queries inside `apps/api/src/routes/projects.ts`: `drizzle-orm` belongs to `@repo/db`
// and no other workspace imports it (ADR 0020), so a route cannot write `eq(...)` even
// when it wants to. Keep scoped queries here, next to the table they read.
//
// EVERY FUNCTION BELOW TAKES A `TenantId` AND GOES THROUGH `forTenant`. That is the
// pattern to copy. A repository that takes a plain `string` organization id has thrown
// the guard away, because the brand is the only thing that proves the value came from
// `requireTenant`.

/** Every project of this organization. Never another organization's, by construction. */
export function listProjects(db: Db, tenantId: TenantId) {
  return forTenant(db, tenantId).select(projects);
}

/**
 * Insert one project into this organization.
 *
 * `organizationId` is not a parameter and cannot be passed: `forTenant` forces it from
 * the branded id. A request body spread into `values` therefore cannot write a row into
 * somebody else's organization.
 */
export function createProject(
  db: Db,
  tenantId: TenantId,
  values: { id: string; name: string }
) {
  return forTenant(db, tenantId).insert(projects, values);
}

/**
 * Delete one project of this organization by id.
 *
 * The tenant filter is already on the statement; `eq(projects.id, id)` is ANDed with it.
 * Another organization's row id therefore deletes nothing rather than deleting their row,
 * which is the whole isolation guarantee in one line.
 */
export function deleteProject(db: Db, tenantId: TenantId, id: string) {
  return forTenant(db, tenantId).delete(projects, eq(projects.id, id));
}
