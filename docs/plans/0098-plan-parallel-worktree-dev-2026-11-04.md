# Plan: run parallel worktrees and remote dev without port or origin clashes

Grilled: 2026-11-04

Issue: #307. Source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, section "Issue 2". Reference: PrimeShopr issue #146 (PR #149, commit `08957c8`) in `/home/dev/projects/primeshopr`. Root cause of the stale dev server: `docs/debug/0001-debug-vite-stale-resolve-after-install-2026-11-04.md`.

## Context

A Saasaloy project pins every dev port: web 3000, admin 3001, app 3002, the email preview 3003, api 4000, each with `strictPort`. Two worktrees of one project cannot run `pnpm dev` at the same time. In PrimeShopr, agents stubbed the api, skipped browser checks or waited on a `flock` because of it. That was the largest time loss in 314 sessions.

Three more faults follow from the same setup:

- A browser keeps cookies per host, not per port. Two worktrees on `localhost` write the same `client.session_token`, so each sign-in signs the other worktree out.
- A dev server reached over a tailnet (`http://devaloy:3000`) is a new origin. The api CORS list and the auth `trustedOrigins` name `localhost` only, so every credentialed call fails.
- Plain `http` on a non-loopback host is not a secure context. `crypto.randomUUID` and `navigator.clipboard` are missing there, and a form that makes an id throws.

PrimeShopr fixed the ports with an external tool, `wtports` (devaloy repo), that hashes a port per worktree and writes `apps/<app>/.env.local`. A Saasaloy project has no `wtports`, so the template must carry the logic.

The "dev server misses changes in `packages/ui`" fault is a Vite 8 behaviour, not a `packages/ui` one. The dev resolver caches a failed bare import, and only watcher events clear that cache. The watcher ignores `node_modules`, so a package installed while `pnpm dev` runs stays unresolved until a restart. `packages/ui` shows it most because the shared UI package gains new dependencies most often.

Goal: an agent or a person runs a second, third or eighth worktree of a Saasaloy project with a working browser loop, locally or on a remote dev box, with no hand edits.

Target: two worktrees of one scaffold run `pnpm dev` at the same time, each signs in on its own web and admin origin, and neither session cookie overwrites the other. A dev server reached on a non-loopback host name passes CORS and saves a form. Both checks run in phase 8.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the port logic lives | In the template, in `packages/env`, as `pnpm dev:ports`. Not an external tool: a scaffold must work on a machine with no devaloy. |
| Where each service's dev port is declared | A `devPort` field on the `SERVICES` rows in `packages/env/src/services.ts`. The `api`, `admin` and `app` modules already add their row with a `const-array` patch, so no module writes a shared root file. |
| How a dev config reads its port | `DEV_PORT` through Vite's `loadEnv`, checked by `devPort()` from `@repo/env/dev-port`, with the pinned port as the fallback. Lifted from PrimeShopr `packages/env/src/dev-port.ts` and its test. `strictPort` stays. |
| Where the per-checkout values land | A marked `# >>> dev:ports` / `# <<< dev:ports` block in each service's `.env.local`, beside the `.env` that `pnpm env:setup` writes. `.env.*` is already gitignored, Vite and the Cloudflare plugin both read `.env.local` over `.env`, and `env:setup` never touches the block. |
| Port scheme (Q1, asked) | One hashed block per worktree. Hash the absolute worktree path to a block `k` from 0 to 999. Port = `10000 + 10k + slot`. The slot is `devPort - 3000` for a frontend (0 to 4) and `devPort - 4000 + 5` for a backend (5 to 9). A `devPort` outside 3000–3004 and 4000–4004 fails the run. |
| Main checkout (Q12, defaulted) | Gets a block too, with the pinned ports and no cookie prefix. Every checkout gets `CORS_ORIGINS` from one writer. |
| Collision (Q13, defaulted) | A block is taken when a port in it listens now, or when another worktree's `.devports.json` records it (found through `git worktree list --porcelain`). On a taken block, probe `k+1`, `k+2`, and so on. A rerun keeps the recorded block while it is still free. |
| Record of the assignment | A gitignored `.devports.json` at the checkout root: `{ "block": k, "host": "...", "cookiePrefix": "...", "services": { "<name>": <port> } }`. `dev:stop`, e2e and the collision check read it. |
| Cookie prefix (Q2, asked) | An `AUTH_COOKIE_PREFIX` key in the `auth` module (`src/env.ts` `cookiePrefixes(env)`, `src/env-preset.ts`, `registry-item.json` `envVars`, blank on purpose in `.env.example`). It applies on any `http:` `BETTER_AUTH_URL`, so a tailnet host works too; a production URL is always `https:`. It gives `<prefix>-client` and `<prefix>-admin`, and it throws on a value that does not match `^[a-z0-9-]+$`. `dev:ports` writes `wt<first 6 hex of the path hash>` in a linked worktree and nothing in the main checkout. |
| Hard-coded `DEV_ORIGINS` (Q3, asked) | Delete both lists (`modules/api/files/src/index.ts`, `modules/auth/files/src/auth.ts`). `dev:ports` writes `CORS_ORIGINS` in every checkout. The AGENTS.md "update both allow-lists" rule goes away. |
| `CORS_ORIGINS` becomes required (Q14, defaulted) | Remove it from `envOptional` in `modules/api/registry-item.json` and make it required in `modules/api/files/src/env.ts`. The env gate names the key, and the key's description names `pnpm env:setup`. |
| Dev host (Q4, asked) | A `DEV_HOST` key in `packages/env/.env`, default `localhost`, with a `dev:ports --host <name>` flag that overrides it for one run. `CORS_ORIGINS` lists the `localhost` and the `DEV_HOST` origin of each browser service. `PUBLIC_API_URL`, `PUBLIC_SITE_URL` and `BETTER_AUTH_URL` use `DEV_HOST`, because a page and its api must share one host for the `SameSite=Lax` cookie. |
| `DEV_HOST` section (Q15, defaulted) | A new file-less `SERVICES` row, `dev-ports`, the same shape as `deploy`. |
| Who runs `dev:ports` (Q5, defaulted) | `pnpm env:setup` calls it at the end. It also runs alone. |
| `dev:stop` (Q6, defaulted) | Finds listeners on this checkout's ports from `.devports.json`, plus processes whose cwd is under the checkout root (`/proc/<pid>/cwd` on Linux, `lsof -a -d cwd` on macOS). Stops each process tree with SIGTERM, then SIGKILL after 5 s. Never touches a process outside the checkout. |
| Vite dev plugins (Q7, Q11, asked and defaulted) | One `@repo/tooling/vite` export holds `devGzip()` (lifted from PrimeShopr `apps/admin/vite/dev-gzip.ts`) and `restartOnLockfile()`. Web, admin and app take both; api takes `restartOnLockfile()`. They are devDependencies. If `server.restart()` does not work inside `astro dev`, web takes `devGzip()` only and the AGENTS.md rule covers it. |
| Stale resolver fix (Q11, asked) | `restartOnLockfile()`: `server.watcher.add(<root>/pnpm-lock.yaml)` and `server.restart()` on a change, `apply: "serve"`. Plus an AGENTS.md and `saasaloy-ui` rule: restart the dev server after an install. `server.watch: null` is rejected because it removes HMR. |
| The SSR `brand.css` staleness (Q18, defaulted) | Recorded in the debug note. No fix in this issue: it affects the first paint only, and its mechanism is not proven. |
| `--concurrency` (Q8, defaulted) | `--concurrency=4` on `test` and `typecheck` in the template root scripts. |
| email-react preview (Q9, defaulted) | A `SERVICES` row with `file: "packages/email-react/.env"` and `devPort: 3003`, and a small `dev` wrapper that reads `DEV_PORT` from its `.env.local` and passes `--port`. |
| Plain-HTTP helpers (Q10, defaulted) | `packages/ui/src/lib/random-id.ts` (`randomId()` on `crypto.getRandomValues`) and `packages/ui/src/lib/clipboard.ts` (`copyText()` with an `execCommand` fallback, lifted from PrimeShopr). |
| e2e ports (Q16, defaulted) | `modules/e2e/files/lib/project.ts` reads `.devports.json` and falls back to the pinned ports when the file is missing. |
| Test runners (Q20, defaulted) | `node --test` beside the source for `dev-port`, `dev-ports`, `dev-stop`, the Vite plugins and the helpers. The auth `env.test.ts` stays on `node --test`. No new runner. |
| Outward actions (Q17, asked) | None. The Vite upstream report text goes in the debug note, and the owner files it if wanted. The owner asked for the `ready` label on #307 and for every change to stay uncommitted. |

## Approach

Port PrimeShopr's `DEV_PORT` and `AUTH_COOKIE_PREFIX` code, and replace `wtports` with a template script that reads the `SERVICES` table. It reuses:

- `packages/env/src/services.ts`, the `SERVICES` table and its `const-array` patch point.
- `packages/env/src/env-file.ts` for reading and writing env files.
- `modules/auth/files/src/env.ts`, its `LOOPBACK_HOSTNAMES` set and `hostnameOf()`.
- The `cookiePrefix: group` line in `modules/auth/files/src/auth.ts`.
- `CORS_ORIGINS`, which both the api and auth already read.

Rejected:

- **Smallest diff:** `DEV_PORT` support in the configs, and a person picks ports by hand. It does not stop two agents from picking the same port, and it leaves origins and cookies to hand edits.
- **Fold into `env:setup`:** write the ports straight into each `.env`. `env:setup` would then mix values a source holds with values this checkout derives, and each pull would rewrite them.

Every phase that changes a file a project owns adds an update note under `packages/cli/update-notes/`.

### Phase 1: root cause of the stale `packages/ui` watcher (done in the grill, 2026-11-04)

Proved with debugkit on a `.dev` scaffold. See the debug note.

Done when: `docs/debug/0001-debug-vite-stale-resolve-after-install-2026-11-04.md` names the cause, the reproduction and the toggle evidence.

### Phase 2: `DEV_PORT` in every dev config (built 2026-11-04)

- Add `packages/env/src/dev-port.ts` and `dev-port.test.ts`, lifted from PrimeShopr. Export `./dev-port`.
- Add `devPort` to the `Service` type and to the `web` row (3000). Add it to the `api` (4000), `admin` (3001) and `app` (3002) row patches. Add the `email-react` row (3003) and its `dev` wrapper.
- Read `DEV_PORT` with `loadEnv` in `apps/web/astro.config.mjs`, `modules/admin/files/vite.config.ts`, `modules/app/files/vite.config.ts` and `modules/api/files/vite.config.ts`. Keep `strictPort`.
- `modules/api/files/wrangler.jsonc` keeps `dev.port: 4000`. Its comment names `wrangler dev --port <DEV_PORT>` for a worktree.

Done when: `DEV_PORT=4567` in `apps/web/.env.local` starts the web dev server on 4567, an unset key starts it on 3000, and `DEV_PORT=abc` fails at startup naming the file. `node --test` passes in `packages/env`.

### Phase 3: `pnpm dev:ports` (built 2026-11-04)

- `packages/env/scripts/dev-ports.ts` and a testable core in `packages/env/src/dev-ports.ts`, run as `pnpm dev:ports` from the root. `pnpm env:setup` calls it at the end.
- It computes the block, checks for a collision, and writes the marked block into each service's `.env.local`: `DEV_PORT`, the origin keys that service reads (`PUBLIC_API_URL`, `PUBLIC_SITE_URL`, `BETTER_AUTH_URL`, `CORS_ORIGINS`) and, in a linked worktree, `AUTH_COOKIE_PREFIX`.
- It writes `.devports.json` and adds it to the template `_gitignore`.
- It reads `DEV_HOST` from `packages/env/.env` and takes `--host`. It adds the `dev-ports` file-less row and the `DEV_HOST` key to `.env.example`.
- `pnpm dev:ports --clean` removes every block and the record.
- It prints "restart pnpm dev to load the new ports" when a value changed.
- `modules/e2e/files/lib/project.ts` reads `.devports.json`.

Done when: in two worktrees of one scaffold, `pnpm dev:ports` writes different blocks and different cookie prefixes, a second run writes the same values, and `--clean` leaves no block. The core's tests cover the hash, the slot rule, the collision probe and the block rewrite.

### Phase 4: origins and cookies from the env (built 2026-11-04)

- `modules/auth`: `cookiePrefixes(env)` in `src/env.ts`, used for both instances in `src/auth.ts`. `AUTH_COOKIE_PREFIX` in `src/env-preset.ts` and `registry-item.json`. Tests in `src/env.test.ts`: unset, set on `http:`, ignored on `https:`, bad format throws.
- `modules/api/files/src/index.ts` and `modules/auth/files/src/auth.ts`: delete `DEV_ORIGINS`, build the CORS list and `trustedOrigins` from `CORS_ORIGINS` only. Make `CORS_ORIGINS` required.
- Update the comments and skill text that name the deleted lists or the pinned origins.

Done when: with `dev:ports --host <non-loopback name>`, a browser on `http://<name>:<web port>` signs in and the api answers its preflight with that origin. The auth tests pass, and `scripts/env-presets.test.ts` passes.

### Phase 5: `pnpm dev:stop` (built 2026-11-04)

A root script backed by `packages/env/scripts/dev-stop.ts` (or `packages/tooling`, wherever the root script convention puts it) that stops the `turbo run dev` parent and its vite and workerd children for this checkout only.

Done when: with two worktrees running `pnpm dev`, `pnpm dev:stop` in one frees that worktree's ports and leaves the other worktree's servers answering.

### Phase 6: remote dev helpers and the restart plugin (built 2026-11-04)

- `@repo/tooling/vite` with `devGzip()` and `restartOnLockfile()`, and their tests. Wire them into web, admin, app and api.
- `randomId()` and `copyText()` in `packages/ui/src/lib`, with tests. Use them in the browser code that calls `crypto.randomUUID` or `navigator.clipboard` today: `modules/api-keys-organization/files/admin/components/api-key-workspace.tsx`, `modules/teams/files/admin/components/organization-workspace.tsx` and `modules/storage/files/src/upload.ts` (check each is browser code first).

Done when: a dev page loaded over a non-loopback host gets `content-encoding: gzip` bodies, an install while `pnpm dev` runs is followed by a restart and the new import resolves on the next reload, and the plugin and helper tests pass.

### Phase 7: turbo caps and guidance

- `--concurrency=4` on `test` and `typecheck` in the template root `package.json`.
- Template `AGENTS.md`: rewrite "Dev Port Map" for `DEV_PORT`, `dev:ports` and `DEV_HOST`; add `## Worktree setup` (env, branch database, `env:setup` which runs `dev:ports`, teardown) in the gitkit `prepare` shape; add "test on the real origin, not localhost", "one session per worktree" and "restart the dev server after an install".
- The `saasaloy-env`, `saasaloy-api`, `saasaloy-auth` and `saasaloy-ui` skills.
- Update notes for every file a project owns.

Done when: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass at the repo root.

### Phase 8: acceptance on a scaffold (built 2026-11-04)

Run the issue's acceptance in `.dev`: two worktrees of one scaffold with `api`, `auth`, `admin` and `database-d1` run `pnpm dev` at the same time. Sign in on both in one headless browser (`playwright-cli`). Reach one through a non-loopback host and save a form. Stop every server.

Done when: both sessions stay signed in after the other signs in, the non-loopback origin passes CORS and the form saves, and no dev port stays held after `pnpm dev:stop`.

## Open questions

None. Every decision is settled.

## Non-goals

- Production CORS, cookie domains or `COOKIE_DOMAIN` behaviour.
- A dev database per worktree. `database-postgres` and gitkit `prepare` already cover it; this plan only points the `## Worktree setup` section at them.
- Running two sessions in one worktree.
- HTTPS for the dev servers.
- A fix for the SSR `brand.css` staleness, and the upstream Vite fix.
- The per-component `@source` list in `globals.css` (#306 owns it).
