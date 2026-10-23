# Deploy to Cloudflare

One command deploys the whole project:

```bash
pnpm deploy:production
```

It checks the branch, the tree, origin, CI and new migrations, then every production value. Then it builds and deploys each Worker with wrangler, one at a time in a fixed order, requests the live hosts, and tags the commit. Preview all of it with `pnpm deploy:production --dry-run`, which builds, uploads, migrates and tags nothing. The secrets go up with the code, and wrangler creates the D1, KV, R2 and queue resources the first time. There is no Pulumi stack, no extra module and no staging environment. Production is the only target.

## Before you begin

- **A Cloudflare account.** Nothing up to this point needed one: `saasaloy init` and `saasaloy add` touch no cloud service.
- **No global install.** `wrangler` is a devDependency of every deployable workspace, so `pnpm install` already put it there.
- **Credentials.** Either set `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID` when the token reaches more than one account), or log in once with `pnpm --filter @repo/web exec wrangler login`. The deploy stops before any build when it finds neither. The token needs Workers Scripts edit, plus D1, Workers KV Storage, Workers R2 Storage and Queues edit for whichever of those the project uses.
- **Production values.** With the default `local` value source, create `packages/env/.env.prod`. It is gitignored. Copy the keys from `packages/env/.env.example` and give each its production value, `PUBLIC_SITE_URL` and `PUBLIC_API_URL` included. With `env-infisical`, put them in Infisical's `prod` environment and run with `ENV_SOURCE=infisical`. The dev file, `packages/env/.env`, is never read by a deploy.

## What `pnpm deploy:production` does

The command runs `packages/tooling/src/deploy-production.ts`. It stops at the first failure, and only a run where every step passed writes a tag ([ADR 0048](../../adr/0048-adr-production-deploy-is-gated-ordered-and-tagged-2026-10-23.md)).

1. **Gates.** Each reads its setting from `packages/tooling/src/deploy.config.ts`, a file the project owns:
   - the branch is on the `branches` list (`main` and `hotfix-*` by default),
   - the tree is clean,
   - HEAD is the same commit as its branch on origin,
   - the `ciWorkflow` run on HEAD passed. The gate is off until the config names a workflow, and the run says so,
   - no file matching `migrations` (`packages/db/migrations/*.sql`) changed since the last deploy tag, unless you pass `--migrate`. With no tag yet, every migration file counts as new.

   A failed gate stops the run before anything builds, and every message ends with the command that clears it.
2. **Env check.** `node packages/env/src/deploy.ts --check` loads the production values of every service and exits non-zero, naming each blank key, when one is missing.
3. **Migration**, with `--migrate` only: `pnpm --filter @repo/db run db:prod:migrate`. With `database-postgres` it dumps the production database first. With `database-d1` it creates the D1 database when the account has none by that name, dumps an existing one with `wrangler d1 export --remote`, then applies the pending migrations. A failed or empty dump stops the migration with either driver. No deploy migrates without the flag.
4. **Workers**, one at a time, lowest `order` first from `DEPLOY_TARGETS` in `packages/tooling/src/targets.ts`: `api` (10), `admin` (20), `web` (30). A workspace under `apps/` with a `wrangler.jsonc` and a `deploy` script but no row stops the run. Each Worker runs `pnpm --filter <package> run deploy`, which is `env-deploy <service>`:
   - load that service's production values and the Cloudflare credentials into memory,
   - run `pnpm run build` with them in the environment, so the bundle inlines the production `PUBLIC_*` values while `apps/*/.env` keeps its dev values,
   - write the Worker's secrets to a `0600` file under the OS temp directory,
   - run `wrangler deploy --secrets-file <file>`, and delete the file whether that passed or failed.
5. **Smoke checks.** Each `SMOKE_CHECKS` row in `targets.ts` is requested on every custom domain of its service, three tries 5 seconds apart. The host comes from a `routes[]` entry with `custom_domain: true` in the Worker's `wrangler.jsonc`. A service with no custom domain gets no check, and the run says so.
6. **Tag.** HEAD gets an annotated `deploy-<UTC yyyymmdd-hhmm>` tag, pushed to origin. The newest tag is what is live, and `git log <tag>..main` lists what the next deploy ships.

A variable your shell exports wins over the value source, for both the check and the build. That is how CI passes values.

What lands in the secrets file: the service's values, minus every `CLOUDFLARE_*` key, minus each key the Worker's `wrangler.jsonc` already sets in `vars`, minus empty values. An assets-only Worker gets no secrets file.

## What is deployable

| Workspace | Comes from | Worker config | Deploys |
|---|---|---|---|
| `apps/web` | the base, always present | `apps/web/wrangler.jsonc` | Astro's `dist/client` as Workers static assets, no Worker code |
| `apps/api` | `saasaloy add api` (or anything that depends on it) | `apps/api/wrangler.jsonc` | the Hono Worker at `src/worker.ts`, with its secrets |
| `apps/admin` | `saasaloy add admin` | `apps/admin/wrangler.jsonc` | the Vite-built admin SPA as Workers static assets |

A project that only ran `saasaloy init` has one Worker, `<project-name>-web`, and `pnpm deploy:production` prints its `workers.dev` URL.

`apps/web/wrangler.jsonc` is not the file that deploys. The build writes `.wrangler/deploy/config.json`, which redirects wrangler to the config the Cloudflare adapter generates at `dist/client/wrangler.json`, and wrangler prints "Using redirected Wrangler configuration" when it does. `env-deploy` reads the same redirect to decide which keys are `vars`.

**Rename the api Worker before your second project.** `modules/api/files/wrangler.jsonc` sets `"name": "api"` literally, so two projects in one account deploy over each other. Edit `apps/api/wrangler.jsonc` and give it a project-specific name. Issue #197 adds the project-name prefix to every module.

## Preview, deploy one Worker, and the other flags

```bash
pnpm deploy:production --dry-run                    # every gate, the order, the smoke checks, the env check
pnpm deploy:production --migrate                    # run the production migration before the first Worker
pnpm deploy:production --skip-ci "<reason>"         # pass the CI gate while GitHub Actions is down
pnpm deploy:production --only api                   # one Worker and its smoke checks, no tag
pnpm --filter @repo/web run deploy -- --dry-run     # build one Worker with production values, upload nothing
```

The dry run prints the last deploy tag, the commits since it, every gate, the deploy order and the smoke URLs. It exits 0 and ends with the list of what would stop a real run. `--skip-ci` puts its reason in the tag message. `--only` writes no tag, because the tag means every Worker runs that commit. Deploying with `pnpm --filter <package> run deploy` alone skips the gates, the order and the tag.

The generated project ships the `saasaloy-deploy` skill for an agent: it runs the dry run, reports, and deploys only after the owner says so in the same session. It also ships `docs/runbook-deploy.md`, a runbook the project fills in with its own first deploy, hosting and data restore steps.

## Resources

Wrangler creates a missing resource on deploy and reuses it on the next one:

- **`database-d1`**: the D1 database named in `database_name` (`app-db`). `db:prod:migrate` creates it on the first `pnpm deploy:production --migrate`, and the deploy connects the binding to it by name.
- **`kv-cloudflare`**: a namespace titled `<worker name>-kv`. A later deploy reuses the namespace the deployed Worker already holds.
- **`storage-cloudflare`**: the R2 bucket named in `bucket_name` (`app-storage`).
- **`queue-cloudflare`**: both queues, `app-jobs` and `app-jobs-dlq`. Queues need a Workers paid plan.

A deploy in an interactive terminal offers to write the new ids back into `wrangler.jsonc`. Keep them or discard them; later deploys work either way.

Two kinds of setup stay manual:

- **`email-cloudflare`** needs a Workers paid plan and a domain onboarded in the dashboard. An unverified sender fails with `sender_not_verified`.
- **`billing-stripe`** needs a webhook endpoint registered at Stripe, pointing at `https://<your-api>/auth/stripe/webhook`, and its signing secret in `STRIPE_WEBHOOK_SECRET`.

## Environment variables and secrets

`saasaloy add` prints the variables a module needs, and `saasaloy env` fills in the local dev file. `saasaloy env --check` reports what is still missing. For production, `node packages/env/src/deploy.ts --check` is the gate, and `pnpm deploy:production` runs it for you. What the shipped modules declare:

| Module | Variables |
|---|---|
| base (`deploy`) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
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
| `billing` | `BILLING_PROVIDER`, `BILLING_LOCKOUT_DAYS`, `BILLING_APP_URL` |
| `billing-stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `database-postgres` | `DATABASE_URL` |
| `feature-flags` | `FLAGS_ISOLATE_TTL_SECONDS` |
| `waitlist` | `PUBLIC_API_URL` |

`BETTER_AUTH_SECRET` is marked blank on purpose, because local dev on a loopback `BETTER_AUTH_URL` runs without one, so the check lets it through. In production it is required: `auth` throws while the Worker initializes when it is unset, and `wrangler deploy` reports that startup failure. Set it in the production values.

## When a deploy fails partway

The run stops at the failed step and writes no tag. A Worker that deployed before the failure stays live, so a run can leave the api on the new version and the web app on the old one, or a migration applied with the old api still serving. The run prints a rollback command for each Worker it deployed:

```bash
pnpm --filter @repo/api exec env-deploy --run api -- wrangler rollback
```

`wrangler deployments list` in the same form shows the history. A failed smoke check also prints these lines, after every Worker is live. Two rules keep a partial deploy survivable:

- **Keep migrations backward compatible**, so the old api reads the new schema. A code rollback does not undo a migration.
- **Never move or delete a deploy tag.** After a rollback the live code is the previous tag's commit again. Revert the bad commit on `main`, and the next deploy tags the revert.

When the tag push fails, the Workers stay live and the tag stays local. Run `git push origin <tag>`.

Fix the cause and run `pnpm deploy:production` again. Every Worker redeploys on every run.

## Removing a secret

`--secrets-file` only adds. A key you delete from the value source stays on the Worker. Remove it by hand from the workspace that owns it:

```bash
pnpm --filter @repo/api exec wrangler secret delete OLD_KEY
```

## Tearing it down

There is no command that destroys a project. Each piece goes with its own wrangler command, run from a workspace that has wrangler, in this order. With `queue-cloudflare`, remove the api Worker as the queue's consumer first: Cloudflare refuses to delete a Worker that consumes a queue, and refuses to delete a queue that a Worker still binds.

```bash
pnpm --filter @repo/api exec wrangler queues consumer remove app-jobs api   # queue-cloudflare only; use your api Worker name
pnpm --filter @repo/api exec wrangler delete                          # the api Worker
pnpm --filter @repo/web exec wrangler delete                          # the web Worker
pnpm --filter @repo/api exec wrangler d1 delete app-db                # the D1 database and its data
pnpm --filter @repo/api exec wrangler kv namespace list               # find the KV namespace id
pnpm --filter @repo/api exec wrangler kv namespace delete --namespace-id <id>
pnpm --filter @repo/api exec wrangler r2 bucket delete app-storage    # the bucket must be empty
pnpm --filter @repo/api exec wrangler queues delete app-jobs
pnpm --filter @repo/api exec wrangler queues delete app-jobs-dlq
```

Every one of these deletes data that no backup in this repo holds.

## Coming from the `infra` module

A project scaffolded before this flow may still have an `infra/` workspace and a Pulumi state directory. `saasaloy doctor` warns about it. Follow [Move off the infra module](../runbooks/move-off-the-infra-module.md), and never run `pulumi destroy`: it deletes the live Workers and their data.

## Related

- [Getting started](../getting-started.md): build and run the project locally first.
- [Add a module](add-a-module.md): installing `api` and `database` in the first place.
- [Architecture](../architecture.md): why the CLI stops at copying files in.

_The gated flow was checked against branch `issue-234-gate-order-and-tag-the-production-deploy` on 2026-10-23 with `pnpm deploy:production --dry-run` in a generated project; no live deploy ran. Checked against branch `issue-198` on 2026-10-21 with live deploys to a disposable Cloudflare account: the landing page, and a project with `api`, `database-d1`, `auth`, `kv-cloudflare` and `queue-cloudflare`. The teardown above ran in this order. R2 and the `infra` runbook were not run live._
