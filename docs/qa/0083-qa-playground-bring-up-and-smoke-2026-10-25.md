# QA: one-command playground bring-up, seed and smoke scripts (#187)

Branch `issue-187-bring-up-a-seeded-smoke-checked-playground-with-one`. Every agent result below ran against commit `f12dfa6f` on devaloy (Docker daemon present, headless Chromium present), with no other process on ports 3000, 3001, 3002, 4000 or 5432.

## What changed

- `pnpm play:up [--preset minimal|full] [--db d1|postgres]` in `scripts/playground.ts`: a fresh `.dev/playground` from a preset, migrated, seeded, snapped, with every app's dev server running. `pnpm play:down` stops the servers.
- `scripts/play-presets.json`: the `minimal` and `full` presets, a module list and an `env` map each.
- `scripts/smoke.ts` (helper), `scripts/play-smoke.ts` (`pnpm play:smoke`), and `modules/<name>/smoke.ts` for auth, admin, multitenant, billing, feature-flags, payment and waitlist.
- `play:restore --db` reads `DATABASE_URL` from `apps/api/.env` before `.dev.vars`.

## Agent results

| ID | Check | Command | Result |
|----|-------|---------|--------|
| C1 | `play:up --preset full --db d1` ends with every app answering | `node scripts/playground.ts up --preset full --db d1` | ✅ exit 0. web :3000 200, admin :3001 200, app :3002 200, api :4000 404 on `/` (the api has no root route; `/health` is 200) |
| C2 | the same on Postgres, named volume only | `node scripts/playground.ts up --preset full --db postgres`, then `docker inspect` | ✅ exit 0, four apps answer. The container `playground-5b3d2948-postgres-1` mounts one volume, `playground-5b3d2948_postgres-data`, and no bind mount |
| C3 | `db:generate` and the migration need no manual step | the two runs above | ✅ both runs go from the command to running apps with no input |
| C4 | seeded users sign in with the known password | `node scripts/play-smoke.ts` (auth) | ✅ superadmin has role `superadmin`, member signs in, banned gets 403 `BANNED_USER`, a wrong password gets 401 |
| C5 | two organizations, console billing subscriptions, waitlist rows | the `db:seed` output in the `up` log | ✅ `organizations 2 rows`, `billing_subscriptions 8 rows`, `waitlist_entries 2 rows` on D1 and on Postgres |
| C6 | `play:up` and `play:restore --db` seed | `node scripts/playground.ts restore --db` | ✅ D1: restored in 11.0s with `users 4 rows`, `organizations 2 rows`. Postgres (at the pre-commit state of the same code): restored in 6.4s with `users 4 rows` |
| C7 | the admin and customer panels show content on first load | headless Chromium, sign in as superadmin on :3001 and member on :3002 | ✅ admin Overview shows API health "Healthy", Users 4, and the four seeded sign-ups. The customer Home shows "Welcome to Saasaloy, Grace Member" and the template placeholder |
| C8 | the helper signs in, keeps the cookie, prints one line per check | `node --test scripts/smoke.test.ts`, and the smoke runs | ✅ 3 unit tests pass. Each check prints one `PASS` or `FAIL` line |
| C9 | `play:smoke` runs every installed module's script and prints a total | `node scripts/play-smoke.ts` | ✅ runs 7 modules in install order and prints `[smoke] 37 passed, 0 failed, 7 module(s): …` |
| C10 | `play:smoke` passes on `full` on a clean seed | the same, after each `up` | ✅ 37 passed, 0 failed, on D1 and on Postgres |
| C11 | one presets file, a module list and an env map per preset | `node --test scripts/playground.test.ts` | ✅ the file holds `minimal` and `full`; every module exists, no two conflict, no preset names a driver. `up --preset minimal` ends with web answering in 24.1s |
| C12 | `BETTER_AUTH_SECRET` stays unset | `grep -c BETTER_AUTH_SECRET .dev/playground/packages/env/.env` | ✅ 0. `readPresets` refuses a preset that sets it |

Gates at `f12dfa6f`: `pnpm lint` exit 0, `pnpm typecheck:scripts` exit 0, `node --test "scripts/**/*.test.ts"` 477 pass, `pnpm test:modules` 997 pass, `pnpm --filter saasaloy test` 1817 pass.

## Manual cases

1. Free ports 3000, 3001, 3002 and 4000. Run `pnpm play:up`. Expect four `answers on` lines and the sign-in hint.
2. Open http://localhost:3001 and sign in as `admin@example.test` with `saasaloy-dev-password`. Expect the Overview with the seeded users. Open Billing, Flags and Payments. Expect seeded rows on each page.
3. Open http://localhost:3002 and sign in as `member@example.test`. Expect the Home page with your name.
4. Start any server on port 3001 from another folder, then run `pnpm play:up`. Expect a refusal that names the pid and its folder, and expect that process to keep running.
5. Run `pnpm play:smoke`. Expect `0 failed`. Run it again on the same database. Expect `0 failed` again.
6. Run `pnpm play:down`. Expect the four ports to be free.
7. Run `pnpm play:up --db postgres`, then `pnpm play:down`. Remove the container with the `docker compose --project-name playground-<hash> down --volumes` command that CONTRIBUTING.md gives.

## Notes

- The multitenant smoke script does not check that a superadmin crosses tenants with `x-organization-id`. On the seeded data the superadmin's client session gets 403 from `/tenant` with the header, because `mayCrossOrganizations` wants an admin-audience session, and its admin session gets 401 on `/tenant`. That path needs its own look.
- A volume `playground_postgres-data`, made on 2026-10-23 by an earlier playground, still sits on this box. `play:up` no longer uses it.
