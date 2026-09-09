import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { user as userTable } from "@repo/db/schema/auth";
import { ADMIN_ROLES, SUPERADMIN_ROLE } from "./authorize";
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
  // First user wins, and it wins `superadmin`. This is the ONLY automatic role promotion
  // in the system, and it fires at most once per project: the hook reads the `user` table
  // before the row is written, so it can only match on the very first sign-up. Without it
  // a fresh `saasaloy add admin` scaffolds an admin app that denies every account, and the
  // only way in is the `update user set role` SQL in the auth skill.
  //
  // `superadmin` rather than `admin` because the first account has to be able to grant the
  // rest, and `superadmin` is the only role that crosses an organization boundary. A later
  // `admin` is granted through `client.admin.setRole`.
  //
  // WARNING — sign-up is open. Any account that reaches /signup before you do becomes
  // the superadmin, and on a deployed api with a public origin that window is real. Sign
  // up yourself as soon as the api answers, and check with
  // `select email, role from user`. The auth skill carries the recovery SQL for when
  // somebody else got there first, and `client.admin.setRole` promotes the rest once one
  // superadmin exists.
  //
  // Two first sign-ups that land at the same instant both read an empty table and both
  // become superadmin. That is accepted, not engineered away: a unique index on
  // `role = 'superadmin'` would also block a deliberate second one.
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
          return { data: { ...newUser, role: SUPERADMIN_ROLE } };
        },
      },
    },
  },
  advanced: {
    // The adapter's schema check is off, and it has to be. Better Auth 1.7.3 registers
    // `findDrizzleSchemaProblems(config.schema ?? db._?.fullSchema ?? {})` on every
    // adapter (`@better-auth/drizzle-adapter/dist/index.mjs`, and `checksSchema` in
    // `@better-auth/core/dist/db/schema-check.mjs` is the switch). Neither source can
    // answer here. `authDb` is a request-scoped proxy holding no client of its own, so
    // `db._` is not a schema registry, and the check falls back to `{}` — which reads as
    // "tables user, session, account, verification are missing" and turns EVERY
    // `auth.api.*` call, sign-up included, into a 500.
    //
    // Passing `config.schema` instead would fix the read and break the composition: the
    // expected set grows with the plugin array, so `billing-stripe` pushing `stripe()`
    // would need the `subscription` model in that object too, and every later plugin
    // another table. A capability module would then have to patch this file to add a
    // table name, which is exactly the coupling the plugin-array patch point exists to
    // avoid.
    //
    // Nothing is lost that the project does not already have. The tables come from
    // `@db/schema/auth.ts`, which this module ships and `saasaloy` owns, and drizzle-kit
    // generates the migrations from those same declarations — so a drift the check would
    // report is a drift `pnpm db:generate` already reports first.
    database: { validateSchema: false },
    ...(cookieDomain
      ? { crossSubDomainCookies: { domain: cookieDomain, enabled: true } }
      : {}),
  },
  // Also the patch point for feature capabilities (`billing` pushing `stripe()`,
  // `teams` pushing `organization()`). Keep this an array literal (never omit it, never
  // hoist it to a named const) — `insertIntoPluginArray` needs a real array to push into.
  //
  // `admin()` is the one plugin auth ships with. It adds `user.role`/`banned`/`banReason`/
  // `banExpires` and `session.impersonatedBy` (mirrored in `@db/schema/auth.ts`), gives every
  // new user the default role `"user"`, and treats the roles in `adminRoles` as privileged.
  // It is on by default so a session carries a role from the first sign-up: `apps/admin`'s
  // guard reads `user.role` against the same two strings, and a role that only appears once
  // some later module turns it on would make that guard silently deny everyone.
  //
  // `adminRoles` names both site roles, so the plugin's own endpoints (`listUsers`,
  // `setRole`, `banUser`, `impersonateUser`) admit a `superadmin` as well as an `admin`.
  // Leaving it at the default `["admin"]` would let `requireAdmin` pass a `superadmin`
  // that the plugin then refused, which is the one disagreement the pair must not have.
  // The list comes from `./authorize.ts`, so the gate and the plugin read one source.
  plugins: [admin({ adminRoles: [...ADMIN_ROLES] })],
});
