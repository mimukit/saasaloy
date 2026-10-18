# Plan: wrangler-native deploy in the base, remove the `infra` module

Grilled: 2026-10-18

## Context

The `infra` module deploys through a Pulumi program that translates each `wrangler.jsonc` into `@pulumi/cloudflare` resources (ADR 0021). Pulumi was picked for provider optionality, and after several shipped projects that option has never been used. Every service runs on Cloudflare (ADR 0001).

The translation layer has also fallen behind the modules it deploys:

- `modules/infra/files/src/translate.ts:192` accepts only `vars` and `d1_databases`. `kv-cloudflare`, `storage-cloudflare`, `queue-cloudflare`, `email-cloudflare` and `ratelimit` patch `kv_namespaces`, `r2_buckets`, `queues`, `send_email` and `ratelimits` into `apps/api/wrangler.jsonc`, so `infra` throws on any project that installs one of them.
- `translate.ts:228` refuses a Worker with both `main` and `assets`, which blocks the first Astro page that sets `prerender = false`.
- `stage.ts` re-implements wrangler's `.assetsignore` rules, `readBundle` uploads only the entry chunk of a code-split build, and `secrets.ts` shells out to `wrangler secret put` anyway.
- `infra` reads the source `apps/web/wrangler.jsonc`, but the file that really deploys is the Astro adapter's `dist/client/wrangler.json`. `wrangler deploy` follows that redirect on its own.
- `translate.ts` builds each service with `pnpm run build`, which reads the dev `.env` under `apps/`. `apps/web/src/env.ts` and `modules/admin/files/src/env.ts` inline `PUBLIC_SITE_URL` and `PUBLIC_API_URL` at build time, so a deploy ships the dev URLs.

Most projects built on Saasaloy are a single landing page: `apps/web` and nothing else. Today the base has no root deploy command, so those projects either run `pnpm --filter @repo/web run deploy` by hand or install a Pulumi stack for one assets-only Worker.

Success: a fresh `saasaloy init` project deploys with `pnpm deploy:production` and no extra module. A project with `api`, `auth`, `database-d1`, `kv-cloudflare` and `queue-cloudflare` deploys from an empty Cloudflare account with the same one command, secrets and prod build values included. Two such projects share one account without touching each other's Workers or resources. `@pulumi/*` no longer appears anywhere we ship.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Deploy engine | `wrangler` only. No Pulumi, no dependency on the beta `cf` CLI. A script that later wants `cf` swaps one command. |
| Who owns deploy | The base template. Root `deploy:production` runs a turbo `deploy` task across every workspace that declares one. |
| Environments | Production only. No `env.*` blocks in `wrangler.jsonc`, no staging Worker. |
| Where deploy runs | The developer's machine by default. CI deploy is opt-in through the `infra-ci-deploy` module. |
| `infra` module | Deleted, with every reference to it. ADR 0043 supersedes ADR 0021. |
| Resource provisioning | Wrangler creates KV, D1, R2 and queue resources on deploy. Wrangler 4.131 already does this by default (`--experimental-provision` defaults to `true`; the `HANDLERS` table covers `kv_namespaces`, `d1_databases`, `r2_buckets` and `queues`). No provision script of our own. |
| Secrets delivery | `wrangler deploy --secrets-file <file>`, so code and secrets land in one Worker version. A Worker that throws at module scope on a missing secret (`auth` does) deploys cleanly on the first run. The file is written `0600` under `os.tmpdir()` and deleted in `finally`. |
| Values source | One path: the `packages/env` value source (`local` or `env-infisical`), loaded in memory per service. No prod file is written under `apps/`, which `setup.ts:48` refuses anyway. A variable the shell already exports wins, so CI can pass values as environment variables. |
| Prod build values | `env-deploy` runs the workspace build itself with the prod values in the child environment. Vite gives `process.env` priority over `.env` files, so the bundle inlines the prod `PUBLIC_*` values and the dev `.env` stays untouched. |
| `env-deploy` home | A bin in `packages/env` (`src/deploy.ts`). It replaces `env-exec`, which loses its only caller. |
| Cloudflare credentials | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the names wrangler reads, held by a `deploy` row in `SERVICES` that has no file. `Service.file` becomes optional and `env:setup` skips a row without one. `CLOUDFLARE_DEFAULT_ACCOUNT_ID` and `PULUMI_CONFIG_PASSPHRASE` go. The `CLOUDFLARE_*` deny rule from `infra/src/secrets.ts` keeps credentials out of every Worker's secrets. |
| Missing values | `deploy:production` checks every service's prod values before turbo starts, so nothing uploads when one key is blank. `env-deploy` checks its own service again. |
| D1 migrations | The base `turbo.json` `deploy` task depends on `^db:migrate:prod`. `apps/api` depends on `@repo/db`, so migrations run before the api uploads. A project without `database-d1` has no such task and nothing runs. |
| Redeploy scope | Every Worker redeploys on every run. Revisit when a project has more than five Workers. |
| Partial failure | Accepted and documented. Turbo stops the remaining tasks; finished ones stay live. The wiki points to `wrangler rollback`, and migrations stay backward compatible. |
| Removed secrets | `--secrets-file` only adds. The wiki tells the user to run `wrangler secret delete <KEY>` by hand. |
| Name collisions | `saasaloy add` substitutes `{{PROJECT_NAME}}` in module files and descriptor patches, as `init` does for the base, through the existing `resolveProjectName`. Every account-scoped name gets the prefix: Worker names, D1 `database_name`, queue names, KV and R2 names. Error messages stop quoting literal resource names. |
| CI module name | `infra-ci-deploy`. It is unrelated to the deleted `infra` module, and the upgrade runbook says so. |
| Teardown | No `destroy` command. `wrangler delete` removes a Worker; the wiki lists the commands for D1, KV, R2 and queues. |

## Approach

Wrangler already does what `infra` re-implements: it reads the redirected Astro config, uploads code-split bundles, applies `.assetsignore`, accepts every binding kind, creates missing resources, and uploads secrets with the code. So the plan deletes the translation layer instead of extending it. It keeps only what wrangler cannot know: which prod values a service reads, the order in which workspaces deploy, and the names that keep two projects apart.

It reuses what exists:

- The `deploy: wrangler deploy` scripts in `apps/web/package.json`, `modules/api/files/package.json` and `modules/admin/files/package.json`, which become `env-deploy <service>`.
- `turbo.json` in the base, which gets one `deploy` task.
- The `EnvSource.load({ root, service, environment, processEnv })` contract in `packages/env/src/source.ts`, which already answers per service and per environment for both `local` and `env-infisical`.
- `incompleteKeys` and `blankOnPurposeKeys` in `packages/env/src/check.ts` for the prod gate.
- The `SERVICES` table in `packages/env/src/services.ts` and the `# @services` lines in `.env.example`.
- `childEnv` from `packages/env/src/exec.ts`, moved into `deploy.ts` before `exec.ts` is deleted.
- `resolveProjectName` and the `{{PROJECT_NAME}}` render path that `init` and `update` already use (`packages/cli/src/lib/scaffold.ts:45`, `packages/cli/src/commands/update.ts:598`).
- `db:migrate:prod` from `modules/database-d1/registry-item.json`.

Rejected alternatives, one line each:

- Keep Pulumi and extend `translate.ts` per binding kind. Every new provider module would need a matching translator case, and wrangler already handles all of them.
- Keep `infra` as a thin wrangler orchestrator module. A landing-page project would still need an extra module to deploy.
- `wrangler secret bulk` after the deploy. The first deploy fails on the `auth` module-scope check, and each push adds a second Worker version.
- A `build:production` turbo task. Two build tasks per workspace, and a cached dev build could still ship.

### Phase 1: confirm the wrangler behaviour on the pinned version (#198) (built 2026-10-18)

Run each check against the pinned wrangler (`4.145.0` today) on a throwaway Cloudflare account, from a project under `.dev/`. Record the answers in this plan's open questions and adjust Phases 3 and 4.

- A binding with no id (D1, KV, R2) and a queue producer with no existing queue: does `wrangler deploy` create each one, and does a second deploy reuse it instead of creating another?
- Does wrangler write the created ids back into `wrangler.jsonc`? If it does, the project commits them after the first deploy.
- Does `vite dev` with `@cloudflare/vite-plugin` still run locally against a D1 binding that has no `database_id`, and a KV binding with no `id`?
- Does `wrangler deploy --secrets-file` work through the Astro redirected config, and on a Worker that does not exist yet?

Done when: each question has a recorded yes or no with the wrangler output that shows it.

### Phase 2: prefix account-scoped names with the project name (#197)

- Render `{{PROJECT_NAME}}` in module files and in descriptor patch entries during `saasaloy add`, through `resolveProjectName`. Hash the rendered bytes, as the base does, so `saasaloy update` does not report a false change.
- Rename: `modules/api/files/wrangler.jsonc` `"name": "api"` to `{{PROJECT_NAME}}-api`, admin likewise, `database-d1`'s `app-db`, `queue-cloudflare`'s `app-jobs` and `app-jobs-dlq`, and the KV and R2 names in `kv-cloudflare` and `storage-cloudflare`.
- Change the error messages in `modules/kv-cloudflare/files/cloudflare.ts:82` and `modules/queue-cloudflare/files/cloudflare.ts:132` to point at `wrangler.jsonc` instead of a literal name.
- Tests in `packages/cli` for the render and the hash.

Done when: in `.dev/`, two projects named `alpha` and `beta` with `api` and `database-d1` installed show `alpha-api`, `alpha-db`, `beta-api` and `beta-db` in their `apps/api/wrangler.jsonc`, and `saasaloy update` in each reports no module change.

### Phase 3: deploy from the base template (#198) (built 2026-10-18)

- Make `Service.file` optional. `env:setup` skips a row without a file. Add `{ name: "deploy", environment: "prod", omit: [] }` to the base `SERVICES`. Rename `infra` to `deploy` in the `envServices` enum of `packages/cli/schemas/registry-item.schema.json` and in `SERVICE_NAMES` in `packages/cli/src/lib/env-example.ts`.
- Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the base `.env.example` under `# @services deploy`.
- Add `packages/env/src/deploy.ts`, bin `env-deploy`:
  - `env-deploy --check` loads the prod values for every service with the selected source and exits non-zero, naming each missing key, when one is blank.
  - `env-deploy <service>` loads that service's prod values and the `deploy` credentials, checks them, runs `pnpm run build` in the workspace with the values in the child environment, writes the secrets file, runs `wrangler deploy --secrets-file`, and deletes the file in `finally`.
  - The secrets file holds the service's values minus `CLOUDFLARE_*` keys and minus keys already in the Worker's `vars`. An assets-only Worker gets no secrets file.
- Delete `packages/env/src/exec.ts` and `exec.test.ts` after moving `childEnv`.
- Add a `deploy` task to the base `turbo.json`: `{ "dependsOn": ["^build", "^db:migrate:prod"], "cache": false }`.
- Add `"deploy:production": "env-deploy --check && turbo run deploy"` to the base `package.json`. Change `apps/web`'s `deploy` to `env-deploy web`.
- Unit tests next to the existing `packages/env/src/*.test.ts` for the secrets filter, the assets-only skip, the file cleanup on a failed deploy, and the check.
- Document the flow in the base `_agents/skills/saasaloy-env/SKILL.md`.

Done when: in `.dev/`, `saasaloy init` then `pnpm deploy:production` prints a `workers.dev` URL; the served page carries the prod `PUBLIC_SITE_URL`; no file under `apps/` holds a prod value; and a blank `CLOUDFLARE_API_TOKEN` with no `wrangler login` stops the run before any build.

### Phase 4: module deploy steps (#198) (built 2026-10-18)

- `api` and `admin`: change `deploy` to `env-deploy api` and `env-deploy admin`.
- `database-d1`, `kv-cloudflare`, `storage-cloudflare`: drop the placeholder ids (`"local"`, `<replace-me>`) if Phase 1 shows provisioning and local dev both work without them. Otherwise keep the placeholder and document the first-deploy step.
- `queue-cloudflare`: rely on provisioning for both queues if Phase 1 confirms it.
- Confirm that `db:migrate:prod` runs before the api upload under `turbo run deploy`, and that it receives the `deploy` credentials.

Done when: in `.dev/`, a project with `api`, `auth`, `database-d1`, `kv-cloudflare` and `queue-cloudflare` deploys from an empty Cloudflare account with one `pnpm deploy:production`, and a request to the api that reads KV and the database succeeds.

### Phase 5: remove `infra` and write the ADR (#198)

- Delete `modules/infra/`.
- Remove `infra` from `packages/cli/src/lib/doctor.ts:887`, `scripts/verify-pins.test.ts:187`, the base `pnpm-workspace.yaml` (the `infra` entry and the `@pulumi/pulumi` postinstall allowance), both `oxlint.config.mjs` files, and the `env-setup.ts` comment.
- Update `AGENTS.md`, `CONTEXT.md` (the service entry and the handler-set wording), `README.md`, and the module skills that mention `infra`: `queue`, `kv`, `storage`, `api`, `admin`, `database-d1`, `database-postgres`, `env-infisical`.
- Add a `saasaloy doctor` warning when the project still has an `infra/` directory, pointing at the upgrade runbook.
- Write ADR 0043, which supersedes ADR 0021, and mark 0021 superseded.

Done when: `grep -rniE 'pulumi|\binfra\b' --exclude-dir=node_modules .` matches only `docs/adr/`, `docs/plans/`, `docs/qa/`, `CHANGELOG.md`, the doctor warning and the `infra-ci-deploy` module, and `pnpm test`, `pnpm lint` and `pnpm deps:check` pass.

### Phase 6: docs and the upgrade path (#198) (built 2026-10-18)

- Rewrite `docs/wiki/how-to/deploy-to-cloudflare.md` around `pnpm deploy:production`. Keep `env-deploy <service>` as the per-workspace route. Cover partial failure and `wrangler rollback`, removed secrets and `wrangler secret delete`, and teardown with `wrangler delete` plus the D1, KV, R2 and queue delete commands.
- Add a runbook for a project that already runs `infra`: never run `pulumi destroy`, because it deletes live resources; copy the D1 `database_id` and other ids out of `infra/state/` into `wrangler.jsonc`; keep the old resource and Worker names, since the prefix applies only to new installs; delete `infra/` and its `SERVICES` row; rename the credentials; run `pnpm deploy:production`. Say that `infra-ci-deploy` is unrelated to the old module.
- Add a CLI changelog entry that names the removal and the module rename as breaking.

Done when: the wiki commands and the runbook each run as written in `.dev/`, and the runbook takes a project scaffolded with the last release that ships `infra` to a working `pnpm deploy:production` with its existing Workers and data.

### Phase 7: the `infra-ci-deploy` module (#199)

- Add `modules/infra-ci-deploy/`, which writes `@root/.github/workflows/deploy.yml`. GitHub reads workflows only from the repository root, which is the stated reason the `@root` rule asks for.
- The workflow runs `pnpm deploy:production` on push to `main`. `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the value-source credentials (`ENV_SOURCE` and the Infisical keys, when installed) come from repository secrets as environment variables.
- Add a module skill that lists the repository secrets to set.

Done when: a test repository with the module installed deploys on a push to `main`, `saasaloy remove infra-ci-deploy` deletes the workflow, and a project without the module has no `.github/workflows/deploy.yml`.

## Migration and rollback

Live Cloudflare resources move from Pulumi state to wrangler config, and nothing in Cloudflare changes. Phase 6's runbook carries the steps. A project keeps its `infra/` directory and its committed `infra/state/` until the first wrangler deploy succeeds, so its rollback is to restore `infra/` from git and run `pulumi up` again. Saasaloy rolls back by reverting the Phase 5 commit; the last release with `infra` stays installable as `saasaloy add mimukit/saasaloy@vX.Y.Z/infra`.

The name prefix from Phase 2 applies only to new installs. An existing project keeps the names already in its files, so its live Workers and resources keep their names.

## Open questions

Phase 1 results, recorded 2026-10-18 against wrangler 4.145.0. The live deploy to a throwaway account was blocked on this machine, so the remote answers come from the pinned wrangler's own source (`wrangler-dist/cli.js`) and `--dry-run`, and the local answers from runs in `.dev/probe-198`. A live deploy is still owed; the QA plan carries it.

- **Provisioning and reuse: yes, from source.** `--experimental-provision` and `--experimental-auto-create` both default to `true`. `provisionBindings` checks each binding: D1 connects to an existing database by `database_name` (`getDatabaseInfoFromIdOrName`) or creates one under that name; R2 connects to `bucket_name` or creates it; a producer queue connects to `queue` by name or creates it; KV has no name field, so it inherits the binding the deployed Worker already holds, and otherwise creates `<worker name>-<binding>` (`autoProvisionedResourceName`). A second deploy reuses each one. One gap: `wrangler d1 migrations apply --remote` runs before the deploy and fails with "Couldn't find a D1 DB named ..." on an empty account, so `db:migrate:prod` now creates a missing database first (`modules/database-d1/files/scripts/migrate-prod.ts`).
- **Id write-back: only in an interactive, non-CI shell, and optional.** `provisionBindings` calls `experimental_patchConfig` when `!isNonInteractiveOrCI()`, then prints "future deploys will continue to work even without IDs". Through a redirected config it patches the user's source file, and only for bindings that file declares. No commit is needed.
- **Local dev without ids: yes, run.** `vite dev` with `@cloudflare/vite-plugin` 1.62.3 served D1, KV, R2 and a queue producer with no `database_id` and no KV `id`. `wrangler d1 execute DB --local` and `vite dev` read the same local database (`previewDatabaseUuid ?? uuid ?? binding`). `--dry-run` lists the bindings without ids. So Phase 4 drops `"database_id": "local"` and `"id": "<replace-me>"`, and the placeholder had to go: wrangler sends `"local"` as a real id to every remote command.
- **`--secrets-file` through the redirect, on a new Worker: yes, from source and dry run.** `deploy` sets `useConfigRedirectIfAvailable: true`, and the secrets file becomes `secret_text` bindings in the same upload, whether or not the Worker exists. `env-deploy web -- --dry-run` printed "Using redirected Wrangler configuration" with `dist/client/wrangler.json`, and `env-deploy api -- --dry-run` listed each secret in the upload.

Found while building, and built into Phases 3 and 4:

- Vite gives the environment priority over `.env`, but the Astro adapter prerenders in workerd, and wrangler hands workerd the dev `apps/web/.env` as vars. An exported `PUBLIC_SITE_URL` lost to the dev file until the build ran with `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`. `env-deploy` sets it, and sets a listed key the source leaves out to an empty string.
- The `local` source had one file for every environment, so a deploy would have shipped the dev `localhost` URLs. It now reads `packages/env/.env.prod` for `prod`.
- Turbo's strict env mode dropped a shell-exported `CLOUDFLARE_API_TOKEN` from the `deploy` task. The base `turbo.json` sets `passThroughEnv: ["*"]` on `deploy` and `db:migrate:prod`, and `db:migrate:prod` is `cache: false`.
- The root has no `@repo/env` bin, so `deploy:production` calls `node packages/env/src/deploy.ts --check`. `db:migrate:prod` gets the credentials through a third form, `env-deploy --run deploy -- <command>`.

## Non-goals

- Staging, preview, or any environment other than production.
- Any deploy target other than Cloudflare.
- A resource diff before deploy. `wrangler deploy --dry-run` is the preview.
- A command that destroys every resource a project created.
- Adopting the `cf` CLI while it is in beta.
- Deploying only changed Workers.
- Deleting secrets that were removed from the value source.
- Rollback tooling beyond a pointer to `wrangler rollback`.
