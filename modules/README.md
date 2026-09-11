# modules — the Saasaloy registry

Each subdirectory is one module the `saasaloy add <name>` applier fetches from this repo
over the network — this repo *is* the default registry (ADR 0012). A local checkout of
this dir can be pointed at with `SAASALOY_REGISTRY_DIR` for dev/offline work.

A module is a shadcn-shaped descriptor plus the files it drops in:

```
modules/
  <name>/
    registry-item.json     # name, type, dependsOn[], dependencies[], devDependencies[], files[], patches, scaffolds[], agent{}
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

`teams` is a feature module on `auth` and `admin`. It enables Better Auth organizations, drops the organization schema into `packages/db`, and adds the site-admin `/teams` screen. The screen covers organization creation, active-organization switching, members, and copy-ID invitations. Better Auth's nested teams-within-an-organization feature stays off.

`multitenant`, `rbac` and `api-keys` stack on `teams`, in that order, and each one is the floor the next stands on. `multitenant` answers "which organization is this request acting for, and as whom" with `requireTenant(c)`, and it answers "is this query filtered to that organization" with `forTenant(db, tenantId)` — a branded `TenantId` that only `requireTenant` mints, and a wrapper that appends the tenant filter to every query it builds. `rbac` adds the second question, "may this principal do this", as a pure `can(principal, permissions)` over roles an operator defines at runtime, with the three base role names locked. `api-keys` adds the third caller: an organization-owned bearer credential that resolves the same `Tenant` a session cookie does, through a credential resolver registered into `multitenant`'s `tenantResolvers` table, and that is gated by the same `can()` rather than a second permission path. The tenant column convention (`organizationId` / `organization_id`, `notNull`, `references(() => organization.id)`, one index) is what makes a table fit the guard, and a table without it is a compile error at the call site rather than a review note.

`validators` is the capability that scaffolds `packages/validators` (`@repo/validators`): shared Zod
input schemas, one file per feature, with `zod` as the only runtime dependency. It `dependsOn` `api`
and patches `@repo/validators` into `apps/api/package.json`, so api routes validate requests against
the same files a browser bundle imports. Request shapes live there; database column shapes stay in
`packages/db`.

`queue` is the capability that scaffolds `packages/queue` (`@repo/queue`): a job table, a schedule table, a five-field cron matcher and a provider registry, with zero runtime dependencies. It merges what the catalog listed as `queue`, `cron` and `workflows`, because to a caller they are one thing: run work outside the request. It `dependsOn` `api` and patches `@repo/queue` into `apps/api/package.json`. `QUEUE_PROVIDER` picks the provider at runtime and has no default in either direction. See ADR 0033 for why a queue takes providers rather than drivers.

`billing` is the capability that scaffolds `packages/billing` (`@repo/billing`): a provider contract, a plan table, a billable-subject file, the projection rules over `billing_subscription`, and a provider registry, with zero runtime dependencies and no payment vendor named anywhere in it. `BILLING_PROVIDER` picks the provider at runtime and has no default in either direction. See ADR 0034 for why a payment capability takes providers even though the project owns the table.

A **provider module** (`email-cloudflare`, `email-console`, `email-plunk`, `logger-console`, `sms-console`, `queue-cloudflare`, `queue-memory`, `billing-stripe`, `billing-console`) is a narrow feature: one file into a
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
`d1_databases` binding, the `db:migrate:local` / `db:migrate:prod` scripts and the D1 client.
`database-postgres` adds `DATABASE_URL` to `envVars`, a `nodejs_compat` entry in the
`compatibility_flags` of `apps/api/wrangler.jsonc`, a single `db:migrate` script, and a client that
prefers a `HYPERDRIVE` binding over `DATABASE_URL` when one is bound.

Tests create disposable registry fixtures. CLI development and manual QA use throwaway
registries under `.dev/`, so example modules do not need to live in the default registry.
