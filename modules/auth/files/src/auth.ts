import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { getDb } from "@repo/db/client";
import { deriveCookieDomain, requireAuthSecret } from "./env";
import type { AuthEnv } from "./env";

// Bindings + secrets this module reads. `cloudflare:workers`' importable `env` (not
// Hono's `c.env`) is used deliberately here — see the comment on `export const auth`
// below for why. The string vars live in `./env` with the two rules that read them, so
// those rules stay testable without booting a Worker.
interface AuthBindings extends AuthEnv {
  DB: D1Database;
}

const authEnv = env as unknown as AuthBindings;

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

const cookieDomain = deriveCookieDomain(authEnv);

// Read at module scope on purpose: a missing secret outside local dev throws here, so
// the Worker fails on its first request rather than serving sessions signed with Better
// Auth's published development key. See ./env.ts for the rule and the escape hatch.
const secret = requireAuthSecret(authEnv);

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
  secret, // required outside local dev; `requireAuthSecret` already threw if it was missing
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // needs the `email` capability; auth deliberately doesn't depend on it
  },
  database: drizzleAdapter(getDb(authEnv.DB), { provider: "sqlite" }),
  advanced: cookieDomain
    ? { crossSubDomainCookies: { domain: cookieDomain, enabled: true } }
    : undefined,
  // Also the patch point for feature capabilities (`billing` pushing `stripe()`,
  // `teams` pushing `organization()`). Keep this an array literal (never omit it, never
  // hoist it to a named const) — `insertIntoPluginArray` needs a real array to push into.
  //
  // `admin()` is the one plugin auth ships with. It adds `user.role`/`banned`/`banReason`/
  // `banExpires` and `session.impersonatedBy` (mirrored in `@db/schema/auth.ts`), gives every
  // new user the default role `"user"`, and treats `"admin"` as the privileged role. It is on
  // by default so a session carries a role from the first sign-up: `apps/admin`'s guard reads
  // `session.user.role === "admin"`, and a role that only appears once some later module turns
  // it on would make that guard silently deny everyone.
  plugins: [admin()],
});
