# Modules

Every installable module in the default registry, in one place. This table is the map; the per-module facts a doc page would repeat — dependencies, env vars, config patches — live in each module's `registry-item.json` and print truthfully with `saasaloy add <name> --dry-run`. The tiers (capability, feature, provider, driver) are defined in [`CONTEXT.md`](../../CONTEXT.md).

| Module | Tier | What it gives you |
|---|---|---|
| `api` | capability | an `apps/api` Hono Worker, registered as the `@api` alias, on `logger` + `logger-console` |
| `logger` | capability | a `packages/logger` workspace with the provider interface, level threshold and field redaction |
| `logger-console` | feature (provider) | a `logger` provider that writes structured JSON to the Worker's console |
| `validators` | capability | a `packages/validators` workspace holding the zod request schemas and the shared `{ error: { code, message } }` envelope, on `api` |
| `database` | capability | a `packages/db` workspace with Drizzle ORM and `drizzle-kit`, on `api`. Ships no client: it names `database-d1` and `database-postgres` in `requiresOneOf`, so `add` makes you pick one |
| `database-d1` | feature (driver) | the Cloudflare D1 client, `drizzle.config.ts` and wrangler binding. Conflicts with `database-postgres` |
| `database-postgres` | feature (driver) | the Postgres client over `postgres.js`, a Hyperdrive-aware `getDb`, and a `withDb` callback helper that scopes a client to one handler and closes it. Conflicts with `database-d1` |
| `auth` | capability | a `packages/auth` workspace wrapping Better Auth, on `api` + `database`. Installs under either driver: it ships its schema and its db provider in a SQLite and a Postgres variant, and holds a request-scoped db client behind the module-scope singleton ([ADR 0029](../adr/0029-adr-auth-holds-a-request-scoped-db-client-2026-08-31.md)) |
| `admin` | capability | an `apps/admin` TanStack Router SPA behind the auth session, on `api` + `auth` |
| `email` | capability | a `packages/email` workspace with the provider interface, the escaping `html` tag and `safeUrl`, on `api` |
| `email-console` | feature (provider) | an `email` provider that logs messages instead of sending — no plan, no domain, no key |
| `email-cloudflare` | feature (provider) | an `email` provider on Cloudflare Email Sending — needs a paid Workers plan and a hand-onboarded domain, see [the reference](reference.md#email-providers) |
| `email-plunk` | feature (provider) | an `email` provider on Plunk over plain HTTP, no SDK and no binding, so `packages/email` stays at zero runtime dependencies. Needs `PLUNK_API_KEY` |
| `email-react` | feature | a `packages/email-react` workspace that adds opt-in JSX templates on [React Email](https://react.email), plus its preview server, on `email`. The tagged-template idiom stays; a JSX template returns a promise ([ADR 0031](../adr/0036-adr-react-email-is-an-opt-in-render-engine-2026-09-03.md)) |
| `sms` | capability | a `packages/sms` workspace with the provider interface and segment counting, on `api`. Cloudflare has no SMS product, so there is no Cloudflare-native provider |
| `sms-console` | feature (provider) | an `sms` provider that logs messages instead of sending |
| `queue` | capability | a `packages/queue` workspace with a job table, a schedule table, a five-field cron matcher and the provider registry, on `api`. Zero runtime dependencies; `QUEUE_PROVIDER` picks the provider at runtime with no default |
| `queue-cloudflare` | feature (provider) | a `queue` provider on Cloudflare Queues: one file, four wrangler bindings, and a `handlers` entry in `apps/api/src/worker.ts` for the non-`fetch` Worker exports |
| `queue-memory` | feature (provider) | a `queue` provider that runs jobs in-process: one file, one patch, no binding and no env var |
| `kv` | capability | a `packages/kv` workspace with the provider interface, namespaced keys and the `consume` contract a rate limit policy builds on, on `api`. `KV_PROVIDER` picks the provider at runtime; `KV_KEY_PREFIX` namespaces every key |
| `kv-cloudflare` | feature (provider) | a `kv` provider on Workers KV: the `KV` namespace binding plus the `ratelimits` bindings in `apps/api/wrangler.jsonc` |
| `kv-memory` | feature (provider) | a `kv` provider that keeps entries in memory, for local development and tests |
| `ratelimit` | feature | per-route Hono middleware over the `kv` capability's `consume` contract, with named policies (`strict`, `default`, `loose`), a 429 carrying `Retry-After`, and a fail-open default, on `api` + `kv` |
| `storage` | capability | a `packages/storage` workspace with the provider interface, object keys, signed upload and download links, and the `apps/api` proxy route, on `api`. `STORAGE_PROVIDER` picks the provider at runtime; `STORAGE_URL_SECRET` signs the links |
| `storage-cloudflare` | feature (provider) | a `storage` provider on Cloudflare R2: the `BUCKET` binding, `aws4fetch` for signed URLs, and the four `R2_*` env vars |
| `storage-memory` | feature (provider) | a `storage` provider that keeps objects in memory, for local development and tests |
| `waitlist` | feature | a waitlist form plus its API route and table, on `api` + `database` + `validators`. Its table ships in a SQLite and a Postgres variant, so it installs under either driver |
| `teams` | feature | Better Auth organizations, memberships and copy-ID invitations, plus a site-admin Teams screen, on `auth` + `admin` |
| `multitenant` | feature | `requireTenant(c)` and the `forTenant(db, tenantId)` query guard, so every scoped route resolves one organization and every scoped query is filtered to it, on `teams`. Ships a worked `project` example and a compile-time isolation proof (`packages/db/src/tenant.typecheck.ts`) |
| `rbac` | feature | runtime-defined organization roles on Better Auth's dynamic access control, a pure `can(principal, permissions)`, `requireCan(c, …)` on the write routes, and a `/roles` admin screen. `roleLockGuard` refuses the three base role names, on `multitenant` + `admin` |
| `api-keys` | feature | organization-owned bearer credentials on `@better-auth/api-key`, stored as a SHA-256 hash with the plaintext shown once, scoped through the same `can()` a member goes through, plus an `/api-keys` admin screen. Registers a credential resolver so a bearer call resolves the same `Tenant` a cookie does, on `rbac` |
| `billing` | capability | a `packages/billing` workspace with the provider contract, a `plans.ts` file, a billable-subject file, the `billing_subscription` projection and the provider registry, on `api` + `database` + `auth` + `admin` + `queue` + `email`. Zero runtime dependencies; `BILLING_PROVIDER` picks the provider at runtime with no default |
| `billing-console` | feature (provider) | a `billing` provider that runs the whole checkout flow with no network and no secret |
| `billing-stripe` | feature (provider) | a `billing` provider on Stripe through `stripe` and `@better-auth/stripe`, registered into both the `providers` array and Better Auth's `plugins` array. Needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` |
| `entitlements` | feature | resolves what a subject's plan allows from `plans.ts` and the `billing_subscription` projection, and gates a route with `requireFeature` or `requireWithinLimit`, which answer 402, on `billing` |
| `feature-flags` | feature | a `packages/feature-flags` workspace with typed flags, per-tenant overrides and percentage rollouts, resolved through an isolate cache over a published `kv` document with the database as the source of truth, plus maintenance mode, kill switches and a `/flags` admin screen, on `api` + `database` + `validators` + `auth` + `admin` + `kv` |
| `infra` | capability | an `infra` workspace holding the Pulumi program that deploys every Worker in the project. Depends on nothing |

Dependencies install automatically: `saasaloy add waitlist` brings `api`, `logger`, `logger-console`, `validators` and `database` with it, prerequisites first. The one thing it will not choose for you is the database driver. `database` names both drivers in `requiresOneOf`, so on a project that has neither, an interactive run asks which one and a `--yes` run stops and names the options:

```
Cannot add waitlist — unmet requirement:
  database (required by waitlist) needs one of: database-d1, database-postgres, and none is installed. Run `saasaloy add database-d1` first, or pick another from that list.
```

Add a driver first and the second run goes through. A capability brings its vendor SDK and encapsulates it, so nothing else in your project imports Hono, Drizzle or Better Auth directly ([ADR 0020](../adr/0020-adr-capability-owns-its-vendor-packages-2026-07-24.md)).

To see what any module would actually do to your project before installing it:

```bash
saasaloy add <name> --dry-run
```

To list what a registry offers, including third-party ones, see [`saasaloy list`](reference.md#saasaloy-list). To publish a module of your own, start at [Contribute a module](how-to/contribute-a-module.md).

_Verified against `main`@`42cbf03` on 2026-09-11._
