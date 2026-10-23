# 0051: The `e2e` capability gates flows on installed modules

A generated project had no proof that its apps work together. Nothing signed in to the admin app, submitted the waitlist form or called a guarded route against running apps, so a change in one module that broke another module's flow broke it silently. The `e2e` capability adds a Playwright suite to a project. This record settles its shape. It was first written for PR #164 as ADR 0043 on 2026-09-20; that number went to the wrangler-native deploy, and the record is re-taken here for the rebuild under issue [#155](https://github.com/mimukit/saasaloy/issues/155) (`docs/plans/0081-plan-e2e-capability-rebuild-2026-10-23.md`).

## Status

accepted. It applies [ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md) and [ADR 0037](0037-adr-an-alternate-implementation-that-adds-one-file-is-a-provider-2026-09-08.md) and amends neither. It leaves one question open on purpose: which module ships the flow for a feature module. Issue [#240](https://github.com/mimukit/saasaloy/issues/240) holds that decision in its phase 1. **Amended by [ADR 0054](0054-adr-when-gates-optional-entries-and-feature-modules-own-their-journeys-2026-10-23.md):** that question is settled. A feature module ships its own journey spec under `when: { installed: ["e2e"] }`, a journey across three or more modules stays in `modules/e2e`, and `e2e` will turn testing on through `enablesTesting` once issue [#245](https://github.com/mimukit/saasaloy/issues/245) sets it.

## The shape

- **A plain capability, with neither providers nor drivers.** The three-question test asks how a capability's alternate implementations differ, and `e2e` has none. It wraps no external service. Playwright is a devDependency inside `packages/e2e`, the way `drizzle-kit` is one inside `packages/db`. Swapping it would replace every file in the workspace, which is a rewrite, not a driver. So there is no `E2E_PROVIDER` and nothing for `conflictsWith` to keep apart.
- **One workspace.** `packages/e2e`, named `@repo/e2e`, alias `@e2e`. Nothing deploys the suite, so it is not an app. It `dependsOn` `api`, because the floor flow, `health`, needs nothing else.
- **Chromium only, pinned exact.** `@playwright/test` is exact-pinned in the workspace. A second engine doubles the run for a class of bug the suite does not look for.
- **`saasaloy.json` decides what runs.** `playwright.config.ts` reads `installed`. It starts one `webServer` entry per installed app on its pinned dev port, and Playwright kills every process it started. An unreadable `saasaloy.json` throws, because reading it as "nothing installed" would end green having tested nothing.
- **A spec declares its modules as tags.** `test.describe("admin login", { tag: ["@admin", "@auth"] }, …)`. Every tag is a module name. The base app has no tag, because it is always present. The tags whose module is absent become `grepInvert`.
- **The project's own database commands, before Playwright starts.** `prepare.ts` runs `pnpm db:setup`, then `pnpm db:seed`, and the `e2e` script runs it before `playwright test`. The api Worker reads `apps/api/.env` when it boots, so a database URL written after `webServer` starts would never reach it. The suite carries no second code path per driver.
- **The seed provides the signed-in account.** The admin flows sign in as the seeded `superadmin@example.test`. The suite creates no account over HTTP. `db:seed` upserts the row before every run, so its role and password are known.
- **The four base flows ship in the module.** `health`, `waitlist`, `admin-login` and `admin-unauthenticated` live in `modules/e2e/files/specs/`. They exercise the base app and the capabilities a project almost always holds, and each is gated on its tags.
- **No workflow in the project.** The module adds no CI file to a generated project. CI there is opt-in. The tool repo runs the suite in its own `.github/workflows/e2e.yml`.

## Never collected, never skipped

A spec whose module is absent is uncollected when the configuration loads. It is **not** allowed to run and call `test.skip()` on a 404.

A broken route and an uninstalled module look the same from inside a browser: both answer 404. A suite that skips on a 404 reports green when a route breaks, which is the failure the suite exists to catch. Deciding before anything runs, from the file that records what is installed, keeps a 404 a failure.

That rule fails silently in one direction, and a test guards it. A tag that names no module is never in any project's `installed`, so its spec is uncollected everywhere and the suite still reports green. A module rename does exactly that. `scripts/e2e-tags.test.ts` asserts that every tag in `SPEC_TAGS` names a directory under `modules/` and that every tag a spec writes is declared. It runs in `pnpm test`.

## Considered Options

- **Skip at run time on a 404.** Rejected for the reason above.
- **Read a `requires` export from each spec.** Rejected: importing a spec outside the runner throws, because `test()` runs at import.
- **Seed the admin account over HTTP from a Playwright setup project.** This was PR #164's shape, written before the seed system existed. Rejected now: it depended on the first-user promotion, so a database that already held an account gave the fixture the plain `user` role. The seed sets the role directly.
- **Ship a CI workflow with the module.** Rejected: CI is opt-in for a generated project (issue #240).
- **Settle here which module ships a feature module's flow.** Not taken. Issue #240 phase 1 owns that decision, and this record does not pre-empt it. The tag mechanism works for either answer, because a tag gates a spec wherever the spec comes from.

## Consequences

- `pnpm test` stays unit-only. The base `vitest.config.ts` leaves `packages/e2e` out, because Vitest's default glob also matches `*.spec.ts`.
- The base `oxlint.config.mjs` turns the Vitest preset's rules off for `packages/e2e/**`, for the same glob reason. The tool repo's config does the same for `modules/e2e/files/**`.
- The suite needs the waitlist form placed on a page. `saasaloy add waitlist` does not place it, so the waitlist flow fails with a message that names the Wire-up section until the owner does.
- A local run keeps its database. `global-teardown.ts` drops it only when `CI` is set. Every row a spec writes is unique, so a crashed run cannot poison the next one.
- `pnpm verify:e2e --driver=d1|postgres` runs the suite in a fresh playground. It downloads a browser and takes minutes, so it stays out of `deps:verify`.

## References

- PR #164, the first build, which this rebuild supersedes.
- `docs/plans/0059-plan-e2e-capability-2026-09-20.md`, the grilled plan.
- `docs/plans/0072-plan-seed-system-2026-10-20.md`, the seed slices the admin flows sign in with.
- [ADR 0040](0040-adr-a-scaffolded-project-writes-env-never-dev-vars-2026-09-20.md), why every app reads `.env` and nothing writes `.dev.vars`.
