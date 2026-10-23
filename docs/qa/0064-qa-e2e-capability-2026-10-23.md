# QA Plan: The e2e capability, rebuilt

_Generated 2026-10-23 · against `6a7753b` (uncommitted changes, the rebuild under review) · covers the `e2e` module, its base template changes, `pnpm verify:e2e`, the tag guard and the tool repo's `e2e.yml`_

## Summary

- `saasaloy add e2e` gives a project a Playwright suite that runs four flows against the running apps.
- Working means both drivers pass, absent modules uncollect their flows, and a red run says why.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-155-rebuild-e2e-capability`, in its own worktree.
- The box needs a Docker daemon for the Postgres server in Scenario 2.
- No credentials. The admin flows use the seeded `superadmin@example.test` / `saasaloy-dev-password`.

Install the repo:

```sh
pnpm install
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: The branch checkout, nothing running | The skill and the template notes read as a runbook | 🟡 Normal |
| TC-1.2 | 1: The branch checkout, nothing running | ADR 0051 leaves feature-module flow ownership open | 🔴 Critical |
| TC-2.1 | 2: A clean playground on Postgres | A Postgres run passes and its output reads clearly | 🔴 Critical |
| TC-3.1 | 3: The pull request on GitHub | The `e2e` workflow passes on both jobs | 🔴 Critical |

## Scenario 1: The branch checkout, nothing running

**Setup.** No setup. These cases read files only.

- [ ] Setup complete

### TC-1.1: The skill and the template notes read as a runbook  ·  🟡 Normal

**Goal.** A project owner can add a flow and fix a red run from the skill alone.

**Steps**

1. Read `modules/e2e/skills/saasaloy-e2e/SKILL.md` from top to bottom.
   - [ ] The skill tells a project owner what to do, in order, with no gap
     - "The two commands" and the `.env` paragraph before the first run
     - "Adding a flow": the tag rule and the island-hydration wait
     - "The seeded admin": why the suite creates no account
     - "When a run is red": each refusal maps to one command
2. Read the `## Test` section of `packages/cli/templates/base/README.md` and the browser-suite bullet in `packages/cli/templates/base/AGENTS.md`.
   - [ ] Both agree with the skill and add no new term

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: ADR 0051 leaves feature-module flow ownership open  ·  🔴 Critical

**Goal.** The rebuild does not settle the open decision in issue #240 phase 1.

**Steps**

1. Read `docs/adr/0051-adr-the-e2e-capability-gates-flows-on-installed-modules-2026-10-23.md`.
   - [ ] No sentence says that `e2e` owns every spec, or that a feature module must not ship one
     - the Status section names issue #240 phase 1 as the owner of the decision
     - "Considered Options" lists that question as not taken
2. Read the `Flow` and `Spec tag` entries in `CONTEXT.md` and the `e2e` paragraph in `modules/README.md`.
   - [ ] Neither one settles the decision either
3. Read `docs/plans/0081-plan-e2e-capability-rebuild-2026-10-23.md`.
   - [ ] The "What changes" table matches what you know of PR #164

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 2: A clean playground on Postgres

**Setup.** Run once. The script runs `play:reset`, so it rebuilds `.dev/playground` from nothing.

1. Start a Postgres server of your own on port 55432. The driver's `compose.yaml` container is shared by every worktree's playground on this box.

```sh
docker run -d --name e2e-qa-postgres -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18
```

- [ ] Setup complete

### TC-2.1: A Postgres run passes and its output reads clearly  ·  🔴 Critical

**Goal.** A developer sees what each step did, and the four flows pass on Postgres.

**Steps**

1. Run the gate against your server.

   ```sh
   E2E_DATABASE_SERVER=postgres://postgres:postgres@127.0.0.1:55432/postgres E2E_DB_SETUP_ARGS=--server pnpm verify:e2e --driver=postgres
   ```

   - [ ] The output ends with `verify-e2e: the postgres suite passed.` and `4 passed`
   - [ ] Each `verify-e2e:` step line tells you what the script does next, and the `> pnpm db:setup` and `> pnpm db:seed` lines make the database work easy to follow

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
docker rm -f e2e-qa-postgres
```

## Scenario 3: The pull request on GitHub

**Setup.** Open the pull request page for this branch.

- [ ] Setup complete

### TC-3.1: The `e2e` workflow passes on both jobs  ·  🔴 Critical

**Goal.** The tool repo's CI runs the suite on a bare runner for both drivers.

**Steps**

1. Open the Checks tab of the pull request.
   - [ ] `suite (d1)` and `suite (postgres)` both pass
     - the "Install the browser's system libraries" step passes
     - the postgres job reaches its service container through `--server`
     - the log shows `pnpm db:drop` in the teardown, because CI sets `CI`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself on 2026-10-23, on the uncommitted tree over `6a7753b`. No action needed from the tester._

Commands run:

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
node packages/cli/dist/index.js doctor modules
```

```sh
pnpm verify:e2e --driver=d1
```

```sh
E2E_DATABASE_SERVER=postgres://postgres:postgres@127.0.0.1:55432/postgres E2E_DB_SETUP_ARGS=--server pnpm verify:e2e --driver=postgres
```

```sh
CI=true E2E_DB_SETUP_ARGS=--server pnpm -C .dev/playground run e2e
```

- ✅ `pnpm lint` → four passes clean, "All matched files use Prettier code style!"
- ✅ `pnpm typecheck` → clean
- ✅ `pnpm test` → 61 + 5 Vitest files passed; node test runs 740, 90 and 389 passed, 0 failed. `scripts/e2e-tags.test.ts` and `scripts/verify-e2e.test.ts` are in the last run.
- ✅ `doctor modules` → "No problems found", `e2e` included
- ✅ `verify:e2e --driver=d1` → `4 passed (38.9s)`, "the d1 suite passed"
- ✅ `verify:e2e --driver=postgres` (server backend, dedicated container on 55432) → `4 passed (37.5s)`, "the postgres suite passed"
- ✅ `CI=true pnpm e2e` → `4 passed`; teardown printed "Dropped playground_dev on the server DATABASE_URL names" and `apps/api/.env.db` is gone
- ✅ After every run, nothing listens on 3000, 3001 or 4000
- ❌ `pnpm deps:check` → exit 1 with 80 outdated pins on `main` already; the new module adds `@playwright/test 1.63.0 → 1.64.1` and `@types/node 26.4.1 → 26.6.5`. Kept at 1.63.0 to match the root `playwright` pin. Not a defect of this change.

### Checks on the playground (`.dev/playground`, reset with `pnpm play:reset`)

- ✅ Tag gating: with `admin`, `auth` and `waitlist` removed from `installed`, `playwright test --list` → `Total: 1 test in 1 file` (health only); restored → `Total: 4 tests in 4 files`
- ✅ Missing Chromium (`PLAYWRIGHT_BROWSERS_PATH=/tmp/qakit-empty node prepare.ts`) → exit 1, "Chromium is not installed at … Run: pnpm e2e:install"
- ✅ Missing `apps/api/.env` → exit 1, "apps/api/.env does not exist, so the apps cannot start. Run: pnpm env:setup"
- ✅ Malformed `saasaloy.json` → throws "… saasaloy.json is not valid JSON."
- ✅ A deliberately failing spec → stdout shows `Expected: 418` / `Received: 200`; `playwright-report/index.html`, `test-failed-1.png`, `video.webm` and `error-context.md` written. No trace locally, because `trace` is `on-first-retry` and local runs take no retry.
- ✅ `pnpm --filter @repo/e2e clean` → both output directories removed
- ✅ `git check-ignore` → `playwright-report/` and `test-results/` match the base `.gitignore`
- ✅ `pnpm -C .dev/playground test` → 7 Vitest files, 119 tests passed; no Playwright spec collected
- ❌ `pnpm -C .dev/playground lint` → `prettier --check` fails on `packages/db/migrations/meta/_journal.json` and `0000_snapshot.json`, which `db:generate` writes. The same failure happens without this module.

### Browser checks

The suite itself is the browser check: Chromium signed the seeded superadmin in to `apps/admin`, opened `/users`, submitted the waitlist form on `apps/web`, and got 201 and 401 where expected, on both drivers. The agent captured no screenshots, because no case in this plan judges a screen.

## Not covered / needs human judgment

- The workflow in `.github/workflows/e2e.yml` has not run on GitHub yet. TC-3.1 covers it.
- The default local Postgres path (`db:setup --docker`) did not run to green on this box. The `issue-207` worktree's playground owns `playground-postgres-1` on port 5432 with its own `playground_dev`, so the agent used the `--server` path instead and left that container stopped, as it found it.
- Windows: not run. The spawns pass `shell` on `win32` and `clean` uses `rimraf`.
- Accessibility, visual layout and performance: not in scope. The suite asserts behavior only.
- Feature-module journey specs: out of scope until issue #240 phase 1 is decided.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
