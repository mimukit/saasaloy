# QA Plan: web dev server on a fresh project

_Generated 2026-09-29 · against `6702a53` plus the uncommitted issue #186 changes · covers the web template's dev server, the `@cloudflare/vite-plugin` pin, the SSR pre-bundle entries, the `theme.ts` handler move, and the `release-smoke` dev check_

## Summary

- A project scaffolded from the base template starts `astro dev` and renders `/` with no React error.
- Working means: the dev server answers, every React block renders and hydrates in a browser, an edit reloads cleanly, and the admin theme toggle still cycles.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-186-start-astro-dev-on-the-base-template`.
- The scaffolded project is `.dev/playground`.
- The web dev URL is `http://localhost:3000`. The admin dev URL is `http://localhost:3001`. The api dev URL is `http://localhost:4000`.
- You need a real browser. The dev box has none, so forward the ports to your machine first.

Forward the three ports from your machine:

```sh
ssh -N -L 3000:localhost:3000 -L 3001:localhost:3001 -L 4000:localhost:4000 devaloy
```

Run every command below in a terminal on the dev box, not through a coding agent. Astro 7 starts a background server when it detects an agent, and this plan tests the foreground path a person gets.

- [x] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh base project, cold Vite cache | `pnpm dev` starts and the terminal shows no React error | 🔴 Critical |
| TC-1.2 | 1: fresh base project, cold Vite cache | The landing page renders and its blocks hydrate | 🔴 Critical |
| TC-1.3 | 1: fresh base project, cold Vite cache | An edit to a `@repo/ui` block reloads with no hook error | 🟡 Normal |
| TC-2.1 | 2: project with admin, signed in as superadmin | The admin theme toggle cycles and follows the OS | 🟡 Normal |

## Scenario 1: fresh base project, cold Vite cache

**Setup.** Run once, for every case in this scenario.

1. Scaffold a base-only playground and install it.

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

- [x] Setup complete

### TC-1.1: `pnpm dev` starts and the terminal shows no React error  ·  🔴 Critical

**Goal.** A fresh project's web dev server starts in the foreground and renders `/` with one copy of React.

**Steps**

1. Start the web dev server.

   ```sh
   pnpm -C .dev/playground/apps/web dev
   ```

   - [ ] The terminal prints `astro v7.3.5 ready` and `Local http://localhost:3000/`
     - no `Dev server process exited before becoming ready`
     - no `does not satisfy the peer dependency required by @cloudflare/vite-plugin`
2. Open `http://localhost:3000/` in the browser. Wait for the page to load.
   - [ ] The terminal shows no `Invalid hook call` and no `Cannot read properties of null (reading 'use…')`
   - [ ] The terminal shows no `optimized dependencies changed. reloading` line after the first request
3. Reload the page twice.
   - [ ] The terminal still shows no React error

Leave the server running for TC-1.2 and TC-1.3.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The landing page renders and its blocks hydrate  ·  🔴 Critical

**Goal.** The blocks from `@repo/ui` render on the server and work in the browser.

**Steps**

1. Look at `http://localhost:3000/` at 1280px or wider. Scroll from top to bottom.
   - [ ] Every block shows its content, with icons in place
     - navbar: logo, links, call-to-action button
     - hero, feature grid with an icon on each card, pricing table, FAQ, call-to-action, footer
2. Open the browser console.
   - [ ] The console shows no hydration error and no `Invalid hook call`
3. Click the pricing table's billing toggle. Open one FAQ item.
   - [ ] The prices change, and the FAQ item opens and closes
4. Narrow the window below 768px. Open the navbar menu.
   - [ ] The mobile menu opens and closes
5. Click the theme toggle beside the navbar three times.
   - [ ] The palette cycles light, dark, system, and the icon changes each time

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: An edit to a `@repo/ui` block reloads with no hook error  ·  🟡 Normal

**Goal.** A source edit in the linked `@repo/ui` workspace does not bring back the two-copies fault.

**Steps**

1. Open `.dev/playground/packages/ui/src/content/landing.ts`. Change the text of `landing.hero.title`. Save the file.
   - [ ] The browser shows the new title without a manual reload
   - [ ] The terminal shows no React error
2. Undo the edit. Save the file.
   - [ ] The old title comes back, and the terminal shows no React error
3. Stop the server with `Ctrl+C`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2. Nothing to reset: Scenario 2 scaffolds on top of this project.

## Scenario 2: project with admin, signed in as superadmin

**Setup.** Run once, for every case in this scenario.

1. Add the D1 driver and the admin module.

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add admin --yes && pnpm install
```

2. Write the api's local variables.

```sh
printf 'BETTER_AUTH_SECRET=qa-secret-0123456789abcdef0123456789abcdef\nBETTER_AUTH_URL=http://localhost:4000\nCOOKIE_DOMAIN=\nCORS_ORIGINS=http://localhost:3000,http://localhost:3001\nLOGGER_PROVIDER=console\nLOG_LEVEL=info\nPUBLIC_API_URL=http://localhost:4000\n' > apps/api/.dev.vars
```

3. Generate and apply the migration.

```sh
pnpm -C packages/db db:generate && pnpm -C packages/db db:migrate:local
```

4. Start the api in one terminal.

```sh
pnpm -C apps/api dev
```

5. Start the admin app in a second terminal.

```sh
pnpm -C apps/admin dev
```

6. Create the first user. The first user gets the `superadmin` role.

```sh
curl -s -i -X POST http://localhost:4000/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3001' -d '{"email":"admin@example.test","password":"qa-password-123","name":"QA Admin"}'
```

7. Open `http://localhost:3001` in the browser. Sign in as `admin@example.test` with `qa-password-123`.

- [ ] Setup complete

### TC-2.1: The admin theme toggle cycles and follows the OS  ·  🟡 Normal

**Goal.** Moving the click and OS handlers in `packages/ui/src/lib/theme.ts` to module scope keeps the admin toggle's behaviour.

**Steps**

1. Click the theme toggle in the admin rail three times.
   - [ ] Each click moves one step, light to dark to system, and never skips a step
   - [ ] The toggle's label changes with each step
2. Leave the toggle on system. Switch your OS between light and dark mode.
   - [ ] The admin palette follows the OS without a reload
3. Set the toggle to dark. Switch the OS again.
   - [ ] The admin palette stays dark
4. Reload the page.
   - [ ] The admin app keeps the choice from step 3

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop both dev servers with `Ctrl+C`. Then scaffold a clean playground.

```sh
cd ../.. && pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm verify:content && pnpm deps:check
```

```sh
pnpm deps:verify
```

```sh
pnpm release:smoke
```

```sh
node --test scripts/verify-pins.test.ts scripts/release-smoke.test.ts
```

- ✅ `pnpm lint`, `pnpm typecheck`, `pnpm test` (547 module tests, 166 script tests), `pnpm verify:content`, `pnpm deps:check` → all exit 0.
- ✅ `pnpm deps:verify` → verify-pins passes 4 rules, and the base playground installs, builds, lints, passes verify-css and typechecks.
- ✅ `pnpm release:smoke` → passes 4 times in a row. The web dev server answers 200 with no React error in the log.
- ✅ Negative check: with the old web `package.json` (wrangler 4.129.0), `release:smoke` fails with "astro dev exited with code 1 before it answered" and the wrangler peer error.
- ✅ Negative check: with the `ssr.optimizeDeps.entries` block removed, `release:smoke` fails with "answered 200, but the server render logged 16 React error(s)".
- ✅ Foreground `astro dev` on a base playground: 4 of 4 requests render with 0 React errors. Before the fix, requests 1 and 2 logged 17 errors each.
- ✅ Background `astro dev` (agent mode) on a base playground: 6 of 6 requests clean.
- ✅ Playground with 30 modules (database-d1 and every local provider): install resolves one `@cloudflare/vite-plugin` (1.60.2), one `wrangler` (4.141.0) and one `react` (19.3.0). `astro dev` renders 4 of 4 requests clean. With `WaitlistForm` wired into `index.astro`, 3 of 3 requests are clean, and the SSR pre-bundle holds one `react` entry.
- ✅ Schema snapshots: `getAuthTables()` with the admin plugin is identical at better-auth 1.7.3 and 1.7.6. The `@better-auth/api-key` schema is identical at 1.7.2 and 1.7.6. The organization plugin tables are identical at 1.7.2 and 1.7.6.
- ✅ Scenario 2 setup ran once on the dev box: the migration applied, `/health` answered 200, sign-up answered 200, and admin answered 200 on port 3001.

## Not covered / needs human judgment

- The scheduled workflow `.github/workflows/smoke.yml` runs only on GitHub. Trigger it once by hand with `workflow_dispatch` after merge and read the log.
- HMR timing in a browser is not measured. TC-1.3 checks only that an edit reloads without an error.
- The `database-postgres` driver is not covered. The fix touches the web app only, and the admin scenario needs one driver.
- Vendor providers (Stripe, Plunk, Cloudflare email) are not covered. They need accounts, and the change does not touch them.
- Accessibility and compatibility are not covered. The change alters no markup.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
