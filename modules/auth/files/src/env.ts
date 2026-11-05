// The env rules `src/auth.ts` applies at module scope, kept in their own file with
// no imports at all. That is what makes them testable: `src/auth.ts` pulls in
// `cloudflare:workers`, Better Auth and the D1 client the moment it loads, so a test
// that wanted `deriveCookieDomain` out of it would have to boot a Worker to get one
// pure string function. The rules decide how sessions are signed and where the cookie
// is scoped, which is exactly the code worth covering.
//
// Keep this file free of imports and free of Workers types. The repo's own
// `src/env.test.ts` (not shipped) runs it under `node --test`, which strips the types
// and executes the file as-is.

/** The string-valued vars this package reads. `DB` and the rest live in `src/auth.ts`. */
export interface AuthEnv {
  AUTH_COOKIE_PREFIX?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  COOKIE_DOMAIN?: string;
  CORS_ORIGINS?: string;
}

// Exact hostnames, never a substring or a suffix test. `localhost.attacker.example`
// and `127.0.0.1.nip.io` both resolve off-box and both contain a loopback label, so a
// looser check would hand them the dev escape hatch below. `new URL()` reports an IPv6
// host with its brackets, hence both spellings.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname of `baseURL`, or `undefined` when it is unset or unparseable. */
function hostnameOf(baseURL: string | undefined): string | undefined {
  if (!baseURL) {
    return undefined;
  }
  try {
    return new URL(baseURL).hostname;
  } catch {
    return undefined;
  }
}

/**
 * True only when `BETTER_AUTH_URL` is set AND names a loopback host.
 *
 * An unset `BETTER_AUTH_URL` is deliberately NOT local dev. A production Worker whose
 * secrets never got set has no `BETTER_AUTH_URL` either, and treating that state as dev
 * is the exact failure `requireAuthSecret` exists to stop.
 */
export function isLocalDevUrl(baseURL: string | undefined): boolean {
  const hostname = hostnameOf(baseURL);
  return hostname !== undefined && LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * The signing secret, or `undefined` in local dev so Better Auth uses its own
 * development default.
 *
 * Fails closed. Better Auth's fallback key is published in its source, so a Worker that
 * signs sessions with it will accept a cookie anyone can forge — and it says so in one
 * console warning nobody reads on a platform where a cold start prints it once. So the
 * fallback is allowed only where it cannot matter: the operator has to have written a
 * loopback `BETTER_AUTH_URL`. Every other shape throws at module load, which takes the
 * Worker down on its first request instead of serving forgeable sessions.
 *
 * @throws {Error} when the secret is missing outside local dev.
 */
export function requireAuthSecret(env: AuthEnv): string | undefined {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret) {
    return secret;
  }
  if (isLocalDevUrl(env.BETTER_AUTH_URL)) {
    return undefined;
  }
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Without it Better Auth signs sessions with its " +
      "published development key, so any session cookie can be forged. Set it with " +
      "`wrangler secret put BETTER_AUTH_SECRET` (or put it in packages/env/.env and run pnpm env:setup). " +
      "The development default is allowed only when BETTER_AUTH_URL names a loopback " +
      "host, e.g. BETTER_AUTH_URL=http://localhost:4000."
  );
}

/**
 * The cookie domain, or `undefined` for a host-only cookie.
 *
 * The rule (build-spec §2.5 / ADR 0004, hardened in the auth plan): an explicit
 * `COOKIE_DOMAIN` always wins (prod sets `.x.com` for cross-subdomain sessions). When
 * unset, derive conservatively from `BETTER_AUTH_URL` rather than guess: a loopback host
 * stays host-only (SameSite=Lax already covers dev ports as same-site); an `api.`-prefixed
 * host strips to the apex for cross-subdomain cookies; anything else falls back to
 * host-only, because a mis-derived domain breaks login silently and host-only always works
 * (just without subdomain sharing) — never the more dangerous failure mode.
 */
export function deriveCookieDomain(env: AuthEnv): string | undefined {
  if (env.COOKIE_DOMAIN) {
    return env.COOKIE_DOMAIN;
  }

  const hostname = hostnameOf(env.BETTER_AUTH_URL);
  if (hostname === undefined || LOOPBACK_HOSTNAMES.has(hostname)) {
    return undefined; // host-only
  }

  if (hostname.startsWith("api.")) {
    const apex = hostname.slice("api.".length);
    // The apex must still have a dot in it. Without this guard a host whose own apex
    // starts with `api.` — `api.dev`, `api.io` — strips to a bare TLD (`.dev`, `.io`),
    // which browsers reject outright, and login breaks silently: the exact failure this
    // whole function exists to avoid. (A two-label check won't catch a registry suffix
    // like `api.co.uk`; a real public-suffix list is more than a scaffold should carry,
    // and nobody hosts an API on the apex of a public suffix.)
    if (apex.includes(".")) {
      return `.${apex}`;
    }
  }
  return undefined; // conservative: never guess a domain shape we don't recognize
}

/** What `AUTH_COOKIE_PREFIX` may hold: lowercase letters, digits and hyphens. */
export const AUTH_COOKIE_PREFIX_PATTERN = /^[a-z0-9-]+$/u;

/** True only when `baseURL` parses and its scheme is plain `http:`. */
function isHttpUrl(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false;
  }
  try {
    return new URL(baseURL).protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The Better Auth `cookiePrefix` of each instance: `client` and `admin`, or
 * `<prefix>-client` and `<prefix>-admin` when `AUTH_COOKIE_PREFIX` is set.
 *
 * Browsers scope a cookie by host, never by port. Two worktrees of one project that run
 * side by side on `localhost` (or on one tailnet host) would overwrite each other's
 * `client.session_token`, so each linked worktree signs in on its own names.
 * `pnpm dev:ports` writes the key there and nowhere else.
 *
 * The prefix applies only on an `http:` `BETTER_AUTH_URL`, loopback or not. A deployed
 * api is always `https:`, so a key copied into production by mistake changes nothing
 * and signs nobody out. An unset or unparseable URL gets the plain names too.
 *
 * @throws {Error} when the prefix applies and does not match `AUTH_COOKIE_PREFIX_PATTERN`.
 */
export function cookiePrefixes(env: AuthEnv): {
  client: string;
  admin: string;
} {
  const prefix = env.AUTH_COOKIE_PREFIX?.trim();
  if (!prefix || !isHttpUrl(env.BETTER_AUTH_URL)) {
    return { admin: "admin", client: "client" };
  }
  if (!AUTH_COOKIE_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `AUTH_COOKIE_PREFIX must match ${AUTH_COOKIE_PREFIX_PATTERN.source} ` +
        `(lowercase letters, digits and hyphens), got ${JSON.stringify(prefix)}. ` +
        "Run pnpm dev:ports to write a valid one, or remove the key."
    );
  }
  return { admin: `${prefix}-admin`, client: `${prefix}-client` };
}
