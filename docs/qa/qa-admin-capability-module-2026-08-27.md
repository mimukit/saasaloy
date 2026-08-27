# QA Plan: `admin` capability module (issue #13)

_Generated 2026-08-27 · against `6e000a5` · covers the `admin` module: the scaffolded `apps/admin` React SPA, its session guard, its route-tree nav, and its theme-init injection._

## Summary

- `saasaloy add admin` scaffolds a React SPA at `apps/admin`, pulls in `database`, `api` and `auth`, and guards every page behind a Better Auth session.
- Working means an unauthenticated visitor lands on `/login`, signup creates the first user and opens the dashboard, sign-out returns to `/login`, a dropped route file paints its own nav item, and the first frame carries the correct theme.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-13-admin-capability-module`, commit `6e000a5`.
- Base URLs: admin at `http://localhost:3001`, api at `http://localhost:4000`.
- Credentials: none exist yet. You create the first user in TC-1.2. Use `qa@example.test` / `qa-password-123`.
- No feature flags. `VITE_API_URL` stays unset, so the admin app falls back to `http://localhost:4000`.
- Use a private browser window. A stored session or a stored `theme` value changes the result of TC-1.1 and TC-1.4.

Build the playground and install the module:

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add admin --yes && pnpm install
```

Start the api in terminal 1:

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

Start the admin app in terminal 2:

```sh
cd .dev/playground && pnpm --filter @repo/admin dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: empty database, no session | The guard sends every visitor to `/login` and keeps the redirect | 🔴 Critical |
| TC-1.2 | 1: empty database, no session | Signup creates the first user and opens the dashboard | 🔴 Critical |
| TC-1.3 | 1: empty database, no session | A dropped route file paints its own nav item | 🔴 Critical |
| TC-1.4 | 1: empty database, no session | The first frame carries the theme, and the toggle cycles | 🟡 Normal |
| TC-1.5 | 1: empty database, no session | Sign-out clears the session and returns to `/login` | 🔴 Critical |
| TC-2.1 | 2: signed-in session, api stopped | A failed sign-out says so and keeps the session | 🟡 Normal |

## Scenario 1: empty database, no session

**Setup.** Run once, for every case in this scenario.

1. Confirm both dev servers from **Environment** are running.
2. Open a new private browser window. Keep it for the whole scenario.

Confirm the api answers:

```sh
curl -i http://localhost:4000/auth/get-session
```

- [ ] Setup complete

### TC-1.1: The guard sends every visitor to `/login` and keeps the redirect  ·  🔴 Critical

**Goal.** No unauthenticated visitor sees a guarded page, and a deep link survives the trip through login and signup.

**Steps**

1. Open `http://localhost:3001/` in the private window.
   - [ ] The address bar ends on `http://localhost:3001/login?redirect=%2F`
   - [ ] The login form paints, with an email field, a password field and a "Sign in" button
   - [ ] The dashboard never paints, not even for one frame
2. Open `http://localhost:3001/settings` in the same window.
   - [ ] The address bar ends on `/login?redirect=%2Fsettings`
3. Press the "Create one" link in the login card footer.
   - [ ] The address bar keeps the redirect, so it reads `/signup?redirect=%2Fsettings`
4. Press the "Sign in" link in the signup card footer.
   - [ ] The address bar reads `/login?redirect=%2Fsettings` again
5. Open `http://localhost:3001/login?redirect=https://example.com` in the address bar.
   - [ ] The login form still paints and the app stays on `localhost:3001`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Signup creates the first user and opens the dashboard  ·  🔴 Critical

**Goal.** The first signup on an empty database creates a user, sets a session cookie, and lands on the guarded dashboard.

**Steps**

1. Open `http://localhost:3001/signup`.
2. Enter `qa@example.test` and `qa-password-123`. Press the submit button.
   - [ ] The app navigates to `http://localhost:3001/` and the dashboard paints
   - [ ] The nav shows `qa@example.test`, the theme toggle and a sign-out button
3. Open devtools, then Application → Cookies → `http://localhost:3001`.
   - [ ] A session cookie exists, and its `HttpOnly` column is ticked
4. Reload `http://localhost:3001/`.
   - [ ] The dashboard paints again, with no bounce to `/login`
5. Open `http://localhost:3001/signup` and submit `qa@example.test` / `qa-password-123` a second time.
   - [ ] The card shows an error message
   - [ ] The address bar stays on `/signup`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A dropped route file paints its own nav item  ·  🔴 Critical

**Goal.** One new route file adds both the page and its nav link, with no other file edited.

**Steps**

1. Create `apps/admin/src/routes/_authed/demo.tsx` in the playground. Edit nothing else.

   ```sh
   cd .dev/playground && printf 'import { createFileRoute } from "@tanstack/react-router";\n\nexport const Route = createFileRoute("/_authed/demo")({\n  component: Demo,\n  staticData: { nav: { label: "Demo", order: 1 } },\n});\n\nfunction Demo() {\n  return <div>Demo page</div>;\n}\n' > apps/admin/src/routes/_authed/demo.tsx
   ```

2. Return to the browser on `http://localhost:3001/`. Wait for the dev server to reload.
   - [ ] A "Demo" link appears in the nav, in the position the `order: 1` value asks for
3. Press the "Demo" link.
   - [ ] The address bar reads `/demo` and the page shows "Demo page"
   - [ ] The nav still paints, with "Demo" marked as the current page
4. Delete the file.

   ```sh
   cd .dev/playground && rm apps/admin/src/routes/_authed/demo.tsx
   ```

5. Return to the browser and reload.
   - [ ] The "Demo" link is gone from the nav
   - [ ] `http://localhost:3001/demo` no longer resolves to the demo page

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The first frame carries the theme, and the toggle cycles  ·  🟡 Normal

**Goal.** The injected theme script sets `data-theme` before the app bundle runs, so a dark reload never shows a white frame.

**Steps**

1. Set the OS or the browser preference to dark. Open devtools → Network and tick "Disable cache".
2. Hard-reload `http://localhost:3001/`. Watch the first frames, or record a slow-motion capture and step through it.
   - [ ] The first painted frame is dark, with no white or light frame before it
3. Run this in the devtools console.

   ```sh
   document.documentElement.dataset.theme
   ```

   - [ ] The value is `dark`
4. Press the theme toggle in the nav once.
   - [ ] The page switches to light, and the toggle icon changes with it
   - [ ] The button `aria-label` reads the matching `THEME_LABELS` string for the new state
5. Press the toggle twice more, so the state runs light → dark → system.
   - [ ] Each press changes the painted theme and updates the `aria-label` to match
6. Hard-reload once more, with the stored state left on `dark`.
   - [ ] The first frame is dark again, with no flash

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: Sign-out clears the session and returns to `/login`  ·  🔴 Critical

**Goal.** Sign-out ends the session on the server, not only in the browser tab.

**Steps**

1. Confirm the dashboard is open at `http://localhost:3001/` and the nav shows `qa@example.test`.
2. Press the sign-out button.
   - [ ] The app ends on `http://localhost:3001/login`
   - [ ] No error message appears in the nav
3. Open devtools → Application → Cookies.
   - [ ] The session cookie is gone
4. Open `http://localhost:3001/` again.
   - [ ] The app stays on `/login?redirect=%2F` and the dashboard does not paint

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

Sign in again, because Scenario 2 needs a live session:

```sh
open http://localhost:3001/login
```

## Scenario 2: signed-in session, api stopped

**Setup.** Run once, for the case in this scenario.

1. Sign in at `http://localhost:3001/login` with `qa@example.test` / `qa-password-123`.
2. Confirm the dashboard paints and the nav shows the email.
3. Stop the api dev server in terminal 1 with `Ctrl+C`. Leave the admin dev server running.

- [ ] Setup complete

### TC-2.1: A failed sign-out says so and keeps the session  ·  🟡 Normal

**Goal.** A sign-out that the server never answers reports the failure and does not pretend the session is gone.

**Steps**

1. Press the sign-out button in the nav.
   - [ ] The nav shows an error message, "Could not reach the server. Try again."
   - [ ] The app stays on the dashboard and does not navigate to `/login`
2. Look at the sign-out button.
   - [ ] The button is enabled again, so a second press is possible
3. Start the api again in terminal 1.

   ```sh
   cd .dev/playground && pnpm --filter @repo/api dev
   ```

4. Press the sign-out button once more.
   - [ ] The error message clears and the app ends on `/login`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop both dev servers with `Ctrl+C`, then remove the playground:

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

All six checks ran against commit `6e000a5`, on a playground rebuilt from scratch after the three fix commits (`5107518`, `e8d25f1`, `6e000a5`) landed.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add admin --yes
```

```sh
cd .dev/playground && pnpm install && pnpm typecheck && pnpm build
```

```sh
cd .dev/playground && git add -A && git commit -qm baseline && ./saasaloy add admin --yes && git status --porcelain
```

```sh
cd .dev/playground && pnpm --filter @repo/admin build && grep -c demo apps/admin/src/routeTree.gen.ts && grep -rl Demo apps/admin/dist/assets && git status --porcelain
```

```sh
cd .dev/playground && grep -c "prefers-color-scheme" apps/admin/index.html; head -c 600 apps/admin/dist/index.html; grep -n "head-prepend\|THEME_INIT_SCRIPT" apps/admin/vite.config.ts
```

```sh
grep -rn "prefers-color-scheme\|THEME_STORAGE_KEY\|THEME_INIT_SCRIPT" modules/admin/
```

- ✅ AC1-resolve → `add admin` applied `api, database, auth, admin` (40 files). `installed` is `["web","api","database","auth","admin"]`, `@admin` maps to `apps/admin/src`, and every named file exists, including `src/routes/_authed/index.tsx`.
- ✅ AC1-gates → `pnpm typecheck` exited 0 (5 tasks), `pnpm build` exited 0 (3 tasks), with no prior `vite dev` run. `apps/admin/dist/index.html` and `dist/assets/` exist. The `routeTree.gen.ts` sha256 is `329337b2…5c2b9c` before and after the build.
- ✅ AC1-idempotent → the second run printed "Nothing to do — use --force to re-apply" and `git status --porcelain` stayed empty.
- ✅ AC3-drop → after the demo route file, `routeTree.gen.ts` holds 13 `demo` hits, "Demo" lands in `dist/assets/demo-BliVUPiJ.js` and the entry chunk, and `git status --porcelain` lists exactly the new file plus the regenerated tree. After the delete and rebuild, the status is empty and the sha256 is back to `329337b2…5c2b9c`.
- ✅ AC4-inject → source `index.html` has 0 `prefers-color-scheme` hits. `dist/index.html` opens `<head>` with a bare `<script>` (no `type="module"`, no `src`) carrying the `THEME_INIT_SCRIPT` body. `vite.config.ts` imports the constant from `@repo/ui/lib/theme` and injects it at `head-prepend` from `transformIndexHtml`.
- ✅ AC4-no-drift → six hits under `modules/admin/`, all of them the identifier or prose. No copy of the script body anywhere.

## Not covered / needs human judgment

- Every case in this plan needs a browser, and the box that generated the plan has none. That is why the five human-only checks reached the plan and the six agent checks did not.
- `wrangler deploy` and the `apps/admin/wrangler.jsonc` static-assets shape against a real Cloudflare account.
- Cross-origin behaviour against a non-`localhost` origin, and the `trustedOrigins` list at runtime. Only the source constants were read.
- Performance and concurrency. The admin app is a scaffold with one page and no data volume, so load behaviour carries no signal yet.
- Compatibility across browsers. The plan targets one modern browser; the SPA uses no browser-specific API past `matchMedia` and `localStorage`.
- Accessibility past the theme toggle `aria-label` and the sign-out error `role="alert"`. A full keyboard and screen-reader pass on the login, signup and shell is worth a separate run.
