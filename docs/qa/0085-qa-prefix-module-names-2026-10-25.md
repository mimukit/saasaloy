# QA Plan: Prefix account-scoped module names with the project name

_Generated 2026-10-25 · against `d45fd218` (clean) · covers issue #197: `saasaloy add` renders `{{PROJECT_NAME}}` in module files and patches, and `update` keeps the names of existing projects_

## Summary
- `saasaloy add` gives each module's Workers, D1 database, queues and R2 bucket the project name as a prefix.
- Working means two projects in one Cloudflare account get different names, and an existing project keeps its old names after `update`.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-197-prefix-account-scoped-module-names-with-the-project-name`, at `d45fd218` or later.
- A Cloudflare account that you can use for throwaway Workers, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set.
- Run all commands from the repo root of the worktree.

Build the CLI:

```sh
pnpm install && pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Two new projects, one Cloudflare account | Both projects deploy without touching each other | 🔴 Critical |
| TC-1.2 | 1: Two new projects, one Cloudflare account | The module skills read well with the `<project>` placeholder | 🟢 Low |

## Scenario 1: Two new projects, one Cloudflare account

**Setup.** Run once, for every case in this scenario.

1. Make two projects, `alpha` and `beta`, with `api` and `database-d1`.

```sh
mkdir -p .dev/qa197-live && cd .dev/qa197-live && node ../../packages/cli/dist/index.js init alpha --yes && node ../../packages/cli/dist/index.js init beta --yes
```

```sh
cd .dev/qa197-live/alpha && SAASALOY_REGISTRY_DIR=../../../modules node ../../../packages/cli/dist/index.js add api database-d1 --yes
```

```sh
cd .dev/qa197-live/beta && SAASALOY_REGISTRY_DIR=../../../modules node ../../../packages/cli/dist/index.js add api database-d1 --yes
```

2. Fill the production values in each project with `saasaloy env`.

- [ ] Setup complete

### TC-1.1: Both projects deploy without touching each other  ·  🔴 Critical

**Goal.** Two projects in one account get two api Workers and two D1 databases.

**Steps**

1. Deploy `alpha`.

   ```sh
   cd .dev/qa197-live/alpha && pnpm deploy:production --migrate
   ```

   - [ ] The Cloudflare dashboard shows the Worker `alpha-api` and the D1 database `alpha-db`
2. Deploy `beta`.

   ```sh
   cd .dev/qa197-live/beta && pnpm deploy:production --migrate
   ```

   - [ ] The dashboard shows `beta-api` and `beta-db` beside the `alpha` resources, and `alpha-api` still answers its URL

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The module skills read well with the `<project>` placeholder  ·  🟢 Low

**Goal.** The changed skill text tells a reader which name to use.

**Steps**

1. Open these files in `.dev/qa197-live/alpha/.agents/skills/`: `saasaloy-database-d1/SKILL.md`. In the repo, open `modules/queue/skills/saasaloy-queue/SKILL.md`, `modules/storage/skills/saasaloy-storage/SKILL.md` and `docs/wiki/how-to/deploy-to-cloudflare.md`.
   - [ ] Each mention of `<project>` reads clearly, and the teardown commands are correct for a real project

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd .dev/qa197-live/alpha/apps/api && pnpm exec wrangler delete && pnpm exec wrangler d1 delete alpha-db
```

```sh
cd .dev/qa197-live/beta/apps/api && pnpm exec wrangler delete && pnpm exec wrangler d1 delete beta-db
```

## Automated verification (by AI agent)
_Checks the agent ran itself at `d45fd218` (clean). No action needed from the tester._

Commands run:

```sh
pnpm --filter saasaloy exec vitest run --maxWorkers=2
```

```sh
pnpm --filter saasaloy exec tsc --noEmit
```

```sh
pnpm lint
```

```sh
pnpm run test:modules
```

```sh
pnpm --filter saasaloy build
```

```sh
cd .dev/qa197 && node ../../packages/cli/dist/index.js init alpha --no-install --no-git && cd alpha && SAASALOY_REGISTRY_DIR=../../../modules node ../../../packages/cli/dist/index.js add api database-d1 --yes && SAASALOY_REGISTRY_DIR=../../../modules node ../../../packages/cli/dist/index.js update --dry-run
```

- ✅ C5 · CLI tests → 1832 passed, 72 files, including `module-render.test.ts` (render, hash, no change on update, old names kept) and `kept-names.test.ts`.
- ✅ Typecheck, lint (4 passes) and module tests → exit 0; module tests 997 pass, 0 fail.
- ✅ C1, C3, C6 · `.dev/qa197/alpha` → `"name": "alpha-api"`, `"database_name": "alpha-db"`; `.dev/qa197/beta` → `"name": "beta-api"`, `"database_name": "beta-db"`. No file in either project holds the literal `{{PROJECT_NAME}}`.
- ✅ C2 · `apps/api/wrangler.jsonc` manifest hash in `alpha` → `98a17dbf…` is the hash of the rendered bytes; `module-render.test.ts` asserts the same against `hashContent` of the rendered file.
- ⚠️ C6 · `saasaloy update --dry-run` in `alpha` and `beta` → exit 0, and it lists 7 files for merge (6 as "drift", `packages/db/tsconfig.json` as "conflict"). The same command with the `origin/main` CLI and modules at `ad33c013` lists the identical 7 files (sorted list md5 `ced26301…` in all three runs). Each file is one that another module patched, and `update` passes those patches back for the base only. No diff shows a name line or the `{{PROJECT_NAME}}` token. So the rendering adds no change, but `update` does not report "no module change" on `main` either.
- ✅ C4 · `modules/kv-cloudflare/files/cloudflare.ts` and `modules/queue-cloudflare/files/cloudflare.ts` → the binding errors name `apps/api/wrangler.jsonc` and quote no resource name (0 matches for `app-kv` or `app-jobs`).
- ✅ C7 · a project made with the `origin/main` CLI, with `api`, `database-d1`, `queue-cloudflare`, `kv-cloudflare` and `storage-cloudflare`, then `update --yes --force` with this branch → the file keeps `"name": "api"`, `app-db`, `app-jobs`, `app-jobs-dlq` and `app-storage`, and holds 0 `gamma-` names. An `api`-only project keeps `"name": "api"`, and `update` counts the file as up to date.

## Not covered / needs human judgment
- A live deploy to Cloudflare. TC-1.1 covers it, because it needs real credentials.
- Browser checks: the change is CLI-only, with no UI.
- Security, concurrency, performance and accessibility: the change renames strings at plan time and adds no input, endpoint or screen.
- `saasaloy add --force` on a module installed before this change re-plans the files with the new names. This plan does not cover that path.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
