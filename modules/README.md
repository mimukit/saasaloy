# modules — the Saasaloy registry

Each subdirectory is one module the `saasaloy add <name>` applier fetches from this repo
over the network — this repo *is* the default registry (ADR 0012). A local checkout of
this dir can be pointed at with `SAASALOY_REGISTRY_DIR` for dev/offline work.

A module is a shadcn-shaped descriptor plus the files it drops in:

```
modules/
  <name>/
    registry-item.json     # name, type, description, stage, needs[], dependsOn[], dependencies[], devDependencies[], files[], patches, scaffolds[], agent{}
    files/                 # template files, copied to alias (or scaffold-root) targets in the consumer project
    skills/saasaloy-<name>/  # skill folder, installed to the consumer's .agents/skills/saasaloy-<name>/ (+ a .claude/skills symlink)
```

See `docs/plans/0001-plan-saasaloy-build-spec-2026-07-21.md` §3.3 for the descriptor shape. Modules land in
Phase 1 (`api`, `database`, `waitlist`) and Phase 2 (`auth`, `admin`, `billing`, …). The first to land
is `api` (a capability — it carries `scaffolds[]`; see ADR 0013 for the scaffolds/files split). A
capability built on a vendor SDK encapsulates it in the workspace it scaffolds — other workspaces
import its exported utilities, never the vendor package (ADR 0020).

`admin` is the capability that scaffolds `apps/admin` (`@repo/admin`): a TanStack Router + Vite SPA,
built to static assets and served by a Worker with a single-page-application fallback. It
`dependsOn` `api` and `auth`, gates every route on `session.user.role === "admin"` in the root
layout's `beforeLoad`, and calls the api through `hc<AppType>` with `credentials: "include"`. Its
extension point is a file drop: a feature module writes `src/routes/<feature>.tsx` and the router
plugin registers it, no patch — the admin-side twin of the schema barrel. The screen inherits a
three-panel shell (icon rail, nav panel, content panel) on the app's own dark-by-default token set,
and composes the page primitives the module ships — page layout, page header, filter chips, data
table, status pill, attribute list, detail panel — so it needs no styling work of its own.

`teams` is a feature module on `auth` and `admin`. It enables Better Auth organizations, drops the organization schema into `packages/db`, and adds the site-admin `/teams` screen. The screen covers organization creation, active-organization switching, members, and copy-ID invitations. Better Auth's nested teams-within-an-organization feature stays off. `teams` also owns the permission vocabulary in `access.ts`, the pure `can(principal, permissions)` rule that reads it, and the `roleLockGuard` that keeps `owner`, `admin` and `member` read-only — the rule ships with the data it reads.

`multitenant` and `api-keys-organization` stack on `teams`, in that order, and each one is the floor the next stands on. `multitenant` answers "which organization is this request acting for, and as whom" with `requireTenant(c)`, and it answers "is this query filtered to that organization" with `forTenant(db, tenantId)` — a branded `TenantId` that only `requireTenant` mints, and a wrapper that appends the tenant filter to every query it builds. `multitenant` also answers the second question on the request path, "may this principal do this", with `requirePermission(c, permissions)` over the roles an operator defines at runtime, and it ships the `/roles` screen that edits them. `api-keys-organization` adds the third caller: an organization-owned bearer credential that resolves the same `Tenant` a session cookie does, through a credential resolver registered into `multitenant`'s `tenantResolvers` table, and that is gated by the same `can()` rather than a second permission path. It is one owner of the `api-keys` core, which holds what every owner shares: the `@better-auth/api-key` dependency, the client plugin, the shared plugin options in `api-key-options.ts`, and the two `auth.ts` patches that import `apiKeyPlugin` and `apiKeyScopeGuard` from the owner's `plugins/api-key.ts`. The core names its owners in `requiresOneOf`, the way `database` names its drivers, because the owner decides the table's column and a switch moves data (ADR 0055). The tenant column convention (`organizationId` / `organization_id`, `notNull`, `references(() => organization.id)`, one index) is what makes a table fit the guard, and a table without it is a compile error at the call site rather than a review note.

`api-keys-user` is the other owner, for a project with no organizations. It stands on the `api-keys` core and `auth` alone, so it pulls in no `multitenant`, `teams` or `admin`. A key belongs to one user: `api_keys.user_id` references `users.id` with `onDelete: "cascade"`, so a deleted account leaves no live credential. Its scope is checked at issue time against `API_KEY_SCOPES` in `packages/auth/src/api-key-scopes.ts`, which ships empty and which the project edits, so a scoped create answers 403 until the project declares its pairs. A route opens with `requireCaller(c)` from `@repo/auth/caller`, which reads a bearer key before the session cookie and never falls back from one to the other, and states its demand with `requireScope(caller, demand)`. A session user passes every demand; a key must hold it. The rules sit in the import-free `api-key-rules.ts`, and their refusal text is the `permission required: <resource>:<action>` format `teams` uses.

`validators` is the capability that scaffolds `packages/validators` (`@repo/validators`): shared Zod
input schemas, one file per feature, with `zod` as the only runtime dependency. It `dependsOn` `api`
and patches `@repo/validators` into `apps/api/package.json`, so api routes validate requests against
the same files a browser bundle imports. Request shapes live there; database column shapes stay in
`packages/db`.

`queue` is the capability that scaffolds `packages/queue` (`@repo/queue`): a job table, a schedule table, a five-field cron matcher and a provider registry, with zero runtime dependencies. It merges what the catalog listed as `queue`, `cron` and `workflows`, because to a caller they are one thing: run work outside the request. It `dependsOn` `api` and patches `@repo/queue` into `apps/api/package.json`. `QUEUE_PROVIDER` picks the provider at runtime and has no default in either direction. See ADR 0033 for why a queue takes providers rather than drivers.

`billing` is the capability that scaffolds `packages/billing` (`@repo/billing`): a provider contract, a plan table, a billable-subject file, the projection rules over `billing_subscriptions`, the plan entitlements, and a provider registry, with zero runtime dependencies and no payment vendor named anywhere in it. `BILLING_PROVIDER` picks the provider at runtime and has no default in either direction. See ADR 0034 for why a payment capability takes providers even though the project owns the table. `src/entitlements.ts` answers what a subject's plan allows, reading only `plans.ts` and the projection, so it runs with no payment provider installed; `apps/api/src/middleware/require-feature.ts` is the 402 gate over the same answer. A boolean in a plan's `features` is a **plan feature**, never a "feature flag" — that term belongs to `feature-flags`.

`payment` is the capability that scaffolds `packages/payment` (`@repo/payment`): one-time payments linked to an app record by an opaque reference, with a provider contract, a status machine over `payments`, `payment_events` and `payment_refunds`, status-change listeners and a provider registry, with zero runtime dependencies. `PAYMENT_PROVIDER` is a comma list in priority order, and `create({ method })` stores the first listed provider that offers the method. It ships the public callback route `/payment/callback/:provider/*` and the staff review routes under `/admin/payment`, and no shopper routes: an app authorizes its own reference and calls `createPayment(env)`. See ADR 0045.

`e2e` is the capability that scaffolds `packages/e2e` (`@repo/e2e`): a Playwright suite that migrates and seeds the development database, starts the installed apps on their pinned dev ports, drives them with headless Chromium, and stops every process it started. It `dependsOn` `api` and patches `e2e` and `e2e:install` into the root `package.json`. It takes neither providers nor drivers, because it wraps no external service. Four base flows ship, and each one declares the modules it needs as a Playwright tag; `playwright.config.ts` reads `installed` from `saasaloy.json` and never collects a flow whose modules are absent, rather than skipping it at run time on a 404. See ADR 0051.

`kv` is the capability that scaffolds `packages/kv` (`@repo/kv`): a key-value contract over `get`, `set`, `delete` and `list`, a validated key builder with a tenant prefix, a `cacheAside` helper and a **policy** registry beside the provider registry, with zero runtime dependencies. It `dependsOn` `api`. `KV_PROVIDER` picks the provider at runtime and `KV_KEY_PREFIX` namespaces every key, so two environments may share one store.

`storage` is the capability that scaffolds `packages/storage` (`@repo/storage`): `put`, `get`, `head`, `delete` and `list` over objects, optional presigned and multipart methods, a signed-URL token file, and the `/storage` routes in `apps/api`. It `dependsOn` `api` and needs `STORAGE_URL_SECRET` to sign a URL. It still takes providers rather than drivers, but it is the closest call on the list, because a swap moves every object — ADR 0037 has the three-question test.

`ratelimit` is a feature on `api` and `kv`: one policy file inside `packages/kv` and one Hono middleware in `apps/api`. It stays opt-in because a project wants `kv` for plenty of other reasons.

`feature-flags` is a feature that scaffolds `packages/feature-flags` and stacks on `api`, `database`, `validators`, `auth`, `admin` and `kv`. It holds typed flags, per-tenant overrides, percentage rollouts, maintenance mode and kill switches behind one resolver: the database is the source of truth, a published `kv` document is the read path, and an isolate cache in front of it reaches a warm Worker in about `FLAGS_ISOLATE_TTL_SECONDS`. It ships a `/flags` admin screen.

A **provider module** (`email-cloudflare`, `email-console`, `email-plunk`, `logger-console`, `sms-console`, `sms-khudebarta`, `queue-cloudflare`, `queue-memory`, `kv-cloudflare`, `kv-memory`, `kv-upstash`, `storage-cloudflare`, `storage-memory`, `billing-stripe`, `billing-console`, `payment-console`, `payment-manual`) is a narrow feature: one file into a
capability's `providers/` folder plus the patch that registers it, carrying whatever descriptor
surface that provider needs (a binding, an npm dep, a secret). It ships no skill of its own — the
capability's skill documents it. See `.agents/skills/create-provider/`.

The one-file rule constrains a provider's runtime surface, not its descriptor. `queue-cloudflare`
ships one file and six patches: four `wrangler-binding` entries, one `plugin-array` into the
capability's `providers` array, and one into the `handlers` array in `apps/api/src/worker.ts`. That
last one is how any module registers a non-`fetch` Worker export, and it is the only way (ADR 0033).
`queue-memory` is the same capability with the smallest possible descriptor: one file, one patch,
no binding and no env var, so a project develops and tests background work with no vendor account
and no network.

`billing-stripe` shows the other end of the same rule: one file with **two** exports, because
Stripe reaches the project through two doors — the capability's `providers` array and Better Auth's
`plugins` array — so it carries two `plugin-array` patches and three `package-json-dependency`
patches. `billing-console` is its local twin: one file, one patch, no secret, and the whole
checkout flow with no network.

A **driver module** (`database-d1`, `database-postgres`) is the mutually exclusive kind. Several
providers coexist behind one interface and a runtime env var picks one; a project holds exactly one
driver. Each driver names the other in `conflictsWith` so `saasaloy add` refuses the second with a
non-zero exit, and the capability names both in `requiresOneOf` so `add` will not leave the core
installed with no driver behind it. A driver also outgrows the provider shape on purpose. It carries `scaffolds[]` and
replaces files the capability would otherwise own (`packages/db/src/client.ts`,
`drizzle.config.ts`, `tsconfig.json`). It ships its own skill too, because a project installs
exactly one driver and the two runbooks share almost nothing. See ADR 0026.

The `database` trio is the worked example. The core (`database`) scaffolds `packages/db` with the
schema barrel, the repository layer and `db:generate`, and knows no dialect. `database-d1` adds the
`d1_databases` binding, the `db:migrate:local` script, the `db:prod:migrate` / `db:prod:dump` scripts and the D1 client.
`database-postgres` adds `DATABASE_URL` to `envVars`, a `nodejs_compat` entry in the
`compatibility_flags` of `apps/api/wrangler.jsonc`, a single `db:migrate` script for the development database, the `db:prod:migrate` / `db:prod:dump` scripts, and a client that
prefers a `HYPERDRIVE` binding over `DATABASE_URL` when one is bound. Neither driver migrates production on a deploy unless `pnpm deploy:production --migrate` asks for it (ADR 0048).

`api-keys` takes owners by the same rule, without the scaffolds. The core names `api-keys-organization` and `api-keys-user` in `requiresOneOf`, and each owner names the other in `conflictsWith`. An owner ships `plugins/api-key.ts` at one fixed path, so the core's `auth.ts` patches import the same name in either mode, plus the schema and every file that reads the owner column. The owners ship no skill: the core's `saasaloy-api-keys` covers both modes. See ADR 0055.

Tests create disposable registry fixtures. CLI development and manual QA use throwaway
registries under `.dev/`, so example modules do not need to live in the default registry.
