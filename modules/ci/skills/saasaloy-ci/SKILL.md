---
name: saasaloy-ci
description: Runbook for the ci module — the static GitHub Actions workflow at .github/workflows/ci.yml, the root ci:prepare script with ci:prepare:env and its ci:prepare:<module> steps, the build step, the optional ci:e2e step, and the deploy CI gate in packages/tooling/src/deploy.config.ts. Use when CI fails, when a CI build fails naming an unset key, when a change needs a service or a tool ready before lint, typecheck, test and build run in CI, when adding a CI step for a module, or when turning the deploy CI gate off.
---

# ci — the GitHub Actions gate

`ci` gives the project one workflow, `.github/workflows/ci.yml`, that runs on every push to `main` and on every pull request. It installs four things:

| What | Where it lands |
| --- | --- |
| the workflow | `.github/workflows/ci.yml` |
| `ci:prepare` | root `package.json` script (patch) |
| `ci:prepare:env` | root `package.json` script (patch) |
| `ciWorkflow: "ci.yml"` | `packages/tooling/src/deploy.config.ts` (patch) |

The workflow runs these steps, in this order:

1. Check out the commit, set up pnpm and Node 24, and restore the Turborepo cache in `.turbo/cache`. The cache key holds the branch and the commit SHA, and a run falls back to its branch's newest cache, then to `main`'s.
2. `pnpm install --frozen-lockfile`. A `package.json` edited without its lockfile fails here.
3. `pnpm ci:prepare`. It runs `ci:prepare:env` first, then every other root script whose name starts with `ci:prepare:`, one at a time. `ci:prepare:env` runs `node packages/env/scripts/env-setup.ts --example`, which writes each service's `.env` from the defaults in `packages/env/.env.example`. It refuses nothing, and a key with no default is written blank.
4. `pnpm lint`, `pnpm typecheck` and `pnpm test`. `test` passes with no test files, so a project with testing off stays green.
5. `pnpm build`. A broken build fails here, not at deploy time.
6. `pnpm run --if-present ci:e2e`. It runs only when the root `package.json` has a `ci:e2e` script. No module adds one yet, so the step does nothing until you write it.

## When the workflow runs

- **A push runs it on `main` only.** Every other branch, `hotfix-*` included, gets its run from its pull request, and that run carries the branch's head SHA. So the deploy gate finds a run on a hotfix branch too.
- **A run on `main` is never cancelled.** `cancel-in-progress` is `${{ github.ref != 'refs/heads/main' }}`. `pnpm deploy:production` reads the run on the deploy commit. If a second merge cancelled the run on the first merge commit, the deploy gate would find a cancelled run and stop. A second push to any other branch cancels that branch's older run, whose answer is worthless.
- **Every `uses:` is pinned to a 40-character commit SHA**, with the release tag in a `# vX.Y.Z` comment. A tag can be moved to other code, and a SHA cannot. A newer saasaloy release brings newer pins.

## The workflow file does not change

The CLI writes `ci.yml` once. No module patches it, and the steps above are the whole file. A module that needs CI work adds a script to the root `package.json` under `when: { installed: ["ci"] }`:

| Module | Script | Runs |
| --- | --- | --- |
| `database-postgres` | `ci:prepare:database` | `docker compose up -d --wait`, the Postgres from `compose.yaml` |

`saasaloy add ci` after that module writes its script too. `saasaloy remove ci` deletes the workflow and resets `ciWorkflow`, but it leaves the `ci:*` scripts in `package.json` and warns about each one, so delete them by hand. The job sets `DATABASE_URL` to the compose database's literal development credentials. Only the Postgres driver reads it, and the test setup creates `<database>_test` on that server.

To add a CI step of your own, add a `ci:prepare:<name>` script to the root `package.json`. Edit `ci.yml` only for a step that cannot be a script, such as a service container or a secret. `saasaloy update` then reports the file as drifted and keeps your copy.

## The e2e suite is not in CI yet

The `e2e` module adds no `ci:*` script. `ci:prepare:env` writes every `apps/<app>/.env` from the example's defaults, but a key with no default stays blank there. With the Postgres driver, `packages/env/.env.example` also leaves `DATABASE_URL` blank, and `db:seed` reads the job's `DATABASE_URL` ahead of `apps/api/.env`. To run the suite in CI, add a `ci:prepare:e2e` script that writes `packages/env/.env`, runs `pnpm env:setup` (which replaces the files `ci:prepare:env` wrote) and runs `pnpm e2e:install --with-deps`. Then add a `ci:e2e` script that runs `pnpm e2e`, and give the seed a project database rather than the server URL.

## The deploy gate

`pnpm deploy:production` checks that `ci.yml` passed on `HEAD` before it deploys, because the module set `ciWorkflow: "ci.yml"` in `packages/tooling/src/deploy.config.ts`. `pnpm deploy:production --dry-run` prints the gate as on. To turn it off, set `ciWorkflow` back to `undefined`. The patch writes only while the value reads `undefined`, so a value you set stays.

## When CI is red

- Run the failing step locally first: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. The workflow runs nothing that a local shell cannot. Do not run `pnpm ci:prepare` on your own checkout: `ci:prepare:env` overwrites each service's `.env` with the example's defaults. Run `pnpm env:setup` afterwards if you did.
- `test` or `build` fails naming an unset key (an `EnvValidationError` in a test): CI writes that key blank, because `packages/env/.env.example` gives it no default. Give it a local default there, under its `# @services` line. A secret never gets a default; a step that needs a secret needs a CI secret and a `ci:prepare:<name>` script that writes it.
- A new project with `email` meets this on its first CI run: `EMAIL_PROVIDER` and `EMAIL_FROM` have no default, and the api route tests read them. Set the local values in `packages/env/.env.example`, for example `EMAIL_PROVIDER=console` with `email-console` installed and `EMAIL_FROM=hello@example.test`. The module ships no default on purpose, because the provider key must name a provider the project chose.
- `install` fails with a lockfile error: run `pnpm install` and commit `pnpm-lock.yaml`.
- `ci:prepare:database` times out: the container's health check failed. Read the step log for the `postgres` service output.

## Next

Run `saasaloy-deploy` to ship once `ci.yml` passes on `HEAD`.
