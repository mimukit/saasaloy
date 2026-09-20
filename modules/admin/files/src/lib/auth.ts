import { createClient } from "@repo/auth/client";
import { adminEnv } from "@admin/env";

// The one auth client for the SPA. `@repo/auth` owns better-auth's configuration —
// `basePath: "/auth"`, `credentials: "include"` and the `adminClient()` plugin all come
// baked in — so this file only supplies the origin and caches the session lookup.
//
/**
 * Origin the SPA calls for both api and auth requests. `apps/api` runs on 4000 in dev.
 *
 * `src/env.ts` validates `PUBLIC_API_URL` and inlines it at build time. There is no
 * fallback: an unset key fails the build naming the key, rather than shipping a bundle
 * that calls http://localhost:4000 from production.
 */
export const apiBaseUrl = adminEnv().PUBLIC_API_URL;

export const auth = createClient(apiBaseUrl);

/** The signed-in session, shaped by better-auth's `admin()` plugin (so `user.role` exists). */
export type AdminSession = typeof auth.$Infer.Session;

/** The site-admin role. better-auth's admin plugin writes this string into `user.role`. */
export const ADMIN_ROLE = "admin";

/** The role above `admin`. The first account to sign up wins it. */
export const SUPERADMIN_ROLE = "superadmin";

/**
 * The roles that open the shell. This is the browser's copy of `ADMIN_ROLES` in
 * `packages/auth/src/authorize.ts`, because a bundle cannot import from
 * `@repo/auth/server`. Change one list and change the other, or the SPA and the api
 * disagree about who gets in.
 */
export const ADMIN_ROLES: readonly string[] = [ADMIN_ROLE, SUPERADMIN_ROLE];

// The root route's `beforeLoad` runs on every navigation, and an unmemoised getSession()
// there costs a blocking round trip per click. One promise is kept and handed to every
// caller instead, and every code path that changes who is signed in clears it.
//
// Read the lifetime plainly: this memo lasts for the page load, not for one navigation.
// The first call fetches, and the settled promise is reused until `forgetSession()` or a
// reload. So a session that expires, is revoked, or has its role changed in another tab
// stays cached here, and the shell keeps painting while every api call answers 401. That
// is a cosmetic lag, never a privilege: the api authorizes each request on the cookie it
// receives, not on this value. Anything needing a live re-read belongs in TanStack Query,
// which owns cache lifetimes; this file deliberately owns none.
let cached: Promise<AdminSession | null> | null = null;

/** Read the current session, once per page load. Returns `null` when anonymous. */
export function loadSession(): Promise<AdminSession | null> {
  cached ??= auth
    .getSession()
    .then(({ data }) => data ?? null)
    .catch(() => {
      // A network failure must not poison the cache: drop it so the next navigation
      // asks again instead of showing the login screen forever.
      cached = null;
      return null;
    });
  return cached;
}

/** Drop the cached session. Call after any sign-in or sign-out, before `router.invalidate()`. */
export function forgetSession(): void {
  cached = null;
}

/**
 * True when the session may enter the shell. A session alone is never enough.
 *
 * Both site roles pass, matching `requireAdmin` on the api. The comparison stays `===`
 * per entry: a fold or a substring test would let `"Admin"` and `"administrator"` in,
 * and the api would then refuse every call the shell made.
 */
export function isAdmin(session: AdminSession | null): boolean {
  const role = session?.user.role;
  return ADMIN_ROLES.some((candidate) => role === candidate);
}
