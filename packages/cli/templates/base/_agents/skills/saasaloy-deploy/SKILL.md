---
name: saasaloy-deploy
description: Runbook for an AI agent that releases and deploys this project to production with pnpm release and pnpm deploy:production. Use when the owner says "deploy", "ship this", "release", "cut a release", "bump the version", "update the changelog", "put this live", "hotfix production", "roll back production", "what is live", "what will the next deploy ship", "is this fix live", "write the release walkthrough for v<version>", "write the stakeholder summary for the last release", "make the first superadmin", or "set up the first deploy", when a question about production behavior needs the live code, when a release or a deploy stops at a gate, or when editing packages/tooling/src/deploy.config.ts or targets.ts. Covers the go-ahead rule, answering a production question against the last deploy tag, the first superadmin before the first deploy, the release and its changelog, the release walkthrough and the stakeholder summary when `release.include` lists `docs/release/`, the dry-run report, the gates and what clears each one, the CI wait with --wait-ci, --migrate, --skip-ci and --only, smoke checks on a custom domain, the hotfix branch, and the rollback.
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
- `pnpm deploy:production --dry-run`, any number of times, with or without `--wait-ci`. It runs the env check and builds, uploads, migrates and tags nothing.
- Read-only git: `git describe --tags --match 'deploy-*' --abbrev=0`, `git log <tag>..HEAD`, `git show <tag>`.
- `pnpm --filter <package> exec env-deploy --run <service> -- wrangler deployments list`, for each deploy target.
- `pnpm logs:prod`, and on Postgres `pnpm db:prod:query`. Both are read-only, and both refuse until the owner has written their credential file. The `saasaloy-prod-debug` skill covers them when `database-postgres` is installed.

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
- Query production through `env-deploy --run api`, `psql` with the owner URL, or anything else that loads `packages/env/.env.prod`. That is the owner role, which can write. Read production with `pnpm db:prod:query` only.
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
3. Run both dry runs, and save each one's output to a file:
   ```sh
   mkdir -p .artifacts/deploy
   pnpm release:dry > .artifacts/deploy/release-dry.log 2>&1
   pnpm deploy:production --dry-run > .artifacts/deploy/deploy-dry.log 2>&1
   ```
   Read each file as often as you need. Do not run a dry run again only to see another part of its output: each one reads git and GitHub and runs the env check again. `.artifacts/` is gitignored, so the files do not fail the tree gate.
4. When the deploy dry run lists migration files, print each `.sql` file it names and read it.
   When `release.include` in `packages/tooling/src/deploy.config.ts` lists `docs/release/` and `pnpm release:dry` printed a version, write the release walkthrough and draft the stakeholder summary from the changelog entry it printed. Do not ask first: the setting is the owner's request for both. Follow "The release walkthrough" and "The stakeholder summary" below. Leave the walkthrough untracked.
5. Write the report. Use the template below. When you wrote a walkthrough, add its lines from "The dry-run report". The owner reads the report, the walkthrough and the summary before the go-ahead. When the owner asks for a change to either, make it and show the report again.
6. Stop. Wait for the owner's go-ahead.
7. Run the release the owner approved. Then start a dry run that waits for CI, as a background task, with the flags the owner approved for the deploy:
   ```sh
   pnpm release                      # or pnpm release minor, major, <version>
   pnpm deploy:production --dry-run --wait-ci > .artifacts/deploy/deploy-wait.log 2>&1   # add --migrate, --only <service> when approved
   ```
   When `release.include` lists `docs/release/`, check that `git show --stat HEAD` lists `docs/release/v<version>-walkthrough.md`, and that `git status --short` prints nothing.

   Pass the approved flags, because `--wait-ci` waits only when every other gate passes: without an approved `--migrate`, a new migration file fails its gate and nothing waits. With an approved `--skip-ci`, skip this wait, because the two flags conflict. While it runs, draft the result report from the release notes `pnpm release` printed. When it ends, read the log. When every gate is `ok`, go to step 8. A release commit that changes only the root `version` and `CHANGELOG.md` passes on its parent's green run at once, so it usually does not wait. When a gate fails, report the line it printed and stop.
8. Run the deploy the owner approved, with exactly the flags in the report:
   ```sh
   pnpm deploy:production            # or with --migrate, --skip-ci "<reason>", --only <service>
   ```
9. Check what the smoke checks do not cover, such as a sign-in flow, in a browser. Use `playwright-cli` when `command -v playwright-cli` finds it. Otherwise list the pages for the owner.
10. Report the result. Use the template below. When `release.include` lists `docs/release/`, put the final stakeholder summary under it. Fill in the date and the GitHub Release URL, and check the counts against `gh release view v<version>`. Commit nothing after the deploy.

## Answer a production question against the last deploy tag

Production runs the commit the newest `deploy-*` tag names, not `main`. `main` may hold commits that are not live, and a hotfix tag may name a commit `main` does not have. So when the owner asks how production behaves, why a user saw something, or whether a fix is live, read the code at the tag:

```sh
tag="$(git describe --tags --match 'deploy-*' --abbrev=0)"
git show "$tag":<path>          # a file as production runs it
git log --oneline "$tag"..main  # what main has that production does not
git merge-base --is-ancestor "$tag" main && echo "main holds the live commit"
```

Name the tag in your answer. With no `deploy-*` tag, nothing has deployed through `pnpm deploy:production` yet: say so rather than answer from `main`. For production data and logs, follow the `saasaloy-prod-debug` skill on Postgres. On D1, `pnpm logs:prod` reads the api logs, and there is no read-only database tool.

## The first superadmin, before the first deploy

No sign-up promotes an account: every sign-up gets `user`, the first one included. A project with `auth` needs its first superadmin made by hand, or nobody can open the admin app. The owner does this, because it needs their password and their production credentials.

- **Postgres:** run the migrations, then the superadmin command, then the first deploy. `db:prod:superadmin` writes the `users` and `accounts` tables, so they must exist first. It asks for the password at the prompt.
  ```sh
  pnpm db:prod:migrate
  pnpm db:prod:superadmin --email you@example.com
  pnpm deploy:production --migrate
  ```
  The migration gate still counts every migration file on the first deploy, because there is no tag yet. `--migrate` then finds nothing pending and applies nothing.
- **D1:** deploy, sign up on a client app with the owner's email, then promote that account from `apps/api`. `<db>` is the `database_name` in `apps/api/wrangler.jsonc`:
  ```sh
  wrangler d1 execute <db> --remote --command "update users set role = 'superadmin' where email = 'you@example.com'"
  ```

Then sign in on the admin app with that email. The `saasaloy-auth` skill covers the roles.

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

When `release.include` lists `docs/release/` and the deploy ships a release, add these lines after "Risks":

```markdown
Walkthrough: [v<version>-walkthrough.md](/abs/path/docs/release/v<version>-walkthrough.md), untracked. `pnpm release` commits and pushes it in the release commit.

Stakeholder summary (draft): <the summary, as "The stakeholder summary" writes it>
```

## The release

`pnpm release` runs `packages/tooling/src/release.ts`, which runs release-it with options it builds from `deploy.config.ts`. It reads no `.release-it.json`, and it never asks a question. In one run it:

1. Reads the Conventional Commits since the last release tag and picks the next version: a `fix` bumps the patch, a `feat` the minor, a breaking change the major. Below 1.0 a breaking change bumps the minor (`preMajor`).
2. Writes the version into the root `package.json` and a new entry at the top of `CHANGELOG.md`.
3. Stages each `release.include` path, then commits as `chore(release): v<version>`, tags the commit `v<version>`, pushes, and creates a GitHub Release.

`release.include` (default `[]`) lists paths the release commit also carries. A `before:git:release` hook runs `git add -- '<path>'` for each one just before the commit. `requireCleanWorkingDir` runs `git diff --quiet HEAD`, which ignores untracked files, so a new walkthrough does not stop the release. A tracked file that you edited does. Each path is relative to the repository root and uses only `A-Z a-z 0-9 . _ / -`, with no `..` segment, and it names something below the root, never `.`. A real release refuses a path that does not exist or that git ignores, because its `git add` would fail after the version bump. A release commit that carries the walkthrough changes more than the version and `CHANGELOG.md`, so the CI gate waits for that commit's own run.

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
| `release.include path "<path>" is absolute`, `has a .. segment`, `names the repository root`, or `has a character outside ...` | Fix the path in `release.include` in `deploy.config.ts`. |
| `release.include names <path>, and nothing is there` | Write the walkthrough first, or remove the path from `release.include`. |
| `git ignores release.include path <path>` | Remove the `.gitignore` rule that matches the path, or remove the path from `release.include`. |
| `a GitHub Release needs a token and none was found` | `gh auth login`, or set `GITHUB_TOKEN`. The owner may set `release.githubRelease: false` instead. |

## The release walkthrough

This section applies only when `release.include` in `packages/tooling/src/deploy.config.ts` lists `docs/release/`. Otherwise write no walkthrough.

A release walkthrough is a test guide for admin users and stakeholders, most of them not technical. It walks them through every change in one release that they can see on screen or that changes their daily work. The owner downloads the file and shares it, so do not send or post it. When an older `docs/release/v*-walkthrough.md` exists, copy its structure.

Write it before the release, from the `pnpm release:dry` output, so it ships in the release commit. The version and the release tag do not exist yet, so compare against `HEAD`, and use the GitHub Release URL that the dry run printed for the last line.

1. Read the changelog entry that `pnpm release:dry` printed.
2. Keep each entry that changes a screen or a daily workflow, in the admin app or on a client app. Drop entries for developer tooling, tests, the dev setup, speed, and fixes with no visible effect.
3. Find what changed on screen. `git diff --stat <previous v* tag> HEAD -- apps packages/ui/src/content` lists the new and changed screens. With no release tag yet, every screen is new.
4. Take every page name, button label and message from the screen's words in `packages/ui/src/content/`, and, with the `admin` module, the menu and its groups from `apps/admin/src/components/nav.ts`. Never guess a label.
5. Check where each button sits in its route file, such as `apps/admin/src/routes/<screen>.tsx`. A button in the header, in a menu and in a page section each need a different instruction.
6. Write the guide with the structure below and save it as `docs/release/v<version>-walkthrough.md`. Leave it untracked. `pnpm release` commits it. Never commit the walkthrough on its own, and never leave it for after the deploy.

Structure:

- A title, the release date, and the live URL of each app that changed.
- **Before you start.** The guide runs on the live system. Mark every test **Look only** or **Makes a real change**. Warn testers about a real change that reaches people outside the team, such as an email or a text message, and tell them to use a team member's address or phone for it. Name the buttons only a superadmin sees, so a normal admin knows the refusal is correct.
- One numbered part per area, in the order staff do the work. Put tests that create real records last.
- One numbered subsection per test, with its label in the heading. Each step is a `- [ ]` tick box with one action and what the tester should see.
- Name a screen or a button in bold, exactly as the screen shows it. Give the keyboard shortcut in brackets where one exists.
- Warn against any test that changes things for real users at once.
- **How to send feedback.** Ask for the part number, what the tester did and expected, a screenshot, and the browser and device.
- The GitHub Release URL as the last line, in the form `Release notes: https://github.com/<owner>/<repo>/releases/tag/v<version>`.

The guide is prose for a reader outside the project, so it carries no AI tells: no em or en dash as sentence punctuation, no puffery, plain verbs. Use plain words: "the activity record", not "the audit log"; "the website", not "the web app"; no api, route, query or deploy. Use no commit hashes, issue numbers, scopes or file paths. Do not hard-wrap the Markdown.

When you have not opened the live pages, tell the owner that the labels come from the code and that a tester may find a small difference in wording or position.

## The stakeholder summary

This section applies only when `release.include` lists `docs/release/`.

Every release gets a summary for stakeholders. Draft it before the go-ahead, in the dry-run report, and give the final copy under the result report after the deploy. Do not send it, post it or save it to a file. The owner sends it.

1. Find the release notes. Before the release, read the changelog entry in the `pnpm release:dry` output. After it, read the GitHub Release:
   ```sh
   gh release view v<version> --json body -q .body
   ```
2. Count the `* ` entries under each `###` heading. `### Features` gives the new features and `### Bug Fixes` gives the bug fixes. `### Performance Improvements` gives the improvements. Report `### Reverts` on its own line when it has entries.
3. When the deploy shipped no release (a hotfix), write the summary after the deploy, and take the commits instead: `git log --no-merges --format=%s <previous deploy-* tag>..<new deploy-* tag>`. Count `feat` as features, `fix` as fixes and `perf` as improvements. Leave out `chore`, `docs`, `test`, `ci`, `refactor`, `style` and `build`.
4. Check that the counts add up to the total before you write the summary.
5. Write the summary with the template below. Group the entries by what a user or an admin sees, not by commit. Leave out entries that only change developer tooling, tests or the dev setup, but keep them in the counts.

Above the summary, tell the owner two facts in one or two sentences. Each count is a changelog entry, one per commit, so one feature can span many entries. Name the largest example (an issue number with its entry count) and the number of developer-only entries. Offer counts by user-facing feature when the owner wants them.

The summary is prose for a reader outside the project, with the same rules as the walkthrough. Name the effect for the user, not the code: "the admin app loads faster", not "start the session check with the html". Use no commit hashes, scopes or file paths.

```markdown
**<Product> v<version> is live (<day month year>)**

This release has <total> changes: <n> new features, <n> bug fixes and <n> performance improvements.

**New features (<n>)**

- <one line per user-facing group, for example "Admin app: new Members screen">

**Bug fixes (<n>)**

- <one line per area, such as sign-in, admin screens, website>

**Performance improvements (<n>)**

- <the effect a user sees>

Full release notes: <GitHub Release URL>
```

`<Product>` is the product name the project shows its users. For a hotfix without a release, use "<Product> hotfix is live (<date>)" as the title, and use the deploy tag in place of the release notes link. Leave out a section that has no entries.

## The gates and what clears each one

The gate values come from `packages/tooling/src/deploy.config.ts`. A key the file leaves out falls back to the default shown.

| Gate | It passes when | The run prints | Clear it with |
| --- | --- | --- | --- |
| Branch | The branch matches `branches` (default `["main", "hotfix-*"]`; a trailing `*` matches any rest). | `The branch is <x>, and a deploy starts only from ...` | `git switch main`. For a fix while `main` holds unreleased work, see "Hotfix". |
| Tree | `git status --porcelain` is empty. | `The tree has uncommitted changes (...)` | `git commit`, or `git stash push -u`. An agent asks the owner what to do with the named files. A file the build itself changed is a bug to fix, not to stash. |
| Origin | HEAD is the same commit as `origin/<branch>`. | `origin has no <branch>`, or `HEAD (...) is not origin/<branch> (...)` | `git push -u origin <branch>`, or `git pull --ff-only`, or `git push`. |
| CI | `ciWorkflow` names no workflow (the gate is off), or a run of that workflow on HEAD succeeded. A run that GitHub still shows as queued or in progress passes when every step of every job ended `success` or `skipped`, because GitHub can mark a run done many minutes after its jobs end. One failed step fails the run at once. A commit with one parent that changes only the root `package.json` `version` line and `CHANGELOG.md` passes on a green run on its parent, and the gate prints `passed on <parent sha>`. | `<workflow> failed on HEAD`, `is still running`, or `has no run on HEAD` | `pnpm deploy:production --dry-run --wait-ci`, which waits for the run. A failed run: read it with `gh run view <id> --log-failed`, fix, push. When GitHub Actions is down: `--skip-ci "<reason>"`. |
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
  - `database-postgres`: `db:prod:migrate` checks that `DATABASE_URL` names `<project>_production` on a server other than the development one in `apps/api/.env`. It then dumps the database with `pg_dump` and applies the migrations with `drizzle-kit migrate`. No migration runs without a good dump. After the migration it re-applies the read-only role's grants, as `pnpm db:prod:readonly-grants` does. A failed grant step prints its error and the migration stands.
  - `database-d1`: `db:prod:migrate` runs `wrangler d1 migrations apply DB --remote`, and creates the database first when the account has none by its `database_name`. Before it migrates an existing database, it dumps it with `wrangler d1 export --remote`. No migration runs without a good dump. A database it has just created gets no dump, because it holds nothing.
- `--skip-ci "<reason>"` passes the CI gate. The reason goes into the tag message. Every other gate still runs.
- `--wait-ci` checks every other gate first. When one fails, the run reports the gates and does not wait. Otherwise it reads the CI gate again every 15 seconds until it passes or fails. A missing run counts as one GitHub has not listed yet for 5 minutes, and the whole wait ends after 30 minutes. The run then goes on with the state it last read: a dry run reports it, and a real run deploys only on a pass. It prints one line a minute while it waits, so a background log shows progress. `--wait-ci` with `--skip-ci` is an error. With no `ciWorkflow`, nothing waits.
- `--only <service>` deploys one Worker after the same gates, and runs only its smoke checks. It writes no tag, because the tag means "this commit is live on every Worker".

`pnpm db:prod:dump` takes a dump on its own: `pg_dump --format=custom` for Postgres, `wrangler d1 export --remote` for D1. Dumps land in `~/<project>-backups/` (mode 0700), or in `DB_DUMP_DIR` when it is set, outside the repository. For Postgres, `pg_dump` runs from the `postgres:<major>` image the root `compose.yaml` names, through Docker. Set `PG_DUMP=local` to use the `pg_dump` on `PATH` instead.

## Changing the gates, the order and the smoke checks

`packages/tooling/src/deploy.config.ts` and `packages/tooling/src/targets.ts` belong to the project. `saasaloy init` writes them once, and `saasaloy update` never writes them again. The engine reads every key with a default, so an older copy keeps working.

`deploy.config.ts`:

- `branches`: the branches a deploy may start from.
- `tagPrefix`: the start of every deploy tag. Change it only before the first deploy, or the engine no longer finds the older tags.
- `ciWorkflow`: the GitHub Actions workflow file that must pass on HEAD, such as `"ci.yml"`. `undefined` turns the CI gate off.
- `migrations`: the git pathspec for migration files.
- `release`: what `pnpm release` writes. `tagPrefix` (default `v`; change it only before the first release), `githubRelease` (default `true`), `preMajor` (default `true`), `changelogSections`, the `conventionalcommits` preset's `types` list (unset keeps the preset's sections), and `include` (default `[]`), the untracked paths the release commit also carries. `["docs/release/"]` turns on the release walkthrough and the stakeholder summary. A key left out falls back to its default.

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
4. Wait for CI on the branch when the config names a workflow: run `pnpm deploy:production --dry-run --wait-ci > .artifacts/deploy/deploy-wait.log 2>&1` as a background task, and read the log when it ends. Add `--migrate` when the fix adds a migration file, so the migration gate passes and the run waits. A gate other than CI that fails stops the run with no wait: report it. Then follow "Procedure" from step 2 on this branch. `pnpm release` on the branch makes a patch release such as `v0.3.1`. When the fix cannot wait for the release, the owner may deploy first and release after.
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

`saasaloy update` adds `packages/tooling` and this skill. It merges the root `package.json`, `turbo.json` and `AGENTS.md` when you edited them, and its report lists each one that got conflict markers. Finish by hand:

1. Merge the root `package.json` scripts: `deploy:production` is `node packages/tooling/src/deploy-production.ts`, `prepare` is `husky && node packages/tooling/src/link-skills.ts`, `skills:link` is `node packages/tooling/src/link-skills.ts`, and `lint:types` and `lint:fix` include `packages/tooling/src`.
2. Merge `turbo.json`: remove `^db:migrate:prod` from the `deploy` task's `dependsOn`, and remove the `db:migrate:prod` task.
3. With `database-d1`, check `packages/db/package.json`. It needs `db:prod:migrate` and `db:prod:dump`, and the old `db:migrate:prod` script goes: rename it to `db:prod:migrate` if the update did not add that one. A D1 deploy no longer migrates on its own. Run `pnpm deploy:production --migrate` when the migration gate asks for it.
4. Run `saasaloy doctor`. Its Deploy warnings name a `turbo.json` that still has `db:migrate:prod`, and each deploying workspace with no `DEPLOY_TARGETS` row. Each warning prints its fix.
5. Add a `custom_domain` route to each Worker that has a production host, so its smoke checks run.
6. Read `docs/runbook-deploy.md`. `saasaloy update` writes it when the project has none, and it is then the project's to edit.

## A project made before the release step

`saasaloy update` adds `packages/tooling/src/release.ts` and the two release-it pins in `packages/tooling/package.json`. Finish by hand:

1. Merge the root `package.json` scripts: `release` is `node packages/tooling/src/release.ts`, and `release:dry` is `node packages/tooling/src/release.ts --dry-run`. `saasaloy doctor` warns while they are missing.
2. Delete an older `.release-it.json`, and any `release-it` or `@release-it/conventional-changelog` in the root `package.json`. `release.ts` reads neither. Move a changelog choice into the `release` block of `deploy.config.ts`.
3. Keep `CHANGELOG.md` and the `v*` tags. The next release reads the newest tag and adds its entry above the old ones.

The root `package.json` `version` belongs to the project. `saasaloy update` merges `package.json` by key and the template never changes `version`, so your value stays and a release alone never gives the file a conflict.
