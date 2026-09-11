# Deploy to Cloudflare

Saasaloy scaffolds Workers projects but does not deploy them. Each deployable workspace
owns its own `wrangler.jsonc` and its own `deploy` script, and you run them one at a time.
There is no root `deploy` script and no command that ships the whole project at once.

## Before you begin

- **A Cloudflare account.** Nothing up to this point needed one — `saasaloy init` and
  `saasaloy add` touch no cloud service.
- **No global install.** `wrangler` is a devDependency of every deployable workspace
  (pinned at `4.129.0`), so `pnpm install` already put it there.
- **An authenticated wrangler.** `pnpm --filter @repo/web exec wrangler login` opens a
  browser once and stores the credential for every workspace in the repo.

## What is deployable

Depends on what you installed:

| Workspace | Comes from | Worker config | Deploys |
|---|---|---|---|
| `apps/web` | the base, always present | `apps/web/wrangler.jsonc` | Astro's `dist/client` as Workers static assets, no Worker code |
| `apps/api` | `saasaloy add api` (or anything that depends on it) | `apps/api/wrangler.jsonc` | the Hono Worker at `src/worker.ts` |
| `apps/admin` | `saasaloy add admin` | `apps/admin/wrangler.jsonc` | the Vite-built admin SPA as Workers static assets |

A project that only ran `saasaloy init` has exactly one thing to deploy.

## Deploy the landing page

```bash
pnpm --filter @repo/web run build
pnpm --filter @repo/web run deploy
```

`deploy` is `wrangler deploy`, and it uploads whatever is in `apps/web/dist/client` — so the build has to run first. The Worker is named `<project-name>-web`: `init` substituted your project name into `wrangler.jsonc` when it scaffolded.

`apps/web/wrangler.jsonc` is not the file that deploys. The build writes `.wrangler/deploy/config.json`, which redirects wrangler to the config the Cloudflare adapter generates at `dist/client/wrangler.json`, and wrangler prints "Using redirected Wrangler configuration" when it does. An edit to `apps/web/wrangler.jsonc` reaches production only through that merge, so run `wrangler deploy --dry-run` after you change it.

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

## If you installed `database-d1`

The `database` module is driver-neutral and adds no Worker binding. The D1 binding and the migration scripts come from the `database-d1` driver; a project on `database-postgres` sets `DATABASE_URL` instead and skips this section.

D1 needs two things before a remote deploy works, and neither is automatic.

**Replace the placeholder database id.** `saasaloy add database-d1` patches
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

Full detail lives in the `saasaloy-database-d1` skill that the driver installs into your
project at `.agents/skills/saasaloy-database-d1/`, beside the `saasaloy-database` skill the
core module installs.

## Resources a provider module expects

A provider that patches a binding into `apps/api/wrangler.jsonc` cannot create the resource behind it. Create it yourself before the first remote deploy, or `wrangler deploy` fails:

- **`queue-cloudflare`** needs both queues to exist: `wrangler queues create app-jobs` and `wrangler queues create app-jobs-dlq`. Queues need a Workers paid plan; `queue-memory` needs neither.
- **`kv-cloudflare`** writes `"id": "<replace-me>"` for the `KV` namespace. Run `wrangler kv namespace create app-kv` and paste the printed id into `apps/api/wrangler.jsonc`.
- **`storage-cloudflare`** needs the bucket its `BUCKET` binding names: `pnpm wrangler r2 bucket create app-storage`. The four `R2_*` values are optional and only buy presigned URLs.
- **`email-cloudflare`** needs a Workers paid plan and a domain onboarded in the dashboard. It writes the `send_email` binding, and an unverified sender fails with `sender_not_verified`.
- **`billing-stripe`** needs a webhook endpoint registered at Stripe, pointing at `https://<your-api>/auth/stripe/webhook`, and its signing secret in `STRIPE_WEBHOOK_SECRET`.

The `infra` module does not close this gap for every binding. Its translator does not yet handle `queues`, `triggers` or `send_email`, so a project on `infra` still creates those by hand.

## Environment variables and secrets

`saasaloy add` prints the variables a module needs and then leaves them to you — it writes
no `.env` file and sets nothing on Cloudflare. `saasaloy env` fills in the local files for you, and `saasaloy env --check` reports what is still missing and exits non-zero, which is the gate to put in front of a deploy. Neither command sets anything on Cloudflare. What the shipped modules declare:

| Module | Variables |
|---|---|
| `api` | `CORS_ORIGINS` |
| `admin` | `PUBLIC_API_URL` |
| `auth` | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN` |
| `email` | `EMAIL_PROVIDER`, `EMAIL_FROM` |
| `sms` | `SMS_PROVIDER`, `SMS_FROM` |
| `logger` | `LOGGER_PROVIDER`, `LOG_LEVEL` |
| `queue` | `QUEUE_PROVIDER` |
| `kv` | `KV_PROVIDER`, `KV_KEY_PREFIX` |
| `storage` | `STORAGE_PROVIDER`, `STORAGE_URL_SECRET`, `STORAGE_MAX_UPLOAD_BYTES`, `STORAGE_PROXY_URL` |
| `storage-cloudflare` | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| `email-plunk` | `PLUNK_API_KEY`, `PLUNK_API_URL` |
| `billing` | `BILLING_PROVIDER`, `BILLING_LOCKOUT_DAYS`, `BILLING_APP_NAME`, `BILLING_APP_URL` |
| `billing-stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `database-postgres` | `DATABASE_URL` |
| `feature-flags` | `FLAGS_ISOLATE_TTL_SECONDS` |
| `infra` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, `PULUMI_CONFIG_PASSPHRASE` |
| `waitlist` | `PUBLIC_API_URL` |

Each descriptor carries a description of what its variables are for; `saasaloy add` shows
them under **Env vars to set**, and `modules/<name>/registry-item.json` is the source.

`BETTER_AUTH_SECRET` is a Workers secret rather than a plain variable, and `auth` fails
closed on it: the check runs at module scope, so the package throws while the Worker
initializes when the secret is unset, which means a Worker never
serves sessions signed with Better Auth's published development key. The only exception
is a `BETTER_AUTH_URL` that names a loopback host, which is what keeps the local
`wrangler dev` loop keyless. Set secrets with
`pnpm --filter @repo/api exec wrangler secret put BETTER_AUTH_SECRET` against the Worker
that reads them, not in `wrangler.jsonc`, so they stay out of the repo.

## Or install `infra` and deploy everything at once

The manual per-workspace flow above is the default, but a centralized alternative exists:
`saasaloy add infra` scaffolds a root-level `infra` workspace that discovers every
deployable service in the repo and ships it through Pulumi:

```bash
pnpm --filter @repo/infra run preview   # pulumi preview
pnpm --filter @repo/infra run deploy    # pulumi up
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

_Verified against `main`@`42cbf03` on 2026-09-11._
