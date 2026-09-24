# QA Plan: an e2e test capability for the scaffolded app

_Generated 2026-09-20 · against `02154b5` plus the uncommitted work tree · covers the base template's vitest runner and the new `e2e` module_

## Summary

- A scaffolded project gets `pnpm test` (vitest, one example test) and `saasaloy add e2e`, which brings Playwright, four browser flows and the commands that run them.
- Working means a fresh project runs `pnpm test` green, runs `pnpm e2e` green, starts and stops every app itself, and refuses with an actionable message when the browser or the env file is missing.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-155-add-an-e2e-test-capability-for-the-scaffolded-app`.
- The tool repo is the registry. `pnpm play:init` copies a `saasaloy` shim into the playground that points the CLI at this worktree's `modules/`.
- No credentials. Every flow runs against localhost.
- The apps use fixed dev ports: `apps/web` 3000, `apps/admin` 3001, `apps/api` 4000.
- Docker must be running for Scenario 3 only.

Set the repo root once. Every command below runs from it.

```sh
export REPO=/home/dev/worktrees/saasaloy/issue-155-add-an-e2e-test-capability-for-the-scaffolded-app
```

Check that the three dev ports are free. A held port fails a run with a message about the port, not about the feature.

```sh
ss -ltn | grep -E ':3000|:3001|:4000' || echo "ports free"
```

There is no database client to set. The suite reaches the database only through the project's own `db:setup` and `db:drop`.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1: a fresh base project, nothing added | The unit runner reports a real result | 🔴 Critical |
| TC-1.2 | 1: a fresh base project, nothing added | The lint and typecheck gates still pass | 🟡 Normal |
| TC-2.1 | 2: a D1 project with api, auth, admin, waitlist and e2e | The suite refuses a missing browser and a missing env file | 🔴 Critical |
| TC-2.2 | 2: a D1 project with api, auth, admin, waitlist and e2e | The four flows pass and the run leaves no process behind | 🔴 Critical |
| TC-2.3 | 2: a D1 project with api, auth, admin, waitlist and e2e | A failure is readable on stdout and in the artifacts | 🔴 Critical |
| TC-2.4 | 2: a D1 project with api, auth, admin, waitlist and e2e | `pnpm test` stays unit-only beside the browser suite | 🟡 Normal |
| TC-2.5 | 2: a D1 project with api, auth, admin, waitlist and e2e | `clean` removes the artifacts it wrote | 🟢 Low |
| TC-3.1 | 3: an api-only project with e2e | An uninstalled module's flow is never collected | 🔴 Critical |

## Scenario 1: a fresh base project, nothing added

**Setup.** Run once, for every case in this scenario.

1. Scaffold the playground from this worktree's template.

```sh
cd $REPO && pnpm run play:reset
```

2. Give the playground its own git directory. Without it the linter walks up to this repo's `.gitignore`, finds `/.dev/`, and reports nothing.

```sh
cd $REPO/.dev/playground && git init -q .
```

3. Install.

```sh
cd $REPO/.dev/playground && pnpm install
```

- [ ] Setup complete

### TC-1.1: The unit runner reports a real result · 🔴 Critical

**Goal.** A project owner runs one command and sees a green suite, not an empty runner.

**Steps**

1. Run the unit suite.

   ```sh
   cd $REPO/.dev/playground && pnpm test
   ```

   - [ ] The run reports 1 test file and 4 passing tests, and exits 0
     - the file is `packages/ui/src/lib/interpolate.test.ts`
     - no workspace is reported as missing a config
   - [ ] The output names no `packages/e2e` file

2. Open the example test and read it as a project owner would.

   ```sh
   cd $REPO/.dev/playground && cat packages/ui/src/lib/interpolate.test.ts
   ```

   - [ ] The file is a pattern worth copying
     - it sits beside the source it covers
     - it imports `test` and `expect` from `vitest` rather than using globals
     - its comment says where to put the next test and how `pnpm test` finds it

3. Read the project's own testing instructions.

   ```sh
   cd $REPO/.dev/playground && grep -n -A12 "Testing Instructions" AGENTS.md
   ```

   - [ ] The instructions describe the runner this project actually has

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The lint and typecheck gates still pass · 🟡 Normal

**Goal.** Adding a test file and a runner did not break the gates a project owner runs before every commit.

**Steps**

1. Run the typecheck.

   ```sh
   cd $REPO/.dev/playground && pnpm typecheck
   ```

   - [ ] It exits 0

2. Run the four lint passes.

   ```sh
   cd $REPO/.dev/playground && pnpm lint
   ```

   - [ ] No violation names the new test file or `vitest.config.ts`
     - a violation in `packages/ui/src/lib/theme.ts` is a known defect of the base template and is not this change; note it and read on

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after both cases above, before moving to Scenario 2.

```sh
cd $REPO && pnpm run play:destroy
```

## Scenario 2: a D1 project with api, auth, admin, waitlist and e2e

**Setup.** Run once, for every case in this scenario. It is the same sequence `pnpm verify:e2e` performs, run by hand so the cases below can interrupt it.

1. Scaffold and install the full module set. This takes several minutes.

```sh
cd $REPO && pnpm run verify:e2e --driver=d1
```

2. Confirm it ended with `verify-e2e: the d1 suite passed.` If it did not, stop and report; every case below assumes that project.

- [ ] Setup complete

### TC-2.1: The suite refuses a missing browser and a missing env file · 🔴 Critical

**Goal.** A developer who skipped a step reads a message that names the command to run, not a stack trace.

**Steps**

1. Move the env file aside and run the suite.

   ```sh
   cd $REPO/.dev/playground && mv apps/api/.dev.vars apps/api/.dev.vars.bak && pnpm e2e; mv apps/api/.dev.vars.bak apps/api/.dev.vars
   ```

   - [ ] The run stops before starting any app, and the message is actionable
     - it says `apps/api/.dev.vars does not exist`
     - it gives the `cp` command to fix it
     - it prints no stack trace

2. Hide the browser download and run the suite.

   ```sh
   cd $REPO/.dev/playground && mv ~/.cache/ms-playwright ~/.cache/ms-playwright.bak && pnpm e2e; mv ~/.cache/ms-playwright.bak ~/.cache/ms-playwright
   ```

   - [ ] The message names `pnpm e2e:install` and prints no stack trace

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The four flows pass and the run leaves no process behind · 🔴 Critical

**Goal.** One command starts three apps, drives a browser through four flows, and gives the ports back.

**Steps**

1. Run the suite and watch it.

   ```sh
   cd $REPO/.dev/playground && pnpm e2e
   ```

   - [ ] Five checks pass: the setup project plus `health`, `waitlist`, `admin-login` and `admin-unauthenticated`
   - [ ] The run needs no desktop
     - no browser window opens
     - nothing waits for a key press
   - [ ] The log shows all three apps starting, on 4000, 3000 and 3001

2. Check the ports after the run ends.

   ```sh
   ss -ltn | grep -E ':3000|:3001|:4000' || echo "ports free"
   ```

   - [ ] It prints `ports free`

3. Run the suite a second time without dropping the database.

   ```sh
   cd $REPO/.dev/playground && pnpm e2e
   ```

   - [ ] It passes again
     - the fixture account already exists, so the setup project signs in rather than signing up
     - the waitlist row is a new address, so nothing collides

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A failure is readable on stdout and in the artifacts · 🔴 Critical

**Goal.** A red run tells a developer which step failed, without a browser and without guessing.

**Steps**

1. Break one flow on purpose. Change the expected health body.

   ```sh
   cd $REPO/.dev/playground && sed -i 's/{ status: "ok" }/{ status: "broken" }/' packages/e2e/specs/health.spec.ts
   ```

2. Run the suite.

   ```sh
   cd $REPO/.dev/playground && pnpm e2e
   ```

   - [ ] The failing step is on stdout and is enough to act on
     - the spec file and line appear
     - the expected and received values appear
   - [ ] The run exits non-zero

3. Look at what it wrote.

   ```sh
   cd $REPO/.dev/playground && ls packages/e2e/playwright-report packages/e2e/test-results
   ```

   - [ ] An HTML report exists, and `test-results` holds a screenshot and a video for the failed flow

4. Open the report.

   ```sh
   cd $REPO/.dev/playground && pnpm --filter @repo/e2e exec playwright show-report
   ```

   - [ ] The report names the failed flow and its step

5. Put the spec back.

   ```sh
   cd $REPO/.dev/playground && sed -i 's/{ status: "broken" }/{ status: "ok" }/' packages/e2e/specs/health.spec.ts
   ```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: `pnpm test` stays unit-only beside the browser suite · 🟡 Normal

**Goal.** The two runners never read each other's files, so a unit run cannot start a browser.

**Steps**

1. Run the unit suite in the full project.

   ```sh
   cd $REPO/.dev/playground && pnpm test
   ```

   - [ ] It reports the one example test only, opens no browser, and exits 0
   - [ ] No `packages/e2e` file appears in the output

2. Confirm the e2e workspace declares no `test` script.

   ```sh
   cd $REPO/.dev/playground && node -e "console.log(Object.keys(require('./packages/e2e/package.json').scripts).join(' '))"
   ```

   - [ ] The list holds `e2e`, `e2e:ui`, `e2e:install`, `clean` and `typecheck`, and no `test`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.5: `clean` removes the artifacts it wrote · 🟢 Low

**Goal.** The workspace cleans only what it generates, with `rimraf` rather than `rm -rf`.

**Steps**

1. Clean the e2e workspace.

   ```sh
   cd $REPO/.dev/playground && pnpm --filter @repo/e2e clean
   ```

2. Look at what is left.

   ```sh
   cd $REPO/.dev/playground && ls -a packages/e2e
   ```

   - [ ] `playwright-report`, `test-results` and `.auth` are gone
   - [ ] Every source file is still there
     - `playwright.config.ts`, `prepare-db.ts`, `auth.setup.ts`, `lib/`, `specs/`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
cd $REPO/.dev/playground && pnpm db:drop
```

```sh
cd $REPO && pnpm run play:destroy
```

## Scenario 3: an api-only project with e2e

**Setup.** Run once. This project holds the floor and nothing else, which is what the gating rule is about.

1. Scaffold, install and add only `api` and `e2e`.

```sh
cd $REPO && pnpm run play:reset && cd .dev/playground && git init -q . && ./saasaloy add e2e --yes && cp apps/api/.dev.vars.example apps/api/.dev.vars && pnpm install
```

- [ ] Setup complete

### TC-3.1: An uninstalled module's flow is never collected · 🔴 Critical

**Goal.** A flow for a module the project does not hold is dropped before it runs, rather than skipped at run time on a 404.

**Steps**

1. Run the suite.

   ```sh
   cd $REPO/.dev/playground && pnpm e2e
   ```

   - [ ] Only the `health` flow runs, and it passes
   - [ ] The three other flows are reported as neither passed nor SKIPPED
     - Playwright reports `1 passed`, with no skip count
     - a skip line here is the defect this case exists to catch
   - [ ] Only `apps/api` and `apps/web` start; nothing tries port 3001

2. Confirm the config read the project rather than the filesystem.

   ```sh
   cd $REPO/.dev/playground && cat saasaloy.json
   ```

   - [ ] `installed` holds `api`, `logger`, `logger-console` and `e2e`, and neither `admin`, `auth` nor `waitlist`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
cd $REPO && pnpm run play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The repo's four gate scripts, run on the work tree:

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

Descriptor validation for every module in the registry:

```sh
node packages/cli/dist/index.js doctor modules
```

The browser gate, run for real on both drivers, each from a destroyed playground:

```sh
pnpm run play:destroy && pnpm run verify:e2e --driver=d1
```

```sh
pnpm run play:destroy && pnpm run verify:e2e --driver=postgres
```

- ✅ `pnpm lint` → four passes clean: type-aware oxlint, plain oxlint, Stylelint, `prettier --check`.
- ✅ `pnpm typecheck` → `tsc` clean over `scripts` and `packages/cli`.
- ✅ `pnpm test` → 55 vitest files passed, 584 module tests passed, 164 script tests passed, 0 failed. The new `scripts/e2e-tags.test.ts` contributes 4 of those.
- ✅ `doctor modules` → 40 descriptors valid, `e2e` among them, no problems found.
- ✅ `verify:e2e --driver=d1` → 5 passed in 57.1s. The setup project seeded the fixture admin; `health`, `waitlist`, `admin-login` and `admin-unauthenticated` all passed.
- ✅ `verify:e2e --driver=postgres` → 5 passed in 1.1m, against a Postgres created by the project's own `db:setup`.
- ✅ `verify:e2e` also runs `oxlint -c oxlint.config.mjs packages/e2e` inside the generated project, so the template's own lint config is proven against the shipped suite on every gate run. That step found three real violations the tool repo's config suppresses and the template's does not; all three are fixed.
- ✅ Bugs found by running the gate, not by reading: the api's readiness URL had to be `/health` because `GET /` answers 404; `astro dev` detached itself under agent detection and had to be pinned to the foreground with `ASTRO_DEV_BACKGROUND`; and the waitlist spec had to wait for `<astro-island ssr>` to clear before typing, or hydration wiped the typed address and the form posted an empty one.

No database was written outside `.dev/playground`. The Postgres container the postgres run created was removed with `docker compose down -v`.

## Not covered / needs human judgment

- **The CI workflow has never run.** `.github/workflows/e2e.yml` is written and not executed: this box has no GitHub Actions runner, and the Postgres service container, the `~/.cache/ms-playwright` cache key and `playwright install-deps` are all unproven until the first pull request opens. Watch that job.
- **Windows.** Every path here was exercised on Linux. `clean` uses `rimraf` and the spawns pass `shell` on `win32`, but nobody ran it there.
- **A second browser engine.** Chromium only, by decision. Firefox and WebKit are out of scope.
- **Visual regression, accessibility and performance.** Deliberately out of scope for this capability; plan 0025 owns the accessibility surface.
- **A deployed target.** Every flow drives a local dev server. Nothing runs against a preview or production, by decision.
- **Concurrency.** The suite runs one worker on purpose, because the fixture account is shared. Parallel workers were not tested and are not supported.
- **A project with `e2e` but no `database`.** `prepare-db.ts` has the branch for it and it was read, not run.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
