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
| `admin` | capability | an `apps/admin` TanStack Router SPA behind the auth session, on `api` + `auth` + `shell` |
| `shell` | capability | the frame, the coss primitive set, the page blocks and `shell.css` under `@repo/ui/*/shell` that every signed-in SPA renders, with no auth logic and no dependency |
| `app` | capability | an `apps/app` TanStack Router SPA on port 3002 for every signed-in user: the `shell` frame with the web brand, the `auth` sign-in and sign-up blocks, and a home screen, on `api` + `auth` + `shell`, with no `admin` |
| `command` | feature | a Cmd/Ctrl+K command palette, `G` then a letter to move between screens, a `?` sheet of every shortcut, and one conflict-checked key registry, for `admin` and `app` on `shell`. Each app's descriptor wires it into the shell header, whichever lands first |
| `email` | capability | a `packages/email` workspace with the provider interface, the escaping `html` tag and `safeUrl`, on `api` |
| `email-console` | feature (provider) | an `email` provider that logs messages instead of sending — no plan, no domain, no key |
| `email-cloudflare` | feature (provider) | an `email` provider on Cloudflare Email Sending — needs a paid Workers plan and a hand-onboarded domain, see [the reference](reference.md#email-providers) |
| `email-plunk` | feature (provider) | an `email` provider on Plunk over plain HTTP, no SDK and no binding, so `packages/email` stays at zero runtime dependencies. Needs `PLUNK_API_KEY` |
| `email-react` | feature | a `packages/email-react` workspace that adds opt-in JSX templates on [React Email](https://react.email), plus its preview server, on `email`. The tagged-template idiom stays; a JSX template returns a promise ([ADR 0031](../adr/0036-adr-react-email-is-an-opt-in-render-engine-2026-09-03.md)) |
| `sms` | capability | a `packages/sms` workspace with the provider interface and segment counting, on `api`. Cloudflare has no SMS product, so there is no Cloudflare-native provider |
| `sms-console` | feature (provider) | an `sms` provider that logs messages instead of sending |
| `sms-khudebarta` | feature (provider) | an `sms` provider on Khudebarta, a Bangladeshi bulk-SMS gateway, over plain HTTPS with no SDK and no binding. Sends to `+880` numbers only. Needs `KHUDEBARTA_API_KEY` and `KHUDEBARTA_SECRET_KEY`, see [the reference](reference.md#the-other-providers-that-need-an-account) |
| `queue` | capability | a `packages/queue` workspace with a job table, a schedule table, a five-field cron matcher and the provider registry, on `api`. Zero runtime dependencies; `QUEUE_PROVIDER` picks the provider at runtime with no default |
| `queue-cloudflare` | feature (provider) | a `queue` provider on Cloudflare Queues: one file, four wrangler bindings, and a `handlers` entry in `apps/api/src/worker.ts` for the non-`fetch` Worker exports |
| `queue-memory` | feature (provider) | a `queue` provider that runs jobs in-process: one file, one patch, no binding and no env var |
| `kv` | capability | a `packages/kv` workspace with the provider interface, namespaced keys and the `consume` contract a rate limit policy builds on, on `api`. `KV_PROVIDER` picks the provider at runtime; `KV_KEY_PREFIX` namespaces every key, and `kv-upstash` requires it |
| `kv-cloudflare` | feature (provider) | a `kv` provider on Workers KV: the `KV` namespace binding plus the `ratelimits` bindings in `apps/api/wrangler.jsonc` |
| `kv-upstash` | feature (provider) | a `kv` provider on Upstash Redis over HTTPS: two REST secrets, a required `KV_KEY_PREFIX`, and a `consume` that counts globally and reports `remaining` |
| `kv-memory` | feature (provider) | a `kv` provider that keeps entries in memory, for local development and tests |
| `ratelimit` | feature | per-route Hono middleware over the `kv` capability's `consume` contract, with named policies (`strict`, `default`, `loose`), a 429 carrying `Retry-After`, and a fail-open default, on `api` + `kv` |
| `storage` | capability | a `packages/storage` workspace with the provider interface, object keys, signed upload and download links, and the `apps/api` proxy route, on `api`. `STORAGE_PROVIDER` picks the provider at runtime; `STORAGE_URL_SECRET` signs the links |
| `storage-cloudflare` | feature (provider) | a `storage` provider on Cloudflare R2: the `BUCKET` binding, `aws4fetch` for signed URLs, and the four `R2_*` env vars |
| `storage-memory` | feature (provider) | a `storage` provider that keeps objects in memory, for local development and tests |
| `waitlist` | feature | a waitlist form plus its API route and table, on `api` + `database` + `validators`. Its table ships in a SQLite and a Postgres variant, so it installs under either driver |
| `teams` | feature | Better Auth organizations, memberships and copy-ID invitations, the permission vocabulary in `access.ts`, the pure `can(principal, permissions)` rule, the `roleLockGuard` that refuses the three base role names, plus a site-admin Teams screen, on `auth` + `admin` |
| `multitenant` | feature | `requireTenant(c)` and the `forTenant(db, tenantId)` query guard, so every scoped route resolves one organization and every scoped query is filtered to it, on `teams`. Ships `requirePermission(c, …)` on the write routes, a `/roles` admin screen for runtime-defined organization roles, a worked `project` example and a compile-time isolation proof (`packages/db/src/tenant.typecheck.ts`) |
| `api-keys` | feature | the `@better-auth/api-key` dependency, its client plugin, and the plugin options every key owner shares. Ships no owner: it names `api-keys-organization` and `api-keys-user` in `requiresOneOf`, so `add` makes you pick one |
| `api-keys-organization` | feature (owner) | organization-owned bearer credentials, stored as a SHA-256 hash with the plaintext shown once, scoped through the same `can()` a member goes through, plus an `/api-keys` admin screen. Registers a credential resolver so a bearer call resolves the same `Tenant` a cookie does, on `multitenant`. Conflicts with `api-keys-user` |
| `api-keys-user` | feature (owner) | user-owned bearer credentials for a project with no organizations, on `api-keys` and `auth` alone. A key belongs to one user, its `user_id` cascades when the user is deleted, and its scope must sit inside the `API_KEY_SCOPES` vocabulary the project edits. A route reads `{ userId, principal }` through `requireCaller(c)` and gates a key with `requireScope(caller, demand)`, from `@repo/auth/caller`. No screen. Conflicts with `api-keys-organization` |
| `billing` | capability | a `packages/billing` workspace with the provider contract, a `plans.ts` file, a billable-subject file, the `billing_subscriptions` projection, the provider registry and the plan entitlements (`requireFeature` and `requireWithinLimit` answer 402), on `api` + `database` + `auth` + `admin` + `queue` + `email`. Zero runtime dependencies; `BILLING_PROVIDER` picks the provider at runtime with no default |
| `billing-console` | feature (provider) | a `billing` provider that runs the whole checkout flow with no network and no secret |
| `billing-stripe` | feature (provider) | a `billing` provider on Stripe through `stripe` and `@better-auth/stripe`, registered into both the `providers` array and Better Auth's `plugins` array. Needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` |
| `payment` | capability | a `packages/payment` workspace with the provider contract, the status machine over `payments`, `payment_events` and `payment_refunds`, status-change listeners, the public callback route and the staff review routes under `/admin/payment`, on `api` + `database` + `auth` + `admin`. Zero runtime dependencies; `PAYMENT_PROVIDER` is a comma list in priority order with no default |
| `payment-console` | feature (provider) | a `payment` provider with a fake hosted checkout page: Pay or Cancel, no network and no secret. Development only |
| `payment-manual` | feature (provider) | a `payment` provider for bKash, Nagad, Rocket and bank transfers the shopper sends outside the site. `create` answers the account to pay, `submit` checks the transaction ID and the sender account, and staff confirm on the admin Payments page. Accounts are options in `manual({ methods })`. Nothing is verified automatically |
| `payment-sslcommerz` | feature (provider) | a `payment` provider on the SSLCOMMERZ hosted checkout for cards and wallets, BDT only. `create` answers a redirect, the IPN is checked against the gateway's validation API before the payment moves, and refunds go through the refund API. Needs an SSLCOMMERZ store |
| `feature-flags` | feature | a `packages/feature-flags` workspace with typed flags, per-tenant overrides and percentage rollouts, resolved through an isolate cache over a published `kv` document with the database as the source of truth, plus maintenance mode, kill switches and a `/flags` admin screen, on `api` + `database` + `validators` + `auth` + `admin` + `kv` |

Dependencies install automatically: `saasaloy add waitlist` brings `api`, `logger`, `logger-console`, `validators` and `database` with it, prerequisites first. The one thing it will not choose for you is the database driver. `database` names both drivers in `requiresOneOf`, so on a project that has neither, an interactive run asks which one, `--with` names it on the command line, and a `--yes` run without `--with` stops and names the options:

```
Cannot add waitlist — unmet requirement:
  database (required by waitlist) needs one of: database-d1, database-postgres, and none is installed. Re-run as `saasaloy add waitlist --with database-d1`, or pick another from that list.
```

`saasaloy add waitlist --with database-d1 --yes` installs the module and the driver in one run, with no terminal needed. Adding the driver first and then the module works too. A capability brings its vendor SDK and encapsulates it, so nothing else in your project imports Hono, Drizzle or Better Auth directly ([ADR 0020](../adr/0020-adr-capability-owns-its-vendor-packages-2026-07-24.md)).

To see what any module would actually do to your project before installing it:

```bash
saasaloy add <name> --dry-run
```

To list what a registry offers, including third-party ones, see [`saasaloy list`](reference.md#saasaloy-list). `saasaloy list --json` gives each module's one-line `description`, its `stage` (`validate`, `mvp`, `teams`, `money` or `scale`) and its `needs` (`cloudflare-paid`, `stripe`, `domain`, `vendor-account`), read from the descriptor. To publish a module of your own, start at [Contribute a module](how-to/contribute-a-module.md).

_Verified against `main`@`42cbf03` on 2026-09-11._
