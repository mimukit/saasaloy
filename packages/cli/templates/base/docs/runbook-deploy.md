# Runbook: deploy {{PROJECT_NAME}} to production

This file belongs to the project. `saasaloy init` wrote it once, and `saasaloy update` never writes it again. Fill in each section marked "Fill in" for this project, and keep it true as production changes.

The general flow lives in the `saasaloy-deploy` skill (`.agents/skills/saasaloy-deploy/SKILL.md`): the go-ahead rule for agents, the release, the gates and what clears each one, `--migrate`, `--skip-ci` and `--only`, the hotfix branch and the Worker rollback. This runbook holds what only this project knows.

## Commands

Each deploy is two steps: `pnpm release`, then `pnpm deploy:production`. The release tags the commit `v<version>` and writes its `CHANGELOG.md` entry. The deploy names that version in its `deploy-*` tag.

| Command | What it does |
| --- | --- |
| `pnpm release:dry` | Prints the next version and the changelog entry. Changes nothing. |
| `pnpm release` | Bumps the root `package.json` version, writes `CHANGELOG.md`, commits `chore(release): v<version>`, tags `v<version>`, pushes, and creates a GitHub Release. `pnpm release minor`, `major` or `<version>` picks the bump. |
| `pnpm deploy:production --dry-run` | Prints the last deploy tag, the commits since it, every gate, the deploy order and the smoke checks, and runs the env check. Builds, uploads, migrates and tags nothing. |
| `pnpm deploy:production` | The gates, the env check, every Worker in order, the smoke checks, then the deploy tag. |
| `pnpm deploy:production --migrate` | The same, with the production migration before the first Worker. |
| `pnpm deploy:production --skip-ci "<reason>"` | Passes the CI gate when GitHub Actions is down. The reason goes into the tag message. |
| `pnpm deploy:production --only <service>` | One Worker and its smoke checks, after the gates. Writes no tag. |
| `git describe --tags --match 'deploy-*' --abbrev=0` | Names the last deploy, which is what is live. |
| `git log <tag>..main` | Lists what the next deploy ships. |
| `git describe --tags --match 'v*' --abbrev=0` | Names the last release. |

With a database module installed, `pnpm db:prod:dump` takes a dump into `~/<project>-backups/` (or `DB_DUMP_DIR`), and `pnpm db:prod:migrate` runs the production migration. `pnpm deploy:production --migrate` calls the second one for you.

## Production

Fill in: one row per Worker, from `DEPLOY_TARGETS` in `packages/tooling/src/targets.ts`.

| Worker | Workspace | Address | What it is |
| --- | --- | --- | --- |
| `{{PROJECT_NAME}}-web` | `apps/web` | `https://<host>` | Astro site |

A smoke check runs only against a `custom_domain: true` route in the Worker's `wrangler.jsonc`. List each host here once its route is in place.

## Hosting

Fill in: where each part of production runs and who has access.

- The Cloudflare account, and the zone each host sits on.
- The database, when the project has one: where it runs, its name (`<project>_production` for Postgres), and how a deploy machine reaches it.
- The value source for production values: `packages/env/.env.prod` on which machine, or the secrets manager. Name where its only copy is kept.
- Who may deploy, and from which machine.

## The first deploy

Fill in: the steps this project took for its first deploy, as a record. Every deploy after it follows the `saasaloy-deploy` skill.

A starting order:

1. Fill `packages/env/.env.prod`, or the production environment of the value source, and run `pnpm deploy:production --dry-run` until the env check passes.
2. With a database: `pnpm db:prod:dump` on the empty database, to prove the backup path before there is anything to lose.
3. Add a `custom_domain` route to each Worker that has a production host, so the smoke checks run.
4. Commit, push, run `pnpm release` (the first release is `v0.1.0`, and its changelog entry covers every commit so far), then `pnpm deploy:production --migrate`. With no deploy tag yet, every migration file counts as new, so the first deploy with a database needs `--migrate`.
5. Check each production host in a browser, including sign-in when the project has it.

## Restore data from a dump

Fill in and test this before you rely on it. A code rollback does not undo a migration, and a restore loses every write since the dump was taken. Only the owner decides on a restore.

- Postgres: `db:prod:dump` and `db:prod:migrate` write a `pg_dump --format=custom` file named `<project>_production-<UTC time>.dump`. Restore it with `pg_restore --clean --if-exists --single-transaction`, through `pnpm --filter @repo/db exec env-deploy --run api -- <command>` so `DATABASE_URL` is the production value. Write the exact command for this project here.
- D1: `db:prod:dump` writes a SQL file. Restore it with `wrangler d1 execute <database_name> --remote --file <dump>`, or roll the database back in place with D1 Time Travel (`wrangler d1 time-travel restore`).

After a restore, roll the api back to the version that matches that schema.

## Hotfix releases

A hotfix branch makes its own patch release, such as `v0.3.1`. Merging it back into `main` after `main` has released conflicts in `CHANGELOG.md` and in the root `package.json` `version`: keep both changelog entries and the higher version. The `saasaloy-deploy` skill has the steps. This path has not run on a real project yet, so write down what happened here the first time.

## When something fails

Fill in: the failures this project has met in production, each with its cause and its fix.
