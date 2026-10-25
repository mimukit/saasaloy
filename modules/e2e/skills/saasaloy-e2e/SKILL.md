---
name: saasaloy-e2e
description: Write and run the project's Playwright end-to-end flows in packages/e2e (@repo/e2e). Use when adding a browser flow, gating a spec on an installed module, debugging a red e2e run, signing a spec in as the seeded admin, or installing the browser.
---

# saasaloy-e2e

`packages/e2e` holds the project's browser suite. It starts the apps, drives them with headless Chromium, and stops every process it started. It is the only workspace in the repo that Playwright reads, and `pnpm test` (Vitest) never collects a file from it: the root `vitest.config.ts` leaves `packages/e2e` out.

## The two commands

```sh
pnpm e2e:install    # download Chromium, once per machine
pnpm e2e            # migrate and seed the database, start the apps, run the flows
```

`pnpm e2e:install` is not a `postinstall`. Downloading ~150MB on every `pnpm install` in every checkout is a cost a project should opt into, so the browser is missing until you ask for it, and `pnpm e2e` fails with that exact command in the message when it is.

`pnpm e2e:ui` opens Playwright's watch UI. It needs a desktop, so it is useless on a headless box; `pnpm e2e` is the headless path and needs nothing.

Before the first run, every app needs its `.env`. Run `saasaloy env` (or copy `packages/env/.env.example` to `packages/env/.env`; the local defaults are enough), then `pnpm env:setup`. `pnpm e2e` names the missing file and that command when one is absent.

## What one run does, in order

1. `prepare.ts` checks Chromium is downloaded and every app it will start has its `.env`.
2. When `database` is installed, `prepare.ts` runs `pnpm db:setup`, then `pnpm db:seed`.
3. Playwright starts one dev server per installed app and waits for each to answer.
4. The specs run, one at a time.
5. `global-teardown.ts` runs `pnpm db:drop`, **on CI only**.

Steps 1 and 2 are a script rather than a `globalSetup` hook because of step 3. The api Worker reads `apps/api/.env` when it boots, so a `DATABASE_URL` written after the server started is a value it never sees.

## Ports

| App | Port | Started when |
| --- | --- | --- |
| `apps/api` | 4000 | `api` is installed |
| `apps/web` | 3000 | always, it is the base app |
| `apps/admin` | 3001 | `admin` is installed |

These are the project's pinned dev ports, the same ones in `AGENTS.md`. Off CI, `reuseExistingServer` is on, so a `pnpm dev` you already have running is used instead of a second one on a busy port. On CI it is off, because reusing would hide a start-up failure.

Playwright waits on `http://localhost:4000/health` for the api, not on its origin. The Worker answers `GET /` with a 404 envelope, and Playwright reads any status at or above 400 as "not ready".

## Adding a flow

1. Write `specs/<name>.spec.ts`.
2. Wrap it in a `test.describe` that declares the modules it needs as tags.
3. Add any new tag to `SPEC_TAGS` in `lib/project.ts`.

```ts
import { expect, test } from "@playwright/test";

import { URLS } from "../lib/project.ts";

test.describe("api health", { tag: ["@api"] }, () => {
  test("the api answers", async ({ request }) => {
    const response = await request.get(`${URLS.api}/health`);
    expect(response.status()).toBe(200);
  });
});
```

Four rules, each one load-bearing:

- **A tag is a module name, and nothing else.** `playwright.config.ts` turns every tag in `SPEC_TAGS` whose module is absent into `grepInvert`, so the spec is never collected. A tag that names no module is never in `installed`, so its spec would never run anywhere and the suite would still report green.
- **Never skip on a missing route.** A `test.skip()` when a page 404s turns a broken route into a green run, which is the exact failure this suite exists to catch. Gate on the tag, which is decided before anything runs.
- **Wait for the island before you type.** A form on `apps/web` is a React island on a static Astro page. A value typed before hydration is thrown away when React mounts the controlled input, and the form then submits an empty value. Astro marks an island `<astro-island ssr>` until it hydrates, so wait for the island that holds your field to lose it: `await expect(page.locator("astro-island[ssr]").filter({ has: field })).toHaveCount(0)`. `waitlist.spec.ts` is the worked example.
- **Imports carry the `.ts` extension.** `prepare.ts` runs under `node`, whose type stripping resolves the real file, so the whole workspace keeps one import style.

## The seeded admin and the rows a spec writes

The admin specs sign in as `superadmin@example.test` with the password `saasaloy-dev-password`, `SEED_ADMIN` in `lib/project.ts`. The suite creates no account of its own. The `auth` module's seed slices write that user, and `pnpm db:seed` upserts it back to its slice values before every run, so a password changed by hand is reset and the account is always a superadmin. Change `SEED_ADMIN` only together with `packages/db/src/seed/slices/users.ts` and `accounts.ts`.

A spec that needs a signed-in admin but is not about the login screen signs in at the start of the test through the same form `admin-login.spec.ts` drives. `admin-login.spec.ts` itself starts from no cookie on purpose: a login flow that starts from a saved session tests the session.

Every **other** row a spec writes is unique, with `uniqueEmail()` from `lib/fixtures.ts`. There is no cleanup step, on purpose: a teardown that deletes rows does not run when a run crashes, so the next run starts poisoned and the failure looks like a real bug a day later. A unique row cannot collide with anything.

## The flows that ship

| Spec | Tags | What it proves |
| --- | --- | --- |
| `health.spec.ts` | `@api` | The Worker started and `GET /health` answers the documented body. The floor. |
| `waitlist.spec.ts` | `@waitlist` | A real browser fills the real form on `apps/web`, the island posts, and the route answers 201. |
| `admin-login.spec.ts` | `@admin` `@auth` | The login form signs the seeded admin in, the guard redirects, and `GET /admin/users` answers 200. |
| `admin-unauthenticated.spec.ts` | `@admin` `@auth` | The same guarded route answers 401 with the api's error envelope when nobody is signed in. |

`admin-unauthenticated.spec.ts` is its own flow rather than a second assertion, because the admin SPA's guard runs in the browser and would hide a server that stopped checking.

**`waitlist.spec.ts` needs the form on a page.** `saasaloy add waitlist` writes the block and the island and then stops; the `saasaloy-waitlist` skill's Wire-up section has the two lines that place it. The spec says so in its failure message rather than skipping.

## When a run is red

- The failing step is on **stdout**. The `list` reporter runs first for exactly that reason, so a headless box needs nothing else.
- `playwright-report/` holds the HTML report. Open it with `pnpm --filter @repo/e2e exec playwright show-report`.
- `test-results/` holds a screenshot of every failure, a video of it, and a trace of the first retry. Open a trace with `pnpm --filter @repo/e2e exec playwright show-trace <path>`.
- Both directories are gitignored, and `pnpm --filter @repo/e2e clean` removes them.

Three failures have a fix rather than a bug behind them:

- *"Chromium is not installed"*: run `pnpm e2e:install`. On a bare CI image the system libraries are missing too: `pnpm --filter @repo/e2e exec playwright install --with-deps chromium`, which needs root and is never run for a developer.
- *"apps/api/.env does not exist"*: run `pnpm env:setup`.
- *"pnpm db:seed failed"* with a refusal about the database: the seed writes only to this project's own development database. Run `pnpm db:setup` and read what it prints.

## The database

The suite uses the project's own `db:setup`, `db:seed` and `db:drop`, so it works the same under `database-d1` and `database-postgres` and carries no second code path. Both setup and seed carry the guard: `db:setup` refuses a `DATABASE_URL` its state block does not vouch for, and `db:seed` refuses `NODE_ENV=production` and any database that is not this project's own, before it connects.

The database is dropped **on CI only**. Locally it is kept, because a drop means a full migration on the next run for no safety gained. Run `pnpm db:drop` yourself for a clean slate.

`E2E_DB_SETUP_ARGS` passes extra flags to `db:setup`. It exists for a CI runner with a Postgres service container, which sets it to `--server` so `db:setup` creates the project's database on the server `DATABASE_URL` in `apps/api/.env` names. A developer leaves it unset.

## CI

This module adds no workflow. A project that wants the suite on CI writes its own job: install, `pnpm env:setup`, `pnpm --filter @repo/e2e exec playwright install --with-deps chromium`, then `pnpm e2e` with `CI=true`.

## What this suite is not

No visual regression, no accessibility assertions, no performance budget, no load or contract testing. One browser engine, Chromium. Nothing runs against a deployed preview or production: every flow drives a dev server on localhost with a development database.

## Next

Run `saasaloy-testing` to decide which other tests a change needs.
