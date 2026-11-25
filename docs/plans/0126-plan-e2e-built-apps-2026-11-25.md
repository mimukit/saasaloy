# Plan: serve built apps in the e2e run

Grilled: 2026-11-25

Issue: #399

## Context

The `e2e` module starts every app with its dev server (`pnpm --filter @repo/<app> dev`) in `webServer`. A dev server compiles on request and keeps Vite's module graph in memory. On a CI runner with a memory limit, the suite becomes slow and flaky: pages stay on "Loading" and clicks time out.

The issue's primeshopr measurements (4 CPU threads, 1 worker, 32 specs) give the baseline. Dev servers: 5.9 min, 5.6 GB peak RSS. Built apps (`build` + `preview`): 4.0 min, 3.5 GB peak RSS, with the build at about 15 s. A 5 GB self-hosted runner failed 5 specs in 13.9 min with dev servers.

Goal: the e2e suite runs reliably on a memory-limited CI runner and tests the build output that ships.

Target: in a `.dev` project with every module the spec tags name, `E2E_SERVE=built pnpm e2e` passes every spec, and its peak RSS is lower than the same run with `E2E_SERVE=dev`. The primeshopr 5 GB runner result is measured after release.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Mode switch | `E2E_SERVE` takes `dev` or `built`. Unset means `built` when `!!process.env.CI` and `dev` otherwise, the same CI test the config uses for `forbidOnly` and `retries`. Any other value throws when the config loads, naming the two values. Local runs keep the fast loop; CI gets the memory win with no extra setting. |
| `pnpm e2e:ui` | Same rule as `pnpm e2e`. It runs locally, so it gets dev servers unless `E2E_SERVE=built` is set. |
| Mode parser | A pure function `serveMode(env)` in `modules/e2e/files/lib/project.ts`, beside `portsFrom`, so a test can call it without Playwright. |
| Built command | `pnpm turbo run build --filter=@repo/<app> --ui=stream && pnpm --filter @repo/<app> preview`. The build goes through turbo, so CI reuses its earlier `pnpm build` step and an unchanged local rerun skips the build. The preview uses the app's own `preview` script, so the e2e config names no tool and no port. |
| Turbo build hash | The base template's `turbo.json` `build` task gets `inputs: ["$TURBO_DEFAULT$", ".env", ".env.local"]` and `env: ["PUBLIC_*"]`. Checked on 2026-11-25 in `.dev/playground` (turbo 2.11.6): a new key in `apps/admin/.env` and a `PUBLIC_API_URL` process variable left the `@repo/admin#build` hash at `a83bca67753a1b26`, so a cached `dist` could carry another checkout's origins. A file added to `packages/ui` did change the hash, so a workspace package without a `build` script is hashed through its `<NONEXISTENT>` task. Deploy is not affected: `env-deploy` runs `pnpm run build` directly (`packages/env/src/deploy.ts:323`). |
| Preview ports | Each Vite app (`api`, `admin`, `app`) gets `preview: { port: <the same devPort(...) value>, strictPort: true }` in its `vite.config.ts`. `web` needs no change, because Astro's `server.port` also applies to `astro preview`. A human `pnpm preview` in a worktree then uses the worktree's port too. |
| api preview CORS | The api's `preview` block also sets `cors: false`, for the same reason its `server` block does: Vite's CORS middleware answers preflights itself and hides the Worker's `hono/cors`. |
| api env in preview | No change. `@cloudflare/vite-plugin` 1.62.3 writes the local dev vars from `apps/api/.env` to `dist/<worker>/.dev.vars` at build time and `vite preview` reads them, so `DATABASE_URL` and the auth values reach the Worker. `wrangler deploy` ignores that file. |
| Dev-only plugins | No change. `devGzip` and `restartOnLockfile` are `apply: "serve"` plugins built on `configureServer`, which `vite preview` never calls. |
| Production build behavior | No spec depends on a production-only branch. The only `NODE_ENV` branch in shipped app code is the command palette's conflict handling (`modules/command/files/ui/containers/command/command-root.tsx:66`), which warns instead of throwing. |
| Astro detach | The `webServer` env adds `ASTRO_PREVIEW_BACKGROUND: "1"` beside `ASTRO_DEV_BACKGROUND`. Astro 7.3.5 detaches `astro preview` in an agent environment otherwise (`astro/dist/cli/preview/index.js:45`). |
| Start-up timeout | 300 s in built mode, 120 s in dev mode, because the build runs before the server answers. |
| Server reuse | Built mode never reuses a running server. A reused server is most likely a `pnpm dev`, and a built run that attached to it would test dev output and report a pass. A running `pnpm dev` on the same port makes Playwright fail with its "already used" error; the skill tells the developer to stop it. |
| api log | The built api command goes through `lib/tee-log.ts` exactly like the dev command, so `API_LOG` keeps the console SMS codes. |
| Process ownership | No `exec` in the command. Playwright kills the whole process group it started, which already covers the `pnpm` and `sh` wrappers of the dev command today. Phase 3 verifies it. |
| Non-loopback host | Phase 5 runs one built admin login with `.devports.json` naming a non-loopback host. A production build can make Better Auth set `Secure` cookies, which Chromium accepts on `http://localhost` only. If the login fails, the skill says built mode needs a loopback host. |
| Mode test | A vitest test in `scripts/` beside `scripts/e2e-tags.test.ts`, which imports `serveMode` and checks unset off CI, unset on CI, each explicit value, and an unknown value. |
| Update notes | One note each in `packages/cli/update-notes/` (turbo), `modules/api/update-notes/`, `modules/admin/update-notes/`, `modules/app/update-notes/` and `modules/e2e/update-notes/`, each with the next serial in its folder. |
| Variable name | `E2E_SERVE`, the name in the issue and in primeshopr's experiment. |

## Approach

The experiment's diff in the issue is the reference. The plan keeps its shape but moves the preview port into each app's Vite config, so the e2e module never learns a tool name or a port, and it builds through turbo after the turbo hash covers the env files. It reuses `devPort` from `@repo/env/dev-port`, the existing `tee-log.ts` wrapper, `PORTS` and `READY` from `lib/project.ts`, and the `scripts/e2e-tags.test.ts` pattern for the new test.

Rejected: an `--port PORTS[app]` flag from the e2e config, which puts a tool-specific flag in the e2e config and leaves a human `pnpm preview` on port 4173. Rejected: a direct `pnpm --filter <app> build` in every run, which is always fresh but rebuilds on CI after `pnpm build` already did, once the turbo hash is complete.

### Phase 1: hash the env files in the turbo build

- In `packages/cli/templates/base/turbo.json`, add `inputs: ["$TURBO_DEFAULT$", ".env", ".env.local"]` and `env: ["PUBLIC_*"]` to the `build` task.
- Add a note in `packages/cli/update-notes/`.

Done when: in a `.dev` project, `pnpm turbo run build --filter=@repo/admin --dry=json` reports a different `@repo/admin#build` hash after a new key in `apps/admin/.env`, and again with `PUBLIC_API_URL` set in the process environment.

### Phase 2: preview ports in the Vite apps

- Add a `preview` block with `port` and `strictPort: true` to `modules/api/files/vite.config.ts`, `modules/admin/files/vite.config.ts` and `modules/app/files/vite.config.ts`. Compute the port once and share it between `server` and `preview`.
- Add `cors: false` to the api's `preview` block.
- Add an update note to each of the three modules.

Done when: in a `.dev` project with `pnpm dev:ports` run in a linked worktree, `pnpm --filter @repo/api build && pnpm --filter @repo/api preview` answers `GET /health` on the worktree's api port, and the admin and app previews answer on theirs.

### Phase 3: built mode in the e2e config

- Add `serveMode(env)` to `modules/e2e/files/lib/project.ts` and export the result as `SERVE`.
- In `modules/e2e/files/playwright.config.ts`, rename `devCommand` to `serveCommand`, add the built branch, keep the api `tee-log.ts` wrapper for both modes, add `ASTRO_PREVIEW_BACKGROUND`, and make `timeout` and `reuseExistingServer` depend on the mode.
- Add the `serveMode` test in `scripts/`.

Done when: the `serveMode` test passes, `E2E_SERVE=bogus pnpm e2e` fails at config load naming `dev` and `built`, a second `E2E_SERVE=built pnpm e2e` with no change shows turbo cache hits for every app build, and after a built run no process listens on any app port.

### Phase 4: documentation

- Update `modules/e2e/skills/saasaloy-e2e/SKILL.md`: the two modes, the default, the start-up cost, the turbo cache, the reuse rule, and "stop `pnpm dev` before a built run".
- Update the e2e note in `modules/ci/skills/saasaloy-ci/SKILL.md` so its `ci:e2e` recipe says CI runs built apps by default and reuses the `pnpm build` step's cache.
- Add the e2e update note.
- Run `pnpm docs:generate`, then check the pages that `docs/wiki/.wikimap.yaml` maps to the changed paths and run `pnpm docs:stale`.

Done when: `pnpm docs:check` and `pnpm docs:stale` pass and `pnpm lint` is clean.

### Phase 5: verify against the target

- In a `.dev` project with `api`, `admin`, `app`, `auth`, `auth-phone`, `sms-console`, `waitlist`, `command`, `ecommerce` and `payment-manual`, run the suite once with `E2E_SERVE=dev` and once with `E2E_SERVE=built`, sampling summed RSS every 5 seconds as the issue did.
- Run the admin login spec once in built mode with a non-loopback host in `.devports.json`, and record the result in the skill.
- Record both suite results in the PR.

Done when: the built run passes every collected spec, and its peak RSS is lower than the dev run's peak.

## Open questions

None open. Two checks stay in the build: the non-loopback host login (Phase 5) and whether primeshopr's one flaky spec has a template equivalent that fails in built mode (Phase 5's full run shows it).

## Non-goals

- Running the suite in the `ci` workflow. Issue #345 owns the `ci:e2e` script.
- Changing how `env-deploy` builds. It does not use turbo.
- Changes to primeshopr. It takes the change through `saasaloy update`.
