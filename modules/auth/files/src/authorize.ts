// The gate's decision core: who may act, expressed with zero imports.
//
// `./server.ts` owns the api-facing half — it reads the session and throws Hono's
// `HTTPException` — and this file owns the rule it throws on. The split is what makes
// the rule testable (see ./server.test.ts): anything importing `hono` or `better-auth`
// resolves only inside a scaffolded project, so the rule would otherwise ship untested.
//
// Nothing here talks to the network or the database. A caller passes a session it
// already has and gets an answer.

/**
 * The role better-auth's `admin()` plugin treats as privileged. `./auth.ts` registers
 * the plugin with its defaults, so `adminRoles` is `["admin"]` and every new account
 * gets `"user"`. `apps/admin` keeps its own copy in `src/lib/auth.ts`, because a browser
 * bundle cannot import from `@repo/auth/server`; the two strings have to agree.
 */
export const ADMIN_ROLE = "admin";

/**
 * What the gate reads off a session. Structural on purpose, so better-auth's inferred
 * session type fits without this file importing it. `role` is optional and nullable:
 * the plugin types it `string | undefined`, and a row written before the plugin shipped
 * comes back from the Drizzle adapter as `null`.
 */
export interface RoleBearer {
  user: { role?: string | null | undefined };
}

/**
 * A refusal. `status` is one of the two api's `ERROR_CODES` already maps (`401:
 * "unauthorized"`, `403: "forbidden"`), and `message` becomes `error.message` in the
 * envelope `onError` renders. It is never empty, because `errorSchema` rejects that.
 */
export interface Denial {
  readonly status: 401 | 403;
  readonly message: string;
}

/** Nobody is signed in. 401 tells the SPA to send the caller to the login screen. */
export const SIGNED_OUT: Denial = { status: 401, message: "sign in first" };

/**
 * Signed in, wrong role. 403 rather than 401 is load-bearing: the caller is already
 * authenticated, so signing in again cannot help, and a 401 would bounce them through
 * a login they have just completed.
 */
export function roleDenial(role: string): Denial {
  return { status: 403, message: `role required: ${role}` };
}

/**
 * Whether the session carries exactly this role. The comparison is `===` and stays
 * that way: a case fold or a substring test would let `"Admin"`, `"administrator"` and
 * a comma-joined list past a check whose whole job is to be exact.
 */
export function hasRole(session: RoleBearer, role: string): boolean {
  return session.user.role === role;
}
