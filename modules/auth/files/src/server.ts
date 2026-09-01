import { HTTPException } from "hono/http-exception";
import { auth } from "./auth";
import { ADMIN_ROLE, decide } from "./authorize";
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
export async function requireSession(request: Request) {
  const { denial, session } = decide(await getSession(request));
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
 */
export async function requireRole(request: Request, role: string) {
  const { denial, session } = decide(await getSession(request), role);
  if (denial) {
    throw denialError(denial);
  }
  return session;
}

/** The session, or a 401/403. The gate every administrative route opens with. */
export async function requireAdmin(request: Request) {
  return requireRole(request, ADMIN_ROLE);
}
