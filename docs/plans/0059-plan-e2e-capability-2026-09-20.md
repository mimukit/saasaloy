# Plan: an e2e test capability for the scaffolded app

Grilled: 2026-09-20

## Context

A scaffolded Saasaloy project ships no proof that it works. Nothing exercises sign-in, a waitlist submission, or an admin route against a running app, so a module that breaks another module's flow breaks it silently.

Issue [#155](https://github.com/mimukit/saasaloy/issues/155) says "the scaffolded app has unit tests but no end-to-end coverage". The first half is wrong, and the grill corrected it. Ten modules ship `.test.ts` files, and every one carries a header saying it is deliberately excluded from `scaffolds[].files` and runs on `node:test` here in the tool repo, never in a user's project (see `modules/kv/files/src/keys.test.ts:1-6`, which names the reason: the payload's tsconfig extends `@repo/tsconfig/base.json` and resolves only inside a scaffolded project). A generated project has **zero** test files and **no test runner**.

So the plan ships two layers. The base template gets a unit runner and one example test, which gives a project owner a working `pnpm test` and the pattern to copy. A new `e2e` module gets Playwright, four flows, and a database.

Success means a developer runs `pnpm test` on a fresh project and sees a green suite, then runs `pnpm e2e:install` and `pnpm e2e` and sees headless Chromium sign in to the admin app and submit the waitlist form, with no desktop present.

## Design decisions (settled)

| Decision | Resolution |
|---|---|
| Sequencing against [#152](https://github.com/mimukit/saasaloy/issues/152) | **This issue blocks on #152.** `globalSetup` calls `db:setup` and `globalTeardown` calls `db:drop`; neither exists yet. #152 is `in-review` with a grilled plan, so the wait is short, and a private bootstrap shipped in the meantime would outlive its reason. |
| Unit runner | **vitest**, exact-pinned once in the base template's root `devDependencies`, with a root `vitest.config.ts` carrying a `projects` glob over `apps/*` and `packages/*`. Rejected: a `vitest` devDependency and a `test` script per workspace, which is eleven pnpm-invisible pins for `deps:update` to keep in lockstep. |
| What Phase 1 proves | One real example test in `packages/ui`, not an empty runner. `pnpm test` that reports nothing reads as broken, and the example is the pattern a project owner copies. |
| Scaffolding the module tests into projects | **Out of scope.** It reverses a documented decision in ten file headers and its blocker is a tsconfig resolution problem, not a runner choice. Separate issue. |
| e2e runner | **Playwright**, exact-pinned, Chromium only. It drives the one authenticated UI the registry ships (`modules/admin/files/src/routes/login.tsx`) and the one public UI (`modules/waitlist/files/web/components/WaitlistForm.tsx`). An HTTP-only suite reaches the Hono routes and proves nothing about either form. |
| Module shape | A plain capability module, `modules/e2e/`, with no providers and no drivers. It wraps no external service, so ADR 0033's first question does not apply, and ADR 0037's third question has nothing to select between. Follows plan 0057's precedent ("neither providers nor drivers"). |
| Workspace path | `packages/e2e`, name `@repo/e2e`. `apps/*` is for deployables (`web`, `api`, `admin`); nothing deploys the suite. The template's `packages/*` glob already covers it. |
| Alias | The scaffold declares `"aliases": { "@e2e": "packages/e2e" }`, so a later module can target `@e2e/specs/<name>.spec.ts` without knowing the path. |
| Who owns a spec | **The `e2e` module owns every spec.** A flow crosses modules (waitlist posts from `web` to `api` to `db`), so no feature module owns it, and a spec shipped by `waitlist` would need `dependsOn: ["e2e"]`, forcing the suite on every project that wants a waitlist form. |
| How a spec declares its modules | **Playwright tags**, in the spec: `test.describe("admin login", { tag: ["@admin", "@auth"] }, …)`. `playwright.config.ts` reads `installed` from `saasaloy.json` and builds `grepInvert` from the modules that are absent. Rejected: importing the spec to read an exported `requires` array, which throws because `test()` runs outside the runner; a regex over the source; a generated manifest that a hand-written spec bypasses. **Confirm the tag API against the pinned Playwright version before building.** |
| Guarding the tag vocabulary | A tool-repo test under `scripts/` asserts every tag in the suite names a real directory under `modules/`. That is what stops a rename silently disabling a flow. |
| Skipping, not tolerating | A spec whose modules are absent is never collected. A runtime `test.skip()` on a 404 turns a broken route into a green run, which is the failure this capability exists to catch. |
| Which flows ship | Four. `health.spec.ts` (public, `api` only, the floor); `waitlist.spec.ts` (public form submit, asserted through the api); `admin-login.spec.ts` (drive the real login form, assert the redirect, assert the guarded call returned `200`); `admin-unauthenticated.spec.ts` (call the guarded api route with no cookie, expect `401`). The negative case is its own flow, because an authorization regression shows up there and the client-side TanStack guard hides it everywhere else. |
| Signed-in state | `globalSetup` creates a fixed test user through the Better Auth sign-up endpoint over HTTP and saves `storageState`. `admin-login.spec.ts` ignores that state and drives the form, because a login flow that reuses a cookie tests nothing. Later authenticated specs reuse it. |
| Fixture idempotence | A **fixed** email. `globalSetup` tolerates an "already exists" response and signs in instead. Every spec that writes a row deletes it **at the start**, not in teardown, so a crashed run cannot poison the next one. Rejected: a unique user per run (junk rows), teardown deletion (a crash leaves the user), and dropping the database each run (a full migration on every local run). |
| Which drivers | **Both D1 and Postgres.** The driver split is the repo's load-bearing claim, and an e2e capability that works on one driver proves the opposite of what it exists to prove. `db:setup` hides the difference, so the cost is one CI service container, not a second code path. |
| Database guard | `globalSetup` calls `db:setup`, which already refuses a `DATABASE_URL` its state block does not vouch for (plan 0057). On top of that it asserts the resolved database name carries the e2e suffix. No confirmation prompt and no env var; both get exported once and forgotten. |
| How the app starts | Playwright's `webServer` array, one entry per installed app, each `pnpm --filter @repo/<app> dev` on its fixed port (`api` 4000, `web` 3000, `admin` 3001, all `strictPort`). Playwright owns the lifecycle and kills what it started. `reuseExistingServer` is true off CI. Rejected: `wrangler dev` directly (`vite dev` serves the same Worker on the same port) and a deployed preview (needs credentials a local run does not have). |
| A project without `auth` | `globalSetup` reads `installed` and skips seeding. `dependsOn` stays `["api"]`, because `health.spec.ts` is the floor and `api` is all it needs. Every `@auth`-tagged spec is already uncollected by the `grepInvert` rule. |
| `packages/e2e` scripts | `e2e`, `e2e:ui`, `e2e:install`, `clean`, `typecheck`. **No `test` script**, and the vitest `projects` glob excludes `packages/e2e`, so `pnpm test` stays unit-only and the two runners never see each other's files. |
| Browser binaries | No `postinstall`; it would download ~150MB on every `pnpm install` in every generated project. `pnpm e2e:install` runs `playwright install chromium`, and `globalSetup` fails with that exact command in the message when the browser is missing. `--with-deps` is never run for a developer, because it needs root. |
| Failure artifacts | `trace: "on-first-retry"`, `screenshot: "only-on-failure"`, `video: "retain-on-failure"`, an HTML report at `packages/e2e/playwright-report`, and the `list` reporter so a headless run prints the failing step to stdout. |
| `clean` | `"clean": "rimraf -g playwright-report test-results \"*.tsbuildinfo\""`, with `rimraf` exact-pinned in the workspace, per the template's `AGENTS.md`. |
| Lint | The template's `oxlint.config.mjs` turns the `vitest` preset on (it already anticipates this at `oxlint.config.mjs:13`). Playwright specs are covered by the plain pass; oxlint ships no Playwright preset. |
| The tool-repo gate | `pnpm verify:e2e` scaffolds `.dev/playground`, adds the module set, installs, and runs the suite. Its own script, not part of `deps:verify`, because it costs minutes and a browser download. |
| CI | A two-job matrix (`d1`, `postgres`) in one workflow, on `pull_request` with `paths: modules/**`, `packages/cli/templates/**`. Postgres comes from a GitHub Actions **service container**, reached through `db:setup --server`, which also exercises the one backend plan 0057 ships that nothing else covers. `~/.cache/ms-playwright` is cached; the job runs `playwright install --with-deps chromium`. |

## Approach

Reuses: the `scaffolds` + `aliases` mechanism (`modules/api/registry-item.json`), the `package-json-script` patch kind and the `@root` alias from plan 0057, the fixed dev ports already hardcoded in three vite configs and in the api's CORS allowlist, `db:setup`/`db:drop` from #152, and the `play:init` playground harness.

### Phase 1: a unit runner in the base template

- Add `vitest` (exact-pinned) to the base template's root `devDependencies` and `"test": "vitest run"` to the root scripts.
- Add `vitest.config.ts` at the template root with a `projects` glob over `apps/*` and `packages/*`, excluding `packages/e2e`.
- Write one real example test in `packages/ui`, covering an existing exported function rather than a placeholder assertion.
- Turn the `vitest` preset on in the template's `oxlint.config.mjs`.
- Add a `test` task to `packages/cli/templates/base/turbo.json` only if the `projects` glob proves slower than per-workspace runs; the default is no turbo task.
- Verify: `pnpm play:reset`, then `pnpm -C .dev/playground test` is green.

### Phase 2: the `e2e` module

- `modules/e2e/registry-item.json`: `type: "saasaloy:capability"`, `dependsOn: ["api"]`, a `packages/e2e` scaffold with the `@e2e` alias, `devDependencies` pinning `@playwright/test` and `rimraf`.
- Scaffold `package.json`, `tsconfig.json`, `playwright.config.ts`, `global-setup.ts`, `global-teardown.ts`, `fixtures/user.ts`, `fixtures/api.ts`.
- `playwright.config.ts` reads `installed` from `saasaloy.json`, derives `grepInvert` and the `webServer` array from it, and fails loudly when `saasaloy.json` is unreadable rather than silently running nothing.
- `global-setup.ts` runs `db:setup`, asserts the e2e suffix on the resolved database, then seeds the fixed user when `auth` is installed and saves `storageState`. `global-teardown.ts` runs `db:drop` only when setup created the database.
- Two `package-json-script` patches on the root `package.json`: `e2e` and `e2e:install`.
- `modules/e2e/skills/saasaloy-e2e/SKILL.md`: how to add a flow, the tag vocabulary, the port table, the browser-install step, where artifacts land.

### Phase 3: the four flows

- `specs/health.spec.ts` — tag `@api`. `GET /health`, asserting the documented body.
- `specs/waitlist.spec.ts` — tags `@waitlist @web`. Delete the fixture row, fill the form on `web`, submit, assert the success state, assert the row through the api.
- `specs/admin-login.spec.ts` — tags `@admin @auth`. Drive the login form with the seeded user, assert the redirect to `/`, assert the guarded api call returned `200` and the route rendered rather than `access-denied`.
- `specs/admin-unauthenticated.spec.ts` — tags `@admin @auth`. Call the guarded api route with no cookie, expect `401`.

### Phase 4: the gates

- `scripts/verify-e2e.ts`, wired as `pnpm verify:e2e`. It scaffolds the playground, adds `api`, `database-d1`, `auth`, `admin`, `waitlist`, `e2e`, installs, runs `pnpm e2e`, and prints the report path on failure.
- `scripts/e2e-tags.test.ts`: every tag in `modules/e2e/files/specs/**` names a real directory under `modules/`.
- Add both to CONTRIBUTING's gate table beside `verify:css` and `verify:preset`.
- The two-job CI workflow described above.

### Phase 5: documentation and the decision record

- ADR: an e2e capability takes neither providers nor drivers, and a cross-module flow's spec belongs to `e2e` rather than to the feature module it exercises.
- The template's `README.md` gains a testing section: `pnpm test`, `pnpm e2e:install`, `pnpm e2e`.

## Non-goals

- No visual regression, no accessibility assertions, no performance budget. Plan 0025 owns the a11y surface.
- No suite against a deployed preview or production.
- No second browser engine. Chromium only.
- No load or contract testing.
- No change to the tool repo's own `test:modules` arrangement, and no scaffolding of module test files into a generated project.
- No sign-up, sign-out, or authorization-denied-in-UI flow in the first release.
