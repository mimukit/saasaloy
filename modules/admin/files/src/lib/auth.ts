import { createClient } from "@repo/auth/client";

// The one auth client for the SPA. `@repo/auth` owns better-auth's configuration —
// `basePath: "/auth"`, `credentials: "include"` and the `adminClient()` plugin all come
// baked in — so this file only supplies the origin and caches the session lookup.
//
// `PUBLIC_API_URL` is inlined at build time by Vite (`envPrefix: "PUBLIC_"` in
// vite.config.ts). It is read through a `typeof` guard rather than `??` because an unset
// variable and an empty `PUBLIC_API_URL=` in a .env file are different values, and both
// have to fall back to the dev origin. Vite substitutes the member expression textually,
// so assigning it to a local first is safe.
const configuredApiUrl: unknown = import.meta.env.PUBLIC_API_URL;

/** Origin the SPA calls for both api and auth requests. `apps/api` runs on 4000 in dev. */
export const apiBaseUrl =
  typeof configuredApiUrl === "string" && configuredApiUrl !== ""
    ? configuredApiUrl
    : "http://localhost:4000";

export const auth = createClient(apiBaseUrl);

/** The signed-in session, shaped by better-auth's `admin()` plugin (so `user.role` exists). */
export type AdminSession = typeof auth.$Infer.Session;

/** The role the guard demands. better-auth's admin plugin writes this string into `user.role`. */
export const ADMIN_ROLE = "admin";

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

/** True when the session may enter the shell. A session alone is never enough. */
export function isAdmin(session: AdminSession | null): boolean {
  return session?.user.role === ADMIN_ROLE;
}
