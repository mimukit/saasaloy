import { HTTPException } from "hono/http-exception";
import { auth } from "./auth";
import { ADMIN_ROLE, SIGNED_OUT, hasRole, roleDenial } from "./authorize";
import type { Denial } from "./authorize";

export { auth } from "./auth";
export { ADMIN_ROLE } from "./authorize";

// The protected-route recipe: read the session off any inbound Request's headers
// (the httpOnly cookie rides along automatically), return null when there isn't one.
// A route does `const session = await getSession(c.req.raw); if (!session) return c.json({}, 401);`
// — no route ever imports `better-auth` directly (ADR 0020).
//
// This stays exported alongside the three helpers below, because a route that wants a
// nullable session (a page that renders differently when signed in, rather than
// refusing) needs an answer, not a throw.
export async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

// Why a throw and not Hono middleware: the `chained-route` patch kind registers routes,
// not `.use()` links (ADR 0028), so middleware would need a per-route wiring convention
// no module has. A throw reuses `modules/api`'s `onError`, which renders any
// `HTTPException` as the one `{ error: { code, message } }` envelope the api publishes —
// so every deny, from every module, answers with the same body.
//
// The status and the message come from ./authorize.ts rather than from literals here, so
// the rule the tests cover is the rule a caller meets.
function denialError(denial: Denial): HTTPException {
  return new HTTPException(denial.status, { message: denial.message });
}

/**
 * The session, or a 401. Use this when a route needs to know who the caller is and
 * nothing more — `session.user.id` is right there, so no second lookup.
 */
export async function requireSession(request: Request) {
  const session = await getSession(request);
  if (!session) {
    throw denialError(SIGNED_OUT);
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
 */
export async function requireRole(request: Request, role: string) {
  const session = await requireSession(request);
  if (!hasRole(session, role)) {
    throw denialError(roleDenial(role));
  }
  return session;
}

/** The session, or a 401/403. The gate every administrative route opens with. */
export async function requireAdmin(request: Request) {
  return requireRole(request, ADMIN_ROLE);
}
