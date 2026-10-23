import { HTTPException } from "hono/http-exception";
import { adminAuth, auth } from "./auth";
import {
  ADMIN_APP_ROLES,
  ADMIN_AUDIENCE,
  ADMIN_ROLES,
  AUDIENCE_HEADER,
  SUPERADMIN_ROLE,
  decide,
  parseAudience,
} from "./authorize";
import type { Audience, Denial, RoleDemand } from "./authorize";
import { withAuthScope } from "./db-provider";
import type { AuthDbBindings } from "./db-provider";

export { adminAuth, auth } from "./auth";
export { ADMIN_ROLE } from "./authorize";
export { ADMIN_ROLES, SUPERADMIN_ROLE } from "./authorize";
export {
  ADMIN_APP_ROLES,
  ADMIN_AUDIENCE,
  AUDIENCE_HEADER,
  CLIENT_AUDIENCE,
} from "./authorize";
export type { Audience, RoleDemand } from "./authorize";

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
 * The two instances, by the audience each serves. A lookup in this table is how a gate
 * picks one: no `if`, so no branch here that a test cannot reach.
 */
const INSTANCES = { admin: adminAuth, client: auth } as const;

// Why a throw and not Hono middleware: the `chained-route` patch kind registers routes,
// not `.use()` links (ADR 0028), so middleware would need a per-route wiring convention
// no module has. A throw reuses `modules/api`'s `onError`, which renders any
// `HTTPException` as the one `{ error: { code, message } }` envelope the api publishes —
// so every deny, from every module, answers with the same body.
//
// The whole rule, status and message included, comes from `decide()` and
// `parseAudience()` in ./authorize.ts rather than from a condition written here. Every
// helper below reads the session, asks the rule, and throws what it hands back. That
// leaves no branch in this file for a test to miss, which is the point — nothing here can
// be imported by a test, so any decision written here would ship unexecuted.
function denialError(denial: Denial): HTTPException {
  return new HTTPException(denial.status, { message: denial.message });
}

/**
 * The audience this request names in `x-auth-audience`, or a 400 for a value that names
 * neither. No header means `client`. The admin app's api client sends `admin` on every
 * request, which is how a tenant route called from the admin app reads the admin session.
 */
export function requestAudience(c: AuthRequestContext): Audience {
  const { audience, denial } = parseAudience(
    c.req.raw.headers.get(AUDIENCE_HEADER)
  );
  if (denial) {
    throw denialError(denial);
  }
  return audience;
}

/**
 * The instance this request's audience names: `auth` for a client, `adminAuth` for the
 * admin app. A route that calls Better Auth itself (`authFor(c).api.getActiveMember(...)`)
 * goes through this, so a call from the admin app reads the admin session.
 */
export function authFor(c: AuthRequestContext) {
  return INSTANCES[requestAudience(c)];
}

/**
 * Read the session for this request, or `null` when there is not one.
 *
 * It reads the session of the audience the request names: the client session by
 * default, the admin session when `x-auth-audience: admin` is set. The `require*Admin*`
 * helpers below ignore the header and always read the admin session.
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
  const instance = authFor(c);
  return withAuthScope(c, () =>
    instance.api.getSession({ headers: c.req.raw.headers })
  );
}

/**
 * Read the admin session for this request, or `null`, whatever the header says. The
 * admin gates below read through this, so a client session never reaches them.
 */
export async function getAdminSession(c: AuthRequestContext) {
  return withAuthScope(c, () =>
    adminAuth.api.getSession({ headers: c.req.raw.headers })
  );
}

/**
 * The session, or a 401. Use this when a route needs to know who the caller is and
 * nothing more — `session.user.id` is right there, so no second lookup.
 */
export async function requireSession(c: AuthRequestContext) {
  const { denial, session } = decide(
    await getSession(c),
    undefined,
    requestAudience(c)
  );
  if (denial) {
    throw denialError(denial);
  }
  return session;
}

/**
 * The admin session, or a 401 when no admin session is signed in and a 403 when the role
 * is wrong. This is the primitive: `requireAdmin` is one caller, and a second role later
 * costs a call site rather than a rewritten helper. It reads the admin session whatever
 * `x-auth-audience` says, because every site role lives in the admin group. Better Auth's `ac`/`statements` permission layer stays
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
  const { denial, session } = decide(
    await getAdminSession(c),
    role,
    ADMIN_AUDIENCE
  );
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
 * The admin session, or a 401/403, for anyone in the admin group. This is the gate for a
 * route every admin-app user may call, including a role a project adds to
 * `ADMIN_APP_ROLES` such as `support`. Admin-only work keeps `requireAdmin`.
 */
export async function requireAdminApp(c: AuthRequestContext) {
  return requireRole(c, ADMIN_APP_ROLES);
}

/**
 * The session, or a 401/403, for the one role above `admin`. Exact: an `admin` is
 * refused. This is the gate for anything that crosses an organization boundary, such as
 * the `x-organization-id` bypass the `multitenant` module reads.
 */
export async function requireSuperadmin(c: AuthRequestContext) {
  return requireRole(c, SUPERADMIN_ROLE);
}
