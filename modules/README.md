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

See `docs/plans/plan-saasaloy-build-spec-2026-07-21.md` §3.3 for the descriptor shape. Modules land in
Phase 1 (`api`, `database`, `waitlist`) and Phase 2 (`auth`, `admin`, `billing`, …). The first to land
is `api` (a capability — it carries `scaffolds[]`; see ADR 0013 for the scaffolds/files split). A
capability built on a vendor SDK encapsulates it in the workspace it scaffolds — other workspaces
import its exported utilities, never the vendor package (ADR 0020).

`validators` is the capability that scaffolds `packages/validators` (`@repo/validators`): shared Zod
input schemas, one file per feature, with `zod` as the only runtime dependency. It `dependsOn` `api`
and patches `@repo/validators` into `apps/api/package.json`, so api routes validate requests against
the same files a browser bundle imports. Request shapes live there; database column shapes stay in
`packages/db`.

A **provider module** (`email-cloudflare`, `email-console`, `logger-console`) is a narrow feature: one file into a
capability's `providers/` folder plus the patch that registers it, carrying whatever descriptor
surface that provider needs (a binding, an npm dep, a secret). It ships no skill of its own — the
capability's skill documents it. See `.agents/skills/create-provider/`.

A **driver module** (`database-d1`, `database-postgres`) is the mutually exclusive kind. Several
providers coexist behind one interface and a runtime env var picks one; only one driver may be
installed, and each names the other in `conflictsWith` so `saasaloy add` refuses the second with a
non-zero exit. A driver also outgrows the provider shape on purpose. It carries `scaffolds[]` and
replaces files the capability would otherwise own (`packages/db/src/client.ts`,
`drizzle.config.ts`, `tsconfig.json`). It ships its own skill too, because a project installs
exactly one driver and the two runbooks share almost nothing. See ADR 0023.

The `database` trio is the worked example. The core (`database`) scaffolds `packages/db` with the
schema barrel, the repository layer and `db:generate`, and knows no dialect. `database-d1` adds the
`d1_databases` binding, the `db:migrate:local` / `db:migrate:prod` scripts and the D1 client.
`database-postgres` adds `DATABASE_URL` to `envVars`, a `nodejs_compat` entry in the
`compatibility_flags` of `apps/api/wrangler.jsonc`, a single `db:migrate` script, and a client that
prefers a `HYPERDRIVE` binding over `DATABASE_URL` when one is bound.

Tests create disposable registry fixtures. CLI development and manual QA use throwaway
registries under `.dev/`, so example modules do not need to live in the default registry.
