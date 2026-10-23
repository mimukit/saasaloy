---
name: saasaloy-deploy
description: Runbook for an AI agent that releases and deploys this project to production with pnpm release and pnpm deploy:production. Use when the owner says "deploy", "ship this", "release", "cut a release", "bump the version", "update the changelog", "put this live", "hotfix production", "roll back production", "what is live", or "what will the next deploy ship", when a release or a deploy stops at a gate, or when editing packages/tooling/src/deploy.config.ts or targets.ts. Covers the go-ahead rule, the release and its changelog, the dry-run report, the gates and what clears each one, --migrate, --skip-ci and --only, smoke checks on a custom domain, the hotfix branch, and the rollback.
---

# saasaloy-deploy

A production deploy is two commands, in this order. `pnpm release` gives the commit a version and a changelog entry (see "The release"). `pnpm deploy:production` then puts it live.

`pnpm deploy:production` runs `packages/tooling/src/deploy-production.ts`. It does every mechanical step, in this order, and stops at the first failure:

1. **Gates.** The branch, the tree, origin, CI and new migrations. A real run lists every failed gate at once, each with the command that clears it, and builds nothing.
2. **Env check.** `node packages/env/src/deploy.ts --check` names every blank production key. The `saasaloy-env` skill covers the values.
3. **Migration**, with `--migrate` only: `pnpm --filter @repo/db run db:prod:migrate`.
4. **Workers**, one at a time, lowest `order` first from `DEPLOY_TARGETS` in `packages/tooling/src/targets.ts`. Each runs its own `deploy` script, `env-deploy <service>`.
5. **Smoke checks.** Each `SMOKE_CHECKS` row is requested on every custom domain of its service, three tries, 5 seconds apart.
6. **Tag.** HEAD gets an annotated `deploy-<UTC yyyymmdd-hhmm>` tag, pushed to origin. Its message names the release, such as `Production deploy of c75d4e1 (v0.1.0): api, admin, web.` A run that fails any step writes no tag.

The deploy prints the release on HEAD before the gates. When HEAD is not a release commit, it prints a warning that lists the commits `CHANGELOG.md` does not cover, and it still deploys. That warning is never a gate, so an urgent hotfix goes out first.

This skill covers what the command cannot decide: what the owner approves, what to read, and what to do when a step fails. `docs/runbook-deploy.md` holds this project's own steps: the first deploy, the hosting and the data restore.

## The rule

**Never run `pnpm release` or a real deploy without the owner's go-ahead in this session.** A go-ahead is a message from the owner, after your dry-run report, that tells you to release, to deploy, or both. "Deploy" in the first request is not a go-ahead for a run you have not reported yet. A go-ahead covers the commands your report named, once each. When a run fails and you change anything, report again and wait again.

You may run these without asking:

- `pnpm release:dry`, any number of times. It prints the next version and the changelog entry, and commits, tags and pushes nothing.
- `pnpm deploy:production --dry-run`, any number of times. It runs the env check and builds, uploads, migrates and tags nothing.
- Read-only git: `git describe --tags --match 'deploy-*' --abbrev=0`, `git log <tag>..HEAD`, `git show <tag>`.
- `pnpm --filter <package> exec env-deploy --run <service> -- wrangler deployments list`, for each deploy target.

Only the owner decides these, each in its own message:

- `--migrate`. The owner reads the SQL you show and says yes.
- `--skip-ci "<reason>"`. Use it only when GitHub Actions itself is down, never for a red run. The owner gives the reason.
- `--only <service>`.
- `pnpm release major`, or an exact version. Below 1.0 a breaking change bumps the minor, so `1.0.0` is the owner's choice.
- A deploy with no release first, for an urgent hotfix.
- `wrangler rollback`, and the restore of a database dump.

Never do these:

- Move, delete or re-create a deploy tag or a release tag.
- Edit a released `CHANGELOG.md` entry, or the root `package.json` `version`, by hand. `pnpm release` writes both.
- Edit `packages/env/.env.prod`, or print a value from it.
- Commit with `--no-verify`, stash or discard files to pass the tree gate.
- Deploy a Worker with `pnpm --filter <package> run deploy` or `wrangler deploy`. Both skip the gates, the order and the tag. Use `pnpm deploy:production --only <service>` for one Worker.
- Push to `main` without the owner's approval.

## Procedure

1. Bring the checkout up to date:
   ```sh
   git switch main && git pull --ff-only
   pnpm install
   ```
2. Check for unpushed commits and uncommitted files:
   ```sh
   git status -sb
   ```
   `pnpm release` pushes every local commit with the release commit, so a commit from another session would go to origin unreviewed. When the first line shows `ahead`, or any file is listed, stop and ask the owner what to do with them.
3. Run both dry runs:
   ```sh
   pnpm release:dry
   pnpm deploy:production --dry-run
   ```
4. When the deploy dry run lists migration files, print each `.sql` file it names and read it.
5. Write the report. Use the template below.
6. Stop. Wait for the owner's go-ahead.
7. Run the release the owner approved, then wait for CI on the release commit when the config names a workflow:
   ```sh
   pnpm release                      # or pnpm release minor, major, <version>
   gh run watch
   ```
8. Run the deploy the owner approved, with exactly the flags in the report:
   ```sh
   pnpm deploy:production            # or with --migrate, --skip-ci "<reason>", --only <service>
   ```
9. Check what the smoke checks do not cover, such as a sign-in flow, in a browser. Use `playwright-cli` when `command -v playwright-cli` finds it. Otherwise list the pages for the owner.
10. Report the result. Use the template below.

## The dry-run report

```markdown
**Deploy proposal** for <branch> at <short sha>

Last deploy: <tag, or "none, this deploy writes the first tag">

Release: <the version and the changelog entry pnpm release:dry printed | "none: an urgent hotfix, released after">

Commits this deploy ships:
- <sha> <subject>
- ...

Migrations: <none | the file names, each with a one-line summary of its SQL, and a note on any statement that drops, renames or rewrites data>

Gates: <all pass | each line the dry run printed as fail>

Env check: <passed | the blank keys it named>

Deploy order: <as the dry run printed it>

Smoke checks: <the URLs | the services it skipped for want of a custom domain>

Commands I will run: `pnpm release <increment, when one>`, then `pnpm deploy:production <flags>`

Risks: <a commit that changes sign-in, payment or an authorization check; a migration that is not additive; "none seen">
```

Leave out a section only when it is empty. Do not claim a commit is safe without reading its diff. Name the files you read.

## The release

`pnpm release` runs `packages/tooling/src/release.ts`, which runs release-it with options it builds from `deploy.config.ts`. It reads no `.release-it.json`, and it never asks a question. In one run it:

1. Reads the Conventional Commits since the last release tag and picks the next version: a `fix` bumps the patch, a `feat` the minor, a breaking change the major. Below 1.0 a breaking change bumps the minor (`preMajor`).
2. Writes the version into the root `package.json` and a new entry at the top of `CHANGELOG.md`.
3. Commits both as `chore(release): v<version>`, tags the commit `v<version>`, pushes, and creates a GitHub Release.

The changelog shows `feat`, `fix`, `perf` and `revert` commits. A commit of any other type shows only when it is breaking, under its own heading, such as `Miscellaneous Chores` for a breaking `chore!`. The first release covers every commit since the project start, so its entry is long.

| Command | What it does |
| --- | --- |
| `pnpm release:dry` | Prints the next version and the changelog entry. Changes nothing. |
| `pnpm release` | The version the commits ask for. |
| `pnpm release patch`, `minor`, `major` | That bump, whatever the commits ask for. |
| `pnpm release 1.2.3` | That exact version. |

It refuses to start, and changes nothing, when:

| The run prints | Clear it with |
| --- | --- |
| `Must be on branch ...` | The release takes the deploy's `branches`. `git switch main`, or release from the hotfix branch. |
| `Working dir must be clean` | Commit or ask the owner. Never turn the check off: release-it commits with `git add . --update`, so a dirty file would go into the release commit. |
| `No upstream configured for current branch` | `git push -u origin <branch>`. |
| `There are no commits since the latest tag` | Nothing to release. Deploy without one, or wait for a commit. |
| `a GitHub Release needs a token and none was found` | `gh auth login`, or set `GITHUB_TOKEN`. The owner may set `release.githubRelease: false` instead. |

## The gates and what clears each one

The gate values come from `packages/tooling/src/deploy.config.ts`. A key the file leaves out falls back to the default shown.

| Gate | It passes when | The run prints | Clear it with |
| --- | --- | --- | --- |
| Branch | The branch matches `branches` (default `["main", "hotfix-*"]`; a trailing `*` matches any rest). | `The branch is <x>, and a deploy starts only from ...` | `git switch main`. For a fix while `main` holds unreleased work, see "Hotfix". |
| Tree | `git status --porcelain` is empty. | `The tree has uncommitted changes (...)` | `git commit`, or `git stash push -u`. An agent asks the owner what to do with the named files. A file the build itself changed is a bug to fix, not to stash. |
| Origin | HEAD is the same commit as `origin/<branch>`. | `origin has no <branch>`, or `HEAD (...) is not origin/<branch> (...)` | `git push -u origin <branch>`, or `git pull --ff-only`, or `git push`. |
| CI | `ciWorkflow` names no workflow (the gate is off), or a run of that workflow on HEAD succeeded. | `<workflow> failed on HEAD`, `is still running`, or `has no run on HEAD` | `gh run watch`, then the dry run again. A failed run: read it with `gh run view <id> --log-failed`, fix, push. When GitHub Actions is down: `--skip-ci "<reason>"`. |
| Migrations | No file matching `migrations` (default `packages/db/migrations/*.sql`) changed since the last deploy tag, or `--migrate` is set. With no tag yet, every migration file counts as new. | `<n> migration file(s) changed since <tag>` | Read the SQL, then `pnpm deploy:production --migrate`. |

Two more checks stop the run before the gates, because the deploy order would be a guess:

| The run prints | Clear it with |
| --- | --- |
| `apps/<service> deploys and has no DEPLOY_TARGETS row` | Add `{ service: "<service>", order: <number> }` to `DEPLOY_TARGETS`. `saasaloy doctor` warns about the same state. |
| `DEPLOY_TARGETS names <service>, and apps/<service> is not a workspace with a wrangler.jsonc and a deploy script`, a service or smoke `id` listed twice, or a `SMOKE_CHECKS` row for a service that does not deploy | Remove or fix the row in `packages/tooling/src/targets.ts`. |
| `this repository has no commit yet` | Make the first commit and push it, as the message says. |

A failure after the gates:

| The run prints | What it means, and what to do |
| --- | --- |
| `<service> has no production value for <KEY>`, or another env check line | Nothing built. Report the key names. The owner sets the values. |
| `Migrate failed. No deploy tag was written.` | No Worker deployed. Read the migration output. The migration output names the dump it took first. |
| `Deploy <service> failed. No deploy tag was written.` | That Worker did not go live. A Worker before it in the order is live on the new commit, and the run prints its rollback command. |
| `The Workers are live, and a smoke check failed` | Follow "Roll back" at once: report the failing URL and its status, and propose the rollback the run printed. |
| `... and the push failed, so the tag is local only` | The Workers are live. Run `git push origin <tag>`. |

## The flags

- `--dry-run` prints the last deploy tag, the commits since it, the new migration files, every gate, the deploy order and the smoke checks, then runs the env check. It exits 0 and ends with the list of what would stop a real run.
- `--migrate` runs `pnpm --filter @repo/db run db:prod:migrate` after the env check and before the first Worker, so a new migration lands before the code that reads it. A project with no `@repo/db` workspace refuses the flag. Keep each migration additive (a new table, a nullable or defaulted column), so old code runs on the new schema and a code rollback stays safe.
  - `database-postgres`: `db:prod:migrate` checks that `DATABASE_URL` names `<project>_production` on a server other than the development one in `apps/api/.env`. It then dumps the database with `pg_dump` and applies the migrations with `drizzle-kit migrate`. No migration runs without a good dump.
  - `database-d1`: `db:prod:migrate` runs `wrangler d1 migrations apply DB --remote`, and creates the database first when the account has none by its `database_name`. Before it migrates an existing database, it dumps it with `wrangler d1 export --remote`. No migration runs without a good dump. A database it has just created gets no dump, because it holds nothing.
- `--skip-ci "<reason>"` passes the CI gate. The reason goes into the tag message. Every other gate still runs.
- `--only <service>` deploys one Worker after the same gates, and runs only its smoke checks. It writes no tag, because the tag means "this commit is live on every Worker".

`pnpm db:prod:dump` takes a dump on its own: `pg_dump --format=custom` for Postgres, `wrangler d1 export --remote` for D1. Dumps land in `~/<project>-backups/` (mode 0700), or in `DB_DUMP_DIR` when it is set, outside the repository. For Postgres, `pg_dump` runs from the `postgres:<major>` image the root `compose.yaml` names, through Docker. Set `PG_DUMP=local` to use the `pg_dump` on `PATH` instead.

## Changing the gates, the order and the smoke checks

`packages/tooling/src/deploy.config.ts` and `packages/tooling/src/targets.ts` belong to the project. `saasaloy init` writes them once, and `saasaloy update` never writes them again. The engine reads every key with a default, so an older copy keeps working.

`deploy.config.ts`:

- `branches`: the branches a deploy may start from.
- `tagPrefix`: the start of every deploy tag. Change it only before the first deploy, or the engine no longer finds the older tags.
- `ciWorkflow`: the GitHub Actions workflow file that must pass on HEAD, such as `"ci.yml"`. `undefined` turns the CI gate off.
- `migrations`: the git pathspec for migration files.
- `release`: what `pnpm release` writes. `tagPrefix` (default `v`; change it only before the first release), `githubRelease` (default `true`), `preMajor` (default `true`), and `changelogSections`, the `conventionalcommits` preset's `types` list. Unset keeps the preset's sections. A key left out falls back to its default.

`targets.ts` holds two arrays. Keep each in the shape `export const NAME: Type[] = [...]`, because `saasaloy add` appends its rows there with a `const-array` patch, and `saasaloy remove` takes them out again.

- `DEPLOY_TARGETS`: `{ service, order }`. `service` is the directory under `apps/`. The base adds `web` (30), the api module `api` (10) and the admin module `admin` (20). A new Worker needs its own row, or the deploy stops and names it.
- `SMOKE_CHECKS`: `{ id, service, path, status, body? }`. `body` is text the response body must contain. The `id` stays unique.

**A smoke check needs a custom domain.** The engine takes the host from each `routes[]` entry with `custom_domain: true` in `apps/<service>/wrangler.jsonc`. A service with none gets no smoke check, and the run says so. It never guesses a `workers.dev` address. To turn the checks on, add the route and deploy:

```jsonc
// apps/api/wrangler.jsonc
"routes": [{ "pattern": "api.example.com", "custom_domain": true }]
```

Wrangler creates the domain on the next deploy when the zone is on the same Cloudflare account. The next `pnpm deploy:production --dry-run` lists the smoke URLs for that host.

## Hotfix

Use this when live code needs a fix and `main` holds commits that must not go live yet. There is no long-lived production branch: the newest deploy tag marks what is live.

1. Start the branch from the live commit:
   ```sh
   git switch -c hotfix-<slug> "$(git describe --tags --match 'deploy-*' --abbrev=0)"
   ```
2. Make the fix, run `pnpm typecheck`, `pnpm lint` and `pnpm test`, and commit.
3. Ask the owner to approve the push. Then push it:
   ```sh
   git push -u origin hotfix-<slug>
   ```
4. Wait for CI on the branch when the config names a workflow. Then follow "Procedure" from step 2 on this branch. `pnpm release` on the branch makes a patch release such as `v0.3.1`. When the fix cannot wait for the release, the owner may deploy first and release after.
5. After the deploy, ask the owner to merge the fix into `main`, so the next deploy keeps it. Merge, never rebase: a rebase rewrites the commit the release tag names.
   ```sh
   git switch main && git merge hotfix-<slug>
   ```
   When `main` has released since the hotfix branched, the merge conflicts in `CHANGELOG.md` and in the root `package.json` `version`. Keep both changelog entries, newest version first, and keep the higher version. Then commit the merge and push:
   ```sh
   git push
   git branch -d hotfix-<slug> && git push origin --delete hotfix-<slug>
   ```

A release from a hotfix branch has not run on a real project yet. Read its `pnpm release:dry` output closely.

## Roll back

1. Report the failure and propose the rollback. Wait for the owner's go-ahead.
2. Roll back each broken Worker to its previous version. A failed run prints one line per Worker it deployed, in this form:
   ```sh
   pnpm --filter <package> exec env-deploy --run <service> -- wrangler rollback
   ```
   `wrangler deployments list` in the same form lists the versions. `wrangler rollback <version-id>` picks an older one.
3. Request the smoke-check URLs again, and check that each answers as `SMOKE_CHECKS` expects.
4. Propose a `git revert <sha>` on `main` for the bad commit, so the next deploy does not ship it again. Leave the deploy tags alone. After a rollback, the live code is the previous tag's commit, and the next deploy tags the revert.

A code rollback does not undo a migration. A data restore loses every write since the dump. Only the owner decides on it, with the steps in `docs/runbook-deploy.md`.

## The result report

```markdown
**Deployed** <short sha> as <tag> (<UTC time>)

Release: <v-version, with its GitHub Release link | "none", and why>
Ran: `pnpm release <increment>`, then `pnpm deploy:production <flags>`
Migration: <none | the dump file it printed>
Smoke checks: <pass | skipped for <services>, no custom domain>
Browser checks: <each page and its result | "for the owner", with the list>
```

When the run failed, report the step that failed, the error lines, what is live now, and your proposed next step.

## A project made before the gated deploy

`saasaloy update` adds `packages/tooling` and this skill. It lists the root `package.json`, `turbo.json` and `AGENTS.md` in the merge plan when you edited them. Finish by hand:

1. Merge the root `package.json` scripts: `deploy:production` is `node packages/tooling/src/deploy-production.ts`, `prepare` is `husky && node packages/tooling/src/link-skills.ts`, `skills:link` is `node packages/tooling/src/link-skills.ts`, and `lint:types` and `lint:fix` include `packages/tooling/src`.
2. Merge `turbo.json`: remove `^db:migrate:prod` from the `deploy` task's `dependsOn`, and remove the `db:migrate:prod` task.
3. With `database-d1`, check `packages/db/package.json`. It needs `db:prod:migrate` and `db:prod:dump`, and the old `db:migrate:prod` script goes: rename it to `db:prod:migrate` if the update did not add that one. A D1 deploy no longer migrates on its own. Run `pnpm deploy:production --migrate` when the migration gate asks for it.
4. Run `saasaloy doctor`. Its Deploy warnings name a `turbo.json` that still has `db:migrate:prod`, and each deploying workspace with no `DEPLOY_TARGETS` row. Each warning prints its fix.
5. Add a `custom_domain` route to each Worker that has a production host, so its smoke checks run.
6. Copy `docs/runbook-deploy.md` from a new project if you want the runbook. `saasaloy update` does not create seed files.

## A project made before the release step

`saasaloy update` adds `packages/tooling/src/release.ts` and the two release-it pins in `packages/tooling/package.json`. Finish by hand:

1. Merge the root `package.json` scripts: `release` is `node packages/tooling/src/release.ts`, and `release:dry` is `node packages/tooling/src/release.ts --dry-run`. `saasaloy doctor` warns while they are missing.
2. Delete an older `.release-it.json`, and any `release-it` or `@release-it/conventional-changelog` in the root `package.json`. `release.ts` reads neither. Move a changelog choice into the `release` block of `deploy.config.ts`.
3. Keep `CHANGELOG.md` and the `v*` tags. The next release reads the newest tag and adds its entry above the old ones.

The root `package.json` `version` belongs to the project. `saasaloy update` compares the file as if it held the template's version and keeps yours when it writes, so a release alone never puts the file in a merge plan.
