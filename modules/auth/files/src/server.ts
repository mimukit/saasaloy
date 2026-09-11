import { HTTPException } from "hono/http-exception";
import { auth } from "./auth";
import { ADMIN_ROLES, SUPERADMIN_ROLE, decide } from "./authorize";
import type { Denial, RoleDemand } from "./authorize";
import { withAuthScope } from "./db-provider";
import type { AuthDbBindings } from "./db-provider";

export { auth } from "./auth";
export { ADMIN_ROLE } from "./authorize";
export { ADMIN_ROLES, SUPERADMIN_ROLE } from "./authorize";
export type { RoleDemand } from "./authorize";

// Re-exported so a route reaches the scope and the binding shape through one entry
// point. `apps/api/src/routes/auth.ts` imports only `hono` and this module, and no route
// ever imports `better-auth` directly (ADR 0020). Which driver supplied them is
// `packages/auth/src/db-provider.ts`'s business, and nothing above it can tell.
export { withAuthScope } from "./db-provider";
export type { AuthDbBindings } from "./db-provider";

/**
 * The part of a Hono `Context` `getSession` reads.
 *
 * Structural on purpose: `packages/auth` takes no `hono` dependency, and any request
 * context carrying these three fields fits. It is `DbRequestContext` from
 * `@repo/db/client` plus `req.raw`, which is where the session cookie arrives.
 */
export interface AuthRequestContext {
  env: AuthDbBindings;
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void };
  req: { raw: Request };
}

/**
 * Read the session for this request, or `null` when there is not one.
 *
 * The protected-route recipe:
 *
 *   const session = await getSession(c);
 *   if (!session) return c.json({ error: { code: "unauthorized" } }, 401);
 *
 * It takes the whole context rather than a `Request`, and that is not decoration. Better
 * Auth's `auth` is a module-scope singleton while its database client belongs to one
 * request, so the call has to run inside `withAuthScope`, which needs `c.env` to open the
 * client and `c.executionCtx` to close it. Passing `c.req.raw` alone would leave the
 * caller to remember the wrapper, and forgetting it type-checks, passes on D1 and throws
 * on Postgres. Doing it here means there is nothing to forget. See `./db-scope.ts`.
 *
 * The httpOnly session cookie rides along on `c.req.raw` automatically.
 *
 * This stays exported alongside the three helpers below, because a route that wants a
 * nullable session (a page that renders differently when signed in, rather than
 * refusing) needs an answer, not a throw.
 */
export async function getSession(c: AuthRequestContext) {
  return withAuthScope(c, () =>
    auth.api.getSession({ headers: c.req.raw.headers })
  );
}

// Why a throw and not Hono middleware: the `chained-route` patch kind registers routes,
// not `.use()` links (ADR 0028), so middleware would need a per-route wiring convention
// no module has. A throw reuses `modules/api`'s `onError`, which renders any
// `HTTPException` as the one `{ error: { code, message } }` envelope the api publishes —
// so every deny, from every module, answers with the same body.
//
// The whole rule, status and message included, comes from `decide()` in ./authorize.ts
// rather than from a condition written here. Every helper below is the same three lines:
// read the session, ask `decide`, throw what it hands back. That leaves no branch in this
// file for a test to miss, which is the point — nothing here can be imported by a test,
// so any decision written here would ship unexecuted.
function denialError(denial: Denial): HTTPException {
  return new HTTPException(denial.status, { message: denial.message });
}

/**
 * The session, or a 401. Use this when a route needs to know who the caller is and
 * nothing more — `session.user.id` is right there, so no second lookup.
 */
export async function requireSession(c: AuthRequestContext) {
  const { denial, session } = decide(await getSession(c));
  if (denial) {
    throw denialError(denial);
  }
  return session;
}

/**
 * The session, or a 401 when signed out and a 403 when the role is wrong. This is the
 * primitive: `requireAdmin` is one caller, and a second role later costs a call site
 * rather than a rewritten helper. Better Auth's `ac`/`statements` permission layer stays
 * out — one string comparison does not need a permission model.
 *
 * Role only, no `banned` check. The `admin()` plugin already refuses a banned account at
 * sign-in and revokes its sessions, so a banned user holds no session to inspect.
 *
 * One role per user: `decide` compares with `===`, so a comma-joined `"admin,support"` is
 * refused even though better-auth's own plugin would accept it. See `hasRole`.
 *
 * `role` takes an array to demand any one of several roles. That form has exactly one
 * caller today, `requireAdmin` with `ADMIN_ROLES`; everything else passes one string and
 * gets the exact comparison.
 */
export async function requireRole(c: AuthRequestContext, role: RoleDemand) {
  const { denial, session } = decide(await getSession(c), role);
  if (denial) {
    throw denialError(denial);
  }
  return session;
}

/**
 * The session, or a 401/403. The gate every administrative route opens with.
 *
 * It admits `admin` and `superadmin`, because `superadmin` sits above `admin` and every
 * backoffice route an `admin` may call, a `superadmin` may call too. It grants nothing
 * inside an organization: a tenant route asks `requireTenant`, which reads the caller's
 * membership and not this role.
 */
export async function requireAdmin(c: AuthRequestContext) {
  return requireRole(c, ADMIN_ROLES);
}

/**
 * The session, or a 401/403, for the one role above `admin`. Exact: an `admin` is
 * refused. This is the gate for anything that crosses an organization boundary, such as
 * the `x-organization-id` bypass the `multitenant` module reads.
 */
export async function requireSuperadmin(c: AuthRequestContext) {
  return requireRole(c, SUPERADMIN_ROLE);
}
