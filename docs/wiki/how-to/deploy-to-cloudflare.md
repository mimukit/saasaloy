# Deploy to Cloudflare

Saasaloy scaffolds Workers projects but does not deploy them. Each deployable workspace
owns its own `wrangler.jsonc` and its own `deploy` script, and you run them one at a time.
There is no root `deploy` script and no command that ships the whole project at once.

## Before you begin

- **A Cloudflare account.** Nothing up to this point needed one — `saasaloy init` and
  `saasaloy add` touch no cloud service.
- **No global install.** `wrangler` is a devDependency of every deployable workspace
  (pinned at `4.118.0`), so `pnpm install` already put it there.
- **An authenticated wrangler.** `pnpm --filter @repo/web exec wrangler login` opens a
  browser once and stores the credential for every workspace in the repo.

## What is deployable

Depends on what you installed:

| Workspace | Comes from | Worker config | Deploys |
|---|---|---|---|
| `apps/web` | the base, always present | `apps/web/wrangler.jsonc` | Astro's `dist/` as Workers static assets, no Worker code |
| `apps/api` | `saasaloy add api` (or anything that depends on it) | `apps/api/wrangler.jsonc` | the Hono Worker at `src/index.ts` |
| `apps/admin` | `saasaloy add admin` | `apps/admin/wrangler.jsonc` | the Vite-built admin SPA as Workers static assets |

A project that only ran `saasaloy init` has exactly one thing to deploy.

## Deploy the landing page

```bash
pnpm --filter @repo/web run build
pnpm --filter @repo/web run deploy
```

`deploy` is `wrangler deploy`, and it uploads whatever is in `apps/web/dist` — so the build
has to run first. The Worker is named `<project-name>-web`: `init` substituted your project
name into `wrangler.jsonc` when it scaffolded.

## Deploy the API

Only if you installed the `api` module.

```bash
pnpm --filter @repo/api run build
pnpm --filter @repo/api run deploy
```

**Rename the Worker before your second project.** `modules/api/files/wrangler.jsonc` sets
`"name": "api"` literally. Placeholder substitution runs only in `saasaloy init`, on the
base template — module files are copied verbatim, so every Saasaloy project that installs
`api` lands the same Worker name. Two of them in one Cloudflare account will fight over it.
Edit `apps/api/wrangler.jsonc` and give it a project-specific name; it is your file now.

## If you installed `database`

D1 needs two things before a remote deploy works, and neither is automatic.

**Replace the placeholder database id.** `saasaloy add database` patches
`apps/api/wrangler.jsonc` with `"database_id": "local"`. Local development ignores that
field entirely and runs against miniflare's SQLite, so the placeholder never surfaces until
you go remote. Create the real database and paste its id in:

```bash
pnpm --filter @repo/db exec wrangler d1 create app-db   # prints the real database_id
# → replace "local" in apps/api/wrangler.jsonc with the printed id
```

**Apply migrations to the remote database.** Migrations are hand-driven by design — there
is no `drizzle-kit push` and nothing auto-migrates on boot:

```bash
pnpm --filter @repo/db run db:generate       # schema → SQL under migrations/, review and commit
pnpm --filter @repo/db run db:migrate:prod   # apply pending migrations to remote D1
```

Full detail lives in the `saasaloy-database` skill that the module installs into your
project at `.agents/skills/saasaloy-database/`.

## Environment variables and secrets

`saasaloy add` prints the variables a module needs and then leaves them to you — it writes
no `.env` file and sets nothing on Cloudflare. What the shipped modules declare:

| Module | Variables |
|---|---|
| `api` | `CORS_ORIGINS` |
| `admin` | `PUBLIC_API_URL` |
| `auth` | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN` |
| `email` | `EMAIL_PROVIDER`, `EMAIL_FROM` |
| `sms` | `SMS_PROVIDER`, `SMS_FROM` |
| `logger` | `LOGGER_PROVIDER`, `LOG_LEVEL` |
| `infra` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, `PULUMI_CONFIG_PASSPHRASE` |
| `waitlist` | `PUBLIC_API_URL` |

Each descriptor carries a description of what its variables are for; `saasaloy add` shows
them under **Env vars to set**, and `modules/<name>/registry-item.json` is the source.

`BETTER_AUTH_SECRET` is a Workers secret rather than a plain variable — it falls back to
Better Auth's dev default locally with a console warning, and is required in production.
Set secrets with `pnpm --filter @repo/api exec wrangler secret put BETTER_AUTH_SECRET`
against the Worker that reads them, not in `wrangler.jsonc`, so they stay out of the repo.

## Or install `infra` and deploy everything at once

The manual per-workspace flow above is the default, but a centralized alternative exists:
`saasaloy add infra` scaffolds a root-level `infra` workspace that discovers every
deployable service in the repo and ships it through Pulumi:

```bash
pnpm --filter infra run preview   # pulumi preview
pnpm --filter infra run deploy    # pulumi up
```

It needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID` and
`PULUMI_CONFIG_PASSPHRASE` set. Full detail — credentials, state, adding a service so infra
picks it up — lives in the `saasaloy-infra` skill the module installs at
`.agents/skills/saasaloy-infra/`.

## What Saasaloy does not do

Without `infra`, no pipeline, no environments, no orchestration: deploying is two or three
commands you run yourself, in an order you choose. The `database` module states the
boundary outright: remote migration application is manual, and nothing auto-migrates on
boot.

That also means there is no Saasaloy-side rollback. Reverting a bad deploy is Cloudflare's
tooling against your Worker, not something this repo wraps.

## Related

- [Getting started](../getting-started.md) — build and run the project locally first.
- [Add a module](add-a-module.md) — installing `api` and `database` in the first place.
- [Architecture](../architecture.md) — why the CLI stops at copying files in.

_Verified against `main`@`a21fcce` on 2026-08-31._
