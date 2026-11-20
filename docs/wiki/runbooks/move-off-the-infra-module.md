# Move off the `infra` module

The `infra` module deployed every Worker through a Pulumi program and kept its state in `infra/state/`. It is gone ([ADR 0043](../../adr/0043-adr-wrangler-native-deploy-in-the-base-2026-10-18.md)). The base template now deploys with `pnpm deploy:production`, which runs `wrangler deploy` for each Worker. This runbook moves a project from the last release that shipped `infra` to the new command, and keeps its live Workers and data.

Nothing in your Cloudflare account changes. The same Workers and the same data stay where they are, and wrangler takes over the deploys that Pulumi did.

The releases that shipped `infra` kept the database on D1, through a driver Saasaloy no longer ships ([Why Postgres, not D1](../why-postgres.md)). This runbook moves the deploys only. Moving the data to Postgres is yours to plan, and no Saasaloy release does it.

## Never run `pulumi destroy`

`pulumi destroy` deletes every resource in the stack: the Workers and the database, with its data. Nothing in this runbook needs it. Do not run `pnpm --filter @repo/infra run destroy` either; it is the same command.

## Symptoms

- `saasaloy doctor` reports `infra/ is the Pulumi deploy that pnpm deploy:production replaced`.
- `saasaloy update` installs `pnpm deploy:production`, but the project still has an `infra/` workspace, an `infra` row in `packages/env/src/services.ts`, and a `# @services infra` section in `packages/env/.env.example`.
- `saasaloy update` from 0.10.0 refuses with exit 2, because the lock still lists `infra` and the registry at that release has no `infra` module.

## 1. Keep the old state until the end

Commit your current tree first. `infra/state/` is what lets you go back to `pulumi up`, so leave it in git until step 6 passes.

## 2. Point wrangler at the existing resources

`infra` named each Worker after the `name` in its `wrangler.jsonc`, and it created the database under the binding's `database_name`. Wrangler uses the same names, so a deploy updates the same Worker and finds the same database.

- **Keep every name as it is.** Do not rename a Worker, a `database_name`, a bucket or a queue. A new name creates a new, empty resource. The project-name prefix that new installs get (issue #197) is not for an existing project.
- **Remove the database placeholder.** `infra` left `"database_id": "local"` in `apps/api/wrangler.jsonc`. Delete that line, or replace `local` with the real id from the database resource's `uuid` under `infra/state/`. Wrangler sends any id it finds, so leaving `local` breaks every remote command.
- **KV, R2 and queues are already right.** `infra` never created them. You created them with wrangler and put the ids in `wrangler.jsonc`, and they stay.

## 3. Move the credentials

The deploy credentials move from `infra/.env` to the `deploy` service.

- `CLOUDFLARE_API_TOKEN` keeps its name.
- `CLOUDFLARE_DEFAULT_ACCOUNT_ID` becomes `CLOUDFLARE_ACCOUNT_ID`, the name wrangler reads.
- `PULUMI_CONFIG_PASSPHRASE` goes. Nothing reads it.

With the `local` value source, put both keys in `packages/env/.env.prod`, with the production value of every other key the project lists. With `env-infisical`, put them in a `/deploy` folder in the `prod` environment.

## 4. Remove the module

```bash
pnpm dlx saasaloy@0.9.0 remove infra
```

Run `remove` with 0.9.0, the last release of the old engine. Its `remove` works offline from the project's manifest. From 0.10.0, `remove` renders the project from the registry, which has no `infra` module since 0.6.0, and it refuses a project an older CLI wrote. The 0.9.0 `remove` deletes the files `infra` installed and takes back its patch to `packages/env/src/services.ts`. It leaves `infra/state/` and `infra/.env`, which it did not write. Then finish by hand:

- In `pnpm-workspace.yaml`, delete the `"infra"` entry under `packages:` and the `protobufjs: true` line under `allowBuilds:`.
- In `packages/env/.env.example`, change `# @services infra` to `# @services deploy`, rename `CLOUDFLARE_DEFAULT_ACCOUNT_ID` to `CLOUDFLARE_ACCOUNT_ID`, and delete `PULUMI_CONFIG_PASSPHRASE`.
- Check that `packages/env/src/services.ts` has a `{ name: "deploy", environment: "prod", omit: [] }` row and no `infra` row. From 0.10.0 the file is written once: `saasaloy update` changes it only under `saasaloy update --merge packages/env/src/services.ts`, and update note `base/0008-generated-tables` says how to move its module rows into `services.generated.ts`.
- Run `pnpm install`.

## 5. Check before anything uploads

```bash
pnpm deploy:production --dry-run
pnpm --filter @repo/web run deploy -- --dry-run
```

The first command reports every deploy gate, the deploy order and the smoke checks, and runs the env check, which names every blank production key. It builds nothing. The second builds the web app with the production values and uploads nothing. Wrangler prints "Using redirected Wrangler configuration" for `apps/web`.

## 6. Deploy

```bash
pnpm deploy:production --migrate
```

Commit and push first: the deploy starts only from a clean tree that matches origin. The project has no deploy tag yet, so every migration file counts as new and the migration gate asks for `--migrate`. Each Worker prints its `workers.dev` URL. `db:prod:migrate` runs first and applies only the pending migrations. Open the api and check that a request reading the database returns the data you had.

## 7. Delete what is left

Once step 6 passes, delete `infra/` (the state and the old `.env` with it) and commit. The Pulumi state now describes resources that wrangler manages, and nothing reads it.

## Rolling back

Before step 7, restore `infra/` and the files step 4 changed from git, run `pnpm install`, and deploy with `pnpm --filter @repo/infra run deploy` as before. After step 7, the way back is the last release that ships `infra`, installed with a CLI older than 0.10.0 as `pnpm dlx saasaloy@0.9.0 add mimukit/saasaloy@<tag>/infra`, with the state restored from git history. From 0.10.0, `add` refuses a ref on the default registry.

## `infra-ci-deploy` is something else

A later module named `infra-ci-deploy` (issue #199) writes a GitHub Actions workflow that runs `pnpm deploy:production` on a push to `main`. It has nothing to do with the deleted `infra` module, holds no Pulumi program, and needs no step from this runbook.

_Verified against `main`@`b86486c3` on 2026-11-21._
