import { HTTPException } from "hono/http-exception";
import type { Permissions } from "./access";
import { can } from "./rbac-rules";
import { requireTenant } from "./tenant";
import type { TenantRequestContext } from "./tenant";
import type { Tenant } from "./tenant-rules";

// Permission checking, the api-facing half. `./rbac-rules.ts` holds the rule; here the
// tenant is resolved and the refusal is thrown.
//
// A throwing helper rather than Hono middleware, for the reason `requireTenant` and
// `requireAdmin` both give: the `chained-route` patch kind registers routes, not `.use()`
// links (ADR 0028). A throw reuses api's `onError` envelope, so a refusal from here
// renders as the same `{ error: { code, message } }` body every other refusal does.

export { BASE_ROLE_LOCKED, allows, can } from "./rbac-rules";
export type {
  PermissionDecision,
  PermissionDemand,
  PrincipalLike,
} from "./rbac-rules";

/**
 * The tenant, once this caller is proved to hold every listed permission. The first line
 * of a scoped route that writes:
 *
 *   const tenant = await requireCan(c, { project: ["delete"] });
 *   await withDb(c, (db) => deleteProject(db, tenant.organizationId, id));
 *
 * It is `requireTenant` plus `can`, and it returns the same `Tenant`, so a route never
 * calls both. Resolution runs once and the one `organization_roles` query with it: three
 * `requireCan` lines in one handler would cost three queries if this asked Better Auth's
 * `hasPermission` instead, which is why `can` reads the statements already on the
 * principal.
 *
 * `permissions` is typed by `Permissions` from `./access.ts`, so an undeclared resource
 * or a misspelled action is a compile error rather than a check that silently passes.
 * Adding a resource is an edit to `access.ts` and nothing else.
 *
 * Throws 401 when signed out, 403 `no active organization` when nothing resolves an
 * organization, and 403 `permission required: <resource>:<action>` when the caller is in
 * the right organization but may not do this.
 */
export async function requireCan(
  c: TenantRequestContext,
  permissions: Permissions
): Promise<Tenant> {
  const tenant = await requireTenant(c);
  const { denial } = can(tenant.principal, permissions);
  if (denial) {
    throw new HTTPException(denial.status, { message: denial.message });
  }
  return tenant;
}
