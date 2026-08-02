import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@repo/db/client";

// Bindings + secrets this module reads. `cloudflare:workers`' importable `env` (not
// Hono's `c.env`) is used deliberately here — see the comment on `export const auth`
// below for why.
type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  COOKIE_DOMAIN?: string;
  CORS_ORIGINS?: string;
};

const authEnv = env as unknown as AuthEnv;

// Same localhost dev fallback `modules/api`'s CORS spine uses — one origin list, two
// readers (api's `cors()` middleware and this file's `trustedOrigins`), no drift.
// :3000 is apps/web, :3001 is apps/admin; the api Worker itself is :4000.
const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

function trustedOrigins(): string[] {
  const configured = authEnv.CORS_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : DEV_ORIGINS;
}

// The cookie-domain rule (build-spec §2.5 / ADR 0004, hardened in the auth plan):
// an explicit COOKIE_DOMAIN always wins (prod sets `.x.com` for cross-subdomain
// sessions). When unset, derive conservatively from BETTER_AUTH_URL rather than
// guess: localhost/127.0.0.1 stays host-only (SameSite=Lax already covers dev ports
// as same-site); an `api.`-prefixed host strips to the apex (`.rest` of the
// hostname) for cross-subdomain cookies; anything else falls back to host-only,
// because a mis-derived domain breaks login silently and host-only always works
// (just without subdomain sharing) — never the more dangerous failure mode.
function deriveCookieDomain(): string | undefined {
  if (authEnv.COOKIE_DOMAIN) return authEnv.COOKIE_DOMAIN;

  const baseURL = authEnv.BETTER_AUTH_URL;
  if (!baseURL) return undefined;

  let hostname: string;
  try {
    hostname = new URL(baseURL).hostname;
  } catch {
    return undefined;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") return undefined; // host-only
  if (hostname.startsWith("api.")) {
    const apex = hostname.slice("api.".length);
    // The apex must still have a dot in it. Without this guard a host whose own apex
    // starts with `api.` — `api.dev`, `api.io` — strips to a bare TLD (`.dev`, `.io`),
    // which browsers reject outright, and login breaks silently: the exact failure this
    // whole function exists to avoid. (A two-label check won't catch a registry suffix
    // like `api.co.uk`; a real public-suffix list is more than a scaffold should carry,
    // and nobody hosts an API on the apex of a public suffix.)
    if (apex.includes(".")) return `.${apex}`;
  }
  return undefined; // conservative: never guess a domain shape we don't recognize
}

const cookieDomain = deriveCookieDomain();

// Top-level singleton, not a per-request `c.env`-scoped factory (the convention every
// other capability follows). This is deliberate: the Better Auth plugin-array patch
// point (`{ exportName: "auth", arrayProp: "plugins" }` — see
// packages/cli/src/lib/patch/ts-module.ts) must be a module-scope `export const` for
// `billing`/`teams` to patch `plugins: [...]` with zero codemod changes. Workers'
// `cloudflare:workers` importable-env makes bindings available at module scope, which
// is what makes this shape possible without losing per-request binding access.
export const auth = betterAuth({
  basePath: "/auth",
  baseURL: authEnv.BETTER_AUTH_URL,
  secret: authEnv.BETTER_AUTH_SECRET, // falls back to Better Auth's dev default (+ console warning) when unset
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // needs the `email` capability; auth deliberately doesn't depend on it
  },
  database: drizzleAdapter(getDb(authEnv.DB), { provider: "sqlite" }),
  advanced: cookieDomain
    ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }
    : undefined,
  // Establishes the patch point; auth itself consumes none. Keep this an array
  // literal (never omit it) — `insertIntoPluginArray` needs a real array to push into.
  plugins: [],
});
