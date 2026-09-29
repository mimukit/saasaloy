---
name: saasaloy-e2e
description: Write and run the project's Playwright end-to-end flows in packages/e2e (@repo/e2e). Use when adding a browser flow, gating a spec on an installed module, debugging a red e2e run, installing the browser, or wiring the suite into CI.
---

# saasaloy-e2e

`packages/e2e` holds the project's browser suite. It starts the apps, drives them with headless Chromium, and stops every process it started. It is the only workspace in the repo that Playwright reads, and `pnpm test` (vitest) never collects a file from it.

## The two commands

```sh
pnpm e2e:install    # download Chromium, once per machine
pnpm e2e            # set up the database, start the apps, run the flows
```

`pnpm e2e:install` is not a `postinstall`. Downloading ~150MB on every `pnpm install` in every checkout is a cost a project should opt into, so the browser is missing until you ask for it, and `pnpm e2e` fails with that exact command in the message when it is.

`pnpm e2e:ui` opens Playwright's watch UI. It needs a desktop, so it is useless on a headless box; `pnpm e2e` is the headless path and needs nothing.

## What one run does, in order

1. `prepare-db.ts` checks Chromium is downloaded, runs `pnpm db:setup`, and checks the database it resolved is one this project manages.
2. Playwright starts one dev server per installed app and waits for each to answer.
3. The `setup` project seeds the fixture admin account over HTTP and saves its signed-in state.
4. The specs run, one at a time.
5. `global-teardown.ts` runs `pnpm db:drop` — **on CI only**.

Step 1 is a script rather than a `globalSetup` hook because of step 2. The api Worker reads `apps/api/.dev.vars` when it boots, so a `DATABASE_URL` written after the server started is a value it never sees. Step 3 is a Playwright *project* for the mirror-image reason: seeding talks to the api over HTTP, so it has to run after the server is up.

## Ports

| App | Port | Started when |
| --- | --- | --- |
| `apps/api` | 4000 | `api` is installed |
| `apps/web` | 3000 | always — it is the base app |
| `apps/admin` | 3001 | `admin` is installed |

These are the project's pinned dev ports, the same ones in `AGENTS.md`. Off CI, `reuseExistingServer` is on, so a `pnpm dev` you already have running is used instead of a second one on a busy port. On CI it is off, because reusing would hide a start-up failure.

## Adding a flow

1. Write `specs/<name>.spec.ts`.
2. Wrap it in a `test.describe` that declares the modules it needs as tags.
3. Add any new tag to `SPEC_TAGS` in `lib/project.ts`.

```ts
import { expect, test } from "@playwright/test";

import { URLS } from "../lib/project.ts";

test.describe("billing checkout", { tag: ["@billing", "@auth"] }, () => {
  test("a subscriber reaches the portal", async ({ page }) => {
    await page.goto(`${URLS.web}/pricing`);
    await expect(page.getByRole("heading", { name: "Pricing" })).toBeVisible();
  });
});
```

Three rules, each one load-bearing:

- **A tag is a module name, and nothing else.** `playwright.config.ts` turns every tag in `SPEC_TAGS` whose module is absent into `grepInvert`, so the spec is never collected. The registry's own `scripts/e2e-tags.test.ts` asserts every name in `SPEC_TAGS` is a real directory under `modules/`, so renaming a module fails that test instead of silently disabling a flow.
- **Never skip on a missing route.** A `test.skip()` when a page 404s turns a broken route into a green run, which is the exact failure this suite exists to catch. Gate on the tag, which is decided before anything runs.
- **Imports carry the `.ts` extension.** `prepare-db.ts` runs under `node`, whose type stripping resolves the real file, so the whole workspace keeps one import style.

## The fixture account and the rows a spec writes

`auth.setup.ts` creates one **fixed** account, `TEST_USER` in `lib/project.ts`. It is fixed because the api grants `superadmin` to the first account on an empty `users` table, and a fresh address every run would move that grant to a different row each time. A second run finds the account already there and signs in instead.

Every **other** row a spec writes is unique — `uniqueEmail()` in `lib/fixtures.ts`. There is no cleanup step, on purpose: a teardown that deletes rows does not run when a run crashes, so the next run starts poisoned and the failure looks like a real bug a day later. A unique row cannot collide with anything.

`auth.setup.ts` saves the signed-in browser state to `.auth/admin.json`, and no spec gets it by default. Opt in when a flow needs an already-signed-in admin:

```ts
import { STORAGE_STATE } from "../playwright.config.ts";

test.use({ storageState: STORAGE_STATE });
```

`admin-login.spec.ts` deliberately does not. A login flow that starts from a cookie tests the cookie.

## The flows that ship

| Spec | Tags | What it proves |
| --- | --- | --- |
| `health.spec.ts` | `@api` | The Worker started and `GET /health` answers the documented body. The floor. |
| `waitlist.spec.ts` | `@waitlist` | A real browser fills the real form on `apps/web`, the island posts, and the route answers 201. |
| `admin-login.spec.ts` | `@admin` `@auth` | The login form signs an admin in, the guard redirects, and `GET /admin/users` answers 200. |
| `admin-unauthenticated.spec.ts` | `@admin` `@auth` | The same guarded route answers 401 with the api's error envelope when nobody is signed in. |

`admin-unauthenticated.spec.ts` is its own flow rather than a second assertion, because the admin SPA's guard runs in the browser and would hide a server that stopped checking.

**`waitlist.spec.ts` needs the block to be on a page.** `saasaloy add waitlist` writes the block and the island and then stops; the `saasaloy-waitlist` skill's Wire-up section has the two lines that place it. The spec says so in its failure message rather than skipping.

## When a run is red

- The failing step is on **stdout** — the `list` reporter runs first for exactly that reason, so a headless box needs nothing else.
- `playwright-report/` holds the HTML report. Open it with `pnpm --filter @repo/e2e exec playwright show-report`.
- `test-results/` holds a screenshot of every failure, a video of it, and a trace of the first retry. Open a trace with `pnpm --filter @repo/e2e exec playwright show-trace <path>`.
- Both directories are gitignored, and `pnpm --filter @repo/e2e clean` removes them.

Two failures have a fix rather than a bug behind them:

- *"Chromium is not installed"* — run `pnpm e2e:install`. On a bare CI image the system libraries are missing too: `pnpm --filter @repo/e2e exec playwright install --with-deps chromium`, which needs root and is never run for a developer.
- *"has the role …"* from the setup project — the database already held an account before the fixture signed up, so the fixture is not an admin. Run `pnpm db:drop`, then `pnpm e2e`.

## The database

The suite uses the project's own `db:setup` and `db:drop`, so it works the same under `database-d1` and `database-postgres` and carries no second code path. `db:setup` already refuses a `DATABASE_URL` its state block does not vouch for; `prepare-db.ts` adds a check that the resolved name starts with this project's prefix, so a future change to that script cannot quietly hand the suite a production URL.

The database is dropped **on CI only**. Locally it is kept, because a drop means a full migration on the next run for no safety gained. Run `pnpm db:drop` yourself for a clean slate.

## What this suite is not

No visual regression, no accessibility assertions, no performance budget, no load or contract testing. One browser engine, Chromium. Nothing runs against a deployed preview or production — every flow drives a dev server on localhost with a development database.
