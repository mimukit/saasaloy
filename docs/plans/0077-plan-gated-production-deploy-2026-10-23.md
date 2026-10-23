# Plan: A gated, ordered, tagged production deploy in the base

Grilled: 2026-10-23

Drafted: 2026-10-23

## Context

The base `pnpm deploy:production` is `node packages/env/src/deploy.ts --check && turbo run deploy` (ADR 0043). It checks the production values, then turbo deploys every Worker in parallel. It has no gate on branch, tree, push state or CI. It has no order, so a frontend can go live before the api route it calls. It does no smoke check and it records nothing about what went live.

primeshopr replaced it with `scripts/deploy-production.ts` (uncommitted in that tree). The script refuses a branch other than `main` or `hotfix-*`, a dirty tree, a HEAD that differs from origin, a CI run on HEAD that is not green, and a new migration file since the last `deploy-*` tag unless `--migrate` is passed. It then runs the env check, the optional migration (dump first), the api, admin and web Workers one at a time, `fetch` smoke checks against hardcoded hosts, and an annotated `deploy-<UTC yyyymmdd-hhmm>` tag pushed to origin. `--dry-run`, `--skip-ci "<reason>"` and `--only <worker>` cover the exceptions. A project skill, `primeshopr-deploy`, carries the rule that an agent deploys only after the owner says so in the same session.

That work is general. Every generated project deploys, and every one has the same gaps. This plan moves the general parts into saasaloy and fixes the saasaloy gaps the work exposed. The project-specific parts (Hyperdrive, Dokploy, the superadmin command, primeshopr's hosts) stay in primeshopr.

Success: a new project runs `pnpm deploy:production --dry-run` and sees every gate, the deploy order and the smoke checks derived from its own modules, with no project edit to the root `package.json`. A project changes its gates by editing an owned config file, and `saasaloy update` never puts that file in a merge plan.

## Findings per candidate

| # | Candidate | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Gated flow, root script forked | Real | Base root script at `packages/cli/templates/base/package.json:15`. The root `package.json` is a managed base file, not in `ownedFiles` (`_saasaloy-base.json`). ADR 0034: an edited managed file goes to the merge plan, it is never overwritten. So primeshopr's edit is not reverted silently. It comes back in the merge plan each time the template's root `package.json` changes. |
| 2 | Deploy order | Real | `turbo.json` `deploy` depends on `^build` and `^db:migrate:prod` only. No task orders `apps/*` against each other. |
| 3 | Smoke checks | Real, partly solved | The api module already serves `GET /health` → `{"status":"ok"}` (`modules/api/files/src/routes/health.ts`) and a `{ error: { code, message } }` 404 envelope (`modules/api/files/src/index.ts:164`). Neither touches the database. No template `wrangler.jsonc` has `routes`, so hosts are per project. `env-deploy` already has `parseJsonc` and `readWorkerConfig` (`packages/env/src/deploy.ts:235,268`). |
| 4 | Production migrations | Real for postgres. The premise "dead dependency" is wrong. | `database-d1` defines `db:migrate:prod` (`modules/database-d1/registry-item.json:29`) and its skill says `turbo run deploy` runs it before the api uploads. So every D1 deploy migrates production with no gate and no backup. `database-postgres` defines none (`SKILL.md:202`) and has no dump command. |
| 5 | `routeTree.gen.ts` rewrite | Real, cause found | `@tanstack/router-generator` defaults to `quoteStyle: "single"` and `semicolons: false` (`dist/esm/config.js:26-27`). `modules/admin/files/vite.config.ts` sets neither. The committed `modules/admin/files/src/routeTree.gen.ts` is in Prettier style (double quotes, semicolons). Every build rewrites it. The base `_prettierignore` does not list it, and neither does saasaloy's own `.prettierignore`. |
| 6 | Project skill links | Real, and wider | `init` links every folder in `.agents/skills/` that exists at init time (`commands/init.ts:221`). `add` and `update` link only the skills a descriptor names (`applier.ts:644`, `updater.ts:953`). A project skill added later gets no link. A fresh clone gets no link at all, because `.claude/skills/` is gitignored and no project command creates the links. The primeshopr link was made by hand at 03:36 today. |
| 7 | Root test script and root scripts | Script: solved upstream. Root scripts: real. | Base root `test` is `turbo run test && vitest run` since e1b5313, and the `vitest.config.ts` comment matches it. primeshopr's root script fell behind that change, so its comment is wrong there only. The base has no root `tsconfig.json`, the Vitest projects are `apps/*` and `packages/*`, and `lint:types` covers `packages/env/src` and `packages/ui/src`. A root `scripts/` folder gets no typecheck and no test. |
| 8 | Skills and AGENTS.md that describe deploy | Real once the flow changes | `saasaloy-env` SKILL.md (deploy section), `saasaloy-api` (lines 237, 409-415), `saasaloy-admin` (428), `saasaloy-kv` (163), `saasaloy-storage` (47), `saasaloy-database-postgres` (202), `saasaloy-database-d1` (130-134), `saasaloy-env-infisical` (3, 10), base `AGENTS.md` `@repo/env` section, `registry-item.schema.json:122`, `CONTEXT.md`, ADR 0043. |
| 9 | Runbook and agent deploy skill | Real | The base ships no `docs/` folder and no deploy skill. |
| 10 | Branch guidance | Real | Base `AGENTS.md` has no branch or hotfix text. |
| new | CI gate needs a workflow | Real | The base ships no `.github/workflows/`. A CI gate that reads `ci.yml` fails on every new project. |

## Design decisions (settled 2026-10-23)

Each row names the grill question that settled it, and whether the owner answered it (asked) or took the default.

| Decision | Settled |
|----------|---------|
| Where the flow lives | A new base workspace, `packages/tooling` (`@repo/tooling`). It holds the repo's own tooling: the deploy command and the skill linker. The engine files are managed. The project's choices sit in owned files (below). Rejected: growing `packages/env` (it owns environment values, and git, CI, smoke and tags are not values); a root `scripts/` folder (no tsconfig, no test, no lint coverage, see #7); a module (ADR 0043 puts deploy in the base, and every project deploys); `packages/deploy` (the skill linker would need another home). Q14, asked. |
| Root script | `"deploy:production": "node packages/tooling/src/deploy-production.ts"`. The line never changes again, so a project never forks it. Q20, asked. |
| Project config | `packages/tooling/src/deploy.config.ts`, in `ownedFiles`: allowed branches (`["main", "hotfix-*"]`), tag prefix (`deploy-`), CI workflow file (`undefined` by default, which turns the CI gate off and the dry run says so), migration glob (`packages/db/migrations/*.sql`). An owned file never changes after init, so the engine reads each key with a default and accepts an older file. Q1, defaulted. |
| Deploy order | `DEPLOY_TARGETS` in `packages/tooling/src/targets.ts`, owned, shaped for the `const-array` patch: `{ service, order }`. The base seeds `web` (30). The api module appends `api` (10), the admin module `admin` (20). Rejected: turbo `dependsOn` between apps (`api#deploy` fails when the api is not installed, `turbo.json` is a managed file every module would have to patch, and turbo cannot run a gate or a smoke check); an `order` field on `SERVICES` (that table describes env files, and the `deploy` row has no Worker). A deployable workspace with no `DEPLOY_TARGETS` row stops the deploy with a message that names it (ADR 0046: refuse, never guess). Q2, defaulted. |
| Smoke checks | `SMOKE_CHECKS` in the same owned file, `const-array` keyed by `id`: `{ id, service, path, status, body? }`. The host comes from the service's `wrangler.jsonc` `routes[]` entries with `custom_domain: true`, read with `readWorkerConfig`. A service with no custom domain gets no smoke check, and the run says so. Seeds: web `/` 200, web `/__saasaloy-smoke-404` 404, web `/wrangler.json` 404 (from base); api `/health` 200 with `"ok"` (api module); admin `/` 200 (admin module). Three tries, 5 s apart, as in primeshopr. Q3, defaulted. No custom domain: skip and say so, never parse the `workers.dev` URL and never add a `host` field (Q16, asked). |
| Database readiness check | The core `database` module adds `GET /health/db` through a `chained-route` patch. It runs one `select 1` through the request's db client and answers `{"status":"ok"}`. It appends a smoke check row. This replaces primeshopr's "404 envelope proves Hyperdrive" check with one that says what it proves. It lives in a new `routes/health-db.ts` mounted at `/health/db`, so the api module's `health.ts` stays untouched (Q22, defaulted). A failure answers `503` `{ error: { code: "database_unavailable", message } }` with a fixed message, and the driver error goes only to the logger (Q23, defaulted). One route in the core module, not per driver (Q15, asked). No rate limit: `select 1` costs about the same as a 404, and the `saasaloy-database` skill names a WAF rule as the project's option (Q29, asked). |
| Production migration name | `db:prod:migrate` and `db:prod:dump`, the names primeshopr already uses. `database-postgres` adds both: target check, then `pg_dump --format=custom` (Docker `postgres:<major from compose.yaml>`, or `PG_DUMP=local`), then `drizzle-kit migrate`. `database-d1` renames `db:migrate:prod` to `db:prod:migrate` and adds `db:prod:dump` (`wrangler d1 export --remote`). Rejected: `db:migrate:prod` for postgres, because a project that has not merged the new `turbo.json` would then migrate production on every `turbo run deploy`, a dry run included. Both commands run through `env-deploy --run <service>`, so the production values stay in memory (Q24, defaulted). The build found that `DATABASE_URL` belongs to the `api` row, not the `deploy` row, so Postgres runs `--run api` and D1 keeps `--run deploy`. No other `prod` spelling (`.env.prod`, `Environment = "prod"`, `--env prod`) is renamed. Q19, asked. |
| Postgres target check | The production database is always named `<project>_production`, never `<project>_prod` (owner decision, 2026-10-23). The check requires that name, derived from `databasePrefix` with `_dev` replaced by `_production`, as primeshopr's `productionDatabaseName` does. It also refuses the dev host from `apps/api/.env`. The skill, the runbook and every comment spell the name in full. Q4, defaulted (owner decision before the grill). |
| `turbo.json` | Remove `^db:migrate:prod` from `deploy`, and the `db:migrate:prod` task. The engine runs each Worker with `pnpm --filter <pkg> run deploy`, so turbo has no deploy role left. Keep the `deploy` task with `passThroughEnv` for a project that runs `turbo run deploy` by hand. Q5, defaulted. |
| D1 behaviour change | A D1 project no longer migrates on every deploy. The migration gate names the new files and asks for `--migrate`. This amends ADR 0043, so it needs a new ADR (0048). Q18, asked. ADR 0048 covers the gated, ordered and tagged deploy, the owned config and targets, and the D1 change (Q26, defaulted). |
| Generated files | Admin `vite.config.ts` sets `quoteStyle: "double", semicolons: true`. The committed `routeTree.gen.ts` is regenerated from the plugin. The base `_prettierignore` and saasaloy's `.prettierignore` list `**/routeTree.gen.ts`. The engine does not restore rewritten files: a build that dirties the tree is a bug to fix, and the clean-tree gate reports it. Q6, defaulted. |
| Skill links | `link-skills` in `packages/tooling` links every folder in `.agents/skills/` into `.claude/skills/`, and never touches a path that is not its own link. The root `prepare` becomes `husky && node packages/tooling/src/link-skills.ts`, so `pnpm install` on a fresh clone creates the links. `init`, `add` and `update` use the same rule: every folder, not only descriptor skills. The `prepare` change is approved (Q20, asked). |
| Root code | Base `AGENTS.md` says: no code at the repository root, put a tool in a workspace. `packages/tooling` is that workspace for repo tooling. Its tests run on Vitest through the root config, and it has a `typecheck` script. Q7, defaulted. |
| Runbook and skill | Base seed file `docs/runbook-deploy.md` (owned by the project after init) and base skill `saasaloy-deploy`. The skill carries the go-ahead rule, the dry-run report template, the gate table, the hotfix steps and the rollback. Project-specific steps (first deploy, hosting, data restore) stay in the project's copy of the runbook. Q8, defaulted. |
| Branches | Base `AGENTS.md` gets a "Branches and deploys" section: deploy from `main`, a `hotfix-<slug>` branch cut from the last deploy tag for a fix while `main` holds unreleased work, no long-lived production branch, never move or delete a deploy tag. The config's branch list enforces it. Q9, defaulted. |
| `--only` | Kept. One Worker, its smoke checks, no tag. The tag means "this commit is live everywhere". Q10, defaulted. |
| `--skip-ci "<reason>"` | Kept. The reason goes into the tag message. Q17, asked. |
| First deploy, no tag yet | Every migration file counts as new, so a first deploy that has migrations needs `--migrate`. Q11, defaulted. |
| Failed smoke check | No tag, exit 1, and the run prints `wrangler rollback` for each Worker it deployed. Q12, defaulted. |
| Tag push fails | The tag stays local. The run prints `git push origin <tag>` and exits 1. The Workers stay live. Q13, defaulted. |
| `doctor` checks | Both findings are warnings with the fix printed, not errors. Q25, defaulted. |
| Files a project owns or merges | The owner approved the whole table in "Files a generated project owns..." below. Q20, asked. |
| Test runner | Vitest through the root `vitest.config.ts` `packages/*` project. `prod.ts` tests mock `spawnSync` and need no Docker. Q27, defaulted, then reopened as Q31: saasaloy's `test:base` runs base `*.test.ts` files on `node --test`, so Vitest tests in `packages/tooling` need their own run in saasaloy. The owner kept Vitest (Q31, asked). |
| Existing defects found in the build | Fix in this issue, both approved by the owner: the `database-d1` `migrate-prod.ts` header comment and its `TS7006` parameter type (Q33, asked), and the base `packages/env/src/services.test.ts`, which hardcodes the `SERVICES` list and fails in any project with admin (Q34, asked). |
| Relinking after install | pnpm skips the root `prepare` when an install changes nothing, so a skill folder added later gets no link from `pnpm install`. The base root `package.json` gets `"skills:link": "node packages/tooling/src/link-skills.ts"`, and the base `AGENTS.md` and the deploy skill name it. A fresh clone still links through `prepare`. Q35, asked. |
| `@repo/env` export | The base `packages/env/package.json` exports `./deploy`, so `packages/tooling` imports `readWorkerConfig` and `parseJsonc` and keeps no second JSONC reader. Q32, asked. |
| Attended phases | None. The plan changes no UI, and the agent runs the Phase 7 `.dev` checks. Q28, defaulted. |
| Outward actions | Commit each phase on the issue branch, push it, and open a PR after Phase 7 passes. Tick the issue checkboxes. Nothing merges and no deploy runs. Q30, asked. |

## Approach

### Phase 1: decisions on record (#234) (built 2026-10-23)

1. Grill this plan (grillkit). Record the result at the top.
2. Write ADR 0048, "Production deploy is gated, ordered and tagged", amending ADR 0043.
3. Add `deploy tag`, `deploy target` and `smoke check` to `CONTEXT.md`.

### Phase 2: `packages/tooling` and the deploy engine (#234) (built 2026-10-23)

1. Create `packages/cli/templates/base/packages/tooling/` with `package.json` (clean, typecheck, rimraf, no Vitest script), `tsconfig.json`, `src/deploy-production.ts`, `src/deploy.config.ts`, `src/targets.ts`.
2. Port primeshopr's pure functions and tests (`parseArgs`, `ciState`, `gateProblems`, `tagName`, `tagMessage`, `smokeProblem`) to Vitest. Add `orderTargets` and `smokeUrls(service, wranglerConfig)`.
3. Read the env check and the per-Worker deploy through `@repo/env` (`checkProduction`, the `deploy` script per workspace). The migration step calls `pnpm --filter @repo/db db:prod:migrate`, only with `--migrate`, and refuses `--migrate` when no `@repo/db` exists.
4. Add `packages/tooling/src/deploy.config.ts` and `targets.ts` to `ownedFiles`.
5. Change the root `deploy:production` and `prepare` scripts. Add `packages/tooling/src` to `lint:types`.
6. Remove `^db:migrate:prod` and the `db:migrate:prod` task from `turbo.json`.

### Phase 3: module rows and the database commands (#234) (built 2026-10-23)

1. api, admin: append `DEPLOY_TARGETS` and `SMOKE_CHECKS` rows through `const-array` patches.
2. database: `/health/db` route and its smoke row.
3. database-postgres: `scripts/prod.ts`, `scripts/lib/production.ts` and tests, `db:prod:dump` and `db:prod:migrate` package scripts, root pass-through scripts.
4. database-d1: rename to `db:prod:migrate`, add `db:prod:dump`.
5. `saasaloy doctor`: warn while `turbo.json` still names `db:migrate:prod`, and while a deployable workspace has no `DEPLOY_TARGETS` row.

### Phase 4: generated route tree (#234) (built 2026-10-23)

1. Set the two generator options in `modules/admin/files/vite.config.ts`.
2. Regenerate `modules/admin/files/src/routeTree.gen.ts` in a `.dev` playground and copy it back.
3. Add `**/routeTree.gen.ts` to the base `_prettierignore` and to saasaloy's `.prettierignore`.
4. Check: in `.dev`, build admin twice, then `git status --porcelain` prints nothing.

### Phase 5: skill links (#234) (built 2026-10-23)

1. Write `packages/tooling/src/link-skills.ts` with the same link states as `classifyLink` (create, correct, conflict).
2. Make `init`, `add` and `update` link every `.agents/skills/` folder.
3. Check in `.dev`: add a project skill folder, run `pnpm install`, and see its link. Clone the playground fresh, run `pnpm install`, and see every link.

### Phase 6: docs and skills (#234) (built 2026-10-23)

1. Base `AGENTS.md`: the deploy bullet in the `@repo/env` section, the new "Branches and deploys" section, the "no code at the root" rule, and the testing line for `packages/tooling`.
2. New base skill `saasaloy-deploy`, and `docs/runbook-deploy.md` as a seed file.
3. Update every file in finding #8 to the new flow.
4. `packages/cli/CHANGELOG.md` entry with the D1 behaviour change and the merge steps for an existing project.

### Phase 7: verification (#234) (built 2026-10-23)

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` in saasaloy.
2. In `.dev`: `saasaloy init`, add api, admin and database-postgres, run `pnpm deploy:production --dry-run`. Check the gate report, the order api → admin → web, and the smoke list.
3. In `.dev`: run `saasaloy update` on a project made with the current base. Record which files land in the merge plan.
4. Release smoke (`pnpm release:smoke`).

## Files a generated project owns, or that `saasaloy update` puts in a merge plan

The owner approved every row of this table in the grill (Q20, 2026-10-23).

| File | Status in a project | What `update` does |
|------|---------------------|--------------------|
| root `package.json` (`deploy:production`, `prepare`, `lint:types`) | managed | overwrite when unedited, merge plan when edited (primeshopr: merge plan) |
| `turbo.json` | managed | as above |
| `AGENTS.md` | managed | as above, and most projects edit it |
| `.prettierignore` | managed | as above (primeshopr: merge plan, it added the line already) |
| `packages/tooling/src/deploy.config.ts`, `targets.ts` | new, then owned | created when absent, never written again |
| `docs/runbook-deploy.md` | new seed | created once. primeshopr has its own, so it is kept |
| `apps/admin/vite.config.ts`, `apps/admin/src/routeTree.gen.ts` | module files | merge plan where edited. The route tree differs in every project with its own routes |
| `packages/db/package.json` scripts, `packages/db/scripts/prod.ts` | module files | primeshopr already has both under the same names: collision, so merge plan |
| skills under `.agents/skills/saasaloy-*` | managed | overwrite when unedited |

## Follow-up for primeshopr (not done here)

- After this lands: run `saasaloy update`, take `packages/tooling`, delete `scripts/deploy-production.ts`, put its hosts in `targets.ts` rows and its CI workflow in `deploy.config.ts`, and keep `primeshopr-deploy` only for the project steps or delete it for `saasaloy-deploy`.
- Its root `test` script lost `vitest run`. It should be `turbo run test && vitest run`.
- `packages/db/scripts/prod.ts` says the target is `<project>_prod`, the commit 41f3ce7 message says `primeshopr_prod`, and `lib/production.ts` checks `primeshopr_production`. The code is the rule: the name is `<project>_production`. Fix the comment in `prod.ts`. The commit message stays as it is.

## Non-goals

- A base `ci.yml`. The CI gate stays off until a project names a workflow. A base workflow is its own plan, because `.github/workflows/` is an ask-first path in the base `AGENTS.md`.
- A rollback command. `wrangler rollback` per Worker stays the documented path.
- A smoke check that signs in.
- Moving primeshopr. It follows the update path above.
- A production superadmin command. It depends on `rbac` and stays project-local for now.

## Open questions

All four are settled (grill, 2026-10-23).

1. `packages/tooling`, holding the deploy engine and the skill linker (Q14).
2. The core `database` module, one route for both drivers (Q15).
3. Skip the smoke check and say so (Q16).
4. `--skip-ci` stays, and the reason goes into the tag message (Q17).
