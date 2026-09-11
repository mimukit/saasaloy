import type { Denial } from "./authorize";

// Permission checking's decision core: what a resolved principal may do, expressed with
// zero runtime imports.
//
// `./rbac.ts` owns the half that resolves the tenant and throws; this file owns the rule
// it throws on. The split is the one `./authorize.ts` and `./tenant-rules.ts` already
// draw, and for the same reason: anything importing `better-auth`, `hono` or `@repo/db`
// resolves only inside a scaffolded project, so a rule written there would ship with no
// test able to execute it. `./rbac-rules.test.ts` runs this file under `node --test`.
//
// The one `import type` above is erased before the file runs, and `./authorize.ts` itself
// imports nothing. Add a runtime import here and the test stops loading the file — that
// is the guard, not an accident.
//
// This file is also the ONE browser-safe half. `packages/auth/package.json` maps it to
// `@repo/auth/rbac-rules`, and `apps/admin` imports `can` from there to hide a control
// the caller may not use. `./rbac.ts` cannot be imported by a bundle (it pulls `hono`
// and the whole auth instance), and neither can `./tenant-rules.ts`, which names
// `TenantId` from `@repo/db`. So the types below are structural rather than imported:
// `Principal` from `./tenant-rules.ts` satisfies `PrincipalLike` by shape.
//
// THE HIDE IS COSMETIC. `requireCan` on the route is the gate. A screen that hides a
// button and skips the server check has no authorization at all.

/**
 * A resolved permission set: resource name to the actions held on it. The same shape
 * `./tenant-rules.ts` resolves onto a principal, restated here so this file imports
 * nothing.
 */
export type ResolvedStatements = Record<string, readonly string[]>;

/**
 * What `can` needs off a principal, structurally.
 *
 * `superadmin` carries no statements by design: the arm below answers true for that kind
 * outright, so widening `statements` in `access.ts` can never change what a superadmin
 * may do, and narrowing it can never lock one out. The other two kinds carry the
 * statements `requireTenant` already resolved, which is why `can` runs no query.
 *
 * `Principal` from `./tenant-rules.ts` is assignable to this without a cast.
 */
export type PrincipalLike =
  | { readonly kind: "superadmin" }
  | {
      readonly kind: "member" | "apiKey";
      readonly statements: ResolvedStatements;
    };

/**
 * A permission demand: resource to the actions the caller must hold on it. Every listed
 * action is required — the check is AND, never OR, so `{ project: ["read", "delete"] }`
 * asks for both.
 *
 * `Permissions` from `./access.ts` is the typed form of this, and `./rbac.ts` takes that
 * one so an undeclared resource is a compile error. Here the values are widened to plain
 * strings, because a role loaded out of the database carries no literal types. The
 * `| undefined` in the value is what makes `Partial<...>` from `access.ts` assignable.
 */
export type PermissionDemand = Readonly<
  Record<string, readonly string[] | undefined>
>;

/**
 * The 403 body for a refused permission, and the format `apps/admin` reads. One
 * resource:action pair, the first one missing, rather than the whole demand: a refusal
 * that listed every permission the route wants would tell an attacker the shape of the
 * route.
 */
export function permissionDenial(resource: string, action: string): Denial {
  return { status: 403, message: `permission required: ${resource}:${action}` };
}

/**
 * The refusal for a demand that names no resource and action at all.
 *
 * An empty demand is a bug at the call site, and it fails closed. Reading `{}` as "no
 * permission needed" would turn a mistyped resource key, or a demand built from an empty
 * loop, into an open route, and nothing in the type system catches that.
 */
export function emptyDemandDenial(): Denial {
  return { status: 403, message: "permission required" };
}

/** The gate's answer. Exactly one side is filled in, as `decide()` in `./authorize.ts`. */
export type PermissionDecision =
  | { readonly denial: Denial; readonly allowed: false }
  | { readonly denial: null; readonly allowed: true };

const ALLOWED: PermissionDecision = { denial: null, allowed: true };

/**
 * May this principal do all of these things?
 *
 * Pure, and deliberately so. `requireTenant` already ran the one `organizationRole` query
 * and merged the statements onto the principal, so a route with three `requireCan` lines
 * still pays for one round trip. Better Auth's own `auth.api.hasPermission` would ask the
 * database again per check and could not be tested here at all.
 *
 * Three arms, and the order matters:
 *
 * - `superadmin` — true, without touching statements. The one role that crosses
 *   organizations already proved itself in `requireTenant`.
 * - `member` and `apiKey` — every demanded action must appear in `statements[resource]`.
 *   An unknown resource holds no actions, so it refuses like an empty one.
 * - an empty demand — refused. See `emptyDemandDenial`.
 */
export function can(
  principal: PrincipalLike,
  permissions: PermissionDemand
): PermissionDecision {
  if (principal.kind === "superadmin") {
    return ALLOWED;
  }

  let demanded = 0;
  for (const [resource, actions] of Object.entries(permissions)) {
    if (!actions) {
      continue;
    }
    const held = principal.statements[resource] ?? [];
    for (const action of actions) {
      demanded += 1;
      if (!held.includes(action)) {
        return { denial: permissionDenial(resource, action), allowed: false };
      }
    }
  }

  return demanded === 0
    ? { denial: emptyDemandDenial(), allowed: false }
    : ALLOWED;
}

/**
 * `can` as a boolean, for a screen deciding whether to render a control. Use `can` on the
 * server, where the `Denial` becomes the response; use this in a component, where there
 * is nothing to throw.
 */
export function allows(
  principal: PrincipalLike,
  permissions: PermissionDemand
): boolean {
  return can(principal, permissions).allowed;
}

/**
 * The message a base-role edit is refused with. Exported and fixed, because the `/roles`
 * screen matches on it to explain why a control is missing.
 */
export const BASE_ROLE_LOCKED = "base role is locked";

/**
 * The first locked name among these candidates, or `null` when none is locked.
 *
 * `roleLockGuard()` in `./plugins/role-lock.ts` feeds it every field a Better Auth role
 * endpoint might carry the name in (`role`, `roleName`, `data.roleName`), because the
 * three endpoints do not agree on one field. Anything that is not a string is skipped, so
 * an absent field and a hostile one both fall through to the plugin's own validation.
 */
export function findLockedRole(
  candidates: readonly unknown[],
  baseRoles: readonly string[]
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && baseRoles.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * 403 for an attempt to create, edit or delete a base role. Not 400: the request is
 * well formed and the caller may well hold the `ac` permission the plugin checks. It is
 * the name that is off limits.
 */
export function roleLockDenial(name: string): Denial {
  return { status: 403, message: `${BASE_ROLE_LOCKED}: ${name}` };
}
