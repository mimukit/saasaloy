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
 * The site-admin role. `./auth.ts` registers better-auth's `admin()` plugin with
 * `adminRoles: [ADMIN_ROLE, SUPERADMIN_ROLE]`, and every new account gets `"user"`.
 * `apps/admin` keeps its own copy in `src/lib/auth.ts`, because a browser bundle cannot
 * import from `@repo/auth/server`; the strings have to agree.
 *
 * An `admin` runs `apps/admin`. Inside an organization it is an ordinary member: the
 * site role grants nothing on a tenant route.
 */
export const ADMIN_ROLE = "admin";

/**
 * The role above `admin`. The first account to sign up wins it (the hook in
 * `./auth.ts`), and only it may act inside an organization it does not belong to,
 * through the `x-organization-id` header the `multitenant` module reads. Everything
 * `admin` may do, `superadmin` may do, which is why `requireAdmin` admits either.
 */
export const SUPERADMIN_ROLE = "superadmin";

/**
 * The roles that open `apps/admin`. `requireAdmin` demands one of these, and
 * `apps/admin/src/lib/auth.ts` keeps its own copy of the same pair.
 */
export const ADMIN_ROLES: readonly string[] = [ADMIN_ROLE, SUPERADMIN_ROLE];

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
 * A refusal. `status` is one of the three api's `ERROR_CODES` already maps (`401:
 * "unauthorized"`, `403: "forbidden"`, `404: "not_found"`), and `message` becomes
 * `error.message` in the envelope `onError` renders. It is never empty, because
 * `errorSchema` rejects that.
 *
 * The union is closed on purpose. A gate answers one of these three and nothing else, so
 * adding a status is a decision made here rather than at a call site.
 */
export interface Denial {
  readonly status: 401 | 403 | 404;
  readonly message: string;
}

/** Nobody is signed in. 401 tells the SPA to send the caller to the login screen. */
export const SIGNED_OUT: Denial = { status: 401, message: "sign in first" };

/**
 * Signed in, wrong role. 403 rather than 401 is load-bearing: the caller is already
 * authenticated, so signing in again cannot help, and a 401 would bounce them through
 * a login they have just completed.
 */
export function roleDenial(role: RoleDemand): Denial {
  const named = typeof role === "string" ? role : role.join(" or ");
  return { status: 403, message: `role required: ${named}` };
}

/**
 * What a route demands: one exact role, or any one of a set. The any-of form exists for
 * `requireAdmin`, which admits `admin` and `superadmin`; `requireRole` and
 * `requireSuperadmin` pass a single string and stay exact.
 *
 * An empty array is a demand nothing satisfies, not an absent demand. `decide` keys the
 * "no role wanted" case off `undefined`, so an accidentally empty list fails closed.
 */
export type RoleDemand = string | readonly string[];

/**
 * Whether the session carries this role. A string demands exactly that role; an array
 * demands any one of them, each compared the same exact way. The comparison is `===` and stays
 * that way: a case fold or a substring test would let `"Admin"` and `"administrator"`
 * past a check whose whole job is to be exact.
 *
 * One role per user is the contract, and a comma-joined list is denied. better-auth's
 * `admin()` plugin disagrees: its `has-permission.mjs` splits `user.role` on `,`, so a row
 * holding `"admin,support"` is an admin to `auth.api.listUsers` and is refused here. The
 * divergence is deliberate and it fails closed. Nothing in a scaffolded project writes a
 * joined string (the first-admin hook writes `"admin"`), and `apps/admin`'s browser guard
 * compares with `===` against its own copy of the constant. Splitting here alone would
 * admit a caller the SPA still refuses. Store one role, or change both halves together.
 */
export function hasRole(session: RoleBearer, role: RoleDemand): boolean {
  const held = session.user.role;
  return typeof role === "string"
    ? held === role
    : role.some((candidate) => held === candidate);
}

/**
 * The gate's answer. Exactly one side is filled in: a refusal carries the `Denial` and no
 * session, and a pass carries the session and no denial. Two fields rather than a nullable
 * return, so a caller that throws on `denial` gets the session narrowed to non-null for
 * free and needs no cast.
 */
export type Decision<S extends RoleBearer> =
  | { readonly denial: Denial; readonly session: null }
  | { readonly denial: null; readonly session: S };

/**
 * The whole gate rule, as one pure function. Pass the session (or `null` when there is
 * none) and the role the route demands; omit `role` to ask only whether anybody is signed
 * in. Pass an array to demand any one of several roles, which is how `requireAdmin`
 * admits both `admin` and `superadmin` without a second decision path.
 *
 * The rule lives here rather than in `./server.ts` so a test can execute it. `./server.ts`
 * cannot be imported by a test in this repo, because it pulls `hono` and `better-auth`, so
 * a branch left there would ship with nothing running it and one inverted `!` would keep
 * every automated check green. Every `require*` helper reads its answer from this function
 * and throws when `denial` is set, which leaves those helpers with no rule of their own.
 */
export function decide<S extends RoleBearer>(
  session: S | null | undefined,
  role?: RoleDemand
): Decision<S> {
  if (!session) {
    return { denial: SIGNED_OUT, session: null };
  }
  if (role !== undefined && !hasRole(session, role)) {
    return { denial: roleDenial(role), session: null };
  }
  return { denial: null, session };
}
