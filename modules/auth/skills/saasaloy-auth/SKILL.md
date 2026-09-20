---
name: saasaloy-auth
description: Runbook for the auth capability — Better Auth with httpOnly session cookies in packages/auth, as two instances on one set of tables (the client session at /auth and the admin session at /admin/auth). Use when wiring sign-up/sign-in, gating an api route with requireSession/requireRole/requireAdmin/requireAdminApp or reading one with getSession/authFor, choosing which session a route reads with x-auth-audience, adding a role such as support to the admin group, promoting the first superadmin or checking a user's role, signing in as a seed user with the dev password, re-verifying the schema snapshot after a better-auth bump, enabling social OAuth or email verification, patching the plugin arrays (billing/teams), upgrading a project made before the client/admin split, rotating the auth secret, debugging cookie/CORS/session issues, or working out why a call throws about a database client read outside `withAuthScope`.
---

# auth — Better Auth, httpOnly cookies + subdomains

`packages/auth` (`@repo/auth`) owns [Better Auth](https://better-auth.com) outright (ADR 0020), and no other workspace depends on `better-auth` directly. `apps/api` gets a thin `routes/auth.ts` that forwards to the two instances' handlers; `packages/db` gets a hand-authored schema snapshot. Sessions are **DB-backed httpOnly cookies**, not JWTs (build-spec §2.5 / ADR 0004): one database read per request is negligible, and sessions are instantly revocable by deleting the row.

## Two instances: the client session and the admin session

A project has two user groups. The **client** group is the shopper, the customer, the app user, and its only site role is `user`. The **admin** group is every role in `ADMIN_APP_ROLES` (`superadmin` and `admin` ship). Each group signs in on its own Better Auth instance, both built in `packages/auth/src/auth.ts` on the same four tables:

| Export | Group | `basePath` | Cookie | Sign-up |
|---|---|---|---|---|
| `auth` | client | `/auth` | `client.session_token` | open |
| `adminAuth` | admin | `/admin/auth` | `admin.session_token` | none (`disableSignUp: true`) |

In production both cookies carry the `__Secure-` prefix. `advanced.cookiePrefix` sets the name, so a client and an admin stay signed in together in two tabs of one browser, and a sign-out in one tab leaves the other signed in. The decision record is [ADR 0050](../../../../docs/adr/0050-adr-client-and-admin-sessions-are-two-auth-instances-2026-10-23.md).

Everything the two share (the adapter, the secret, `trustedOrigins`, the first-user hook, `advanced`) lives in `sharedOptions(group)`. Each `betterAuth({...})` spreads it and keeps its own literal `plugins: [...]`.

**The audience column keeps the two apart.** `sessions.audience` is `client` or `admin`, not null, default `'client'`, in both driver schemas. The `audience(name)` plugin in `packages/auth/src/plugins/audience.ts` declares the field with `input: false` (no endpoint can set it) and writes the instance's name into every new row. Each instance wraps its `drizzleAdapter` in `scopeSessionsTo(adapter, group)` from `packages/auth/src/scoped-adapter.ts`, so a session lookup by token finds only rows of its own audience. A token copied into the other cookie is no session at all: every endpoint, middleware and `api.*` call on that instance sees `null`. `decide()` in `authorize.ts` checks the audience a second time behind the adapter.

**`adminAuth` refuses a user outside the admin group.** The admin instance registers `audience("admin", { roles: ADMIN_APP_ROLES })`, whose `session.create.before` hook refuses to open a session for a user whose role is not in the list. The answer is Better Auth's own `INVALID_EMAIL_OR_PASSWORD` ("Invalid email or password"), so the admin login tells an attacker nothing about which addresses hold an account. The `accounts` table is shared, so an admin signs in on the admin app with the same email and password the account uses on the client side.

**The client instance refuses every admin endpoint.** Both instances keep the `admin()` plugin, because it writes the default `"user"` role, types `user.role` and refuses a banned account at sign-in. On `auth`, `clientAdminGuard()` (`packages/auth/src/plugins/client-admin-guard.ts`) answers 403 `ADMIN_SESSION_REQUIRED` on every `/auth/admin/*` path. It matches the path prefix, so an endpoint a Better Auth bump adds is refused too. The same endpoints answer on `/admin/auth/admin/*`, behind the admin session and the rank guard below.

**`/admin/auth/*` is reserved.** The `auth` module mounts `adminAuthRoute` at `/admin/auth` with a second `chained-route` patch on `base`, beside `authRoute` at `/auth`. The path sits under `/admin` so one edge rule (WAF, Access, a log filter) covers the whole admin group on the api. A middleware a project adds on `/admin/*` must skip `/admin/auth/*`, or the sign-in endpoint itself demands a session. A project without the `admin` module still has the `/admin/auth` route; nothing calls it.

## Either database driver

This module installs against `database-d1` or `database-postgres`, and picks the right files for
whichever one the project holds. It depends on `api` and `database`, and names no driver:
`database`'s own `requiresOneOf` is what guarantees one is present.

Two files ship twice, and nothing else does:

| Source in the module | Installs when | What differs |
|---|---|---|
| `files/db/schema/auth.sqlite.ts` | `onlyWith: "database-d1"` | `sqliteTable`, `drizzle-orm/sqlite-core`, millisecond-integer dates |
| `files/db/schema/auth.pg.ts` | `onlyWith: "database-postgres"` | `pgTable`, `drizzle-orm/pg-core`, `timestamptz` dates, `boolean` flags |
| `files/src/db-provider.d1.ts` | `onlyWith: "database-d1"` | `provider: "sqlite"`, and `withAuthScope` runs the body |
| `files/src/db-provider.pg.ts` | `onlyWith: "database-postgres"` | `provider: "pg"`, and `withAuthScope` wraps `withDb` |

Each pair names one `target` — `packages/db/src/schema/auth.ts` and
`packages/auth/src/db-provider.ts` — so exactly one of the two lands and the other is filtered out
before the plan is built. `saasaloy add auth --dry-run` prints which source it chose.

`auth.ts`, `env.ts`, `server.ts`, `client.ts` and `apps/api/src/routes/auth.ts` are single files
under both drivers. The dialect reaches the table declarations and the four lines of
`db-provider.ts`, and stops there.

The two schema variants are the same four tables, so keep them in step. They differ only where each
dialect is idiomatic. A row comes back the same shape either way.

**Switching driver is remove-then-add, and it takes this module with it.** The unchosen variant is
filtered before planning, so a project that swaps drivers keeps the schema it already installed.
Remove `auth` and add it again after the driver switch to get the other variant. There is no data
migration; see ADR 0026.

## The database client is request-scoped

`auth` and `adminAuth` are module-scope singletons whose database client belongs to a single request. That split is the one thing to understand before writing a call against `auth.api.*` or `adminAuth.api.*`.

Why it exists: a Workers isolate outlives the request that created it, but an open socket does not.
Under `database-postgres`, a client bound once at module scope serves the first request and then
throws `Cannot perform I/O on behalf of a different request` on the second. A single manual sign-in
does not catch it; it takes two requests into one worker.

How it works: `drizzleAdapter` is handed `authDb`, a proxy holding no client of its own. It reads
the current request's client out of an `AsyncLocalStorage` in `packages/auth/src/db-scope.ts`.
`withAuthScope(c, fn)` in `packages/auth/src/db-provider.ts` is what puts it there — under
Postgres by wrapping the driver's `withDb`, which also closes the socket on
`c.executionCtx.waitUntil`; under D1 by opening a binding stub and running the body.

**The adapter runs with `usePlural: true`.** Better Auth asks for singular models (`user`, `session`), and the tables here are plural (`users`, `sessions`). The Drizzle adapter finds a table by its export key in the schema object, never by its SQL name, and `usePlural` appends an `s` to every model name, a custom `modelName` included. Keep the flag and the plural export keys together: remove one and every auth call throws `The model "user" was not found in the schema object`, which `pnpm typecheck` does not catch. A plugin with `modelName: "X"` needs the export key `Xs`. The naming rule is in the `saasaloy-database` skill under `## Table names`, and ADR 0038 records it.

**Every `handler` and `api.*` call on either instance runs inside `withAuthScope`.** `apps/api/src/routes/auth.ts` already wraps both handlers, and `getSession(c)` and the gates already wrap their own reads, so ordinary use needs nothing. Reach for the wrapper by hand only when calling an instance yourself:

```ts
import { adminAuth, withAuthScope } from "@repo/auth/server";

const users = await withAuthScope(c, () => adminAuth.api.listUsers({ query: {}, headers: c.req.raw.headers }));
```

Forget it and the read throws with a message naming `withAuthScope` — **on both drivers**, D1
included. That is deliberate. D1 is the default driver, so most development happens there, and a
permissive D1 path would let the mistake pass every local test and surface only after a project
switched to Postgres. The cost on D1 is one property lookup per call. See ADR 0029.

## The plugin-array patch points (read this before adding billing/teams)

`packages/auth/src/auth.ts` exports two **module-scope singletons**, each with its own literal plugin array:

```ts
export const auth = betterAuth({
  ...sharedOptions(CLIENT_AUDIENCE),
  basePath: "/auth",
  // ...
  plugins: [audience(CLIENT_AUDIENCE), siteRoles(), clientAdminGuard()],
});

export const adminAuth = betterAuth({
  ...sharedOptions(ADMIN_AUDIENCE),
  basePath: "/admin/auth",
  // ...
  plugins: [audience(ADMIN_AUDIENCE, { roles: ADMIN_APP_ROLES }), siteRoles(), rankGuard()],
});
```

This is deliberately a top-level `export const`, not a per-request `c.env`-scoped factory (every other capability's convention): the plugin arrays must exist at module scope for the codemod to patch. Keep `audience(...)` first in each array, so the session row carries its audience before any other plugin reads it.

**A feature module that adds a Better Auth plugin patches both instances.** The admin app hosts every self-service screen (teams, roles, keys, billing), so the admin session needs the same feature plugins as the client session. `teams`, `rbac`, `api-keys` and `billing-stripe` each declare one `plugin-array` patch with `"exportName": "auth"` and a second with `"exportName": "adminAuth"`:

```json
"patches": [
  { "file": "packages/auth/src/auth.ts", "kind": "plugin-array", "exportName": "auth", "arrayProp": "plugins", "call": "stripe", "import": { "name": "stripe", "from": "@better-auth/stripe" } },
  { "file": "packages/auth/src/auth.ts", "kind": "plugin-array", "exportName": "adminAuth", "arrayProp": "plugins", "call": "stripe", "import": { "name": "stripe", "from": "@better-auth/stripe" } }
]
```

A module that ships a client plugin does the same in `packages/auth/src/client.ts`, once for `authClientPlugins` and once for `adminAuthClientPlugins`.

The existing codemod (`packages/cli/src/lib/patch/ts-module.ts`) inserts the call into each array and adds the import once. It is idempotent and formatting-preserving, and it finds `plugins` next to the `...sharedOptions(...)` spread. When the named export does not exist (a project whose `auth.ts` predates `adminAuth`), the patch is a refusal, not a silent no-op: `saasaloy add` and `saasaloy update` print a warning that names the missing export, and `update` keeps the module's lock entry so a later `update` retries it. See "Upgrading a project made before the client/admin split" below.

The plugin's own vendor dep (`@better-auth/stripe`) merges into `packages/auth/package.json` (ADR 0020: vendor plugin deps land in the capability that owns the vendor package), never into the feature's own files.

## Env checklist (`add auth` prints this)

| Var | What | Prod | Local |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Signs sessions | **Required** — generate a real secret | Optional, but only when `BETTER_AUTH_URL` is a loopback origin |
| `BETTER_AUTH_URL` | The API's own origin | `https://api.x.com` | `http://localhost:4000` (the api Worker's pinned dev port) — **set it**, it is what opens the keyless path |
| `COOKIE_DOMAIN` | Explicit cookie domain | `.x.com` (cross-subdomain) | Leave unset (host-only) |

### The secret fails closed

`packages/auth/src/env.ts` reads `BETTER_AUTH_SECRET` at module load and **throws** when it is
unset. Better Auth's fallback key is published in its own source, so a Worker signing sessions with
it accepts a cookie anyone can forge, and the only signal is one console warning printed on a cold
start. Throwing takes the Worker down on its first request instead.

The one way out is narrow and explicit: `BETTER_AUTH_URL` must name a loopback host (`localhost`,
`127.0.0.1`, `[::1]`). The match is exact, so `localhost.attacker.example` and `127.0.0.1.nip.io`
do not open it. An **unset** `BETTER_AUTH_URL` does not open it either — a production Worker whose
secrets were never set looks exactly like that, which is the case this rule exists to catch.

So local dev is keyless but not configless: `BETTER_AUTH_URL=http://localhost:4000` is the
local default in `packages/env/.env.example`, `pnpm env:setup` writes it into `apps/api/.env`,
and `wrangler dev` then runs with no secret. Everywhere else,
set the secret with `wrangler secret put BETTER_AUTH_SECRET`.

Misconfigured prod fails **visibly** rather than silently: an origin missing from
`CORS_ORIGINS` gets no `Access-Control-Allow-Origin` header, so the browser refuses to hand the
response to the page, and Better Auth's `trustedOrigins` (fed from the same var) additionally
answers `403 INVALID_ORIGIN` on state-changing calls. Two independent layers — see below.

### The cookie-domain rule

1. `COOKIE_DOMAIN` set → used verbatim, `advanced.crossSubDomainCookies.enabled: true`.
2. Unset, `BETTER_AUTH_URL` host is a loopback host (`localhost`/`127.0.0.1`/`[::1]`) → host-only
   cookie (no `Domain` attr).
3. Unset, host starts `api.` **and the remainder still contains a dot** → strips to the apex
   (`api.x.com` → `.x.com`), cross-subdomain. A host like `api.dev`, whose apex would strip to a
   bare TLD, falls through to rule 4 instead — browsers reject a TLD-only cookie domain outright.
4. Unset, anything else → **host-only** (conservative — never guess a domain shape that isn't one
   of the two recognized shapes; a wrong guess breaks login silently, host-only always works).

## CORS lives in `api`, not here

`auth`'s `trustedOrigins` reads the **same** `CORS_ORIGINS` env var as `modules/api`'s `cors()`
middleware — one origin list, two readers, no drift. If a credentialed cross-origin call is
failing, check `CORS_ORIGINS` on the api Worker first; auth carries zero CORS code of its own.

The two readers enforce different things, and it's worth not confusing them:

| Layer | Who enforces | What an unlisted origin gets |
|---|---|---|
| `cors()` in api's spine | the **browser** | The Worker still runs the handler and returns a body; it just omits `Access-Control-Allow-Origin`, so the browser won't let the calling page read the response. A non-browser client (`curl`) sees the body regardless. |
| `trustedOrigins` in Better Auth | the **server** | State-changing auth calls are rejected outright with `403 INVALID_ORIGIN` (and `403 MISSING_OR_NULL_ORIGIN` when the header is absent) — before any session work happens. |

So CORS is a read gate, not a request gate. When you need a request genuinely refused rather than
merely unreadable, that's `trustedOrigins` or an explicit origin check — don't rely on the CORS
headers to prove it.

## Protect a route: the gates, never `better-auth` directly

`@repo/auth/server` exports two reads, one instance picker and five gates. The reads answer *who*; the gates answer *whether they may act*. Each one reads a fixed session or the session the request names:

| Helper | Session it reads | Returns | Throws |
|---|---|---|---|
| `getSession(c)` | the one `x-auth-audience` names | the session, or `null` | 400 for an unknown header value |
| `getAdminSession(c)` | always the admin session | the session, or `null` | never |
| `authFor(c)` | the one `x-auth-audience` names | the instance, `auth` or `adminAuth` | 400 for an unknown header value |
| `requireSession(c)` | the one `x-auth-audience` names | the session | `HTTPException(401, "sign in first")` |
| `requireRole(c, role)` | always the admin session | the session | 401 as above, then `HTTPException(403, "role required: <role>")` |
| `requireAdmin(c)` | always the admin session | the session | as `requireRole(c, ADMIN_ROLES)` |
| `requireAdminApp(c)` | always the admin session | the session | as `requireRole(c, ADMIN_APP_ROLES)` |
| `requireSuperadmin(c)` | always the admin session | the session | as `requireRole(c, "superadmin")` |

**The `x-auth-audience` header picks the session for the generic helpers.** Its values are `client` and `admin`. No header means `client`. Any other value, the empty string included, gets 400 `x-auth-audience must be "client" or "admin"` rather than a quiet fallback to the client session. The admin app's `api` client sends `x-auth-audience: admin` on every request, so a teams or billing screen there reads the admin who is signed in, not a client signed in on another tab. The header picks between the caller's own two cookies, so it grants nothing. Hono's `cors()` with no `allowHeaders` echoes the preflight's headers, so CORS needs no change for it.

**The role gates ignore the header.** `requireRole`, `requireAdmin`, `requireAdminApp` and `requireSuperadmin` read `adminAuth` through `getAdminSession`, whatever the request says. Every site role lives in the admin group, so a client session never passes a role gate, even one that belongs to a `superadmin`. A request with only a client cookie gets 401 from them, not 403.

**A route that calls Better Auth itself uses `authFor(c)`.** `authFor(c).api.getActiveMember({ headers })` reads the session the request names, so the same route serves the client app and the admin app. Calling `auth.api.*` directly reads only the client session, which is the bug `billing`, `entitlements` and `multitenant` had before the split. Wrap the call in `withAuthScope` as above.

All of them take the whole Hono context, not `c.req.raw`. They need `c.env` to open this request's database client and `c.executionCtx` to close it, and they enter `withAuthScope` for you. See "Either database driver" below.

Reach for a gate first. A route that reads `getSession` and branches by hand is writing the same two error bodies again, and one typo in either is a hole.

```ts
// apps/api/src/routes/widgets.ts
import { Hono } from "hono";
import { requireAdmin } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";

export const widgets = new Hono<{ Bindings: AuthDbBindings }>().get("/", async (c) => {
  const session = await requireAdmin(c);
  return c.json({ userId: session.user.id }, 200);
});
```

There is no `if` and no error body in that route, and that is the point. The gates throw a Hono `HTTPException`, `apps/api`'s `onError` catches it, and `ERROR_CODES` renders it as the one envelope the api publishes: `{ "error": { "code": "forbidden", "message": "role required: admin" } }` on a 403, `"unauthorized"` on a 401. Write the check by hand and you own that shape yourself, in every route, forever.

Each gate returns the session, so the caller reads `session.user.id` without a second round trip. `requireRole` takes any string, and it also takes an array to demand any one of several roles. `requireAdmin` uses that form against the exported `ADMIN_ROLES` and `requireAdminApp` against `ADMIN_APP_ROLES`, so `admin` and `superadmin` pass both today, and `requireSuperadmin` demands `superadmin` exactly. Every comparison is `===`, so `"Admin"` and `"administrator"` are not admins. Pick `requireAdmin` for admin-only work and `requireAdminApp` for a route every admin-app user may call; "Two role lists" below says why the two differ.

`AuthDbBindings` is whichever binding shape the installed driver declares, so this route is one file under both drivers.

**One role per user is the contract here, and it is narrower than better-auth's.** The plugin reads `user.role` as a comma-separated list (`has-permission.mjs` splits it on `,`), so a row holding `"admin,support"` is an admin to `adminAuth.api.listUsers` and gets a 403 from `requireAdmin`. `apps/admin`'s browser guard compares with `===` too, so both halves of the gate agree with each other and both refuse the joined string. Nothing a scaffolded project writes produces one: the first-user hook writes `"superadmin"`, and `auth.admin.setRole({ userId, role: "admin" })` on the admin client writes one value. If you want stacked roles, change `hasRole` in `packages/auth/src/authorize.ts` and `isAdmin` in `apps/admin/src/lib/auth.ts` together, never one alone.

Keep `getSession` for the case it was written for: a route whose answer *changes* for a signed-in caller but is still served to an anonymous one. A public page that shows a "you already voted" badge reads the session; it does not gate on it.

```ts
const session = await getSession(c);
return c.json({ voted: session ? await hasVoted(session.user.id) : false }, 200);
```

If you do hand-write a deny, write the body out rather than importing a helper: `auth` depends on `api` and `database` only, so `@repo/validators` may not resolve. In a project that has it, `errorBody("unauthorized", "sign in first")` from `@repo/validators/common` produces the identical shape.

Every helper wraps `getSession({ headers })` on the instance it reads, so both httpOnly cookies ride along on `c.req.raw` automatically and the instance reads only its own. No route imports `better-auth` (ADR 0020); everything goes through `@repo/auth/server`.

Note the route shape: one named `export const`, one chained expression, an explicit status on every `c.json`. That is what `hc<AppType>` reads. Register it with a `chained-route` patch on the exported chain (`"exportName": "default"`), never by dropping the file and hoping (ADR 0028). `modules/admin`'s `GET /admin/users` is the worked example of a gated route registered that way.

**The gate is the api's, not the browser's.** `apps/admin` also refuses an account outside `ADMIN_APP_ROLES`, in `beforeLoad`. That guard stops the SPA from asking; it cannot stop `curl`. A route that skips `requireAdmin` because the admin app already checks is open to anyone holding any session cookie.

## Roles and the first user

Better Auth's `admin` plugin is on from the start, on both instances (`siteRoles()` in `auth.ts`). It gives `user` a `role` column, writes `"user"` into it for every new sign-up (except the first one, see below), refuses a banned account at sign-in, and treats the roles in `adminRoles` as privileged. Its `/admin/*` endpoints answer only on `adminAuth`.

**Both role strings live in `packages/config/src/sections/auth.ts`, which this module installs, and they have exactly one home.** `packages/auth/src/authorize.ts` reads `config.auth.adminRole` and `config.auth.superadminRole`, and `apps/admin/src/lib/auth.ts` reads the same two — a browser bundle cannot import `@repo/auth/server`, but `@repo/config` has no dependencies at all, so both sides read one copy. Rename either role in `packages/config/src/project.ts`; rows already written keep the old string, so an existing project needs the `update users set role = ...` to match.

There are two site roles, and they are not interchangeable. `admin` runs `apps/admin` for the client accounts. `superadmin` does everything `admin` does, owns the admin group (see "Rank" below), and is the only role that may act inside an organization it does not belong to, through the `x-organization-id` header the `multitenant` module reads. That bypass needs the superadmin signed in on the admin session; a superadmin's client session gets the ordinary 403. Inside an organization an `admin` is an ordinary member: the site role grants nothing on a tenant route, which asks `requireTenant` and reads the caller's membership instead.

`adminRoles` names both, so the plugin's own endpoints admit a `superadmin` as well as an `admin`. Leaving it at the default `["admin"]` would let `requireAdmin` pass a caller the plugin then refused.

### Two role lists

`packages/auth/src/authorize.ts` exports two lists, and they answer different questions:

| List | Question | Gate | Ships with |
|---|---|---|---|
| `ADMIN_APP_ROLES` | Who is in the admin group: who may sign in on the admin session and open `apps/admin`? | `requireAdminApp` | `admin`, `superadmin` |
| `ADMIN_ROLES` | Who may do admin-only work? | `requireAdmin` | `admin`, `superadmin` |

They hold the same roles today and stay separate on purpose. `adminAuth`'s sign-in hook and the rank guard read `ADMIN_APP_ROLES`; the `admin()` plugin's `adminRoles` reads `ADMIN_ROLES`. `apps/admin/src/lib/auth.ts` keeps a browser copy of `ADMIN_APP_ROLES`, because a bundle cannot import from `@repo/auth/server`, and its guard reads that copy:

```ts
const { data } = await auth.getSession();
if (!ADMIN_APP_ROLES.some((role) => data?.user.role === role)) { /* denied */ }
```

`role` is typed on the admin client because `adminAuthClientPlugins` in `packages/auth/src/client.ts` holds `adminClient()`, the client half of the server plugin. Keep the pair: drop the client half and `session.user.role` goes back to being an unchecked cast.

### Adding a `support` role to the admin group

A support agent who may sign in on the admin app but may not run admin-only routes is one role added to the group list only:

1. In `packages/auth/src/authorize.ts`, add `"support"` to `ADMIN_APP_ROLES`. Leave `ADMIN_ROLES` alone.
2. In `apps/admin/src/lib/auth.ts`, add `"support"` to the browser copy of `ADMIN_APP_ROLES`. The two lists must agree, or the SPA and the api disagree about who gets in.
3. If support should reach an `admin()` plugin endpoint (for example `list-users`), give it a statement set in `siteRoles()` in `packages/auth/src/auth.ts`. Without one, the plugin refuses every `/admin/*` call from support. Do not add `support` to `adminRoles`, which would give it every plugin permission. A read-only set looks like this; check the statement names against the pinned better-auth's `better-auth/plugins/admin/access`:

```ts
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultRoles, defaultStatements } from "better-auth/plugins/admin/access";

const ac = createAccessControl(defaultStatements);
const support = ac.newRole({ user: ["list", "get"], session: ["list"] });

function siteRoles() {
  return admin({
    ac,
    adminRoles: [...ADMIN_ROLES],
    roles: { ...defaultRoles, [SUPERADMIN_ROLE]: adminAc, support },
  });
}
```

4. Open each api route support may call with `requireAdminApp(c)`. Every `requireAdmin` route keeps refusing support with 403.
5. Grant the role as a superadmin: `auth.admin.setRole({ userId, role: "support" })` from the admin app. Only a superadmin may grant a role in `ADMIN_APP_ROLES`.

Support is then in the admin group for the rank guard too: an `admin` may not change a support account, and only a superadmin may.

### Rank: superadmin owns the admin group

`adminAc` gives `admin` and `superadmin` the same `set-role`, so the `admin()` plugin alone would let an `admin` promote anyone to `superadmin`. `rankGuard()` (`packages/auth/src/plugins/rank-guard.ts`) runs before every `/admin/*` endpoint on `adminAuth` and asks `rankDenial()` in `authorize.ts`. In order:

- **Impersonation is refused for everyone**, `superadmin` included: `/admin/impersonate-user` gets 403 "impersonation is not available between the client and admin sessions". An impersonated session would be an admin-audience row for a client account, which the split forbids; without this refusal the admin sign-in hook would answer the call with a wrong-credentials message. Cross-audience impersonation is out of scope, and `auth` refuses every `/admin/*` path anyway.
- **A caller who is not `superadmin` may read** (`list-users`, `get-user`, `list-user-sessions`, `has-permission`) and may change client accounts.
- **Only `superadmin` may change an admin-group account or grant an admin-group role.** A write whose target holds an `ADMIN_APP_ROLES` role, or that would give one (`set-role`, `create-user`, `update-user` with `data.role`), gets 403 "only a superadmin may change an admin-group account or role". `revoke-user-session` checks the owner of the session token.
- **The table fails closed.** `ADMIN_PATHS` in `authorize.ts` lists every `/admin/*` endpoint of better-auth 1.7.7's `admin()` plugin by kind. Any path not in it is superadmin-only (403 "only a superadmin may call this admin endpoint"), so an endpoint a Better Auth bump adds needs one line in the table before an `admin` may call it.
- **Nobody may take the role from the last superadmin.** Removing, banning or demoting the only account that holds `superadmin` gets 403 "the last superadmin cannot be removed, banned or demoted", whoever calls.

The guard reads target roles through `@repo/db/repositories/site-roles`, not the adapter, because the scoped adapter cannot see a session of the other audience.

### First user wins

The first account to sign up on an empty `users` table gets `role: "superadmin"`. A `databaseHooks.user.create.before` hook in `sharedOptions()` in `packages/auth/src/auth.ts` reads the table before the row is written, so it can only match on the very first sign-up; every account after that keeps the plugin's default `"user"`. This is the only automatic promotion in the system, and it is what makes `saasaloy add admin` usable without SQL. It writes `superadmin` rather than `admin` because the first account has to be able to grant every other one, and only `superadmin` may change an admin-group role.

Both instances carry the hook, and in practice it fires on `auth`: `adminAuth` has no sign-up. So the first account signs up as a client, through `POST /auth/sign-up/email` or a client app's sign-up screen, and then signs in on the admin app with the same email and password. Both instances read one `accounts` table, so no second account is needed.

**Client sign-up is open, so that first slot is a race you can lose.** Any account that reaches `/auth/sign-up` before you do becomes the superadmin, and on a deployed API with a public origin the window is real. Sign up yourself the moment the API answers its first request, then confirm with `select email, role from users`. Two sign-ups that land at the same instant both read an empty table and both become superadmin; that is accepted rather than locked, because a unique index on `role = 'superadmin'` would also block a deliberate second one later.

If somebody else got there first, or you are promoting an account on a project that already has users, flip the row by hand. Run this from the project root; `--filter @repo/db` puts the working directory in `packages/db`, which is what the relative paths are written against. The statement is the same under both drivers:

```sql
update users set role = 'superadmin' where email = 'you@example.com';
```

**How you run it is the driver's business**, so read the skill for the driver this project
installed — `saasaloy-database-d1` or `saasaloy-database-postgres` — for the console it hands you.
Swap `update` for `select email, role from users` to check it landed. The plural table name
needs no quotes: Postgres reserves `user`, not `users`.

The change takes effect on the next `getSession` call, because sessions are DB-backed and the role is read off the user row, and `cookieCache` is off (see the last boundary below). An account that is already signed in on the admin session needs no re-login. An account promoted from `user` has no admin session yet: it signs in on the admin app, because `adminAuth` refused it before the promotion. Demoting an account works the other way: its admin session stays in the table, but every role gate and the admin app's guard refuse it from the next request, and the admin app shows the refusal page.

Once one superadmin exists, promote the rest through the API instead of SQL: `auth.admin.setRole({ userId, role: "admin" })` on the admin client, which calls `/admin/auth/admin/set-role`. The server authorizes it against the caller's own role and the rank guard above, so only a superadmin may grant `admin` or `superadmin`. Grant `admin` for a backoffice user and keep `superadmin` for the accounts that own the admin group and may cross an organization boundary. The plugin also carries `listUsers`, `banUser` and friends on the same namespace. `impersonateUser` is there too, and the rank guard refuses it.

**A project that installed auth before this shipped needs a migration.** The four new `users` fields and `sessions.impersonatedBy` are schema changes like any other: run `pnpm --filter @repo/db db:generate`, read the emitted SQL, then apply it with the command from the installed driver's skill. Existing users come out of it with `role` null, which is neither site role, so the guard denies them until you promote one.

**`accounts.issuer` is the one that needs a hand.** better-auth 1.7.2 made it required and put a unique index over (`issuer`, `accountId`); 1.7.3 took both back out, so the pinned snapshot no longer carries them and (`providerId`, `accountId`) is the row's identity again. A project that never applied the 1.7.2 migration needs nothing here. A project that already applied it gets the reverse from `db:generate`:

```sql
DROP INDEX `accounts_issuer_account_id_uidx`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `issuer`;
```

Take the index identifier from your own generated migration rather than from the snippet above. Drizzle derives it from the schema the 1.7.2 migration was generated against, so a project that kept better-auth's own naming sees `account_issuer_accountId_uidx` instead, and a `DROP INDEX` on a name that is not there fails and leaves `issuer` in place.

Read it before you apply it, because a `DROP COLUMN` is not reversible and SQLite rewrites the table to do it. Take a copy of the database first. A Postgres project gets the same two statements with `DROP INDEX "accounts_issuer_account_id_uidx"` and `ALTER TABLE "accounts" DROP COLUMN "issuer"`. Nothing reads the column after the drop: better-auth 1.7.3's `getAuthTables()` never writes it and the adapter never selects it.

Leaving the column in place is the option that breaks. The snapshot no longer declares it, so `db:generate` treats it as drift on every later run, and a fresh insert against a database that still has `issuer text NOT NULL` fails the constraint the moment 1.7.3 stops writing the value.

## Seed users and the dev password

`auth` ships seed slices for its four tables, so `pnpm db:seed` gives a development database four users, one for each way the admin app shows a user:

| Email | Role | Notes |
| --- | --- | --- |
| `superadmin@example.test` | `superadmin` | sign in here to reach every admin page |
| `admin@example.test` | `admin` | |
| `member@example.test` | `user` | a client: signs in on `/auth`, refused on the admin app |
| `banned@example.test` | `user` | banned, so sign-in is refused |

Every one has an email-and-password account with the password **`saasaloy-dev-password`**, and `db:seed` prints it after the counts. The hash in `packages/db/src/seed/slices/accounts.ts` is precomputed in Better Auth's own format, so the seed never loads Better Auth. `sessions` and `verifications` ship empty slices: a seeded session would carry a token nobody holds.

A seeded database already holds a superadmin, so the first-user promotion above does not fire there: the first person to sign up gets `user`. Sign in on the admin app as `superadmin@example.test` instead. Never seed a database other people can reach; the password is in this file.

`auth` also ships the example route test, `apps/api/src/routes/auth.test.ts`. It signs the seeded superadmin in through `POST /auth/sign-in/email` and checks the session row, then a second test proves that row is gone. The rest pins the split: both cookies in one browser, a token copied into the other cookie, the admin sign-in refusal, `/auth/admin/*` refused, the rank rules and the impersonation refusal. A Better Auth bump that changes how a session is found fails these tests. Copy its shape for a route of your own; the database driver's skill, "Route tests", explains `testDatabase()`.

## Revocation: delete the session row

Sessions are DB-backed on purpose (build-spec §2.5) — revoking one is a delete, no token
denylist needed:

```sql
delete from sessions where id = '...';
-- or, to kill every session for a user:
delete from sessions where user_id = '...';
```

The next authed request with that cookie gets `401` from `getSession`.

**One user has one sessions table, so a revocation by user ends both audiences.** A password change with `revokeOtherSessions: true`, the admin plugin's `revoke-user-sessions`, or the `delete ... where user_id` above signs that user out of the client session and the admin session alike. To end only one, delete by id, or add `and audience = 'client'` (or `'admin'`) to the statement.

## `@auth/client`: two factories, framework-agnostic

`packages/auth/src/client.ts` wraps `createAuthClient` (ships inside `better-auth`, no new npm dep). There are no React bindings and none are planned. It exports one factory per instance, and a browser bundle picks the one for its user group:

| Factory | Instance | `basePath` | Plugin array | Used by |
|---|---|---|---|---|
| `createClient(baseURL)` | `auth` | `/auth` | `authClientPlugins` (empty by default) | every client-facing app |
| `createAdminClient(baseURL)` | `adminAuth` | `/admin/auth` | `adminAuthClientPlugins` (holds `adminClient()`) | `apps/admin` only |

```ts
import { createClient } from "@repo/auth/client";

const client = createClient("https://api.x.com"); // same origin as BETTER_AUTH_URL
await client.signUp.email({ email, password, name });
await client.signIn.email({ email, password });
```

`apps/admin/src/lib/auth.ts` builds its client with `createAdminClient(apiBaseUrl)` and exports it as `auth`, so a module screen that imports `auth` from `@admin/lib/auth` reaches the admin session with no change. The admin client has no `signUp`: the server refuses it.

`fetchOptions: { credentials: "include" }` is baked into both. The calling origin must be in `CORS_ORIGINS` (api's spine) for the cookie to be set and sent cross-origin.

`adminClient()` rides on the admin client only, mirroring the server's `admin()`, because its endpoints answer only on `/admin/auth`. That is what types `session.user.role` and puts `auth.admin.*` on the admin app's client. Handing those methods to a browser grants nothing; the server authorizes every call. A feature module that ships a client plugin patches both arrays. Keep each array literal and never delete one, even when it is empty.

## Enabling social OAuth / email verification (not wired)

- **Social providers** (Google, GitHub, …): add a `socialProviders` block to
  `packages/auth/src/auth.ts` yourself — not pre-wired, since it needs per-provider client
  IDs/secrets this module can't invent safely.
- **Email verification / password reset emails**: `requireEmailVerification` is off and stays off
  until the **`email`** capability exists (auth deliberately does not depend on it). Wiring it
  early means Better Auth tries to send email with no provider configured — sign-up would appear
  to hang or silently fail.

## Schema: hand-authored, never generated at `add` time

`packages/db/src/schema/auth.ts` (one of `auth.sqlite.ts` and `auth.pg.ts`, chosen by the
installed driver) is a **checked-in Drizzle snapshot** of Better Auth's core tables (`users`, `sessions`, `accounts`, `verifications`) plus the
fields the `admin` plugin adds (`users.role`, `banned`, `ban_reason`, `ban_expires`, and
`sessions.impersonated_by`), plus `sessions.audience` from this module's own `audience()` plugin (text, not null, default `'client'`), pinned to the exact `better-auth` version in
`packages/auth/package.json` — not run through a generator at add-time (no exec, deterministic, `--diff`-able). If you bump `better-auth`, **re-verify this file against the new version's schema** (`@better-auth/core`'s `getAuthTables()`, and the admin plugin's own `schema` export) before shipping — fix the snapshot, not the adapter config, on a mismatch. The adapter matches on the Drizzle **property** name (`banReason`), not the SQL column name (`ban_reason`), and does no case conversion. It's picked up by database's existing barrel + migration scripts same as any other table:

```sh
pnpm --filter @repo/db db:generate       # emits SQL for the new tables
```

The rule has a guard in this repo. The snapshot's header names the version it was verified against, and `modules/auth/files/src/schema-version.test.ts` fails `pnpm test` when that string and `better-auth` in `modules/auth/files/package.json` disagree. It cannot check a column; it makes a bump that skipped the re-verification loud instead of silent. Do the comparison, fix what moved, then edit the header. Editing the header alone to get green is the one way to defeat it.

The 1.7.2 → 1.7.3 pass is the worked example of what "re-verify" means here. It found one change, and it was a removal: `accounts.issuer` and its unique index are gone from `getAuthTables()`, so they came out of both snapshots and the headers say so. The admin plugin's own `schema` export did not move.

`db:generate` belongs to the `database` core and is the same command under either driver. **The
apply step is the driver's**, and the command differs, so read the skill for the driver this
project installed: `saasaloy-database-d1` or `saasaloy-database-postgres`.

Both variants have to stay in step. Edit one table and edit its twin — `add auth` installs only the
one matching the project's driver, so a mismatch shows up on the other driver's first install, long
after the edit.

## Upgrading from singular table names

A project that installed auth before the tables became plural has `user`, `session`, `account` and `verification` in its database. Move them to the new names like this:

1. Run `saasaloy update auth`. It takes the new schema file and the `auth.ts` that passes `usePlural: true`. The schema rename and `usePlural` must land together, because one without the other breaks sign-in. Update auth before `teams`, `api-keys` and `billing`.
2. Run `pnpm db:generate`.
3. drizzle-kit asks, for each new table, whether it is created or renamed from an existing table. Pick the rename from the old name: `user` → `users`, `session` → `sessions`, `account` → `accounts`, `verification` → `verifications`.
4. Read the generated SQL before you apply it. It must rename the tables and the indexes (`ALTER TABLE ... RENAME TO ...`, and `session_user_id_idx` → `sessions_user_id_idx`, `account_user_id_idx` → `accounts_user_id_idx`, `verification_identifier_idx` → `verifications_identifier_idx`). It must contain no `DROP TABLE` or `CREATE TABLE` for a table that holds data.
5. If it drops a table, delete that migration file and run `pnpm db:generate` again.
6. Apply the migration with the command from the installed driver's skill, then sign in once to confirm the adapter finds every table.

## Upgrading a project made before the client/admin split

A project made before the split has one instance and one `better-auth.session_token` cookie. Move it to two instances in this order:

1. Run `saasaloy update auth admin`.
2. Resolve the merge plan for `packages/auth/src/auth.ts`, `packages/auth/src/client.ts`, `packages/auth/src/server.ts` and `@db/schema/auth.ts`. Take the new `adminAuth` export, `adminAuthClientPlugins`, `createAdminClient` and the `audience` column. Carry over any plugin or option you added by hand to both instances.
3. Run `pnpm db:generate`. It writes one migration that adds `sessions.audience` with default `'client'`. Read it, then apply it with `pnpm db:migrate:local`, or the production migrate command from the installed driver's skill.
4. Run `saasaloy update` for each installed module that patches auth: `teams`, `rbac`, `api-keys` and `billing-stripe`. Each one now adds its plugin to `adminAuth` and to `adminAuthClientPlugins` as well.

Run step 4 after step 2. Before the merge, `auth.ts` has no `adminAuth` export, and the patch prints a warning that names the missing export. That warning means "merge `auth.ts` first", and the module's lock entry stays where it was, so running `saasaloy update <module>` again after the merge applies the patch.

Every existing session ends, because the cookie names change from `better-auth.session_token` to `client.session_token` and `admin.session_token`. Old session rows read as client rows through the column default, but no browser holds a cookie that names them. Tell your users they must sign in again. A route of your own that calls `auth.api.*` reads only the client session after the update; switch it to `authFor(c).api.*` if the admin app calls it. A middleware of your own on `/admin/*` must now skip `/admin/auth/*`.

## Boundaries to honor

- **Only `packages/auth` imports `better-auth`.** Every other workspace goes through
  `@repo/auth/server` / `@repo/auth/client` (ADR 0020).
- **`auth` and `adminAuth` stay module-scope singletons** in `packages/auth/src/auth.ts`. Don't refactor them into a per-request factory; that would break the plugin-array patch points every future capability relies on. The database behind it stays request-scoped for the opposite reason (ADR 0029);
  don't collapse the two by binding a client at module scope.
- **Every `api.*` and `handler` call on either instance runs inside `withAuthScope`.** Don't add a fallback
  that opens a client when the scope is empty: that path has no `executionCtx` to close the socket
  on, which is the leak the wrapper exists to prevent.
- **`plugins` stays a literal array** in each `betterAuth({ ... })` call. Never omit it, never hoist it to a named const, and never drop `audience(...)` or `siteRoles()` from it. A feature plugin goes into both arrays.
- **Keep the audience scoping.** Don't unwrap `scopeSessionsTo` or drop the `audience` column: without them a client token copied into the admin cookie is an admin session.
- **`/admin/auth/*` belongs to `adminAuth`.** Don't mount a route under it, and make any `/admin/*` middleware skip it.
- **CORS is api's job.** Don't add CORS handling here; reuse `CORS_ORIGINS`.
- **Sessions are DB-backed; `cookieCache` stays off** — revocability over the marginal latency of
  one database read per request.
- **The dialect lives in the two schema variants and in `db-provider.ts`, nowhere else.** A
  `sqlite-core` or `pg-core` import outside `files/db/schema/auth.*.ts`, or a `provider:` string
  written inline in `auth.ts`, pins this module to one driver again.
