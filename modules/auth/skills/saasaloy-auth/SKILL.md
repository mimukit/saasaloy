---
name: saasaloy-auth
description: Runbook for the auth capability — Better Auth with httpOnly session cookies in packages/auth. Use when wiring sign-up/sign-in, protecting a route with getSession, enabling social OAuth or email verification, patching the plugin array (billing/teams), rotating the auth secret, or debugging cookie/CORS/session issues.
---

# auth — Better Auth, httpOnly cookies + subdomains

`packages/auth` (`@repo/auth`) owns [Better Auth](https://better-auth.com) outright (ADR 0020) —
no other workspace depends on `better-auth` directly. `apps/api` gets a thin `routes/auth.ts`
that forwards to `auth.handler`; `packages/db` gets a hand-authored schema snapshot. Sessions are
**DB-backed httpOnly cookies**, not JWTs (build-spec §2.5 / ADR 0004): a D1 read per request is
negligible, and sessions are instantly revocable by deleting the row.

## The plugin-array patch point (read this before adding billing/teams)

`packages/auth/src/auth.ts` exports a **module-scope singleton**:

```ts
export const auth = betterAuth({
  // ...
  plugins: [],
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
| `BETTER_AUTH_SECRET` | Signs sessions | **Required** — generate a real secret | Falls back to Better Auth's dev default (console warning) |
| `BETTER_AUTH_URL` | The API's own origin | `https://api.x.com` | `http://localhost:4000` (the api Worker's pinned dev port) |
| `COOKIE_DOMAIN` | Explicit cookie domain | `.x.com` (cross-subdomain) | Leave unset (host-only) |

Local dev is **keyless** — every var above has a safe default, so `wrangler dev` works with zero
config. Misconfigured prod fails **visibly** rather than silently: an origin missing from
`CORS_ORIGINS` gets no `Access-Control-Allow-Origin` header, so the browser refuses to hand the
response to the page, and Better Auth's `trustedOrigins` (fed from the same var) additionally
answers `403 INVALID_ORIGIN` on state-changing calls. Two independent layers — see below.

### The cookie-domain rule

1. `COOKIE_DOMAIN` set → used verbatim, `advanced.crossSubDomainCookies.enabled: true`.
2. Unset, `BETTER_AUTH_URL` host is `localhost`/`127.0.0.1` → host-only cookie (no `Domain` attr).
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

## Protect a route: `getSession`, never `better-auth` directly

```ts
// apps/api/src/routes/widgets.ts
import { Hono } from "hono";
import { getSession } from "@repo/auth/server";

const widgets = new Hono();

widgets.get("/", async (c) => {
  const session = await getSession(c.req.raw);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  return c.json({ userId: session.user.id });
});

export default widgets;
```

`getSession` wraps `auth.api.getSession({ headers })` — the httpOnly cookie rides along on
`c.req.raw` automatically. No route imports `better-auth` (ADR 0020); everything goes through
`@repo/auth/server`.

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
dep). React bindings wait for `add admin`; until then, any vanilla caller:

```ts
import { createClient } from "@repo/auth/client";

const client = createClient("https://api.x.com"); // same origin as BETTER_AUTH_URL
await client.signUp.email({ email, password, name });
await client.signIn.email({ email, password });
```

`fetchOptions: { credentials: "include" }` is baked in — the calling origin must be in
`CORS_ORIGINS` (api's spine) for the cookie to be set/sent cross-origin.

## Enabling social OAuth / email verification (not wired)

- **Social providers** (Google, GitHub, …): add a `socialProviders` block to
  `packages/auth/src/auth.ts` yourself — not pre-wired, since it needs per-provider client
  IDs/secrets this module can't invent safely.
- **Email verification / password reset emails**: `requireEmailVerification` is off and stays off
  until the **`email`** capability exists (auth deliberately does not depend on it). Wiring it
  early means Better Auth tries to send email with no provider configured — sign-up would appear
  to hang or silently fail.

## Schema: hand-authored, never generated at `add` time

`@db/schema/auth.ts` (dropped into `packages/db/src/schema/auth.ts`) is a **checked-in Drizzle
snapshot** of Better Auth's core tables (`user`, `session`, `account`, `verification`), pinned to
the exact `better-auth` version in `packages/auth/package.json` — not run through a generator at
add-time (no exec, deterministic, `--diff`-able). If you bump `better-auth`, **re-verify this file
against the new version's schema** (`@better-auth/core`'s `getAuthTables()`) before shipping —
fix the snapshot, not the adapter config, on a mismatch. It's picked up by database's existing
barrel + migration scripts same as any other table:

```sh
pnpm --filter @repo/db db:generate       # emits SQL for the new tables
pnpm --filter @repo/db db:migrate:local  # applies to local D1
```

## Boundaries to honor

- **Only `packages/auth` imports `better-auth`.** Every other workspace goes through
  `@repo/auth/server` / `@repo/auth/client` (ADR 0020).
- **`packages/auth/src/auth.ts` stays a module-scope singleton** — don't refactor it into a
  per-request factory; that would break the plugin-array patch point every future capability
  relies on.
- **`plugins: []` stays a literal array**, even empty — never omit it.
- **CORS is api's job.** Don't add CORS handling here; reuse `CORS_ORIGINS`.
- **Sessions are DB-backed; `cookieCache` stays off** — revocability over the marginal latency of
  a D1 read per request.
