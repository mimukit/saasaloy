---
name: saasaloy-infra-ci-deploy
description: Runbook for infra-ci-deploy, the GitHub Actions workflow that runs pnpm deploy:production on every push to main. Use when setting up CI deploys, when listing the repository secrets the deploy workflow reads, when a deploy run fails in GitHub Actions, or when a push with a migration stops at the migration gate.
---

# infra-ci-deploy — deploy on push to main

`saasaloy add infra-ci-deploy` writes one file, `.github/workflows/deploy.yml`. On every push to `main` it installs the project and runs `pnpm deploy:production`, the same command you run on your machine, with the same gates. Each deploy then leaves a run in the Actions tab and a deploy tag on the commit.

The module has nothing to do with the deleted `infra` module. It holds no Pulumi program.

## What it installs

| File | Lands at |
| --- | --- |
| `files/workflows/deploy.yml` | `.github/workflows/deploy.yml` (the repository root, the only place GitHub reads workflows from) |

`saasaloy remove infra-ci-deploy` deletes the workflow. The repository secrets stay in GitHub; delete them under Settings → Secrets and variables → Actions.

## Repository secrets

Set each one under Settings → Secrets and variables → Actions → New repository secret, or with `gh secret set <NAME>`.

| Secret | Required | What it holds |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | always | An API token wrangler deploys with: Workers Scripts edit, plus D1, KV, R2 and Queues edit for the bindings the project uses. |
| `CLOUDFLARE_ACCOUNT_ID` | always | The Cloudflare account the Workers live in. |
| `ENV_SOURCE` | with `env-infisical` | `infisical` to read the production values from Infisical. Leave it unset to use the `local` source and `ENV_PROD`. |
| `ENV_PROD` | when `ENV_SOURCE` is unset or `local` | The whole contents of `packages/env/.env.prod`. The workflow writes it to that file, which git ignores, before the deploy: `gh secret set ENV_PROD < packages/env/.env.prod`. |
| `INFISICAL_CLIENT_ID` | when `ENV_SOURCE` is `infisical` | The client id of an Infisical machine identity with read access to the production environment. |
| `INFISICAL_CLIENT_SECRET` | when `ENV_SOURCE` is `infisical` | That machine identity's client secret. |

The two `CLOUDFLARE_*` secrets are required even when Infisical holds the same keys in `/deploy`. A variable the shell exports wins over the value source, and GitHub exports an unset secret as an empty string, which would hide the Infisical value.

With `ENV_SOURCE=infisical`, commit `.infisical.json` (the `env-infisical` runbook says how). The workflow installs the Infisical CLI itself.

`GH_TOKEN` is not a secret to set: the workflow passes the run's own `github.token`, which the CI gate uses to read the `ci` workflow's runs.

## How a run goes

1. Checkout with the full history and every tag, because the deploy reads the last deploy tag.
2. `pnpm install --frozen-lockfile`.
3. The production values: `ENV_PROD` written to `packages/env/.env.prod`, or the Infisical CLI installed.
4. When `.github/workflows/ci.yml` exists (the `ci` module), wait for that workflow's run on the same commit. The deploy's CI gate fails while that run is still going.
5. Set the git identity to `github-actions[bot]`, because the deploy tag is an annotated tag.
6. `pnpm deploy:production`: the gates, every Worker in order, the smoke checks, and the deploy tag pushed back to the repository. The job has `contents: write` for that push.

Only one deploy runs at a time. A second push waits for the first deploy to finish and is never cancelled halfway.

## A push with a migration

A push that adds a file under `packages/db/migrations/` stops at the migration gate, as it does on your machine. Read the SQL, then open the Actions tab, pick the `deploy` workflow, choose Run workflow on `main`, and check `migrate`. That run calls `pnpm deploy:production --migrate`.

## When a run fails

Read the failed step's log. `pnpm deploy:production` names the command that clears each gate. A failure after the first Worker went live follows the same steps as a local one: the `saasaloy-deploy` skill lists the Worker rollback, and `docs/runbook-deploy.md` holds what only this project knows.
