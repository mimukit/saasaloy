import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { user as userTable } from "@repo/db/schema/auth";
import { ADMIN_ROLE } from "./authorize";
import { authDb, provider } from "./db-provider";
import { deriveCookieDomain, requireAuthSecret } from "./env";
import type { AuthEnv } from "./env";

// Secrets and string config this module reads. `cloudflare:workers`' importable `env`
// (not Hono's `c.env`) is used deliberately here — see the comment on `export const
// auth` below for why. The rules that read these vars live in `./env`, so they stay
// testable without booting a Worker.
//
// There is no database binding in this type, and there must not be one. The binding
// shape is the driver's business and lives in `./db-provider.ts`, which this module
// ships once per driver. That is what lets one `auth.ts` serve both.
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

const cookieDomain = deriveCookieDomain(authEnv);

// Read at module scope on purpose: a missing secret outside local dev throws here, so
// the Worker fails on its first request rather than serving sessions signed with Better
// Auth's published development key. See ./env.ts for the rule and the escape hatch.
const secret = requireAuthSecret(authEnv);

// Is the `user` table still empty? A one-row `select` rather than a `count(*)`, because
// the only question is existence and the driver stops at the first row.
//
// Reads through `authDb`, the same request-scoped proxy the adapter below takes, not a
// module-scope client. This runs inside the `create.before` hook, which Better Auth only
// reaches from an `auth.api.*` or `auth.handler` call, and every one of those already
// runs inside `withAuthScope`. A client bound at module scope would serve the first
// request and throw on the second under `database-postgres`.
async function noUsersYet(): Promise<boolean> {
  const rows = await authDb
    .select({ id: userTable.id })
    .from(userTable)
    .limit(1);
  return rows.length === 0;
}

// Top-level singleton, not a per-request `c.env`-scoped factory (the convention every
// other capability follows). This is deliberate: the Better Auth plugin-array patch
// point (`{ exportName: "auth", arrayProp: "plugins" }` — see
// packages/cli/src/lib/patch/ts-module.ts) must be a module-scope `export const` for
// `billing`/`teams` to patch `plugins: [...]` with zero codemod changes. Workers'
// `cloudflare:workers` importable-env makes the string config and the secret above
// available at module scope, which is what makes this shape possible.
//
// The database is the one thing that is NOT module-scope, and the split is load-bearing.
// A Workers isolate outlives the request that created it while an open socket does not,
// so under `database-postgres` a client bound here serves the first request and throws
// "Cannot perform I/O on behalf of a different request" on the second. `authDb` is a
// proxy holding no client of its own; it reads the current request's out of an
// `AsyncLocalStorage` that `withAuthScope` enters. Every `auth.handler` and `auth.api.*`
// call therefore has to run inside that wrapper, on both drivers — `getSession(c)` from
// `./server.ts` and `apps/api/src/routes/auth.ts` already do. See `./db-scope.ts`,
// `./db-provider.ts` and ADR 0029.
export const auth = betterAuth({
  basePath: "/auth",
  baseURL: authEnv.BETTER_AUTH_URL,
  secret, // required outside local dev; `requireAuthSecret` already threw if it was missing
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // needs the `email` capability; auth deliberately doesn't depend on it
  },
  database: drizzleAdapter(authDb, { provider }),
  // First user wins. This is the ONLY automatic role promotion in the system, and it
  // fires at most once per project: the hook reads the `user` table before the row is
  // written, so it can only match on the very first sign-up. Without it a fresh
  // `saasaloy add admin` scaffolds an admin app that denies every account, and the only
  // way in is the `update user set role` SQL in the auth skill.
  //
  // WARNING — sign-up is open. Any account that reaches /signup before you do becomes
  // the admin, and on a deployed api with a public origin that window is real. Sign up
  // yourself as soon as the api answers, and check with
  // `select email, role from user`. The auth skill carries the recovery SQL for when
  // somebody else got there first, and `client.admin.setRole` promotes the rest once one
  // admin exists.
  //
  // Two first sign-ups that land at the same instant both read an empty table and both
  // become admin. That is accepted, not engineered away: a unique index on
  // `role = 'admin'` would also block the legitimate promotion of a second admin.
  databaseHooks: {
    user: {
      create: {
        // Returning `{ data }` replaces the row being written; returning nothing leaves
        // it alone, so the `admin()` plugin's own hook — which runs first and writes the
        // default `"user"` — stands. The two are merged in registration order, which is
        // why this one wins when it does answer.
        before: async (newUser) => {
          if (!(await noUsersYet())) {
            return;
          }
          return { data: { ...newUser, role: ADMIN_ROLE } };
        },
      },
    },
  },
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
