# Plan: a faster dev and test feedback loop for modules and UI

Grilled: 2026-09-29

## Context

Testing a module change today means building the CLI, running `pnpm play:init` into `.dev/playground`, running `saasaloy add` for each module through the shim (`scripts/saasaloy-shim.sh`), installing, migrating, signing up a user, and then clicking through the landing page, the customer panel and the admin panel. Any edit under `modules/*/files/` needs another `add` or a reset before it shows up. The loop takes minutes per change, and it grows with every module in the registry (39 today).

What exists already:

- `pnpm play:init`, `play:reset` and `play:destroy` scaffold and remove the playground.
- `pnpm play:watch` (`scripts/watch-template.ts`) re-runs `init --force` when `packages/cli/templates/base` changes. It does not watch `modules/`.
- `pnpm deps:verify` runs a full install, build, lint and typecheck on the playground.
- `packages/cli/test/e2e` and `packages/cli/test/matrix` test the CLI's apply logic against fixture registries.
- `pnpm test:modules` runs unit tests that live beside module files.
- `scripts/qa-tenant-scoping.sh` is one runnable HTTP QA script with PASS and FAIL lines. Most QA in `docs/qa/` (50+ files) is still manual.

Success means an edit to a module file shows in a running, populated app within a few seconds, a full reset to a clean app with every module installed takes one command, and the common QA checks run as scripts.

## Issues

| Issue | Phases | Waits on |
|-------|--------|----------|
| #178 | 0, 1, 2: measure, live sync, git baseline reset | nothing |
| #187 | 3, 4, 6: one-command bring-up, seed data, smoke scripts | #153 (env capability, PR #160) and #186 |
| #186 | the web dev-start fix | nothing |
| #184 | 5: generated `examples/full` with a CI check | #187, for the preset data file |
| #185 | 7: UI gallery route | nothing |

Phase 8 (scoped checks) is dropped. See the decisions below.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Hand-maintained example app or generated one | Generated. A hand-maintained copy duplicates every module file and drifts from `modules/`. It also stops testing the CLI, which is half of what the repo ships. |
| Does the example app fix the edit loop | No. It is a showcase and a review aid. The edit loop comes from live file sync into the playground (Phase 1). |
| Where fast iteration happens | In `.dev/playground`, as today. The repo convention says CLI runs go in `.dev`. |
| Which providers and drivers the full preset uses | The local ones: `-console` and `-memory` providers, so the stack needs no vendor account and no network. |
| How live sync writes a module edit | The watcher re-runs `saasaloy add <module> --force --yes` for the module whose file changed. It takes 0.6s to 0.7s (Phase 0), and it reuses the CLI's manifest update, drift guard and patch engine. No per-file copier, and no second write path. |
| A synced file that has local edits in the playground | `add --force` holds it back as drift and never overwrites it (`applier.ts`). The watcher prints each held-back file. |
| A `registry-item.json` edit | The watcher re-runs `add --force` for that module and prints a warning that a removed patch is not reversed. `play:restore` clears it. |
| `play:pull` | Dropped. With live sync the edit happens in `modules/`, so nothing goes back. `saasaloy doctor` reports a stray playground edit as drift. |
| Sign-in with no form | No dev sign-in route. The seed signs up users through `POST /auth/sign-up/email` with a known password. Nothing new ships, so nothing needs a guard. |
| Env values for the playground | The env capability (#153, PR #160) owns them. It puts `@repo/env` in the base template and removes `.dev.vars`. `play:up` writes the preset's provider values and loopback URLs into `packages/env/.env`, then runs `pnpm env:setup` to write each app's `.env`. |
| `BETTER_AUTH_SECRET` in the playground | Left unset. Better Auth uses its development key, which the api allows only on a loopback `BETTER_AUTH_URL`. A generated secret would drop every session after each reset. |
| Database on `play:restore` | Files only by default, under 1s. `play:restore --db` stops the api, wipes the database, migrates, seeds and starts the api again, with the stop-and-wipe steps of `scripts/qa-tenant-scoping-serve.sh`. Deleting D1 state under a running workerd breaks every query. |
| Install on `play:restore` | `play:restore` runs `pnpm install` at the end. It takes 0.1s when nothing changed and covers a baseline with different packages. |
| Drivers for `play:up` | D1 and Postgres. Postgres runs in a Compose container that `play:up` starts, with a named volume and no host path. |
| Presets | `minimal` (base only) and `full` (every module with a local provider). `full` installs in about 17s, so a `saas` preset saves too little to keep a third list current. |
| Seed data location | `modules/<name>/seed.ts`, beside the descriptor and never copied into a project. A seed uses the HTTP API only, so the same code works on D1 and Postgres. Seeds run in dependency order. |
| Smoke script form | Node `.ts` at `modules/<name>/smoke.ts`, never copied into a project. A shared helper handles the sign-in cookie and prints one PASS or FAIL line per check. |
| Scoped checks (old Phase 8) | Dropped. `pnpm test:modules` takes 4.6s for every module, and turbo already caches `typecheck` and `test`. |
| The web dev-start bug | A separate `high` issue (#186). It bumps dependencies through `pnpm deps:update`, fixes the duplicate React fault, and adds an `astro dev` start check to `release-smoke` so the next plugin release that breaks it fails CI. |
| Phase 3 prerequisites | Phases 3, 4 and 6 move to #187, blocked by #153 and #186. #178 keeps Phases 0 to 2, which need neither, so an unattended run never stops halfway through an issue. |

## Approach

Keep the playground as the place to iterate, and make it cheap to create, reset and update. Add a generated, committed `examples/full` as the showcase and as a golden output that CI checks (#184). Reuse `scripts/watch-template.ts`, the shim, the CLI's own `init` and `add`, `.saasaloy/manifest.json` and the `qa-tenant-scoping` scripts rather than building parallel machinery.

Rejected alternatives, one line each:

- Hand-written `examples/` app: drifts, and it does not exercise the CLI.
- Storybook for module UI: a heavy dependency set for a need a dev-only route covers.
- Browser end-to-end tests as the main check: the dev box has no browser, and HTTP smoke scripts cover the API side at lower cost.
- A per-file sync copier: a second write path beside `add`, for a speed gain Phase 0 showed is not needed.
- A dev-only sign-in route: needs a production guard, and sign-up is already one HTTP call.

### Phase 0: measure the current loop (#178)

- Time one full cycle on the playground: `play:init`, `add` for every module, `pnpm install`, migrations, first sign-in.
- Record the time per step in this plan. The numbers confirm or change the phase order below.

#### Phase 0 results (2026-09-29)

Measured on devaloy (6 cores, 11 GB RAM, warm pnpm store) at `4451001`, with the 30 modules that have a local provider (`database-d1`, every `-console` and `-memory` provider, no vendor provider). Each step ran once.

| Step | Time | Note |
|------|------|------|
| `play:destroy` | 0.7s | |
| CLI build | 0.6s | |
| `init --no-install` | 0.5s | |
| `pnpm install`, base only | 2.1s | |
| `add` per module | 0.4s to 0.8s | 30 adds, 16.6s in total. `add database` alone fails by design: a driver comes first. |
| `pnpm install`, all modules | 5.5s | 0.1s when nothing changed |
| `db:generate` | 1.5s | Not in any `play:` script. `db:migrate:local` fails with "No migrations present" without it. |
| `db:migrate:local` (D1) | 3.8s | |
| `add admin --force` | 0.6s | |
| `add billing --force` | 0.7s | |
| api dev server, first response | 12.0s | Fails at start until `apps/api/.dev.vars` holds `BETTER_AUTH_SECRET`. The provider vars, `CORS_ORIGINS` and `PUBLIC_API_URL` also need values. |
| admin dev server, first response | 1.7s | |
| web dev server, first response | fails | See the web finding below. |
| Sign-up over HTTP | 0.3s | `POST /auth/sign-up/email` returns 200. The first user gets the `superadmin` role. |
| `git init` and baseline commit | 0.6s | 308 files, 3 MB `.git`, no `node_modules` tracked |
| `git reset --hard && git clean -fd` | under 0.1s | |
| `pnpm test:modules` | 4.6s | every module's unit tests |

What the numbers say:

- The scripted CLI work takes about 30s in total. Machine time is not the cost. The cost is the manual steps between the scripted ones: write `.dev.vars` by hand, run `db:generate`, start three servers, sign up.
- `add <module> --force` takes 0.6s to 0.7s. A watcher that re-runs it per changed module is fast enough for Phase 1, so a per-file copier is not needed for speed.
- Dev server cold start is the largest machine cost: 12.0s for the api, and 36.6s for the web app after the fix below. Phase 2 must keep servers running across a restore, not restart them.
- A git baseline and restore cost under 1s, so Phase 2 is cheap.
- Sign-up is one HTTP call, so the Phase 4 seed can use the real auth endpoints with no dev sign-in route.

Web finding (#186): `astro dev` exits before it is ready on a base-only project too. `@astrojs/cloudflare` 14.3.0 resolves `@cloudflare/vite-plugin` 1.61.0, which requires `wrangler` `^4.142.0`, and the web template pins `wrangler` 4.129.0. The error shows only in `apps/web/.astro/dev.log`, because Astro 7 starts the dev server as a background process. With `wrangler` 4.142.0 the server starts in 36.6s, and then the first render logs `Cannot read properties of null (reading 'useContext')` from `lucide-react` inside workerd, which points to two React copies. HMR was not measured: the dev box has no browser.

### Phase 1: live module file sync (#178)

- Extend `scripts/watch-template.ts` to watch `modules/*/files/**` and `modules/*/registry-item.json` as well as the base template.
- On a change, find the module from the path, and skip it when `saasaloy.json` in the playground does not list it as installed.
- Debounce per module, then run `add <module> --force --yes` through the shim. One run at a time, with a queue, as the template watcher does today.
- Print each file that `add` held back as drift, with its path.
- On a `registry-item.json` change, also print that a removed patch is not reversed and that `play:restore` clears it.
- Verify: edit a component under `modules/admin/files/src/`, and see the running admin app update with no manual re-add. Run `saasaloy doctor` in the playground and see no drift for that file.

### Phase 2: git baseline reset (#178)

- After `play:init` and install, run `git init` in the playground and commit a baseline.
- Add `pnpm play:snap` to commit the current state as the new baseline.
- Add `pnpm play:restore`. It runs `git reset --hard && git clean -fd` against the baseline, then `pnpm install`. Ignored files stay, so `node_modules`, the env files and the D1 state survive.
- Add `play:restore --db`. It also stops the api, wipes the database, migrates, seeds when seeds exist, and starts the api again.
- Use `git diff` in the playground to review exactly what an `add` wrote.
- Verify: `play:restore` after a full `add` returns to the baseline in seconds with no full install.

### Phase 3: one-command bring-up with presets (#187)

- Add `pnpm play:up --preset minimal|full [--db d1|postgres]`.
- The script builds the CLI, runs `init`, runs `add` for the preset's module list, installs, writes `packages/env/.env` from the preset, runs `pnpm env:setup`, runs `db:generate` and the migration, seeds (Phase 4), snapshots (Phase 2) and starts the web, api and admin dev servers.
- `--db postgres` starts a Postgres container through Compose, with a named volume only.
- Keep the presets in one data file. Each entry has a module list and an `env` map. `examples/full` (#184) and CI read the same file.
- Verify: `pnpm play:up --preset full --db d1` ends with the web, api and admin apps answering on their ports. The same with `--db postgres`.

### Phase 4: seed data (#187)

- A module can ship `modules/<name>/seed.ts`. It uses the HTTP API only and is never copied into a project.
- The auth seed signs up `admin@example.test` first, so it gets `superadmin`, then `customer@example.test`, both with a known password.
- Other seeds add two organizations, a subscription on the console billing provider, and waitlist rows.
- `play:up` and `play:restore --db` run the seeds of the installed modules in dependency order.
- Verify: sign in as each seeded user, and see content in the admin panel and the customer panel on first load.

### Phase 5: generated `examples/full` with a CI check (#184)

- Add `pnpm example:build`. It runs the `full` preset into `examples/full` without starting dev.
- Commit the output.
- Add a CI job that runs `example:build` and fails when the result differs from the committed copy.
- Exclude `examples/` from the root pnpm workspace globs, `pnpm lint`, `prettier --check .` and Stylelint, and give it its own ignore rules where needed.
- Verify: a PR that changes a module file shows the matching change under `examples/full`.

### Phase 6: module smoke scripts (#187)

- A module can ship `modules/<name>/smoke.ts`. It is never copied into a project.
- A shared helper signs in as a seeded user, keeps the cookie, and prints one PASS or FAIL line per check.
- Add `pnpm play:smoke`. It runs the smoke script of every installed module and prints a total.
- Convert the manual checks from the most recent `docs/qa/` files first, and `scripts/qa-tenant-scoping.sh`.
- Verify: `play:smoke` on the `full` preset passes on a clean seed.

### Phase 7: UI gallery route (#185)

- Add a dev-only `/_dev` route to `apps/web` and `apps/admin` that renders each module's components with fixture data.
- Exclude the route from production builds.
- Verify: every installed module's UI blocks render on the gallery page with no backend call.

### Phase 8: scoped checks (dropped)

Dropped at the grill on 2026-09-29. `pnpm test:modules` takes 4.6s, and turbo already caches `typecheck` and `test`, so scoping saves little.

## Open questions

These belong to #184 and #185 and are asked in their own grill sessions:

- Should `examples/full` include `pnpm-lock.yaml`, and how large is the committed diff per module change? (#184)
- One example (`full`) or one per driver? The D1 and Postgres drivers conflict. (#184)
- Does the CI golden check run on every PR or only when `modules/` or `packages/cli/templates/` change? (#184)
- Does the gallery route ship to generated projects as a feature, or stay in the playground only? (#185)
- Where does a module's fixture data live, and does it share a source with `seed.ts`? (#185)

## Non-goals

- Browser-driven end-to-end tests. The dev box has no browser.
- Changes to how `saasaloy add` applies modules for end users. The sync is a dev tool for this repo only.
- A hosted demo deployment of `examples/full`.
- Replacing the CLI's existing e2e and matrix tests.
