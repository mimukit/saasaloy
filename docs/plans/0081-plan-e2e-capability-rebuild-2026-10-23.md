# Plan: rebuild the e2e capability on current `main`

Drafted: 2026-10-23. Issue: #155. Supersedes PR #164. The design is the grilled [plan 0059](0059-plan-e2e-capability-2026-09-20.md); this plan records only what changed between that build and this one.

## Context

PR #164 built the `e2e` capability on 2026-09-20. `main` moved a long way after that, and the PR is now `CONFLICTING`:

- ADR 0040 says a project writes `.env` through `packages/env` and never writes `.dev.vars`. The PR read and wrote `apps/api/.dev.vars` in 21 places.
- The seed system (plan 0072) writes `superadmin@example.test` with the password `saasaloy-dev-password`. The PR created its own admin account over HTTP.
- The base template's root `vitest.config.ts` landed through plan 0072 Phase 1, so the PR's unit-runner half is already on `main`.
- ADR 0043 and the PR's plan and QA serials are taken.

The owner asked for a rebuild on a fresh branch from `main`, not a rebase.

## What stays from plan 0059

Playwright, Chromium only, `@playwright/test` pinned exact, in `packages/e2e` (`@repo/e2e`, alias `@e2e`). Specs declare their modules as tags, and `playwright.config.ts` turns absent ones into `grepInvert` before the run. The four flows `health`, `waitlist`, `admin-login` and `admin-unauthenticated`. `pnpm verify:e2e --driver=d1|postgres` and `scripts/e2e-tags.test.ts`. The PR's run-time lessons: the api readiness URL is `/health`, `astro dev` stays in the foreground with `ASTRO_DEV_BACKGROUND=1`, and a spec waits for `<astro-island ssr>` to clear before it types.

## What changes

| Topic | PR #164 | This build |
| --- | --- | --- |
| Env files | `prepare-db.ts` refused a missing `apps/api/.dev.vars`; `verify-e2e` copied `.dev.vars.example` | `prepare.ts` refuses when an installed app has no `.env` and names `pnpm env:setup`; `verify-e2e` copies `packages/env/.env.example` to `packages/env/.env` and runs `env:setup` |
| Admin account | `auth.setup.ts`, a setup project that signed a fixture user up over HTTP and needed the first-user promotion | `prepare.ts` runs `pnpm db:seed` after `db:setup`; the admin specs sign in as the seeded superadmin. No setup project, no saved storage state |
| Database guard | A prefix check on the name read back from `.dev.vars` | None of the suite's own. `db:seed` already refuses any database that is not `<prefix>` or `<prefix>_<branch>`, before it connects |
| Unit runner | Root `vitest`, a `vitest.config.ts` and an example test | Dropped; already on `main`. The template's `vitest.config.ts` only gains `!packages/e2e` |
| Postgres in CI | `DATABASE_URL` in the job environment | `E2E_DATABASE_SERVER`. `db:seed` reads a `DATABASE_URL` in the environment ahead of `apps/api/.env`, so a server URL there aimed the seed at the maintenance database |
| Playground | `play:init` | `play:reset`. `init --force` keeps the old `saasaloy.json`, so the other driver could not be added on a second run |
| Leftover database | Not handled | Before the postgres run, `verify-e2e` adopts any database a previous playground left on the server and drops it through `db:drop`, because a fresh `db:generate` names its migration differently |
| Decision record | ADR 0043, which also settled that `e2e` owns every spec | [ADR 0051](../adr/0051-adr-the-e2e-capability-gates-flows-on-installed-modules-2026-10-23.md). It leaves feature-module flow ownership open for issue #240 phase 1 |

## Phases

1. The module: descriptor, workspace files, the four specs, the `saasaloy-e2e` skill.
2. The base template: `!packages/e2e` in `vitest.config.ts`, the `packages/e2e/**` oxlint override, the Playwright output in `_gitignore`, a testing note in `AGENTS.md` and `README.md`.
3. The gates: `scripts/verify-e2e.ts` with its unit test, `scripts/e2e-tags.test.ts`, the `verify:e2e` script, `.github/workflows/e2e.yml`, and the tool repo's oxlint override for `modules/e2e/files/**`.
4. The docs: ADR 0051, the `Flow` and `Spec tag` glossary entries, `modules/README.md`, CONTRIBUTING, and a QA plan.

## Non-goals

- No journey spec for a feature module beyond the four base flows. Issue #240 phase 1 decides who owns those.
- No workflow in the base template. CI is opt-in for a generated project.
- Everything plan 0059 lists as a non-goal.
