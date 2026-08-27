import { createAuthClient } from "better-auth/react";

// The api origin, baked into the bundle at build time — Vite inlines `import.meta.env`
// at compile time, so there is no runtime lookup and no config file to fetch before
// boot. One build per environment is the accepted SPA trade. The fallback keeps
// `pnpm dev` working with no .env at all: the api Worker is pinned to :4000.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// The same contract as `@repo/auth/client`, in React form. `basePath` must match the
// server's (`/auth`, set in packages/auth/src/auth.ts), and `credentials: "include"`
// is what lets the httpOnly session cookie ride along on a cross-origin request. The
// api spine's CORS allowlist has to contain this app's origin for that to succeed;
// http://localhost:3001 is already in its dev fallback, and production sets
// CORS_ORIGINS (and COOKIE_DOMAIN, when the two apps sit on different subdomains).
export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/auth",
  fetchOptions: { credentials: "include" },
});

export const { signIn, signUp, signOut, useSession } = authClient;

export type Session = typeof authClient.$Infer.Session;

// The session as the router sees it. `beforeLoad` runs on every navigation into the
// guarded tree, but the session is fetched once per app load and held here: the guard
// is UX, not enforcement (an httpOnly cookie means the client can never be the gate),
// so re-asking the server on each click buys latency and nothing else. The api
// rejects a stale session with a 401, and lib/api.ts turns that into a trip back to
// /login. Call `reset()` after any sign-in or sign-out to drop the cache.
export interface AuthState {
  /** The loaded session, `null` when signed out, `undefined` before the first load. */
  current: Session | null | undefined;
  /** Load once per app load. Concurrent callers share the one in-flight request. */
  load: () => Promise<Session | null>;
  /** Forget the cached session so the next `load()` asks the server again. */
  reset: () => void;
}

/** Router context. `__root.tsx` types the tree with it; `main.tsx` supplies it. */
export interface RouterContext {
  auth: AuthState;
}

export function createAuthState(): AuthState {
  let pending: Promise<Session | null> | undefined;

  const state: AuthState = {
    current: undefined,
    load: () => {
      // A network failure is not a session. Clearing `pending` in the catch means a
      // dropped connection costs one redirect to /login rather than pinning the app
      // to "signed out" for the rest of its life.
      pending ??= authClient
        .getSession()
        .then(({ data }) => {
          state.current = data ?? null;
          return state.current;
        })
        .catch(() => {
          state.current = null;
          pending = undefined;
          return null;
        });
      return pending;
    },
    reset: () => {
      pending = undefined;
      state.current = undefined;
    },
  };

  return state;
}

// Where to send someone after they sign in. The value comes from the `redirect`
// search param, which means it comes from the URL bar and an attacker can put
// anything in it: `https://evil.com` and the protocol-relative `//evil.com` are both
// values a naive `startsWith("/")` check would happily forward to. Anything that is
// not a single-slash-prefixed path inside this app collapses to the dashboard.
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}

/** The login URL that carries `from` as the post-sign-in destination. */
export function loginHref(from: string): string {
  return `/login?redirect=${encodeURIComponent(safeRedirect(from))}`;
}
