import { withDb } from "@repo/db/client";
import { asTenantId } from "@repo/db/tenant";
import { listOrganizationRoles } from "@repo/db/repositories/organization-roles";
import { organizationExists } from "@repo/db/repositories/organizations";
import { APIError } from "better-auth/api";
import { HTTPException } from "hono/http-exception";
import { roles } from "./access";
import { auth } from "./auth";
import { SUPERADMIN_ROLE } from "./authorize";
import type { Denial } from "./authorize";
import { withAuthScope } from "./db-provider";
import { requireSession } from "./server";
import type { AuthRequestContext } from "./server";
import {
  ORGANIZATION_HEADER,
  headerDenial,
  noOrganizationDenial,
  pickResolver,
  resolveStatements,
  superadminTenant,
  unknownOrganizationDenial,
} from "./tenant-rules";
import type {
  Principal,
  ResolvedStatements,
  Tenant,
  TenantResolver,
} from "./tenant-rules";

// Tenant resolution, the api-facing half. `./tenant-rules.ts` holds every decision this
// file makes; here it reads the session, runs the one role query, and throws.
//
// A throwing helper rather than Hono middleware, for the reason `requireAdmin` gives: the
// `chained-route` patch kind registers routes, not `.use()` links (ADR 0028), and
// `apps/api` cannot import `@repo/auth` at its spine. A throw reuses api's `onError`
// envelope, so a refusal from here renders as the same `{ error: { code, message } }`
// body every other refusal does.
//
// THREE DIFFERENT QUESTIONS, and mixing them up is the mistake this module exists to
// prevent:
//
//   requireAdmin(c)      may this session open apps/admin?
//   requireSuperadmin(c) is this the one role that crosses organizations?
//   requireTenant(c)     which organization is this request acting for, and as whom?
//
// A site `admin` is an ordinary member on every tenant route. The site role grants
// nothing here.

export {
  FORBIDDEN,
  NO_ACTIVE_ORGANIZATION,
  ORGANIZATION_HEADER,
  UNKNOWN_ORGANIZATION,
} from "./tenant-rules";
export type {
  ApiKeyPrincipal,
  MemberPrincipal,
  Principal,
  ResolvedStatements,
  SuperadminPrincipal,
  Tenant,
  TenantResolver,
} from "./tenant-rules";

/** The one table shape. Named so the empty array literal below gets a type from it. */
interface TenantResolverTable {
  resolvers: TenantResolver<TenantRequestContext>[];
}

/**
 * Identity, like `definePlugins` in `./client.ts`. It exists to give the array below a
 * name and a type without wrapping it in anything the codemod would have to understand.
 *
 * Not generic, unlike `definePlugins`. The parameter's declared type is what makes
 * `resolvers: []` infer as `TenantResolver[]` rather than `never[]`, so the table
 * type-checks while it is still empty and a patched-in resolver needs no annotation.
 */
function defineTenantResolvers(
  config: TenantResolverTable
): TenantResolverTable {
  return config;
}

/**
 * The credential resolver table.
 *
 * Module-scope patch point, not a value to move inside `resolveTenant`. The
 * `plugin-array` codemod needs this exact `export const <name> = <fn>({ resolvers: [...]
 * })` shape, the same one `authClientPlugins` uses, so a credential module can register
 * itself with one patch. Keep the array literal here, and never omit it, even though no
 * resolver ships by default.
 *
 * `api-keys` adds `apiKeyTenant` to it. Order is precedence: the first resolver whose
 * `claims` returns true owns the request, and the session path never runs for it.
 */
export const tenantResolvers = defineTenantResolvers({
  resolvers: [],
});

function denialError(denial: Denial): HTTPException {
  return new HTTPException(denial.status, { message: denial.message });
}

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

/**
 * Resolve the tenant for this request, or hand back the refusal.
 *
 * The order is the contract, and each step is exclusive of the ones after it:
 *
 * 1. A credential resolver that claims the request owns it outright. It returns a tenant
 *    or throws its own 401; the cookie is never read. That is what stops a rejected API
 *    key from quietly falling back to whatever session cookie rode along with it.
 * 2. Otherwise the session has to exist, or this is a 401.
 * 3. `x-organization-id` is honoured only for `superadmin`, and refused for everyone
 *    else — refused, not ignored, so a caller who sends it learns they may not. The id it
 *    names is looked up, so a superadmin's typo is a 404 rather than a fabricated tenant.
 * 4. Otherwise the session's active organization, verified by membership through
 *    `getActiveMember`. It reads the session and the `member` row in one call, so a
 *    membership revoked after `setActive` fails closed on the very next request rather
 *    than living on until the session expires.
 *
 * Returns the `{ denial, tenant }` pair `decide()` in `./authorize.ts` returns, for the
 * same reason: exactly one side is filled in, so a caller that throws on `denial` gets
 * `tenant` narrowed to non-null with no cast.
 */
export async function resolveTenant(
  c: TenantRequestContext
): Promise<TenantDecision> {
  const resolver = pickResolver(tenantResolvers.resolvers, c.req.raw.headers);
  if (resolver) {
    return { denial: null, tenant: await resolver.resolve(c) };
  }

  const session = await requireSession(c);
  const header = c.req.raw.headers.get(ORGANIZATION_HEADER);
  if (header) {
    if (session.user.role !== SUPERADMIN_ROLE) {
      return { denial: headerDenial(), tenant: null };
    }
    // The header is a raw request value and `asTenantId` brands whatever it is handed, so
    // the id has to be a real organization before it becomes a `TenantId`. Without this
    // read a typo resolves to a tenant that does not exist: every scoped select returns
    // nothing and the first scoped insert fails on the foreign key as a 500.
    const known = await withDb(c, (db) => organizationExists(db, header));
    if (!known) {
      return { denial: unknownOrganizationDenial(), tenant: null };
    }
    return {
      denial: null,
      tenant: superadminTenant(session.user.id, asTenantId(header)),
    };
  }

  // `getActiveMember` throws when the session has no active organization, and again when
  // the caller is no longer a member of the one it names. Both are the same answer here,
  // and both are the fixed 403 rather than the plugin's own body.
  //
  // Only `APIError` is swallowed. A blanket catch would turn a database outage into the
  // same fixed 403, and `apps/admin` matches on that message to tell the operator to pick
  // an organization — advice that is wrong and unfollowable when the database is down.
  const active = await withAuthScope(c, async () => {
    try {
      return await auth.api.getActiveMember({ headers: c.req.raw.headers });
    } catch (error) {
      if (error instanceof APIError) {
        return null;
      }
      throw error;
    }
  });
  if (!active) {
    return { denial: noOrganizationDenial(), tenant: null };
  }

  const statements = await loadStatements(
    c,
    active.organizationId,
    active.role
  );
  const principal: Principal = {
    kind: "member",
    memberId: active.id,
    role: active.role,
    statements,
    userId: active.userId,
  };
  return {
    denial: null,
    tenant: {
      organizationId: asTenantId(active.organizationId),
      principal,
    },
  };
}

/**
 * The tenant, or a 401 when signed out and a 403 when nothing resolves an organization.
 * The first line of every scoped route:
 *
 *   const tenant = await requireTenant(c);
 *   const rows = await withDb(c, (db) =>
 *     forTenant(db, tenant.organizationId).select(project)
 *   );
 *
 * `tenant.organizationId` is the only `TenantId` in the project. `forTenant` takes
 * nothing else, so a route that skips this call cannot build a scoped query at all.
 */
export async function requireTenant(c: TenantRequestContext): Promise<Tenant> {
  const { denial, tenant } = await resolveTenant(c);
  if (denial) {
    throw denialError(denial);
  }
  return tenant;
}

/**
 * The part of a Hono `Context` tenant resolution reads. `AuthRequestContext` already
 * carries `env`, `executionCtx` and `req.raw`, which is everything the session read, the
 * role query and the header look-up need.
 */
export type TenantRequestContext = AuthRequestContext;

/** The resolved tenant, or the refusal. Exactly one side is filled in. */
export type TenantDecision =
  | { readonly denial: Denial; readonly tenant: null }
  | { readonly denial: null; readonly tenant: Tenant };
