# Plan — `auth` capability module

*Drafted 2026-07-24. Hardened via grillkit 2026-07-24.*

Grilled: 2026-07-24

## Context

`auth` is the first Phase-2 **capability module** (issue #12), the third capability overall after
`api` (#8) and `database` (#9) — both closed, so #12 is unblocked. It wires **Better Auth** with the
**httpOnly-cookie + subdomain session model** (build-spec §2.5 / ADR 0004, overriding the draft's JWT
default): the session cookie is scoped to the apex domain so `app.x.com` calls `api.x.com` with
`credentials: 'include'`, sessions are DB-backed (revocable), and a D1 session read per request is
negligible.

The grill settled a structural decision beyond the issue's original scope: **`add auth` scaffolds its
own workspace, `packages/auth`**, which owns the `better-auth` dependency outright — no other
workspace imports the vendor package ([ADR 0020](../adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md),
now the convention for all capabilities). `apps/api` and `packages/db` receive only thin drops
through their existing conventions (route glob, schema barrel). The grill also moved **CORS into
`api`'s spine** — it's a property of the API's cross-origin topology (the `waitlist` form on `x.com`
needs it too), not of auth — so this issue updates `modules/api` as well.

Success = a schema-valid `auth` descriptor whose `saasaloy add auth` (pulling `api` + `database`)
lands `packages/auth`, drops the route + schema files, and yields a keyless local login flow:
sign-up/sign-in sets an httpOnly cookie, a credentialed cross-origin call succeeds, and deleting the
session row revokes access — exercised end to end in `.dev/`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Tier | **Capability** (`saasaloy:capability`) — carries a `scaffolds[]` entry for `packages/auth` plus `files[]` drops into `@api` and `@db`. |
| Identity | Package `@repo/auth`; scaffold registers alias `@auth → packages/auth/src`. |
| Vendor encapsulation | **`packages/auth` owns `better-auth`** (ADR 0020). Every other workspace imports `@auth/server` / `@auth/client`, never the vendor package. Future plugin deps (`@better-auth/stripe`, org plugin) merge into `packages/auth/package.json`. |
| `dependsOn` | **`["api", "database"]`** — the route drop needs `apps/api`'s `routes/` glob; the adapter and schema drop need `packages/db`. Resolved recursively behind the confirmation prompt. |
| Mounting | `files[]` drops **`@api/routes/auth.ts`** — a thin Hono sub-app forwarding `["GET","POST"] /*` to `auth.handler`, mounted at `/auth` by api's existing glob. Better Auth `basePath: "/auth"`. **`apps/api/src/index.ts` is untouched.** |
| CORS | **Moves into `api`'s spine** (`modules/api` update in this issue): global `cors()` middleware reading `CORS_ORIGINS` (comma-separated), `credentials: true`, with a localhost dev fallback. Auth carries zero CORS code. `SameSite=Lax` works in both prod (subdomains are same-site) and dev (localhost ports are same-site) — no `SameSite=None`. |
| Config shape | **Top-level singleton**: `packages/auth/src/auth.ts` does `import { env } from "cloudflare:workers"` (importable-env; compat date 2026-07-21 ≫ GA 2025-04) and exports `export const auth = betterAuth({...})` at module scope. A file comment records why it deviates from the `c.env` convention: the plugin-array patch point must live at module scope. |
| Plugin-array patch point | `packages/auth/src/auth.ts`, `{ exportName: "auth", arrayProp: "plugins" }` — **the exact shape the existing codemod patches; zero `packages/cli` changes.** `billing`/`teams` later push `stripe()` / `organization()` here. |
| Auth schema | **Hand-authored, checked-in Drizzle snapshot** (`user`, `session`, `account`, `verification`) matching the pinned `better-auth` version, dropped to `@db/schema/auth.ts` — picked up by db's barrel + `db:generate`/`db:migrate:local`. Never generated at add-time (no exec, deterministic, `--diff`-able). The deliberate ADR 0020 exception: table definitions are db-domain files living in `packages/db`, keeping `auth → db` acyclic. |
| Methods | **Email + password only** (`emailAndPassword: { enabled: true }`), `requireEmailVerification` **off** — verification needs the `email` capability, which auth deliberately does not depend on. Social OAuth documented in the skill, not pre-wired. Keyless out of the box. |
| Sessions | DB-backed (revocable — delete the row, the session dies). **`cookieCache` stays off** (spec §2.5 rationale: revocability; a D1 read per request is negligible; also Better Auth's default). Expiry = Better Auth defaults. |
| Env vars | `BETTER_AUTH_SECRET` (Workers secret), `BETTER_AUTH_URL` (the API's own origin), `COOKIE_DOMAIN` (optional). `trustedOrigins` **reuses `CORS_ORIGINS`** — one origin list, two consumers, no drift. All three declared in the descriptor's `envVars{}` — its first real use; `add` prints them as the prod checklist. |
| Cookie domain rule | Explicit `COOKIE_DOMAIN` wins (`.x.com` in prod → `crossSubDomainCookies`). When unset, **derive from `BETTER_AUTH_URL`**: `localhost`/`127.0.0.1` → host-only; hostname starting `api.` → strip to `.rest`; **any other shape → host-only (never guess)** — a mis-derived domain breaks login silently, so the fallback is conservative. |
| Dev config | **Dev-safe code defaults — `wrangler dev` works keyless.** `CORS_ORIGINS` falls back to the localhost app origins (in api's spine and auth's `trustedOrigins`), cookie is host-only, secret falls back to Better Auth's dev default (with its console warning). `files[]` cannot target `apps/api/.dev.vars` (targets are `@alias/rest`; `@api` = `apps/api/src`) — deliberately **not** solved with a new applier mechanism. Misconfigured prod fails visibly (CORS rejects the real origin). |
| Server surface | `@auth/server` exports `auth` (for the route) and a `getSession(request)` helper — the protected-route recipe (`401` when null) without any route importing `better-auth`. |
| Client surface | **`@auth/client` ships now**: a framework-agnostic `createAuthClient` wrapper (no new npm dep — inside `better-auth`). React bindings wait for `admin`. |
| `dependencies[]` | **Empty** — the capability declares deps in the `package.json` it scaffolds (ADR 0013): `better-auth` (pinned at build time), `@repo/db` (`workspace:*`), `@repo/tsconfig`, `typescript`. |
| Agent context | Ships `skills/saasaloy-auth/SKILL.md` (`saasaloy-`-prefixed, ADR 0014), listed in `agent.skills`. |
| Acceptance / DoD | In `.dev/`: `saasaloy add auth` resolves `api` + `database`, scaffolds `packages/auth`, drops route + schema; migrations apply; sign-up/sign-in against `wrangler dev` sets an httpOnly cookie; a credentialed request from a localhost app origin succeeds; deleting the session row in local D1 makes the next authed call 401. All keyless. |

## Approach

### Phase 1 — `modules/api` update (CORS spine)
- `files/src/index.ts`: global `cors()` from `hono/cors` before the route glob — origins from
  `c.env.CORS_ORIGINS` with the localhost dev fallback, `credentials: true`; `Bindings` gains
  `CORS_ORIGINS?: string`.
- Existing consumers pick it up via `add api --diff` (the copy-in update path).

### Phase 2 — Descriptor (`modules/auth/registry-item.json`)
- `name: "auth"`, `type: "saasaloy:capability"`, `dependsOn: ["api", "database"]`, empty
  `dependencies`/`devDependencies`.
- One `scaffolds[]` entry: `workspace: "packages/auth"`, `aliases: { "@auth": "packages/auth/src" }`.
- `files[]`: `@api/routes/auth.ts` (thin mount), `@db/schema/auth.ts` (schema snapshot).
- `envVars`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN` with one-line descriptions.
- `patches: []` — auth **establishes** the plugin-array patch point; it consumes none itself.
- `agent.skills: ["skills/saasaloy-auth"]`. Validate via `validateRegistryItem`.

### Phase 3 — Scaffold files (`modules/auth/files/` → `packages/auth`)
- `src/auth.ts` — the importable-env singleton: `basePath: "/auth"`, `baseURL`, `secret`,
  `emailAndPassword`, `trustedOrigins` from `CORS_ORIGINS` (+ dev fallback), the cookie-domain
  rule, `drizzleAdapter(getDb(env.DB), { provider: "sqlite" })`, `plugins: []`, and the
  why-not-`c.env` comment.
- `src/server.ts` — exports `auth` + `getSession(request)`.
- `src/client.ts` — framework-agnostic `createAuthClient` wrapper (`@auth/client`).
- `package.json` (deps per ADR 0013, exports map for `./server` + `./client`), `tsconfig.json`.

### Phase 4 — Convention drops (`modules/auth/files/`)
- `api/routes/auth.ts` → `@api/routes/auth.ts`: Hono sub-app, `app.on(["GET","POST"], "/*", …)`
  forwarding to `auth.handler` via `@auth/server`.
- `db/schema/auth.ts` → `@db/schema/auth.ts`: the four core tables, faithful to the pinned
  `better-auth` version's expected shape (verified in Phase 6).

### Phase 5 — Skill runbook (`modules/auth/skills/saasaloy-auth/SKILL.md`)
- The plugin-array patch-point contract (`exportName: "auth"` — future modules patch here, never
  hand-edit another workspace); the env checklist + cookie-domain rule; the protected-route recipe
  (`getSession`); enabling social OAuth / email verification (pointer to the `email` capability);
  revocation (delete the session row); the `@auth/client` usage sketch for the future SPA.

### Phase 6 — Exercise in `.dev/`
- `saasaloy add auth` from clean → confirm dep resolution installs `api` → `database` → `auth`,
  aliases registered, files landed.
- `db:generate` + `db:migrate:local`, then `wrangler dev`/`vite dev`: sign-up → cookie set
  (httpOnly, no `Domain` attr locally); credentialed fetch from a localhost origin → 200; delete
  the session row → 401. Verify the schema snapshot satisfies the adapter (no missing-column
  errors) — fix the snapshot, not the adapter config, on mismatch.

## Open questions

Thin spots (none block the build; settle at build time):

- **`better-auth` version pin + snapshot fidelity** — pin current at build time (`pnpm deps:update`
  fills it); the schema snapshot must match that exact version's core tables.
- **`getSession` exact shape** — Better Auth's server API (`auth.api.getSession({ headers })`);
  wrap whatever the pinned version exposes.
- **Adapter table-name mapping** — whether `drizzleAdapter` needs explicit schema/table mapping
  options against the barrel's export names; settle in Phase 6.
- **Two-origin QA harness** — the credentialed-CORS acceptance check needs a second localhost
  origin; a scratch static page in `.dev/` (or `curl` with an `Origin` header) — pick in Phase 6.
- **`add api --diff` on an existing `.dev` project** — first real exercise of the copy-in update
  path for the Phase-1 CORS change; worth observing, not blocking.

## Non-goals

- **Social OAuth providers** — documented in the skill; wired by the owner or a later module.
- **Email verification / password reset emails** — needs the `email` capability; explicitly off.
- **Org + Stripe plugins** — `teams` / `billing` feature modules; they exercise the patch point.
- **Admin UI / React client bindings** — `add admin`'s job; `@auth/client` ships vanilla only.
- **Rate limiting / bot protection** — future capability concern (`ratelimit`).
- **Remote deploy proof** — like `api`/`database`, real `api.x.com` deployment is deferred to
  `infra`/end-to-end QA; the DoD is local.
