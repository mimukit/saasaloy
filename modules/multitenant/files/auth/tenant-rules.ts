import type { TenantId } from "@repo/db/tenant";
import type { Denial } from "./authorize";

// Re-exported so a consumer of `Tenant` gets the id type from the same module, and so
// `./tenant-rules.test.ts` can name it. `export type` is erased like the import above.
export type { TenantId } from "@repo/db/tenant";

// Tenant resolution's decision core: who a request is acting for, expressed with zero
// runtime imports.
//
// `./tenant.ts` owns the half that talks to the session, the database and Hono, and this
// file owns the rules it applies. The split is the one `./authorize.ts` and `./server.ts`
// already draw, and for the same reason: anything importing `better-auth`, `hono` or
// `@repo/db` resolves only inside a scaffolded project, so a rule written there would
// ship with no test able to execute it. `./tenant-rules.test.ts` runs this file under
// `node --test`.
//
// The two imports above are type-only and are erased before the file runs, so the test
// still loads it with nothing installed.

/**
 * The header a `superadmin` uses to act inside an organization it does not belong to.
 *
 * It is honoured on the cookie path only, and only for that one role. Any other signed-in
 * caller sending it gets `headerDenial()`, and so does any caller on the bearer path —
 * a key is bound to one organization, so a header naming a second one is always a
 * mistake or an attack. Refusing rather than ignoring it is deliberate: a silently
 * ignored header reads as "it worked" to whoever sent it.
 */
export const ORGANIZATION_HEADER = "x-organization-id";

/**
 * The message a caller sees when nothing resolves an organization for them. Exported and
 * fixed, because `apps/admin` matches on this exact string to tell "you are signed in but
 * have no organization yet" apart from "you may not do this". Change it here and change
 * the SPA in the same commit.
 */
export const NO_ACTIVE_ORGANIZATION = "no active organization";

/** The message for a header the caller may not send. Deliberately says nothing more. */
export const FORBIDDEN = "forbidden";

/**
 * A resolved permission set: resource name to the actions held on it. This is
 * `access.ts`'s `statements` shape with the literal types dropped, because a role stored
 * in the database is parsed at runtime and cannot carry them.
 */
export type ResolvedStatements = Record<string, readonly string[]>;

/** A signed-in human, acting inside an organization they are a member of. */
export interface MemberPrincipal {
  readonly kind: "member";
  readonly userId: string;
  readonly memberId: string;
  readonly role: string;
  readonly statements: ResolvedStatements;
}

/** A machine caller holding an organization-owned API key. Filled by `api-keys`. */
export interface ApiKeyPrincipal {
  readonly kind: "apiKey";
  readonly keyId: string;
  readonly statements: ResolvedStatements;
}

/**
 * The site role above `admin`, acting inside an organization through the header. It
 * carries no statements on purpose: `can()` answers true for this kind in one `switch`
 * arm rather than by holding every permission, so a widened statement set can never
 * change what a superadmin may do.
 */
export interface SuperadminPrincipal {
  readonly kind: "superadmin";
  readonly userId: string;
}

/** Who the request is. Exactly three kinds, and `can()` handles all three. */
export type Principal = MemberPrincipal | ApiKeyPrincipal | SuperadminPrincipal;

/**
 * What a scoped route works with: the organization every query is filtered to, and who
 * asked. A handler reads `organizationId` and hands it to `forTenant`; `can()` reads
 * `principal`.
 */
export interface Tenant {
  readonly organizationId: TenantId;
  readonly principal: Principal;
}

/** The part of `Headers` a resolver needs to decide whether it claims a request. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * A credential a module teaches this project to authenticate. `api-keys` registers one
 * for `Authorization: Bearer`.
 *
 * `claims` is a cheap, synchronous look at the headers, and it answers "is this my
 * credential", not "is it valid". Returning `true` takes the request off the session
 * path for good: `resolve` either returns a `Tenant` or throws, and the cookie is never
 * consulted afterwards. That is what stops a bad key from falling back to whatever
 * session cookie happens to ride along.
 */
export interface TenantResolver<Context = never> {
  /** For error messages and for reading the `tenantResolvers` array at a glance. */
  readonly name: string;
  claims(headers: HeaderReader): boolean;
  resolve(c: Context): Promise<Tenant>;
}

/**
 * The first resolver that claims this request, or `null` when none does.
 *
 * First wins, so the array order in `./tenant.ts` is the precedence order. Two resolvers
 * claiming one header is a bug in the project, not a case to arbitrate here.
 */
export function pickResolver<
  R extends { claims: (headers: HeaderReader) => boolean },
>(resolvers: readonly R[], headers: HeaderReader): R | null {
  return resolvers.find((resolver) => resolver.claims(headers)) ?? null;
}

/** A stored role row, exactly as `listOrganizationRoles` returns it. */
export interface StoredRoleRow {
  readonly role: string;
  readonly permission: string;
}

/**
 * Merge two permission sets, taking the union of actions per resource. Neither input is
 * mutated.
 */
function mergeStatements(
  base: ResolvedStatements,
  extra: ResolvedStatements
): ResolvedStatements {
  const merged: ResolvedStatements = {};
  for (const [resource, actions] of Object.entries(base)) {
    merged[resource] = [...actions];
  }
  for (const [resource, actions] of Object.entries(extra)) {
    merged[resource] = [...new Set([...(merged[resource] ?? []), ...actions])];
  }
  return merged;
}

/**
 * Read one stored row's `permission` JSON, or `null` when it is not a permission map.
 *
 * A row the plugin did not write, or one hand-edited into nonsense, resolves to nothing
 * rather than throwing. Throwing here would turn one bad row into a 500 on every request
 * that organization makes.
 */
function parsePermission(permission: string): ResolvedStatements | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(permission);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const statements: ResolvedStatements = {};
  for (const [resource, actions] of Object.entries(parsed)) {
    if (Array.isArray(actions)) {
      statements[resource] = actions.filter(
        (action): action is string => typeof action === "string"
      );
    }
  }
  return statements;
}

/**
 * What a member holding `roleName` may do in this organization.
 *
 * Four cases, and they are Better Auth's own `hasPermission` merge written out so `can()`
 * can stay a pure function over the answer:
 *
 * - a base role with a stored row of the same name — the static role merged with the row,
 *   the row widening it. `roleLockGuard()` in `rbac` refuses to write such a row, and
 *   this arm is still here because a row written before the guard shipped, or straight
 *   into the database, has to resolve the same way the plugin resolves it.
 * - a base role with no stored row — the static role alone. The common case.
 * - a custom role — the stored row alone.
 * - a name that matches neither — nothing at all. A deleted role fails closed for its
 *   holders, which is the decision: a dangling role grants no permission rather than
 *   falling back to `member`.
 */
export function resolveStatements(
  roleName: string,
  baseRoles: Readonly<Record<string, ResolvedStatements>>,
  storedRoles: readonly StoredRoleRow[]
): ResolvedStatements {
  const base = baseRoles[roleName];
  const row = storedRoles.find((stored) => stored.role === roleName);
  const stored = row ? parsePermission(row.permission) : null;

  if (base && stored) {
    return mergeStatements(base, stored);
  }
  if (base) {
    return mergeStatements(base, {});
  }
  if (stored) {
    return stored;
  }
  return {};
}

/**
 * The tenant a `superadmin` gets when they name an organization with the header. The id
 * is already branded, so the caller has decided this value may be trusted.
 */
export function superadminTenant(
  userId: string,
  organizationId: TenantId
): Tenant {
  return { organizationId, principal: { kind: "superadmin", userId } };
}

/**
 * 403 for a header this caller may not send. Not 401: they are signed in, so signing in
 * again cannot help. Not 404 either — hiding the header would only make a wrong call look
 * like a wrong path.
 */
export function headerDenial(): Denial {
  return { status: 403, message: FORBIDDEN };
}

/**
 * 403 when the caller is signed in and no organization resolves: no active organization
 * on the session, or a membership revoked since they set one. Fail closed, and say which
 * of the two failures it was in exactly one way, so the SPA can offer "create or join an
 * organization" without guessing.
 */
export function noOrganizationDenial(): Denial {
  return { status: 403, message: NO_ACTIVE_ORGANIZATION };
}
