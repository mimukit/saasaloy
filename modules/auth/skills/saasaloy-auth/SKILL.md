---
name: saasaloy-auth
description: Runbook for the auth capability — Better Auth with httpOnly session cookies in packages/auth. Use when wiring sign-up/sign-in, gating an api route with requireSession/requireRole/requireAdmin or reading one with getSession, promoting the first admin or checking a user's role, re-verifying the schema snapshot after a better-auth bump, enabling social OAuth or email verification, patching the plugin array (billing/teams), rotating the auth secret, debugging cookie/CORS/session issues, or working out why a call throws about a database client read outside `withAuthScope`.
---

# auth — Better Auth, httpOnly cookies + subdomains

`packages/auth` (`@repo/auth`) owns [Better Auth](https://better-auth.com) outright (ADR 0020) —
no other workspace depends on `better-auth` directly. `apps/api` gets a thin `routes/auth.ts`
that forwards to `auth.handler`; `packages/db` gets a hand-authored schema snapshot. Sessions are
**DB-backed httpOnly cookies**, not JWTs (build-spec §2.5 / ADR 0004): one database read per
request is negligible, and sessions are instantly revocable by deleting the row.

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

`auth` is one module-scope singleton whose database client belongs to a single request. That split
is the one thing to understand before writing a call against `auth.api.*`.

Why it exists: a Workers isolate outlives the request that created it, but an open socket does not.
Under `database-postgres`, a client bound once at module scope serves the first request and then
throws `Cannot perform I/O on behalf of a different request` on the second. A single manual sign-in
does not catch it; it takes two requests into one worker.

How it works: `drizzleAdapter` is handed `authDb`, a proxy holding no client of its own. It reads
the current request's client out of an `AsyncLocalStorage` in `packages/auth/src/db-scope.ts`.
`withAuthScope(c, fn)` in `packages/auth/src/db-provider.ts` is what puts it there — under
Postgres by wrapping the driver's `withDb`, which also closes the socket on
`c.executionCtx.waitUntil`; under D1 by opening a binding stub and running the body.

**Every `auth.handler` and `auth.api.*` call runs inside `withAuthScope`.** `apps/api/src/routes/auth.ts`
already wraps the handler, and `getSession(c)` already wraps its own read, so ordinary use needs
nothing. Reach for the wrapper by hand only when calling `auth.api.*` yourself:

```ts
import { auth, withAuthScope } from "@repo/auth/server";

const users = await withAuthScope(c, () => auth.api.listUsers({ query: {}, headers: c.req.raw.headers }));
```

Forget it and the read throws with a message naming `withAuthScope` — **on both drivers**, D1
included. That is deliberate. D1 is the default driver, so most development happens there, and a
permissive D1 path would let the mistake pass every local test and surface only after a project
switched to Postgres. The cost on D1 is one property lookup per call. See ADR 0029.

## The plugin-array patch point (read this before adding billing/teams)

`packages/auth/src/auth.ts` exports a **module-scope singleton**:

```ts
export const auth = betterAuth({
  // ...
  plugins: [admin()],
});
```

This is deliberately a top-level `export const`, not a per-request `c.env`-scoped factory (every
other capability's convention) — the plugin array must exist at module scope for the codemod to
patch. A feature module that extends auth (`billing` pushing `stripe()`, `teams` pushing
`organization()`) declares:

```json
"patches": [{ "file": "packages/auth/src/auth.ts", "kind": "plugin-array", "exportName": "auth", "arrayProp": "plugins", "call": "stripe", "import": { "name": "stripe", "from": "@better-auth/stripe" } }]
```

The existing codemod (`packages/cli/src/lib/patch/ts-module.ts`) inserts `stripe()` into the array
and adds the import — idempotent, formatting-preserving, **zero `packages/cli` changes** needed.
The plugin's own vendor dep (`@better-auth/stripe`) merges into `packages/auth/package.json`
(ADR 0020 — vendor plugin deps land in the capability that owns the vendor package), never into
the feature's own files.

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

So local dev is keyless but not configless: put one line in `apps/api/.dev.vars` —
`BETTER_AUTH_URL=http://localhost:4000` — and `wrangler dev` runs with no secret. Everywhere else,
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

## Protect a route: four helpers, never `better-auth` directly

`@repo/auth/server` exports one read and three gates. The read answers *who*; the gates answer *whether they may act*.

| Helper | Returns | Throws |
|---|---|---|
| `getSession(c)` | the session, or `null` | never |
| `requireSession(c)` | the session | `HTTPException(401, "sign in first")` |
| `requireRole(c, role)` | the session | 401 as above, then `HTTPException(403, "role required: <role>")` |
| `requireAdmin(c)` | the session | as `requireRole(c, ADMIN_ROLE)` |

All four take the whole Hono context, not `c.req.raw`. They need `c.env` to open this request's database client and `c.executionCtx` to close it, and they enter `withAuthScope` for you. See "Either database driver" below.

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

Each gate returns the session, so the caller reads `session.user.id` without a second round trip. `requireRole` takes any string, so a `support` role later costs a call site rather than a rewrite. `requireAdmin` compares with `===` against the exported `ADMIN_ROLE`, which is the same constant `admin()` treats as privileged. `"Admin"` and `"administrator"` are not admins.

`AuthDbBindings` is whichever binding shape the installed driver declares, so this route is one file under both drivers.

**One role per user is the contract here, and it is narrower than better-auth's.** The plugin reads `user.role` as a comma-separated list (`has-permission.mjs` splits it on `,`), so a row holding `"admin,support"` is an admin to `auth.api.listUsers` and gets a 403 from `requireAdmin`. `apps/admin`'s browser guard compares with `===` too, so both halves of the gate agree with each other and both refuse the joined string. Nothing a scaffolded project writes produces one: the first-admin hook writes `"admin"`, and `client.admin.setRole({ userId, role: "admin" })` writes one value. If you want stacked roles, change `hasRole` in `packages/auth/src/authorize.ts` and `isAdmin` in `apps/admin/src/lib/auth.ts` together, never one alone.

Keep `getSession` for the case it was written for: a route whose answer *changes* for a signed-in caller but is still served to an anonymous one. A public page that shows a "you already voted" badge reads the session; it does not gate on it.

```ts
const session = await getSession(c);
return c.json({ voted: session ? await hasVoted(session.user.id) : false }, 200);
```

If you do hand-write a deny, write the body out rather than importing a helper: `auth` depends on `api` and `database` only, so `@repo/validators` may not resolve. In a project that has it, `errorBody("unauthorized", "sign in first")` from `@repo/validators/common` produces the identical shape.

All four wrap `auth.api.getSession({ headers })`, so the httpOnly cookie rides along on `c.req.raw` automatically. No route imports `better-auth` (ADR 0020); everything goes through `@repo/auth/server`.

Note the route shape: one named `export const`, one chained expression, an explicit status on every `c.json`. That is what `hc<AppType>` reads. Register it with a `chained-route` patch on the exported chain (`"exportName": "default"`), never by dropping the file and hoping (ADR 0028). `modules/admin`'s `GET /admin/users` is the worked example of a gated route registered that way.

**The gate is the api's, not the browser's.** `apps/admin` also refuses a non-admin, in `beforeLoad`. That guard stops the SPA from asking; it cannot stop `curl`. A route that skips `requireAdmin` because the admin app already checks is open to anyone holding any session cookie.

## Roles and the first admin

Better Auth's `admin` plugin is on from the start (`plugins: [admin()]`). It gives `user` a `role` column, writes `"user"` into it for every new sign-up (except the first one, see below), and treats `"admin"` as the privileged role. `apps/admin`'s guard reads exactly one thing:

```ts
const { data } = await client.getSession();
if (data?.user.role !== "admin") { /* denied */ }
```

`role` is typed on the client because `packages/auth/src/client.ts` pairs `adminClient()` with
the server plugin. Keep the pair: drop the client half and `session.user.role` goes back to
being an unchecked cast.

### First user wins

The first account to sign up on an empty `user` table gets `role: "admin"`. A `databaseHooks.user.create.before` hook in `packages/auth/src/auth.ts` reads the table before the row is written, so it can only match on the very first sign-up; every account after that keeps the plugin's default `"user"`. This is the only automatic promotion in the system, and it is what makes `saasaloy add admin` usable without SQL.

**Sign-up is open, so that first slot is a race you can lose.** Any account that reaches `/signup` before you do becomes the admin, and on a deployed API with a public origin the window is real. Sign up yourself the moment the API answers its first request, then confirm with `select email, role from user`. Two sign-ups that land at the same instant both read an empty table and both become admin; that is accepted rather than locked, because a unique index on `role = 'admin'` would also block promoting a second admin later.

If somebody else got there first, or you are promoting an account on a project that already has users, flip the row by hand. Run this from the project root; `--filter @repo/db` puts the working directory in `packages/db`, which is what the relative paths are written against. The statement is the same under both drivers:

```sql
update "user" set role = 'admin' where email = 'you@example.com';
```

**How you run it is the driver's business**, so read the skill for the driver this project
installed — `saasaloy-database-d1` or `saasaloy-database-postgres` — for the console it hands you.
Swap `update` for `select email, role from "user"` to check it landed. (`user` is a reserved word
in Postgres and needs the quotes there; SQLite accepts them too.)

The change takes effect on the next `getSession` call, because sessions are DB-backed and the role
is read off the user row — no re-login needed, and `cookieCache` is off (see the last boundary
below).

Once one admin exists, promote the rest through the API instead of SQL: `client.admin.setRole({
userId, role: "admin" })`, which the server authorizes against the caller's own role. The plugin
also carries `listUsers`, `banUser`, `impersonateUser` and friends on the same namespace.

**A project that installed auth before this shipped needs a migration.** The four new `user` fields and `session.impersonatedBy` are schema changes like any other: run `pnpm --filter @repo/db db:generate`, read the emitted SQL, then apply it with the command from the installed driver's skill. Existing users come out of it with `role` null, which is not `"admin"`, so the guard denies them until you promote one.

**`account.issuer` is the one that needs a hand.** better-auth 1.7.2 made it required and put a unique index over (`issuer`, `accountId`). The worked example below is the SQLite/D1 form; a Postgres project hits the same backfill with `ALTER TABLE "account" ADD COLUMN "issuer" text NOT NULL DEFAULT 'local:credential'` and the same `UPDATE` before the index. `db:generate` emits exactly two statements for it, and the first one cannot run on a populated table:

```sql
ALTER TABLE `account` ADD `issuer` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_id_uidx` ON `account` (`issuer`,`account_id`);
```

SQLite refuses that `ALTER` with `Cannot add a NOT NULL column with default value NULL` as soon as `account` holds one row. Backfilling the column by hand first does not help: drizzle-kit diffs the schema against its own snapshot, never against the live database, so the emitted migration still tries to add `issuer` and then fails with `duplicate column name: issuer`.

Edit the emitted migration instead. Give the column a default so the existing rows fill themselves, and correct the social accounts before the unique index goes on:

```sql
ALTER TABLE `account` ADD `issuer` text DEFAULT 'local:credential' NOT NULL;--> statement-breakpoint
UPDATE `account` SET `issuer` = 'local:oauth:' || `provider_id` WHERE `provider_id` != 'credential';--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_id_uidx` ON `account` (`issuer`,`account_id`);
```

`local:credential` is the value better-auth writes for an email/password account, `local:oauth:<providerId>` for a linked social one, so those two statements reproduce what the library would have written itself. Keep the `DEFAULT` in the migration and out of the schema file; drizzle-kit compares the schema to its snapshot, so the extra clause never reads back as drift.

Then apply it with the command from the installed driver's skill. Check it with `select id, provider_id, issuer from account`. If `CREATE UNIQUE INDEX` fails with `UNIQUE constraint failed`, two rows share a provider and an `account_id`; list them with `select issuer, account_id, count(*) from account group by 1, 2 having count(*) > 1` and delete the duplicate before you run the migration again.

This sequence was run against drizzle-kit 0.31.10 and drizzle-orm 0.45.2, the versions `packages/db` pins, on a SQLite database holding one credential account and one linked GitHub account. A fresh project needs none of it: its `account` table is empty when the migration lands, so the generated SQL applies as emitted.

## Revocation: delete the session row

Sessions are DB-backed on purpose (build-spec §2.5) — revoking one is a delete, no token
denylist needed:

```sql
delete from session where id = '...';
-- or, to kill every session for a user:
delete from session where user_id = '...';
```

The next authed request with that cookie gets `401` from `getSession`.

## `@auth/client` — framework-agnostic, for now

`packages/auth/src/client.ts` wraps `createAuthClient` (ships inside `better-auth`, no new npm
dep). There are no React bindings and none are planned — `apps/admin` wraps this client in its own
`src/lib/auth.ts`, and so does any other vanilla caller:

```ts
import { createClient } from "@repo/auth/client";

const client = createClient("https://api.x.com"); // same origin as BETTER_AUTH_URL
await client.signUp.email({ email, password, name });
await client.signIn.email({ email, password });
```

`fetchOptions: { credentials: "include" }` is baked in — the calling origin must be in
`CORS_ORIGINS` (api's spine) for the cookie to be set/sent cross-origin.

`plugins: [adminClient()]` is baked in too, mirroring the server's `admin()`. That is what types
`session.user.role` and puts `client.admin.*` on the returned client. Handing those methods to a
non-admin browser grants nothing; the server authorizes every call.

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
installed driver) is a **checked-in Drizzle snapshot** of Better Auth's core tables (`user`, `session`, `account`, `verification`) plus the
fields the `admin` plugin adds (`user.role`, `banned`, `ban_reason`, `ban_expires`, and
`session.impersonated_by`), pinned to the exact `better-auth` version in
`packages/auth/package.json` — not run through a generator at add-time (no exec, deterministic, `--diff`-able). If you bump `better-auth`, **re-verify this file against the new version's schema** (`@better-auth/core`'s `getAuthTables()`, and the admin plugin's own `schema` export) before shipping — fix the snapshot, not the adapter config, on a mismatch. The adapter matches on the Drizzle **property** name (`banReason`), not the SQL column name (`ban_reason`), and does no case conversion. It's picked up by database's existing barrel + migration scripts same as any other table:

```sh
pnpm --filter @repo/db db:generate       # emits SQL for the new tables
```

The rule has a guard in this repo. The snapshot's header names the version it was verified against, and `modules/auth/files/src/schema-version.test.ts` fails `pnpm test` when that string and `better-auth` in `modules/auth/files/package.json` disagree. It cannot check a column; it makes a bump that skipped the re-verification loud instead of silent. Do the comparison, fix what moved, then edit the header. Editing the header alone to get green is the one way to defeat it.

The 1.6.25 → 1.7.2 pass is the worked example of what "re-verify" means here. It found one change, `account.issuer`, and the header says so. Both variants carry it.

`db:generate` belongs to the `database` core and is the same command under either driver. **The
apply step is the driver's**, and the command differs, so read the skill for the driver this
project installed: `saasaloy-database-d1` or `saasaloy-database-postgres`.

Both variants have to stay in step. Edit one table and edit its twin — `add auth` installs only the
one matching the project's driver, so a mismatch shows up on the other driver's first install, long
after the edit.

## Boundaries to honor

- **Only `packages/auth` imports `better-auth`.** Every other workspace goes through
  `@repo/auth/server` / `@repo/auth/client` (ADR 0020).
- **`packages/auth/src/auth.ts` stays a module-scope singleton** — don't refactor it into a
  per-request factory; that would break the plugin-array patch point every future capability
  relies on. The database behind it stays request-scoped for the opposite reason (ADR 0029);
  don't collapse the two by binding a client at module scope.
- **Every `auth.api.*` and `auth.handler` call runs inside `withAuthScope`.** Don't add a fallback
  that opens a client when the scope is empty: that path has no `executionCtx` to close the socket
  on, which is the leak the wrapper exists to prevent.
- **`plugins` stays a literal array** in the `betterAuth({ ... })` call — never omit it, never
  hoist it to a named const, and never leave it empty by dropping `admin()`.
- **CORS is api's job.** Don't add CORS handling here; reuse `CORS_ORIGINS`.
- **Sessions are DB-backed; `cookieCache` stays off** — revocability over the marginal latency of
  one database read per request.
- **The dialect lives in the two schema variants and in `db-provider.ts`, nowhere else.** A
  `sqlite-core` or `pg-core` import outside `files/db/schema/auth.*.ts`, or a `provider:` string
  written inline in `auth.ts`, pins this module to one driver again.
