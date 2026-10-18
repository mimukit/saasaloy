# Move off the `infra` module

The `infra` module deployed every Worker through a Pulumi program and kept its state in `infra/state/`. It is gone ([ADR 0043](../../adr/0043-adr-wrangler-native-deploy-in-the-base-2026-10-18.md)). The base template now deploys with `pnpm deploy:production`, which runs `wrangler deploy` for each Worker. This runbook moves a project from the last release that shipped `infra` to the new command, and keeps its live Workers and data.

Nothing in your Cloudflare account changes. The same Workers and the same D1 database stay where they are, and wrangler takes over the deploys that Pulumi did.

## Never run `pulumi destroy`

`pulumi destroy` deletes every resource in the stack: the Workers and the D1 database, with its data. Nothing in this runbook needs it. Do not run `pnpm --filter @repo/infra run destroy` either; it is the same command.

## Symptoms

- `saasaloy doctor` reports `infra/ is the Pulumi deploy that pnpm deploy:production replaced`.
- `saasaloy update` installs `pnpm deploy:production`, but the project still has an `infra/` workspace, an `infra` row in `packages/env/src/services.ts`, and a `# @services infra` section in `packages/env/.env.example`.

## 1. Keep the old state until the end

Commit your current tree first. `infra/state/` is what lets you go back to `pulumi up`, so leave it in git until step 6 passes.

## 2. Point wrangler at the existing resources

`infra` named each Worker after the `name` in its `wrangler.jsonc`, and it created each D1 database under the binding's `database_name`. Wrangler uses the same names, so a deploy updates the same Worker and finds the same database.

- **Keep every name as it is.** Do not rename a Worker, a `database_name`, a bucket or a queue. A new name creates a new, empty resource. The project-name prefix that new installs get (issue #197) is not for an existing project.
- **Remove the D1 placeholder.** `infra` left `"database_id": "local"` in `apps/api/wrangler.jsonc`. Delete that line, or replace `local` with the real id. Find the real id with `pnpm --filter @repo/db exec wrangler d1 info app-db` (use your `database_name`), or in the D1 resource's `uuid` under `infra/state/`. Wrangler sends any id it finds, so leaving `local` breaks every remote command.
- **KV, R2 and queues are already right.** `infra` never created them. You created them with wrangler and put the ids in `wrangler.jsonc`, and they stay.

## 3. Move the credentials

The deploy credentials move from `infra/.env` to the `deploy` service.

- `CLOUDFLARE_API_TOKEN` keeps its name.
- `CLOUDFLARE_DEFAULT_ACCOUNT_ID` becomes `CLOUDFLARE_ACCOUNT_ID`, the name wrangler reads.
- `PULUMI_CONFIG_PASSPHRASE` goes. Nothing reads it.

With the `local` value source, put both keys in `packages/env/.env.prod`, with the production value of every other key the project lists. With `env-infisical`, put them in a `/deploy` folder in the `prod` environment.

## 4. Remove the module

```bash
saasaloy remove infra
```

`remove` works offline from the project's manifest. It deletes the files `infra` installed and takes back its patch to `packages/env/src/services.ts`. It leaves `infra/state/` and `infra/.env`, which it did not write. Then finish by hand:

- In `pnpm-workspace.yaml`, delete the `"infra"` entry under `packages:` and the `protobufjs: true` line under `allowBuilds:`.
- In `packages/env/.env.example`, change `# @services infra` to `# @services deploy`, rename `CLOUDFLARE_DEFAULT_ACCOUNT_ID` to `CLOUDFLARE_ACCOUNT_ID`, and delete `PULUMI_CONFIG_PASSPHRASE`.
- Check that `packages/env/src/services.ts` has a `{ name: "deploy", environment: "prod", omit: [] }` row and no `infra` row. `saasaloy update` lists that file in its merge plan, because the project owns it.
- Run `pnpm install`.

## 5. Check before anything uploads

```bash
node packages/env/src/deploy.ts --check
pnpm turbo run deploy --filter @repo/web -- -- --dry-run
```

The first command names every blank production key. The second builds the web app with the production values and uploads nothing. Wrangler prints "Using redirected Wrangler configuration" for `apps/web`.

## 6. Deploy

```bash
pnpm deploy:production
```

Each Worker prints its `workers.dev` URL. With `database-d1`, `db:migrate:prod` runs first and finds the existing database by name, so it creates nothing and applies only the pending migrations. Open the api and check that a request reading the database returns the data you had.

## 7. Delete what is left

Once step 6 passes, delete `infra/` (the state and the old `.env` with it) and commit. The Pulumi state now describes resources that wrangler manages, and nothing reads it.

## Rolling back

Before step 7, restore `infra/` and the files step 4 changed from git, run `pnpm install`, and deploy with `pnpm --filter @repo/infra run deploy` as before. After step 7, the way back is the last release that ships `infra`, installed as `saasaloy add mimukit/saasaloy@<tag>/infra`, with the state restored from git history.

## `infra-ci-deploy` is something else

A later module named `infra-ci-deploy` (issue #199) writes a GitHub Actions workflow that runs `pnpm deploy:production` on a push to `main`. It has nothing to do with the deleted `infra` module, holds no Pulumi program, and needs no step from this runbook.
