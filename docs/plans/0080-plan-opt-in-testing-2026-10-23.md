# Plan: Opt-in testing for generated projects

Grilled: 2026-10-23

## Context

A project made with Saasaloy has a test harness and almost no tests. The base ships a root `vitest.config.ts`, and the database drivers ship `testDatabase()` with seed slices. Only five Vitest files reach a project. 8 of the 10 modules that register api routes ship no route test. The 49 module unit tests run on `node:test` in the tool repo and never reach a project. Nothing runs `pnpm test` before a deploy. `docs/research/0004-research-testing-gaps-2026-10-23.md` has the full survey. Tracked by issue #240.

The goal: a project that turns testing on gets a test for every route, every rule, every provider and every user journey it installs. A later change that breaks one of them fails a gate before it reaches production. An owner can pick test-driven development. A project that does not turn testing on stays as light as it is today.

Target: in a playground scaffolded with every module and `testing.mode` set to `tdd`, each of the 10 route-owning modules ships a route test, each provider passes its capability's contract suite, and `pnpm test` passes on both database drivers. Baseline: 2 of 10 route-owning modules and 0 contract suites (`docs/research/0004-research-testing-gaps-2026-10-23.md`, 2026-10-23).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Testing stack | Vitest for unit, route and contract tests. Playwright for browser journeys. No second runner. |
| Testing is opt-in | `saasaloy.json` carries `"testing": { "mode": "off" \| "tests-after" \| "tdd" }`. `off` is the default, and an absent key reads as `off`. A project with testing off ships no module test file and runs no test guard. |
| Mode values | Three. `tests-after` and `tdd` ship the same files and differ only in the agent guidance. (Q5, defaulted) |
| Mode scope | One mode for the whole project. No per-module mode. (Q7, defaulted) |
| TDD flag lives in two places | `saasaloy.json` holds the value. The template `AGENTS.md` holds a marked testing block (`<!-- saasaloy:testing -->` … `<!-- /saasaloy:testing -->`) that states the mode and its rules. The CLI writes both together and rewrites only the text between the markers. |
| What `tdd` enforces | Guidance only. No check on commit order. (Q12, defaulted) |
| CLI surface | `saasaloy init --testing=<off\|tests-after\|tdd>` at init, and one prompt in an attended init. `saasaloy testing <mode>` changes it later; `saasaloy testing` with no argument prints the mode. Unattended `init` with no flag writes `off`: off is the opt-in default, not a guess (ADR 0046). (Q4, Q6) |
| Turning testing off | Rewrites the `AGENTS.md` block and the mode. Leaves every test file in place, because the CLI never deletes a file the owner may have edited (ADR 0034). (Q8, defaulted) |
| Conditional files | A descriptor `files[]` or `patches` entry takes `"when": { "testing": true }` or `"when": { "installed": ["<module>"] }`. The applier skips an entry whose condition is false and records it as skipped in the manifest. (Q9, defaulted) |
| Backfill | One shared backfill step writes every skipped entry whose condition is now true. `saasaloy testing <on-mode>` and `saasaloy add` both call it. A re-run recovers a partial backfill (ADR 0031). (Q20, defaulted) |
| The base keeps its runner | The root `vitest.config.ts` and `vitest` stay in the base for every project, so an owner can write a first test with no setup. |
| Existing tests are gated too | `auth.test.ts`, `health-db.test.ts`, `completeness.test.ts` and the driver tests take `when: { testing: true }` like every other test. The changelog records it. (Q11, defaulted) |
| Existing projects | A project with shipped tests and no `testing` key reads as `off`. Its files stay. `update` prints one line that suggests `saasaloy testing tests-after`. (Q23, defaulted) |
| Module unit tests ship | Each module unit test moves from `<name>.test.ts` on `node:test` to `<name>.vitest.ts` on Vitest, with a `when: { testing: true }` entry. One copy, no `node:test` twin. |
| Tool repo test run | `pnpm test:modules` runs the `.vitest.ts` files in place through `packages/cli/vitest.modules.config.ts`, with the existing shims that resolve `../index` to the real core. The PR gate stays offline and fast. The playground run that proves the shipped copy is nightly (Phase 10). (Q2) |
| Route test rule | When testing is on, each `@api/routes/*` file ships a route test covering the success path, `401` with no session, `403` for the wrong tenant or role, and one `400` for bad input. |
| Guard opt-out | A `files[]` entry may carry `"untested": "<reason>"`. The guards print the reason. (Q21, defaulted) |
| Schema drift check | Each database driver ships `db:check`: `drizzle-kit check` plus a generate dry run that must write no file. A `package-json-script` patch with `when: { testing: true }` puts it in the root `test` script. (Q10, defaulted) |
| Journey spec ownership | Option A. A feature module ships its own Playwright spec, `modules/<module>/files/e2e/<module>-<journey>.spec.ts` → `@e2e/specs/`, gated by `when: { installed: ["e2e"] }`. A journey that crosses three or more modules ("sign up, create org, subscribe") lives in `modules/e2e`, and may use page objects that the feature modules ship. (Q1, 2026-10-23) |
| `e2e` and the mode | `add e2e` turns testing on: when the mode is `off` it sets `tests-after`, prints one line that says so, and backfills. It leaves `tdd` alone. `remove e2e` does not change the mode. The `e2e` descriptor declares it as `"enablesTesting": true`. (Q15, 2026-10-23) |
| Base e2e flows | The #155 rebuild ships `health`, `waitlist`, `admin-login` and `admin-unauthenticated` in `modules/e2e`. Phase 11 moves the `waitlist` and `admin-*` specs to their own modules. `health` stays. (Q18, defaulted) |
| CI is opt-in, static | A `ci` module writes a static `@root/.github/workflows/ci.yml` that runs `pnpm install --frozen-lockfile`, `pnpm ci:prepare`, `lint`, `typecheck` and `test`. Modules extend `ci:prepare` through `package-json-script` patches: `database-postgres` adds `docker compose up -d --wait` over its `compose.yaml`, and `e2e` adds `e2e:install` and an `e2e` step. The workflow file never changes after it is written. `@root` is justified because GitHub reads workflows only from the repo root. (Q3, 2026-10-23) |
| CI with testing off | The `ci` module works and always runs `pnpm test`; the base config has `passWithNoTests`. The workflow never reads the mode. (Q16, defaulted) |
| Deploy gate | The `ci` module patches `packages/tooling/src/deploy.config.ts` to name `ci.yml`, which turns the ADR 0048 CI gate on. |
| Contract suite runtime | The Phase 9 spike picks Miniflare or the Workers Vitest pool for the Cloudflare providers. (Q14, defaulted) |
| Coverage | Out of this plan. (Q13, defaulted) |
| ADRs | Two. One for the testing mode and the `AGENTS.md` block, amending ADR 0007. One for `files[].when`, `enablesTesting` and journey ownership. (Q19, defaulted) |
| Attended phases | None. Every phase can run unattended. (Q22, defaulted) |
| Filing | Four issues under #240 as the tracking parent: core (Phases 2–4), tests (Phases 5–7), CI (Phase 8), later (Phases 9–11). (Q17, 2026-10-23) |
| PR #164 (e2e) | Rebuilt from `main` on a separate T3 thread under issue #155, outside this plan. Phase 11 depends on it. |
| Guidance | A base skill, `saasaloy-testing`, maps each kind of change to its test layer and states the TDD loop. |

## Approach

The plan adds one switch (`testing.mode`) and one descriptor field (`when`), then hangs every test behind them. It reuses:

- `testDatabase()` from `@repo/db/testing` and the seed slices, for every route test.
- `modules/auth/files/api/routes/auth.vitest.ts`, as the route test shape to copy.
- The `<name>.vitest.ts` → `<name>.test.ts` rename rule in `.agents/skills/create-module/SKILL.md`.
- `scripts/seed-slices.test.ts`, as the shape for the new descriptor guards.
- The `package-json-script` patch kind, for `db:check` and every `ci:prepare` step.
- `modules/database-postgres/files/compose.yaml`, for the CI database.
- `scripts/release-smoke.ts` and `.github/workflows/smoke.yml`, for the nightly run.
- The `-memory` and `-console` providers, as the local side of each contract suite.

Rejected: a `testing` module whose presence turns testing on, because a module cannot hold a mode value cleanly and `remove testing` would have to delete owner tests. A generated `ci.yml`, because it needs a YAML generator and an ADR 0034 exception that script patches avoid. Specs for every journey in `modules/e2e`, because that module would grow with every feature module and own files it does not maintain.

### Phase 1: testing mode in `saasaloy.json` and `AGENTS.md`

Issue: core.

- Add `testing.mode` to `packages/cli/schemas/saasaloy.schema.json`; an absent key reads as `off`.
- Add `--testing=<mode>` to `saasaloy init`, and one prompt in the attended init flow.
- Add `saasaloy testing [mode]` in `packages/cli/src/commands/`. With no argument it prints the mode.
- Add the marked block to the template `AGENTS.md`, with one text per mode. `off`: the project ships no module tests, and `saasaloy testing tests-after` turns them on. `tests-after`: which test each change needs, pointing at the `saasaloy-testing` skill. `tdd`: write the failing test, run it, see it fail for the stated reason, write the code, see it pass.
- `update` on a project with gated test files in its manifest and no `testing` key prints the one-line suggestion.
- Write the ADR for the testing mode and the `AGENTS.md` block, amending ADR 0007.

Done when: `saasaloy init .dev/t --testing=tdd --no-install` writes `"mode": "tdd"` and the `tdd` block, `saasaloy testing off` in that project rewrites both, `saasaloy testing` prints `off`, and `pnpm test` covers each case.

### Phase 2: conditional files and backfill

Issue: core.

- Add `when` (`testing: true`, `installed: string[]`) to `files[]` and `patches` in `registry-item.schema.json`, plus `untested` on `files[]` and `enablesTesting` on the descriptor.
- The applier skips an entry whose condition is false, and the manifest records it as skipped, so `update` does not report it missing.
- Add the shared backfill step. `saasaloy testing <on-mode>` and `saasaloy add` call it.
- `add` of a module with `enablesTesting` sets `tests-after` when the mode is `off`, prints one line, and backfills. `remove` of that module leaves the mode.
- Turning testing off leaves written files in place.
- `doctor modules` validates every `when` entry.
- Write the ADR for `when`, `enablesTesting` and journey ownership.

Done when: a CLI test adds `auth` with testing off and finds no `auth.test.ts`, runs `testing tests-after` and finds it, runs `testing off` and still finds it; a second test adds a fixture module with `enablesTesting` to an `off` project and finds the mode at `tests-after` and `auth.test.ts` written.

### Phase 3: the `saasaloy-testing` skill

Issue: core.

- Add `packages/cli/templates/base/_agents/skills/saasaloy-testing/SKILL.md`.
- It maps each change to its test: pure logic → unit test beside the file; api route → route test with `testDatabase()` and the four cases; provider → contract suite; new table → seed slice; user-visible flow → Playwright spec in the feature module, gated on `e2e`.
- It points to `auth.test.ts` as the route test to copy, and it reads the mode from `saasaloy.json`.
- Update the "Testing Instructions" section of the template `AGENTS.md` to point at the skill.

Done when: a fresh `init` has the skill under `.agents/skills/saasaloy-testing/` with its `.claude/skills/` symlink, and `pnpm verify:content` passes.

### Phase 4: ship the module unit tests

Issue: tests. Depends on the core issue.

- Convert the 49 module unit tests to Vitest and rename them to `<name>.vitest.ts`, with a `when: { testing: true }` entry each.
- Add `packages/cli/vitest.modules.config.ts` and point `pnpm test:modules` at it, so the files run in place with the existing shims.
- Add `scripts/module-tests.test.ts`: it fails when a module ships a `src/` logic file with no test entry beside it and no `untested` reason.
- Update `.agents/skills/create-module/SKILL.md` for the new rule.

Done when: `pnpm test:modules` runs every converted file on Vitest and passes, and the guard fails on a fixture descriptor that drops one test entry.

### Phase 5: route tests for every route-owning module

Issue: tests.

- Write a route test for `admin`, `billing`, `feature-flags`, `multitenant` (2 files), `payment` (2 files), `rbac`, `storage` and `waitlist`, each with the four cases.
- Gate each one, and the existing `auth` and `health-db` tests, with `when: { testing: true }`.
- Add `scripts/route-tests.test.ts`: it fails when a descriptor targets `@api/routes/<name>.ts` with no `@api/routes/<name>.test.ts` entry and no `untested` reason.

Done when: a playground with every module and `--testing=tests-after` passes `pnpm test` on both drivers with 10 of 10 route-owning modules tested, and the guard fails on a fixture that drops one route test.

### Phase 6: schema drift check

Issue: tests.

- Add `db:check` to `database-d1` and `database-postgres`.
- A `package-json-script` patch with `when: { testing: true }` runs it in the root `test` script before Vitest.
- Document it in the `saasaloy-database` skill.

Done when: in the playground, an edit to a table with no `db:generate` makes `pnpm test` fail at `db:check`, and `db:generate` makes it pass.

### Phase 7: the opt-in `ci` module

Issue: CI. Depends on the core issue.

- Build `modules/ci`: the static workflow at `@root/.github/workflows/ci.yml`, a root `ci:prepare` script that does nothing by default, a patch that names `ci.yml` in `deploy.config.ts`, and a `saasaloy-ci` skill.
- `database-postgres` patches `ci:prepare` with `docker compose up -d --wait`, under `when: { installed: ["ci"] }`.
- `e2e` patches in `e2e:install` and the `e2e` step, under the same condition.

Done when: a playground with `ci`, `database-postgres` and testing on runs `ci.yml` green on a push to a scratch repo, and `pnpm deploy:production --dry-run` reports the CI gate as on.

### Phase 8: provider contract suites

Issue: later.

- Spike `packages/kv/src/testing/contract.ts`: `kvContract(name, makeProvider)` registers the shared cases with Vitest (round trip, TTL floor, `list` cursor, `consume` window, error mapping to `KvError` codes with `providerCode` and `retryable`).
- Run it against `kv-memory` and `kv-cloudflare` on Miniflare or the Workers Vitest pool; the spike picks one and records why. A vendor provider runs network cases only when its secret is set, and runs error mapping against recorded responses always.
- Record what the spike learned in the plan: run time, the recorded-response format, and any contract change. A contract a provider cannot pass without a second runtime file is a contract bug (AGENTS.md).
- Roll out to `email`, `sms`, `queue`, `storage`, `payment` and `logger`. Each suite ships under `when: { testing: true }`.

Done when: every installed provider in the Phase 5 playground runs its capability's contract suite in `pnpm test`, and an owner-written provider can call `kvContract("mine", () => mine())`.

### Phase 9: nightly full-project run

Issue: later.

- Measure the time to scaffold, install, `build`, `typecheck` and `test` one full-module project per driver with `--testing=tdd`.
- Add `.github/workflows/full.yml` on a schedule, separate from `smoke.yml`, so the release preflight stays fast.
- Add `verify:e2e` per driver once Phase 10 lands.
- Fix the comment in `packages/cli/test/matrix/combinations.test.ts` so it names the real job.

Done when: the scheduled job runs `build`, `typecheck` and `test` on both drivers and passes on `main`.

### Phase 10: journey specs per feature module

Issue: later. Depends on #155.

- Move the `waitlist` and `admin-*` specs from `modules/e2e` to their own modules under `when: { installed: ["e2e"] }`.
- Write one journey spec per feature module with UI: `auth` sign-in and sign-out, `teams` invite and accept, `api-keys` create and use, `billing` checkout through `payment-console`, `storage` upload, `feature-flags` toggle in admin.
- Add one `axe` assertion per page spec.

Done when: `pnpm verify:e2e --driver=d1` and `--driver=postgres` pass with every journey spec collected, `add e2e` after the feature modules backfills each spec, and the nightly job runs them. The target in Context holds.

## Open questions

- Phase 4: how many module unit tests need a shim change to run on Vitest in place? The phase records the count.
- Phase 8: Miniflare or the Workers Vitest pool. The spike settles it.
- Phase 10: `billing` becomes `subscription` (owner decision, 2026-10-20). Name the spec after whichever module exists when the phase starts.

## Non-goals

- Rebuilding PR #164. A separate T3 thread does it under #155.
- Component tests for admin primitives (#203) and visual regression.
- Deploy on push (#199).
- Coverage reports and thresholds.
- Test data factories beyond the seed slices.
- A per-module testing mode.
- Any test for a project with testing off, beyond what the base ships today.
