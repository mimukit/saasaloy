import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { adminAc, defaultRoles } from "better-auth/plugins/admin/access";
import {
  ADMIN_APP_ROLES,
  ADMIN_AUDIENCE,
  ADMIN_ROLES,
  CLIENT_AUDIENCE,
  siteRoleMap,
} from "./authorize";
import type { Audience } from "./authorize";
import { authDb, provider } from "./db-provider";
import { cookiePrefixes, deriveCookieDomain, requireAuthSecret } from "./env";
import type { AuthEnv } from "./env";
import { audience } from "./plugins/audience";
import { adminAuthPlugins, authPlugins } from "./plugins.generated";
import { clientAdminGuard } from "./plugins/client-admin-guard";
import { rankGuard } from "./plugins/rank-guard";
import { scopeSessionsTo } from "./scoped-adapter";

// Secrets and string config this module reads. `cloudflare:workers`' importable `env`
// (not Hono's `c.env`) is used deliberately here — see the comment on `export const
// auth` below for why. The rules that read these vars live in `./env`, so they stay
// testable without booting a Worker.
//
// There is no database binding in this type, and there must not be one. The binding
// shape is the driver's business and lives in `./db-provider.ts`, which this module
// ships once per driver. That is what lets one `auth.ts` serve both.
const authEnv = env as unknown as AuthEnv;

// The browser origins allowed to call either instance: the same `CORS_ORIGINS` list
// `modules/api`'s `cors()` middleware reads, so the two never drift. There is no
// fallback list. The api env gate makes the key required, and in dev `pnpm dev:ports`
// writes it into `apps/api/.env.local`, so an empty list means a broken setup and every
// cross-origin call fails loudly rather than trusting a guessed origin.
function trustedOrigins(): string[] {
  return (
    authEnv.CORS_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []
  );
}

const cookieDomain = deriveCookieDomain(authEnv);

// `client` and `admin`, or `<AUTH_COOKIE_PREFIX>-client` and `-admin` in a linked worktree
// on an http dev URL. Read once at module scope, so a malformed prefix throws on the first
// request. See `cookiePrefixes` in ./env.ts.
const cookiePrefix = cookiePrefixes(authEnv);

// One rule for both instances: they share the `accounts` table, so a password set on one
// side has to pass on the other. Better Auth's default is 8.
const MIN_PASSWORD_LENGTH = 12;

// Read at module scope on purpose: a missing secret outside local dev throws here, so
// the Worker fails on its first request rather than serving sessions signed with Better
// Auth's published development key. See ./env.ts for the rule and the escape hatch.
const secret = requireAuthSecret(authEnv);

// Two instances, one per user group, on the same four tables. A project has clients (the
// shopper, the customer, the app user) and an admin group (`superadmin`, `admin`, and any
// role a project adds to `ADMIN_APP_ROLES`). Each group signs in on its own instance and
// holds its own cookie, so a client and an admin stay signed in together in two tabs of one
// browser, and neither session counts on the other side:
//
//   auth       client  basePath /auth         cookie client.session_token
//   adminAuth  admin   basePath /admin/auth   cookie admin.session_token
//
// In a linked worktree on an http dev URL, `AUTH_COOKIE_PREFIX` goes in front of both
// names (`wt5ddad8-client.session_token`), because a browser scopes cookies by host and
// not by port, and two worktrees on one host would otherwise overwrite each other's
// sessions. `pnpm dev:ports` writes the key; production never reads it.
//
// The cookie names alone separate an honest browser, because the browser sends both
// cookies to the api host and each instance reads only its own. The `audience` column
// separates a dishonest one: each instance writes its name into the session row, and its
// adapter finds a row only when the name matches (`./scoped-adapter.ts`). A token copied
// into the other cookie is no session at all. See ADR 0050.
//
// Everything the two have in common is in `sharedOptions`. Each `betterAuth({...})` call
// spreads it and then says what differs: the base path, sign-up, and its own `plugins`.
//
// Top-level singletons, not a per-request `c.env`-scoped factory (the convention every
// other capability follows). This is deliberate: each instance is one module-scope
// `export const` whose `plugins: [...]` spreads a generated table (`auth.plugins` or
// `adminAuth.plugins`, from `./plugins.generated.ts`), so `subscription`/`teams` add a
// plugin with no edit to this file. Workers'
// `cloudflare:workers` importable-env makes the string config and the secret above
// available at module scope, which is what makes this shape possible. A feature module
// adds a row to both tables, so both groups get the feature.
//
// The database is the one thing that is NOT module-scope, and the split is load-bearing.
// A Workers isolate outlives the request that created it while an open socket does not,
// so under `database-postgres` a client bound here serves the first request and throws
// "Cannot perform I/O on behalf of a different request" on the second. `authDb` is a
// proxy holding no client of its own; it reads the current request's out of an
// `AsyncLocalStorage` that `withAuthScope` enters. Every `handler` and `api.*` call on
// either instance therefore has to run inside that wrapper — `getSession(c)`
// from `./server.ts` and `apps/api/src/routes/auth.ts` already do. See `./db-scope.ts`,
// `./db-provider.ts` and ADR 0029.
function sharedOptions(group: Audience) {
  return {
    baseURL: authEnv.BETTER_AUTH_URL,
    secret, // required outside local dev; `requireAuthSecret` already threw if it was missing
    trustedOrigins: trustedOrigins(),
    // `usePlural` maps Better Auth's singular model names (`user`) to this project's plural
    // export keys (`users`). The adapter finds a table by its export key in the schema object
    // (`schema[model]`), never by its SQL name. Remove `usePlural`, or export a singular key,
    // and every auth call throws `The model "user" was not found in the schema object`; tsc
    // does not catch it. `usePlural` appends a plain `s`, to a custom `modelName` too, so a
    // plugin with `modelName: "X"` needs the export key `Xs`. See ADR 0038.
    //
    // `scopeSessionsTo` limits every session lookup by token to this instance's audience.
    database: scopeSessionsTo(
      drizzleAdapter(authDb, { provider, usePlural: true }),
      group
    ),
    // No database hook writes a role, and nothing promotes an account. Every sign-up gets
    // the `admin()` plugin's default `"user"`, the first one on an empty `users` table
    // included. Client sign-up is open, so a "first account wins superadmin" hook handed the
    // admin app to whoever reached /auth/sign-up first on a deployed api.
    //
    // The first superadmin comes from outside the api instead:
    //
    //   development       the seed (`@db/seed/users.ts`) writes one
    //   production        `pnpm db:prod:superadmin --email <address>`
    //
    // From then on a superadmin grants every other admin-group role on the admin app (`./plugins/rank-guard.ts`).
    advanced: {
      // Each instance names its own cookies, so the two sessions never overwrite each
      // other: `client.session_token` and `admin.session_token` (or the worktree-prefixed
      // pair from `cookiePrefixes`), with the `__Secure-` prefix on https.
      cookiePrefix: cookiePrefix[group],
      // The adapter's schema check is off, and it has to be. Better Auth 1.7.6 registers
      // `findDrizzleSchemaProblems(config.schema ?? db._?.fullSchema ?? {})` on every
      // adapter (`@better-auth/drizzle-adapter/dist/index.mjs`, and `checksSchema` in
      // `@better-auth/core/dist/db/schema-check.mjs` is the switch). Neither source can
      // answer here. `authDb` is a request-scoped proxy holding no client of its own, so
      // `db._` is not a schema registry, and the check falls back to `{}` — which reads as
      // "tables users, sessions, accounts, verifications are missing" and turns EVERY
      // `auth.api.*` call, sign-up included, into a 500.
      //
      // Passing `config.schema` instead would fix the read and break the composition: the
      // expected set grows with the plugin array, so `subscription-stripe` pushing `stripe()`
      // would need the `subscription` model in that object too, and every later plugin
      // another table. A capability module would then have to patch this file to add a
      // table name, which is exactly the coupling the generated `auth.plugins` table exists
      // to avoid.
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
  };
}

// The `admin()` plugin, configured once for both instances.
//
// It adds `user.role`/`banned`/`banReason`/`banExpires` and `session.impersonatedBy`
// (mirrored in `@db/schema/auth.ts`), gives every new user the default role `"user"`, and
// refuses a banned account at sign-in. Both instances need those three jobs. Its `/admin/*`
// endpoints answer only on `adminAuth`: `clientAdminGuard()` refuses them on `auth`.
//
// `adminRoles` names both site roles, so the plugin's own endpoints (`listUsers`,
// `setRole`, `banUser`) admit a `superadmin` as well as an `admin`. Leaving it at the
// default `["admin"]` would let `requireAdmin` pass a `superadmin` that the plugin then
// refused, which is the one disagreement the pair must not have. The list comes from
// `./authorize.ts`, so the gate and the plugin read one source.
//
// `roles` has to name both site-admin roles, by the strings `config.auth` holds. The
// plugin checks every entry of `adminRoles` against the keys of `roles` and throws
// `Invalid admin roles: <role>` while the Worker initializes when one is missing, and it
// grants a role its permissions by that key. `siteRoleMap` in `./authorize.ts` keys
// `adminAc` by `ADMIN_ROLE` and `SUPERADMIN_ROLE`, so a role renamed in `project.ts`
// keeps the admin statements; the two roles differ in rank, not in what they may do to a
// client. The rank
// itself is `./plugins/rank-guard.ts`'s job, and the organization-level split is
// `packages/auth/src/access.ts`'s.
function siteRoles() {
  return admin({
    adminRoles: [...ADMIN_ROLES],
    roles: siteRoleMap({ admin: adminAc, user: defaultRoles.user }),
  });
}

// The client instance: every account signs up and signs in here, at `/auth`.
export const auth = betterAuth({
  ...sharedOptions(CLIENT_AUDIENCE),
  basePath: "/auth",
  emailAndPassword: {
    enabled: true,
    // The sign-up card in `@repo/ui/blocks/auth` says "At least 12 characters", and this
    // is the check behind it. Better Auth applies it on sign-up, reset and change, never
    // on sign-in, so an account with an older, shorter password still signs in.
    minPasswordLength: MIN_PASSWORD_LENGTH,
    requireEmailVerification: false, // needs the `email` capability; auth deliberately doesn't depend on it
    // No `sendResetPassword` here. With `email` installed, `resetPasswordMail()` in the
    // array below sets it; without `email`, a reset request answers 400.
  },
  // The plugins this module ships, then `authPlugins` from `./plugins.generated.ts`, which
  // the CLI writes on every run: `teams` adds `organizationPlugin()`, `auth-phone` adds
  // `phoneNumberPlugin()`. A plugin of your own goes after the spread. A feature module
  // adds its plugin to `adminAuthPlugins` below as well.
  //
  // `audience(...)` comes first, so the session it writes carries its name before any other
  // plugin reads the row.
  plugins: [
    audience(CLIENT_AUDIENCE),
    siteRoles(),
    clientAdminGuard(),
    ...authPlugins,
  ],
});

// The admin instance: the admin group signs in here, at `/admin/auth`, from `apps/admin`.
// There is no sign-up: an admin account is a client account that a superadmin promoted.
// `audience` refuses to open a session for a user outside `ADMIN_APP_ROLES`, with the same
// answer a wrong password gets.
export const adminAuth = betterAuth({
  ...sharedOptions(ADMIN_AUDIENCE),
  basePath: "/admin/auth",
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    requireEmailVerification: false,
  },
  // The same rules as `auth`'s: the shipped plugins, then `adminAuthPlugins` from
  // `./plugins.generated.ts`, then your own.
  plugins: [
    audience(ADMIN_AUDIENCE, { roles: ADMIN_APP_ROLES }),
    siteRoles(),
    rankGuard(),
    ...adminAuthPlugins,
  ],
});
