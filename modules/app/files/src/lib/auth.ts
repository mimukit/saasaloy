import { createClient } from "@repo/auth/client";

import { appEnv } from "@app/env";

// The customer app's auth client and session cache. It signs in on the client instance at
// `/auth`, the one every account signs up on, and holds the `client.session_token` cookie.
// The admin app signs in on `/admin/auth` with its own cookie, so a person can hold both
// sessions in one browser and neither replaces the other (ADR 0050).
//
// The guard here is the session alone: any signed-in account may open this app. A screen
// that needs a role checks it itself, and the api checks it again on every call.

/**
 * Origin the SPA calls for both api and auth requests. `apps/api` runs on 4000 in dev.
 * `src/env.ts` validates `PUBLIC_API_URL` and inlines it at build time, with no fallback.
 */
export const apiBaseUrl = appEnv().PUBLIC_API_URL;

export const auth = createClient(apiBaseUrl);

/** The signed-in session. */
export type AppSession = typeof auth.$Infer.Session;

let cached: Promise<AppSession | null> | null = null;

/**
 * Read the current session, once per page load. Returns `null` when anonymous.
 *
 * The root guard runs on every navigation, so the promise is cached: one `get-session`
 * call per load rather than one per click. A failed call clears the cache and reads as
 * anonymous, which sends the visitor to sign in rather than to an error screen.
 */
export function loadSession(): Promise<AppSession | null> {
  cached ??= auth
    .getSession()
    .then(({ data }) => data ?? null)
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}

/** Drop the cached session. Call after any sign-in or sign-out, before `router.invalidate()`. */
export function forgetSession(): void {
  cached = null;
}
