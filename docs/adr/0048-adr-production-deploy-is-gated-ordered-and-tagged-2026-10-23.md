# 0048: Production deploy is gated, ordered and tagged

`pnpm deploy:production` used to check the production values and then let `turbo run deploy` upload every Worker in parallel (ADR 0043). Nothing checked the branch, the tree, the push state or CI. A frontend could go live before the api route it calls, nothing asked the live hosts whether the deploy worked, and nothing recorded which commit went live. A downstream project wrote its own gated script to close those gaps, and every generated project has the same gaps. Settled on 2026-10-23 in the grill of `docs/plans/0077-plan-gated-production-deploy-2026-10-23.md` for issue [#234](https://github.com/mimukit/saasaloy/issues/234).

## Status

accepted. Amends [ADR 0043](0043-adr-wrangler-native-deploy-in-the-base-2026-10-18.md): wrangler is still the engine, `env-deploy` still loads the production values in memory, and the base still owns deploy. What changes is the root command, the order, and the D1 migration that ran on every deploy.

## The shape

- **The engine lives in a base workspace.** `packages/tooling` (`@repo/tooling`) holds the repo's own tooling. The root script is `"deploy:production": "node packages/tooling/src/deploy-production.ts"`, and that line never needs a project edit again. `packages/env` keeps the values. Git, CI, smoke checks and tags are not values.
- **The project's choices sit in two owned files.** `packages/tooling/src/deploy.config.ts` holds the allowed branches (`["main", "hotfix-*"]`), the tag prefix (`deploy-`), the CI workflow file (unset by default) and the migration glob (`packages/db/migrations/*.sql`). `packages/tooling/src/targets.ts` holds `DEPLOY_TARGETS` and `SMOKE_CHECKS`. Both are in `ownedFiles`, so `saasaloy update` never writes them again and never puts them in a merge plan. The engine reads every config key with a default, so an older config file keeps working.
- **Five gates run before anything builds.** The branch matches the config's list. The tree is clean. HEAD is the same commit as its branch on origin after a `git fetch`. The CI workflow passed on HEAD, when the config names one; with none, the gate is off and the run says so. A migration file that changed since the last deploy tag needs `--migrate`; with no tag yet, every migration file counts as new. A real run with a failed gate stops and prints the command that clears each gate. `--skip-ci "<reason>"` passes the CI gate and writes the reason into the tag message.
- **The order comes from `DEPLOY_TARGETS`.** Each row is `{ service, order }`, lowest first. The base seeds `web` (30), the api module appends `api` (10) and the admin module `admin` (20), each through a `const-array` patch. A deployable workspace (a workspace under `apps/` with a `wrangler.jsonc` and a `deploy` script) with no row stops the run and names it. A row for a service that does not deploy stops it too. Each Worker runs its own `deploy` script with `pnpm --filter <package> run deploy`, one at a time.
- **Smoke checks come from the service's custom domains.** `SMOKE_CHECKS` rows are `{ id, service, path, status, body? }`, keyed by `id` so a module that adds a row twice adds it once. The host is every `routes[]` entry with `custom_domain: true` in the service's `wrangler.jsonc`. A service with no custom domain gets no smoke check and the run says so. The engine never guesses a `workers.dev` address. Each check gets three tries, 5 seconds apart. A failed check writes no tag, exits 1 and prints a `wrangler rollback` command for each Worker it deployed.
- **A deploy that passed every step writes a tag.** The tag is annotated, named `<prefix><UTC yyyymmdd-hhmm>`, and pushed to origin. The newest tag is what is live: a hotfix branch starts from it, and `git log <tag>..main` lists what the next deploy ships. A failed push keeps the tag local, prints `git push origin <tag>` and exits 1. `--only <service>` deploys one Worker and its smoke checks and writes no tag, because the other Workers may run an older commit.
- **`--dry-run` changes nothing.** It reports every gate, the order and the smoke list, runs the env check, and builds, uploads, migrates and tags nothing.
- **A production migration is a deliberate step.** `--migrate` runs `pnpm --filter @repo/db run db:prod:migrate` after the env check and before the first Worker. It is refused in a project with no `@repo/db` workspace. The database drivers name their commands `db:prod:migrate` and `db:prod:dump`, and both run through `env-deploy --run deploy`, so the production values stay in memory. `database-postgres` dumps before it migrates, and its target check requires the database name `<project>_production`.
- **D1 stops migrating on deploy.** The base `turbo.json` loses `^db:migrate:prod` from the `deploy` task and the `db:migrate:prod` task itself, and `database-d1` renames its script to `db:prod:migrate`. Turbo has no deploy role left. The `deploy` task stays, with `passThroughEnv`, for a project that runs `turbo run deploy` by hand.

## Considered Options

- **Grow `packages/env`.** Rejected: it owns environment values, and git, CI, smoke checks and tags are not values.
- **A root `scripts/` folder.** Rejected: no tsconfig, no test run and no type-aware lint reach it in a generated project.
- **A deploy module.** Rejected: every project deploys, and ADR 0043 already puts deploy in the base.
- **Turbo `dependsOn` between apps for the order.** Rejected: `api#deploy` fails when the api is not installed, `turbo.json` is a managed file every module would have to patch, and turbo cannot run a gate or a smoke check.
- **An `order` field on `SERVICES`.** Rejected: that table describes env files, and its `deploy` row has no Worker.
- **Keep `db:migrate:prod` and point it at Postgres too.** Rejected: a project that has not merged the new `turbo.json` would then migrate production on every `turbo run deploy`, a dry run included.
- **Parse the `workers.dev` URL, or add a `host` field, for a service with no custom domain.** Rejected: the first guesses an address, and the second is a second place to keep a host true.

## Consequences

- A D1 project no longer migrates on every deploy. The migration gate names the new files and asks for `--migrate`. The CLI changelog carries the merge steps for an existing project.
- An existing project gets the new root script and `turbo.json` through `saasaloy update`, as a merge plan when it edited either file. The two owned files are created when absent.
- A Worker added by hand under `apps/` stops the next deploy until the project gives it a `DEPLOY_TARGETS` row. `saasaloy doctor` warns about it before a deploy does.
- A partial failure is still possible: a Worker that deployed before a later one failed stays live, and the run prints its rollback command. Migrations must stay backward compatible.
- The CI gate stays off until a project names a workflow. A base CI workflow is a separate plan.

## References

Issue #234. Plan: `docs/plans/0077-plan-gated-production-deploy-2026-10-23.md`. Amends ADR 0043, and follows ADR 0046 (refuse, never guess) for a deployable workspace with no row.
