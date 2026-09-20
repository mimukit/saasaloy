// The gate's decision core: who may act.
//
// `./server.ts` owns the api-facing half — it reads the session and throws Hono's
// `HTTPException` — and this file owns the rule it throws on. The split is what makes
// the rule testable (see ./server.test.ts): anything importing `hono` or `better-auth`
// resolves only inside a scaffolded project, so the rule would otherwise ship untested.
//
// Nothing here talks to the network or the database. A caller passes a session it
// already has and gets an answer. The one import is `@repo/config`, which is a frozen
// object of checked-in literals with no dependencies of its own, so the rule stays as
// testable as it was when the two role strings were written here.
import { config } from "@repo/config";

/**
 * The site-admin role. `./auth.ts` registers better-auth's `admin()` plugin with
 * `adminRoles: [ADMIN_ROLE, SUPERADMIN_ROLE]`, and every new account gets `"user"`.
 *
 * The string itself lives in `packages/config/src/sections/auth.ts` and has exactly one
 * home. `apps/admin` reads the same section in the browser, where it cannot import from
 * `@repo/auth/server`, so the two sides can no longer disagree.
 *
 * An `admin` runs `apps/admin`. Inside an organization it is an ordinary member: the
 * site role grants nothing on a tenant route.
 */
export const ADMIN_ROLE = config.auth.adminRole;

/**
 * The role above `admin`. The first account to sign up wins it (the hook in
 * `./auth.ts`), and only it may act inside an organization it does not belong to,
 * through the `x-organization-id` header the `multitenant` module reads. Everything
 * `admin` may do, `superadmin` may do, which is why `requireAdmin` admits either.
 */
export const SUPERADMIN_ROLE = config.auth.superadminRole;

/**
 * The privilege list: the roles that may do admin-only work. `requireAdmin` demands one
 * of these, and the `admin()` plugin's `adminRoles` names the same pair, so the gate and
 * the plugin's own endpoints agree on who is an admin.
 */
export const ADMIN_ROLES: readonly string[] = [ADMIN_ROLE, SUPERADMIN_ROLE];

/**
 * The group list: every role in the admin group, which is who may sign in on the admin
 * session and open `apps/admin`. `requireAdminApp` demands one of these, and
 * `apps/admin/src/lib/auth.ts` keeps its own copy for the browser guard.
 *
 * It holds the same two roles as `ADMIN_ROLES` today, and the two lists stay separate on
 * purpose. A project that adds a `support` role adds it here only: support can then sign
 * in and open the admin app, and every `requireAdmin` route still refuses it. The
 * `saasaloy-auth` skill carries that recipe.
 */
export const ADMIN_APP_ROLES: readonly string[] = [ADMIN_ROLE, SUPERADMIN_ROLE];

/**
 * Who a session belongs to. A project has two user groups, and each signs in on its own
 * Better Auth instance: `client` on `/auth` and `admin` on `/admin/auth`. The instance
 * writes its name into `sessions.audience` when it creates the row, and a session of
 * the other audience counts as no session on that instance.
 */
export type Audience = "client" | "admin";

export const CLIENT_AUDIENCE: Audience = "client";
export const ADMIN_AUDIENCE: Audience = "admin";

/**
 * The request header that names which of the caller's two sessions a generic gate reads.
 * The admin app's api client sends `admin`; everything else sends nothing and gets the
 * client session. The header picks between the caller's own cookies, so it grants
 * nothing: a browser carries both cookies to the api host, and the header only says
 * which one this request means.
 */
export const AUDIENCE_HEADER = "x-auth-audience";

/**
 * What the gate reads off a session. Structural on purpose, so better-auth's inferred
 * session type fits without this file importing it. `role` is optional and nullable:
 * the plugin types it `string | undefined`, and a row written before the plugin shipped
 * comes back from the Drizzle adapter as `null`.
 */
export interface RoleBearer {
  user: { role?: string | null | undefined };
  session?: { audience?: string | null | undefined };
}

/**
 * A refusal. `status` is one of the four api's `ERROR_CODES` already maps (`400:
 * "invalid_input"`, `401: "unauthorized"`, `403: "forbidden"`, `404: "not_found"`), and
 * `message` becomes `error.message` in the envelope `onError` renders. It is never empty,
 * because `errorSchema` rejects that.
 *
 * The union is closed on purpose. A gate answers one of these four and nothing else, so
 * adding a status is a decision made here rather than at a call site. 400 has exactly one
 * source, an `x-auth-audience` value that names no audience.
 */
export interface Denial {
  readonly status: 400 | 401 | 403 | 404;
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
 * joined string (the first-user hook writes `"superadmin"`), and `apps/admin`'s browser guard
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
 * Pass `audience` to demand a session of that audience. A session of the other audience
 * is refused as signed out (401), not as forbidden: it is not a session of this group at
 * all, and signing in on the right app is the one thing that helps. The instance's own
 * adapter already refuses such a row, so this is the second check behind it. A session
 * with no `audience` field fails it too, so a caller that forgot the field fails closed.
 *
 * The rule lives here rather than in `./server.ts` so a test can execute it. `./server.ts`
 * cannot be imported by a test in this repo, because it pulls `hono` and `better-auth`, so
 * a branch left there would ship with nothing running it and one inverted `!` would keep
 * every automated check green. Every `require*` helper reads its answer from this function
 * and throws when `denial` is set, which leaves those helpers with no rule of their own.
 */
export function decide<S extends RoleBearer>(
  session: S | null | undefined,
  role?: RoleDemand,
  audience?: Audience
): Decision<S> {
  if (!session) {
    return { denial: SIGNED_OUT, session: null };
  }
  if (audience !== undefined && session.session?.audience !== audience) {
    return { denial: SIGNED_OUT, session: null };
  }
  if (role !== undefined && !hasRole(session, role)) {
    return { denial: roleDenial(role), session: null };
  }
  return { denial: null, session };
}

/** An `x-auth-audience` value that names neither audience. */
export const UNKNOWN_AUDIENCE: Denial = {
  status: 400,
  message: `${AUDIENCE_HEADER} must be "client" or "admin"`,
};

/** The audience a request asks for, or the refusal. Exactly one side is filled in. */
export type AudienceDecision =
  | { readonly audience: Audience; readonly denial: null }
  | { readonly audience: null; readonly denial: Denial };

/**
 * Read the `x-auth-audience` header. No header means `client`, because every caller but
 * the admin app is a client. Any other value, the empty string included, is refused
 * rather than read as `client`: a typo in the admin app would otherwise fall back to the
 * client session without a word, and the admin screens would act as whoever is signed in
 * in the other tab.
 */
export function parseAudience(
  header: string | null | undefined
): AudienceDecision {
  if (header === null || header === undefined) {
    return { audience: CLIENT_AUDIENCE, denial: null };
  }
  if (header === CLIENT_AUDIENCE || header === ADMIN_AUDIENCE) {
    return { audience: header, denial: null };
  }
  return { audience: null, denial: UNKNOWN_AUDIENCE };
}

// The rank rule. `superadmin` owns the admin group: only it may change an account that
// holds an admin-group role, or give such a role. An `admin` runs the back office for
// clients. The `admin()` plugin cannot say this, because `adminAc` gives both roles the
// same `set-role`, so `./plugins/rank-guard.ts` asks this rule before every `/admin/*`
// endpoint on the admin instance runs.

/**
 * What an `/admin/*` endpoint does, as the rank rule sees it.
 *
 * - `read`: it changes nothing.
 * - `user-write`: it changes the user named by `userId` in the body.
 * - `session-write`: it changes the user who owns `sessionToken` in the body.
 * - `create`: it writes a new user, maybe with a role.
 * - `impersonate`: it opens a session as another user.
 * - `unknown`: this list does not name it.
 */
export type AdminPathKind =
  | "read"
  | "user-write"
  | "session-write"
  | "create"
  | "impersonate"
  | "unknown";

/**
 * Every `/admin/*` endpoint better-auth 1.7.7's `admin()` plugin registers, by kind. A
 * path missing from this table is `unknown`, and only a `superadmin` may call it: an
 * endpoint a better-auth bump adds is refused for an `admin` until somebody reads it
 * and adds its line here. That is the fail-closed half of the rank rule.
 */
export const ADMIN_PATHS: Readonly<Record<string, AdminPathKind>> = {
  "/admin/ban-user": "user-write",
  "/admin/create-user": "create",
  "/admin/get-user": "read",
  "/admin/has-permission": "read",
  "/admin/impersonate-user": "impersonate",
  "/admin/list-user-sessions": "read",
  "/admin/list-users": "read",
  "/admin/remove-user": "user-write",
  "/admin/revoke-user-session": "session-write",
  "/admin/revoke-user-sessions": "user-write",
  "/admin/set-role": "user-write",
  "/admin/set-user-password": "user-write",
  "/admin/stop-impersonating": "read",
  "/admin/unban-user": "user-write",
  "/admin/update-user": "user-write",
};

/** The kind of an `/admin/*` path. Anything the table does not name is `unknown`. */
export function adminPathKind(path: string): AdminPathKind {
  return Object.hasOwn(ADMIN_PATHS, path)
    ? (ADMIN_PATHS[path] ?? "unknown")
    : "unknown";
}

/** Read a body field without trusting the body's shape. */
function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

/** A role value as the plugin accepts it, one string or a list, as a list. */
function roleList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * The roles this call would give its target: `role` on `set-role` and `create-user`, and
 * `data.role` on `update-user`. Every other path gives none.
 */
export function grantedRoles(path: string, body: unknown): string[] {
  if (path === "/admin/set-role" || path === "/admin/create-user") {
    return roleList(field(body, "role"));
  }
  if (path === "/admin/update-user") {
    return roleList(field(field(body, "data"), "role"));
  }
  return [];
}

/**
 * Whether this call takes the `superadmin` role away from a target that holds it:
 * removing or banning the account, or writing a role list without `superadmin` in it.
 * A call that writes no role at all (`update-user` with only a name) takes nothing.
 */
export function takesSuperadmin(path: string, body: unknown): boolean {
  if (path === "/admin/remove-user" || path === "/admin/ban-user") {
    return true;
  }
  if (path === "/admin/set-role" || path === "/admin/update-user") {
    const granted = grantedRoles(path, body);
    const wroteRole =
      path === "/admin/set-role" ||
      field(field(body, "data"), "role") !== undefined;
    return wroteRole && !granted.includes(SUPERADMIN_ROLE);
  }
  return false;
}

/** What `rankDenial` needs to know about one `/admin/*` call. */
export interface RankCall {
  readonly kind: AdminPathKind;
  /** The caller's own role. */
  readonly callerRole: string | null | undefined;
  /** The role of the account the call changes, when it names one. */
  readonly targetRole?: string | null | undefined;
  /** The roles the call would give, from `grantedRoles`. */
  readonly granted: readonly string[];
  /** Whether the call takes `superadmin` away from its target, from `takesSuperadmin`. */
  readonly takesSuperadmin: boolean;
  /** How many accounts hold `superadmin` now, the target included. */
  readonly superadmins: number;
}

/** Impersonation would open an admin session as a client, which the split forbids. */
export const IMPERSONATION_REFUSED: Denial = {
  status: 403,
  message:
    "impersonation is not available between the client and admin sessions",
};

/** An `admin` asked to change an account in the admin group, or to grant such a role. */
export const ADMIN_GROUP_REFUSED: Denial = {
  status: 403,
  message: "only a superadmin may change an admin-group account or role",
};

/** An `admin` asked for an `/admin/*` path the rank table does not name. */
export const SUPERADMIN_ONLY: Denial = {
  status: 403,
  message: "only a superadmin may call this admin endpoint",
};

/** The call would leave the project with no `superadmin`. */
export const LAST_SUPERADMIN: Denial = {
  status: 403,
  message: "the last superadmin cannot be removed, banned or demoted",
};

/**
 * The rank rule, as one pure function. `null` lets the call through to the `admin()`
 * plugin, which still checks its own permissions.
 *
 * In order: impersonation is refused for everyone; a caller who is not `superadmin` may
 * read, may not call an unknown path, and may not touch or grant an admin-group role;
 * and nobody, `superadmin` included, may take the role away from the last account that
 * holds it.
 */
export function rankDenial(call: RankCall): Denial | null {
  if (call.kind === "impersonate") {
    return IMPERSONATION_REFUSED;
  }
  if (call.callerRole !== SUPERADMIN_ROLE) {
    if (call.kind === "unknown") {
      return SUPERADMIN_ONLY;
    }
    if (call.kind === "read") {
      return null;
    }
    const touchesGroup =
      ADMIN_APP_ROLES.some((role) => role === call.targetRole) ||
      call.granted.some((role) => ADMIN_APP_ROLES.includes(role));
    if (touchesGroup) {
      return ADMIN_GROUP_REFUSED;
    }
  }
  if (
    call.targetRole === SUPERADMIN_ROLE &&
    call.takesSuperadmin &&
    call.superadmins <= 1
  ) {
    return LAST_SUPERADMIN;
  }
  return null;
}
