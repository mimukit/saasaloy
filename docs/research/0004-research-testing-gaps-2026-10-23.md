# Testing gaps in a Saasaloy project

Date: 2026-10-23. Base: `main` at `6a7753b`.

## Goal

Every user journey and every feature in a project made with Saasaloy has an automated test. A later change that breaks an existing flow fails a gate before it reaches production. An owner can choose test-driven development for the project, and the choice is opt-in.

This report records what a generated project and the tool repo test today, the gaps between that and the goal, and the order in which to close them.

## What exists today

### In the tool repo

The tool repo is well tested. These gates run on every push in `.github/workflows/ci.yml`:

- 61 CLI test files under `packages/cli/src`, plus `test/e2e` (apply, partial apply) and `test/matrix/combinations.test.ts` (every module pair, conflict report only).
- 49 module unit tests under `modules/*/files/**/*.test.ts`, run by `pnpm test:modules` on `node:test`.
- Base template tests for `packages/env` and `packages/tooling`.
- Repo guards under `scripts/*.test.ts`: table names, seed slices, env presets, registry floors.

`smoke.yml` runs daily. It packs the CLI, scaffolds from the tarball, starts `astro dev`, and runs `pnpm lint` on one full-module project per database driver.

### In a generated project

- A root `vitest.config.ts` that treats each workspace as a project, with `passWithNoTests: true`.
- A route test harness: `testDatabase()` from `@repo/db/testing`, for both drivers, that starts every test from the seed slices.
- Five shipped Vitest files: `auth.test.ts`, `health-db.test.ts`, `seed/completeness.test.ts`, the D1 `dump.test.ts`, the Postgres `production.test.ts`.
- `packages/env` tests (on `node --test`) and `packages/tooling` tests.
- A "Testing Instructions" section in the template `AGENTS.md`.
- Seed slices, one per table, with one row for each UI state.

The harness is good. The tests that use it are few.

## Gaps

Ranked by how much each one blocks the goal.

### G1. A generated project has no CI gate

The base template ships no `.github/workflows/` file. ADR 0048 says the deploy CI gate stays off until a project names a workflow, and that "a base CI workflow is a separate plan". That plan does not exist. Issue #199 covers deploy on push, not a test gate.

Effect: `pnpm test` runs only when a person remembers to run it, and `pnpm deploy:production` reports the CI gate as off. No other gap matters until this one is closed, because a test that nothing runs protects nothing.

Fix: the base ships `.github/workflows/ci.yml` with `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. A module patches in its own step when it needs one: the Postgres driver adds a service container, and `e2e` adds a browser job. `packages/tooling/src/deploy.config.ts` names the workflow by default, so the deploy gate is on from the first deploy.

### G2. Module behaviour stops being tested once it is copied into a project

The 49 module unit tests use `node:test` and do not ship. The modules copy code into the project (ADR 0006), and the owner owns it after `add`. When the owner edits `packages/billing/src/define.ts` or `rules.ts` in `multitenant`, no test in their project checks it.

These modules ship no test of any kind: `api`, `billing-stripe`, `email-cloudflare`, `email-console`, `email-plunk`, `email-react`, `logger-console`, `sms`, `sms-console`, `teams`, `waitlist`.

Fix: ship module tests into the project as `<name>.vitest.ts` → `<name>.test.ts`, the rule `create-module` already states for Vitest files. Start with the pure rule code an owner is likely to change: tenant rules, RBAC rules, entitlements, past-due lockout, subscription state, rate limits, feature-flag hashing. A tool-repo guard, like `scripts/seed-slices.test.ts`, then fails when a module ships a `src/` file with logic and no test beside it.

The open question is whether the tool repo keeps a second copy on `node:test`. I recommend one copy, on Vitest, run in the tool repo through the playground. Two copies drift.

### G3. Eight of ten route-owning modules ship no route test

Only `auth` and `database` ship a route test. These register api routes and ship none: `admin`, `billing`, `feature-flags`, `multitenant` (2 files), `payment` (2 files), `rbac`, `storage`, `waitlist`.

The harness is ready. `auth.test.ts` is the example to copy: it signs in as the seeded superadmin, reads seed rows through a route, and proves the write did not outlive its test.

Fix: add a `create-module` rule, "every route file ships a route test", and a guard in `scripts/` that fails on a `@api/routes/*` target with no matching `*.test.ts` target. Each route test covers at least the success path, the unauthenticated `401`, the wrong-tenant or wrong-role `403`, and one validation `400`. Those four cases catch most regressions that cross module lines, such as a tenant guard that a later module bypasses.

### G4. PR #164 (e2e) is stale and cannot merge as it stands

PR #164 opened on 2026-09-20. Since then `main` changed under it:

- GitHub reports it `CONFLICTING`.
- The diff has 21 references to `.dev.vars`. ADR 0040 now says a project writes `.env` and never `.dev.vars`.
- It adds `docs/adr/0043-adr-a-cross-module-flow-belongs-to-the-e2e-module`, but ADR 0043 on `main` is the wrangler-native deploy. Its plan serial `0059` is already used three times in `docs/plans/`.
- Its unit-runner half (root `vitest.config.ts`) has already landed on `main` by another route.
- It predates the env capability, the seed system (plan 0072), the shared app shell (ADR 0047), the gated deploy (ADR 0048) and the billing → subscription rename. Its `auth.setup.ts` creates a fixture account over HTTP, and the seeded superadmin now does that job.

The design holds up and is worth keeping: tags that gate a spec by installed module, decided before the run and never skipped at run time; `pnpm verify:e2e` per driver; the `e2e-tags.test.ts` guard.

Fix: rebuild the PR on a new branch from `main`, keep the design, drop the runner half, use `.env` and the seed, and take the next free ADR number. A rebase of four commits across this many changes costs more than a rewrite.

### G5. No rule says who ships a module's own user journey

PR #164 ships four flows (health, waitlist, admin login, admin unauthenticated), and its ADR puts each cross-module flow in the `e2e` module. That covers the base. It does not cover the journeys a feature module adds: a team invite and accept, a subscription checkout through `payment-console`, an api key create and use, a file upload, an admin feature-flag toggle.

If all of these live in `modules/e2e`, that module grows with every feature module and must know about all of them. The descriptor format has no conditional file ("ship this spec only when `e2e` is installed"), so a feature module cannot ship its own spec today.

Fix, two options:

- A. Add a conditional file entry to the descriptor schema, for example `files[].when: { installed: ["e2e"] }`, and let each feature module ship `@e2e/specs/<module>-*.spec.ts`. The module that owns the journey owns its test. `add e2e` after the feature modules must then backfill their specs.
- B. Keep every spec in `modules/e2e`, gated by tags.

I prefer A. B puts every feature's journey in one module that its owners do not maintain, and the module count keeps growing. A needs an ADR and a small applier change.

### G6. No contract suite proves a provider is swappable

The architecture promises that a project swaps a vendor without touching the core. Each provider has its own ad hoc test, and nothing runs one shared set of cases against every provider of a capability.

Fix: each provider-taking core (`email`, `sms`, `kv`, `queue`, `storage`, `payment`, `logger`) ships `src/testing/contract.ts`, a function that takes a provider factory and registers the cases: send, error mapping to the normalized codes, `retryable`, `providerCode`. Each provider's test calls it, for example `runKvContract(() => memoryProvider())`. An owner who writes a custom provider gets the same suite for free. A vendor provider runs the network cases only when its secret is set, and runs the error-mapping cases always, against recorded responses.

### G7. No scheduled job proves a full generated project passes its own tests

`combinations.test.ts` checks pair conflicts only. Its comment says "the nightly full run owns" typecheck and build. `smoke.yml` runs `pnpm lint` on the full-module project and nothing more. No job runs `pnpm build`, `pnpm typecheck`, `pnpm test` or the e2e suite on a generated project.

Fix: extend `release-smoke` (or add a sibling nightly job) to run `build`, `typecheck`, `test` and `verify:e2e` on the full-module project for each driver. Issues #187 (seeded playground) and #184 (`examples/full` golden check) are the natural place for it.

### G8. No schema drift check

Nothing checks that the committed migrations match the Drizzle schema. An owner who edits a table and forgets `db:generate` ships a schema the database does not have. The route tests do not catch it when the test database is built from the schema, not the migrations.

Fix: the database drivers add a `db:check` script (`drizzle-kit check`, plus a generate dry run that must produce no file) and patch it into the CI workflow from G1.

### G9. No UI component tests

Modules ship 81 `.tsx` and `.astro` files, and none has a component test. Issue #203 (admin primitives, `low`, `needs-planning`) covers part of it.

E2E covers the journeys. Component tests are for the states a journey does not reach: empty lists, error states, disabled buttons, the toggle states that issue #191 fixed by hand. I rank this below G1 to G8, because the e2e suite covers the high-value paths first.

### G10. No accessibility or visual check in a generated project

The tool repo has `verify:a11y` with `@axe-core/playwright`. A generated project has neither. Issue #202 covers a seeded admin app in the tool repo. When `e2e` is installed, one `axe` assertion per page spec is cheap, and it belongs in the e2e module. Visual regression (screenshot diffs) is optional and should stay so, because a baseline needs review on every intended UI change.

### G11. No guide or opt-in for test-driven development

The template `AGENTS.md` tells an agent where tests go and how to run them. It does not say which kind of test each change needs, and the base ships no testing skill. The `implementkit` TDD mode belongs to this box, not to a generated project.

Fix:

- A base skill, `saasaloy-testing`, with a table that maps each change kind to its test: pure logic → unit test beside the file; api route → route test with `testDatabase()`; provider → contract suite; user-visible flow → e2e spec with module tags; new table → seed slice. It also states the four route cases from G3.
- An opt-in flag in `saasaloy.json`, for example `"testing": { "mode": "tdd" }`, that `saasaloy` copies into a generated `AGENTS.md` section. In TDD mode an agent writes the failing test first, runs it, sees it fail for the right reason, and only then writes the code. The default stays `tests-after`, so nothing changes for an owner who does not opt in.
- An optional `pre-push` hook that runs `turbo run test --affected`. Keep it off by default; the CI gate from G1 is the real guard.

### G12. Smaller items

- Coverage: the CLI reports coverage in CI, and a generated project has no coverage config. Add a `test:coverage` script with no threshold. A threshold invites tests written for the number.
- Test data: seed slices reset every test, which is right. Route and e2e tests also need small factories with overrides (a user in org B, a past-due subscription). Ship them from `@repo/db/testing` next to `testDatabase()`.
- Webhooks: `billing-stripe` has no test, and payment providers that verify a signature need a recorded-payload test for a valid signature, a bad one, and a replayed event.

## The full set of layers

| Layer | Proves | Tool today | Owner | Gap |
| --- | --- | --- | --- | --- |
| Lint, format, types | Code compiles, follows the rules | `pnpm lint`, `pnpm typecheck` | base | G1 (no CI) |
| Unit | Pure rules and helpers | Vitest | each module | G2 |
| Provider contract | A vendor swap keeps behaviour | none | each core | G6 |
| Route (api integration) | Auth, tenant, role, validation per route | `testDatabase()` | each route module | G3 |
| Schema | Migrations match schema | none | database drivers | G8 |
| Component | UI states | none | `ui`, `admin` | G9 |
| E2E journey | A user flow across modules | PR #164 | `e2e` + feature modules | G4, G5 |
| Accessibility | Pages pass axe | tool repo only | `e2e` | G10 |
| Deploy smoke | Live hosts answer after deploy | ADR 0048 smoke list | base | done |
| Generated-project nightly | A full scaffold passes its own gates | lint only | tool repo | G7 |

## Recommended order

1. G1: base CI workflow, with the deploy gate named by default. Small, and it makes every later test count.
2. G4: rebuild PR #164 on `main`.
3. G3: route tests for the eight modules, plus the guard. The harness exists, so this is copy-and-adapt work.
4. G2: move the module unit tests to shipped Vitest files, plus the guard.
5. G11: the `saasaloy-testing` skill and the TDD opt-in. It must exist before G5, so feature modules have a rule to follow.
6. G5: decide option A or B in an ADR, then ship one journey spec per feature module.
7. G6: provider contract suites.
8. G7 and G8: nightly full-project run and the schema drift check.
9. G9, G10, G12 as capacity allows.

## Open decisions for the owner

- G2: one test copy on Vitest, or keep the `node:test` copies in the tool repo as well?
- G5: conditional descriptor files (option A) or every spec in `modules/e2e` (option B)?
- G11: is `saasaloy.json` the right home for the TDD flag, or the template `AGENTS.md` only?
