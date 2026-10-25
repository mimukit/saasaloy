---
name: saasaloy-ci
description: Runbook for the ci module — the static GitHub Actions workflow at .github/workflows/ci.yml, the root ci:prepare script and its ci:prepare:<module> steps, the ci:e2e step, and the deploy CI gate in packages/tooling/src/deploy.config.ts. Use when CI fails, when a change needs a service or a tool ready before lint, typecheck and test run in CI, when adding a CI step for a module, or when turning the deploy CI gate off.
---

# ci — the GitHub Actions gate

`ci` gives the project one workflow, `.github/workflows/ci.yml`, that runs on every push and pull request. It installs three things:

| What | Where it lands |
| --- | --- |
| the workflow | `.github/workflows/ci.yml` |
| `ci:prepare` | root `package.json` script (patch) |
| `ciWorkflow: "ci.yml"` | `packages/tooling/src/deploy.config.ts` (patch) |

The workflow runs these steps, in this order:

1. `pnpm install --frozen-lockfile`. A `package.json` edited without its lockfile fails here.
2. `pnpm ci:prepare`. It runs every root script whose name starts with `ci:prepare:`, one at a time. With none, it does nothing and passes.
3. `pnpm lint`, `pnpm typecheck` and `pnpm test`. `test` passes with no test files, so a project with testing off stays green.
4. `pnpm run --if-present ci:e2e`. It runs only when a module added a `ci:e2e` script.

## The workflow file does not change

The CLI writes `ci.yml` once. No module patches it, and the steps above are the whole file. A module that needs CI work adds a script to the root `package.json` under `when: { installed: ["ci"] }`:

| Module | Script | Runs |
| --- | --- | --- |
| `database-postgres` | `ci:prepare:database` | `docker compose up -d --wait`, the Postgres from `compose.yaml` |
| `e2e` | `ci:prepare:e2e` | `pnpm e2e:install --with-deps`, the Playwright browser |
| `e2e` | `ci:e2e` | `pnpm e2e` |

`saasaloy add ci` after those modules writes their scripts too. `saasaloy remove ci` deletes the workflow and resets `ciWorkflow`, but it leaves the `ci:*` scripts in `package.json` and warns about each one, so delete them by hand. The job sets `DATABASE_URL` to the compose database's literal development credentials. Only the Postgres driver reads it, and the test setup creates `<database>_test` on that server.

To add a CI step of your own, add a `ci:prepare:<name>` script to the root `package.json`. Edit `ci.yml` only for a step that cannot be a script, such as a service container or a secret. `saasaloy update` then reports the file as drifted and keeps your copy.

## The deploy gate

`pnpm deploy:production` checks that `ci.yml` passed on `HEAD` before it deploys, because the module set `ciWorkflow: "ci.yml"` in `packages/tooling/src/deploy.config.ts`. `pnpm deploy:production --dry-run` prints the gate as on. To turn it off, set `ciWorkflow` back to `undefined`. The patch writes only while the value reads `undefined`, so a value you set stays.

## When CI is red

- Run the failing step locally first: `pnpm ci:prepare && pnpm lint && pnpm typecheck && pnpm test`. The workflow runs nothing that a local shell cannot.
- `install` fails with a lockfile error: run `pnpm install` and commit `pnpm-lock.yaml`.
- `ci:prepare:database` times out: the container's health check failed. Read the step log for the `postgres` service output.
