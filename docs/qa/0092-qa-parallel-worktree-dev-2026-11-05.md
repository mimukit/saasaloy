# QA Plan: Parallel worktrees and remote dev

_Generated 2026-11-05 · against `654b2154` (clean) · covers issue #307: `pnpm dev:ports`, `DEV_PORT`, `AUTH_COOKIE_PREFIX`, `CORS_ORIGINS` from the env, `pnpm dev:stop`, the dev Vite plugins, `copyText()`, and the template guidance_

## Summary

- Each checkout of a Saasaloy project gets its own dev ports, origins and session cookie names, so several checkouts run `pnpm dev` at the same time on `localhost` or on a tailnet host.
- Working means two checkouts sign in on one browser without a lost session, and a tailnet origin passes CORS.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-307-run-parallel-worktrees-and-remote-dev` at `654b2154`.
- The dev box: `devaloy`, reached over Tailscale. Its tailnet IP during the agent run was `100.73.197.0`.
- Credentials: none before the run. Scenario 1 makes the accounts.
- Screenshots: none. No case in this plan needs a visual judgment of a screen.

Build the CLI and make the scaffold from the repo root:

```sh
pnpm play:init
```

Add the modules from the scaffold folder:

```sh
cd .dev/playground && ./saasaloy add api auth admin database-d1
```

Install, and make the local values file from the tracked example. `saasaloy env --set` refuses a base key such as `DEV_HOST`, so a later step edits the file by hand.

```sh
cd .dev/playground && pnpm install && cp packages/env/.env.example packages/env/.env
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Linked worktree served on the tailnet name | Sign in from a second device on the tailnet | 🔴 Critical |
| TC-1.2 | 1: Linked worktree served on the tailnet name | The `dev:ports` output and the guidance read clearly | 🟡 Normal |
| TC-2.1 | 2: Scaffold on a macOS machine | `pnpm dev:stop` stops only this checkout on macOS | 🟡 Normal |
| TC-3.1 | 3: Scaffold with the organization modules | Copy a value on a plain http tailnet origin | 🟢 Low |

## Scenario 1: Linked worktree served on the tailnet name

**Setup.** Run once, for every case in this scenario. Run the commands on `devaloy`.

1. Commit the scaffold and make a linked worktree of it.

```sh
cd .dev/playground && git add -A && git commit -qm "chore(repo): scaffold" && git worktree add ../playground-wt2 -b wt2
```

2. Prepare the worktree as its `## Worktree setup` section says.

```sh
cd .dev/playground-wt2 && cp ../playground/packages/env/.env packages/env/.env && pnpm install --frozen-lockfile
```

3. Open `.dev/playground-wt2/packages/env/.env` in an editor. Set `DEV_HOST=devaloy`. Set `BETTER_AUTH_SECRET` to the output of the next command.

```sh
openssl rand -hex 24
```

4. Write the env files and the ports, then make the local database.

```sh
cd .dev/playground-wt2 && pnpm env:setup && pnpm db:setup
```

5. Start the dev servers.

```sh
cd .dev/playground-wt2 && pnpm dev
```

- [ ] Setup complete

### TC-1.1: Sign in from a second device on the tailnet  ·  🔴 Critical

**Goal.** A person on another device of the tailnet signs up and signs in to a linked worktree through the box's tailnet name.

**Steps**

1. Read the admin and api ports from `.dev/playground-wt2/.devports.json` (the `services.admin` and `services.api` values).

```sh
cat .dev/playground-wt2/.devports.json
```

2. Make the first account. The admin app has no sign-up, so the first account signs up on the client instance. Put the api port in the URL and the admin port in the `Origin` header.

```sh
curl -i -X POST http://devaloy:<api port>/auth/sign-up/email -H 'Origin: http://devaloy:<admin port>' -H 'Content-Type: application/json' -d '{"email":"qa@example.com","password":"correct-horse-battery","name":"QA"}'
```

   - [ ] The response is `200`, with `access-control-allow-origin: http://devaloy:<admin port>`
3. On your laptop or phone, open `http://devaloy:<admin port>/` in a normal browser. Sign in with `qa@example.com` and `correct-horse-battery`.
   - [ ] The admin dashboard opens, and a reload keeps you signed in
     - no CORS error in the browser console
     - the page loads in a few seconds over the tailnet, not tens of seconds
4. In the browser's developer tools, open the cookies for `devaloy`.
   - [ ] The session cookie is `wt<6 hex>-admin.session_token`, the prefix that `pnpm dev:ports` printed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The `dev:ports` output and the guidance read clearly  ·  🟡 Normal

**Goal.** A new agent or person understands the port scheme and the worktree steps from the printed output and the template guide alone.

**Steps**

1. Run the port step again and read its output.

```sh
cd .dev/playground-wt2 && pnpm dev:ports
```

   - [ ] The output tells you the block, the prefix, each URL, and when to restart `pnpm dev`
2. Open `.dev/playground-wt2/AGENTS.md`. Read "Dev Port Map" and "Worktree setup".
   - [ ] The two sections agree with what you saw in this scenario, and nothing in them is unclear or wrong
     - the main checkout keeps 3000, 3001, 3002, 3003 and 4000
     - a linked worktree takes a 10-port block from 10000
     - `DEV_HOST` and the `BETTER_AUTH_SECRET` rule for a non-loopback host
     - `pnpm dev:stop`, and the restart after an install

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before you move to Scenario 2.

```sh
cd .dev/playground-wt2 && pnpm dev:stop
```

```sh
git -C .dev/playground worktree remove --force ../playground-wt2
```

## Scenario 2: Scaffold on a macOS machine

**Setup.** Run once, on a Mac with Node 24 and pnpm. Use a clone of this branch.

1. Make a scaffold and two checkouts, the same as the Environment and Scenario 1 steps 1 to 4. Leave `DEV_HOST=localhost`.
2. Start `pnpm dev` in both checkouts, each in its own terminal.

- [ ] Setup complete

### TC-2.1: `pnpm dev:stop` stops only this checkout on macOS  ·  🟡 Normal

**Goal.** On macOS, where `/proc` does not exist, `pnpm dev:stop` finds this checkout's processes through `lsof` and leaves the other checkout running.

**Steps**

1. In the linked worktree, stop its servers.

```sh
pnpm dev:stop
```

   - [ ] The command names the processes it stopped, and the linked worktree's terminal shows `pnpm dev` ended
2. Open `http://localhost:3001/` in a browser.
   - [ ] The main checkout's admin still loads
3. In the main checkout, stop its servers.

```sh
pnpm dev:stop
```

   - [ ] No `node`, `workerd` or `esbuild` process of either checkout is left in Activity Monitor

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Remove the Mac scaffold folder.

## Scenario 3: Scaffold with the organization modules

**Setup.** Run once, on `devaloy`, after Scenario 1's Reset.

1. Make a fresh scaffold and add the modules that use `copyText()`.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add api auth admin database-d1 multitenant teams api-keys api-keys-organization
```

2. Set `DEV_HOST=devaloy` and a `BETTER_AUTH_SECRET` in `.dev/playground/packages/env/.env`, as in Scenario 1 step 3.
3. Write the env files, make the database, and start the servers.

```sh
cd .dev/playground && pnpm env:setup && pnpm db:setup && pnpm dev
```

- [ ] Setup complete

### TC-3.1: Copy a value on a plain http tailnet origin  ·  🟢 Low

**Goal.** A copy button works on `http://devaloy:3001`, where the browser blocks `navigator.clipboard`.

**Steps**

1. On your laptop, open `http://devaloy:3001/`, sign in, and create an organization and an API key.
2. Click the copy button beside the new key. Paste into a text editor.
   - [ ] The pasted text is the full key, and the page shows no copy error
3. Invite a member in the organization workspace. Click the copy button beside the invitation ID. Paste it into a text editor.
   - [ ] The pasted text is the full invitation ID, and the page shows "Invitation ID copied."

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the servers and remove the scaffold.

```sh
cd .dev/playground && pnpm dev:stop
```

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test:modules
```

```sh
pnpm test:base
```

```sh
pnpm test:tooling
```

```sh
pnpm test:scripts
```

```sh
pnpm --filter saasaloy test
```

- ✅ `pnpm lint` on `654b2154` → exit 0, all four passes clean
- ✅ `pnpm typecheck` on `654b2154` → exit 0
- ✅ `pnpm test:modules` on `654b2154` → 1031 pass, 0 fail
- ✅ `pnpm test:base` on `654b2154` → 144 pass, 0 fail
- ✅ `pnpm test:tooling` on `654b2154` → 195 pass
- ✅ `pnpm test:scripts` on `654b2154` → 533 pass, 0 fail
- ❌ `pnpm --filter saasaloy test` on `654b2154` → 15 of 1960 fail:
  - 1 is `update-notes.test.ts` "dates every base note at or before the CLI in this package". It fails because the base notes carry `version: 0.9.0` and the package is still `0.8.0`. The owner keeps it red until the release bumps the version.
  - 14 are 5 s timeouts in `update.test.ts` and `no-tty.test.ts`, at a load average of 13. The two files pass 110 of 110 alone:

```sh
cd packages/cli && npx vitest run src/commands/update.test.ts src/commands/no-tty.test.ts --testTimeout=60000
```

### Scenario checks on the disposable target

_Run by the agent on `.dev/playground` (declared throwaway in `AGENTS.md`, reset with `pnpm play:destroy`)._

Run on 2026-11-04 against the uncommitted tree that became `654b2154`, with checkouts `.dev/playground` (main) and `.dev/playground-wt2` (linked, branch `wt2`). The commit hooks ran `prettier --write` and `oxlint --fix` on that tree after `pnpm lint` had passed on it, so the code under test is the code at `654b2154`. The lint-staged backups are gone, so no diff proves it. A rerun on `654b2154` on 2026-11-05 reached `pnpm env:setup` and stopped there, because the container hit its 1024-task limit (`pids.max`) while other threads ran their dev servers. `db:setup` failed with `Resource temporarily unavailable`.

- ✅ Two checkouts at once → main on 3000, 3001, 4000 and `wt2` on 10710, 10711, 10715. Every service answers `200`.
- ✅ The block is stable → the 2026-11-05 rerun on `654b2154` gave `wt2` block 71 and prefix `wtfac67c` again, and the main checkout `block: null`.
- ✅ Sessions stay apart in one cookie jar → after both checkouts sign in, the jar holds `admin.session_token`, `wtfac67c-client.session_token` and `wtfac67c-admin.session_token`. Main returns `a@example.com` and `wt2` returns `b@example.com`.

```sh
curl -s -c jar.txt -b jar.txt http://localhost:10715/admin/auth/get-session -H 'Origin: http://localhost:10711'
```

- ✅ `pnpm dev:stop` in `wt2` → it stops 24 processes. 10710, 10711 and 10715 close, and main's 3001 and 4000 still answer.
- ✅ Tailnet origin, `DEV_HOST=100.73.197.0` with a `BETTER_AUTH_SECRET` → `dev:ports` writes `BETTER_AUTH_URL=http://100.73.197.0:10715` and both origins of web and admin in `CORS_ORIGINS`. The preflight answers `204` with `access-control-allow-origin: http://100.73.197.0:10711`:

```sh
curl -s -i -X OPTIONS http://100.73.197.0:10715/admin/auth/sign-in/email -H 'Origin: http://100.73.197.0:10711' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
```

- ✅ Dev gzip over the tailnet → `content-encoding: gzip` on admin `/@vite/client`, admin `/src/main.tsx` and web `/`. Admin `index.html` stays plain, because it is under the 1024-byte floor.
- ✅ Restart after an install → `pnpm --filter @repo/admin add dlv@1.1.3` in main makes admin and api log `pnpm-lock.yaml changed, restarting so new packages resolve.`, and admin answers `200` after it.
- ✅ `pnpm dev:stop` in main → every port of both checkouts is free, and no process with a cwd in either checkout is left.

### Browser checks

_Driven with `playwright-cli` (headless Chromium) against `http://100.73.197.0:10711` on 2026-11-04. No screenshots._

- ✅ `/login` · secure context → `window.isSecureContext` is `false`, heading "Sign in to Saasaloy admin"
- ✅ `/login` · sign-in form with `b@example.com` → the app lands on `/` with the "Overview" heading
- ✅ `/` · session over a credentialed CORS fetch → `get-session` returns `b@example.com`
- ✅ cookie list → `wtfac67c-admin.session_token`

## Not covered / needs human judgment

- A real second device on the tailnet (TC-1.1). The agent drove a headless browser on the box itself, with the tailnet IP as the host.
- The clipboard paste (TC-3.1). The browser sandbox blocks clipboard reads, so no script confirms the pasted text.
- macOS (TC-2.1). This box runs Linux only.
- Restart on install in apps/web. Web takes `devGzip()` only, because a plain `server.restart()` breaks Astro's own restart handling. The template AGENTS.md tells the agent to restart `pnpm dev` by hand.
- The SSR `brand.css` staleness from the debug note. #307 does not fix it.
- Accessibility and responsive layout: skipped, because the change adds no screen and no control.
- `saasaloy env --set` refuses every base key (`DEV_HOST`, `PUBLIC_SITE_URL`), because it accepts only keys an installed module declares. This branch did not cause it. A person edits `packages/env/.env` by hand for `DEV_HOST`, and the docs say to edit that file.
- Production CORS and cookie domains: skipped, because `CORS_ORIGINS` in production keeps its old meaning and the deploy check now requires it.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
