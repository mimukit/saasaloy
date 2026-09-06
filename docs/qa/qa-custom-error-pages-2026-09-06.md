# QA Plan: Custom error pages

_Generated 2026-09-06 · against `8efc423` · covers the shared `ErrorState` block, the web 404/500 pages, the admin not-found and error screens, and the api 404 envelope_

## Summary

- One `ErrorState` block in `@repo/ui` draws every error screen in a scaffolded project, and `packages/ui/src/content/errors.ts` holds every word it shows.
- "Working" means each surface answers a failure in the project's own theme, with the right status code, and no app writes error markup of its own.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-118-add-custom-error-pages` at commit `8efc423`.
- You need a browser. This plan is all visual judgment; the machine checks are already done and recorded at the foot of the file.
- You need a scaffolded playground, not the Saasaloy repo itself. Every path below is inside `.dev/playground`.
- No credentials and no Cloudflare account are needed. Everything runs locally.
- Ports are fixed: web on 3000, admin on 3001, api on 4000. The built web app runs on 8790 in Scenario 1 so it does not collide with the dev server.

Clone the branch and install:

```sh
git clone https://github.com/mimukit/saasaloy.git && cd saasaloy && git checkout issue-118-add-custom-error-pages && pnpm install
```

Build a fresh playground with the admin and api modules:

```sh
pnpm run play:reset && .dev/playground/saasaloy add admin api --yes && pnpm -C .dev/playground install
```

Build every workspace once:

```sh
pnpm -C .dev/playground build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: built web app on wrangler | The 404 page reads in the project theme | 🔴 Critical |
| TC-1.2 | 1: built web app on wrangler | The 404 page holds up in dark mode and on a narrow screen | 🟡 Normal |
| TC-1.3 | 1: built web app on wrangler | The 500 page reads in the project theme | 🟡 Normal |
| TC-1.4 | 1: built web app on wrangler | The 404 page works on the keyboard | 🟢 Low |
| TC-2.1 | 2: admin app, signed in as an admin | The not-found screen draws inside the app shell | 🔴 Critical |
| TC-2.2 | 2: admin app, signed in as an admin | The error boundary draws and its retry works | 🔴 Critical |
| TC-3.1 | 3: admin app, signed out | An unknown admin path redirects to login, not to not-found | 🔴 Critical |

## Scenario 1: built web app on wrangler

**Setup.** Run once, for every case in this scenario.

Serve the built output the way production serves it. `wrangler dev` reads `apps/web/wrangler.jsonc`, so this is the only way to see the real 404 status.

```sh
cd .dev/playground/apps/web && pnpm exec wrangler dev --port 8790
```

- [ ] Setup complete: the terminal prints a ready message and `http://localhost:8790` loads the home page

### TC-1.1: The 404 page reads in the project theme · 🔴 Critical

**Goal.** A visitor who mistypes an address gets a page that looks like the rest of the site, not a browser default.

**Steps**

1. Open `http://localhost:8790/no-such-page` in the browser at 1280px or wider, in light mode.
   - [ ] The page is the site's own 404 screen, and nothing on it is illegible or invisible against its background
     - the code label reads `404`
     - the heading reads "This page does not exist"
     - the body text explains the typo and the move, and it does not name the product
     - one button reads "Back to home"
     - the card sits centred, with the same corner radius, border and shadow as a card elsewhere on the site
   - [ ] The page uses the site's fonts and colours, so it could not be mistaken for an unstyled page
2. Click "Back to home".
   - [ ] The browser lands on the home page at `http://localhost:8790/`
3. Open `http://localhost:8790/nested/deep/path`.
   - [ ] The same screen appears, so depth of the address makes no difference

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The 404 page holds up in dark mode and on a narrow screen · 🟡 Normal

**Goal.** The error screen survives the two conditions that break a hand-written one.

**Steps**

1. Return to `http://localhost:8790/no-such-page`. Switch the theme to dark with the toggle in the navbar.
   - [ ] The same sweep as TC-1.1 is clean in dark
   - [ ] Nothing is dark text on a dark fill, and the button label stays readable against the button
2. Narrow the browser to 375px.
   - [ ] The card fits the width with no sideways scrolling, and the button stays reachable
3. Switch the theme back to light and reload.
   - [ ] The page opens in light mode with no flash of the wrong theme

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The 500 page reads in the project theme · 🟡 Normal

**Goal.** The 500 screen is drawn and themed, so it is ready the day a page renders on demand.

Every page in the base is prerendered, so nothing routes to this screen yet. You open the built file directly to judge how it looks.

**Steps**

1. Open `http://localhost:8790/500`.
   - [ ] The page is the site's own error screen, and nothing on it is illegible
     - the code label reads `500`
     - the heading reads "Something went wrong on our side"
     - the body text says the failure is not the visitor's doing
     - one button reads "Back to home"
   - [ ] There is **no** retry button on this page, which is correct: the page is a static file and a retry could not re-run what failed
2. Switch the theme to dark.
   - [ ] The same sweep is clean in dark

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The 404 page works on the keyboard · 🟢 Low

**Goal.** A visitor who does not use a mouse can leave the error screen.

**Steps**

1. Open `http://localhost:8790/no-such-page`. Press `Tab` repeatedly from the top of the page.
   - [ ] Focus reaches "Back to home", and the focus ring is visible against the button
2. Press `Enter` on that focus.
   - [ ] The browser lands on the home page

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
pkill -f "wrangler dev --port 8790"
```

## Scenario 2: admin app, signed in as an admin

**Setup.** Run once, for every case in this scenario.

The admin app needs the api and a signed-in admin user. Start the api first, in its own terminal:

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

Start the admin app in a second terminal:

```sh
pnpm -C .dev/playground --filter @repo/admin dev
```

1. Open `http://localhost:3001`, sign up, then sign in.
2. Promote that user to an admin the way the admin module's skill describes, then reload.

- [ ] Setup complete: `http://localhost:3001` shows the admin dashboard inside the app shell, with the sidebar and header visible

### TC-2.1: The not-found screen draws inside the app shell · 🔴 Critical

**Goal.** A signed-in admin who follows a dead link stays inside the app instead of falling out of it.

**Steps**

1. Open `http://localhost:3001/no-such-admin-route`.
   - [ ] The app shell is still there, with the sidebar and header the dashboard shows
   - [ ] The not-found screen sits inside that shell, and nothing on it is illegible
     - the code label reads `404`
     - the heading reads "This page does not exist"
     - one button reads "Back to home"
   - [ ] The screen looks like the same component the web 404 used in TC-1.1, restyled by the admin's own layout, not a second design
2. Click "Back to home".
   - [ ] The admin dashboard loads
3. Switch the theme to dark and open `http://localhost:3001/no-such-admin-route` again.
   - [ ] The same sweep is clean in dark

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The error boundary draws and its retry works · 🔴 Critical

**Goal.** A render that throws lands on the shared screen, and the retry on it actually re-renders.

You have to make a route throw. Edit one route component under `.dev/playground/apps/admin/src/routes/` and put `throw new Error("qa boom");` at the top of its component function. Save and let the dev server reload.

**Steps**

1. Open the route you edited.
   - [ ] The shared error screen appears, and nothing on it is illegible
     - the code label reads `500`
     - the heading reads "This screen stopped working"
     - one button reads "Try again"
     - a second control reads "Back to home"
   - [ ] The raw error message and the stack trace are **not** shown to the user
2. Remove the `throw` line you added and save. Wait for the dev server to reload the module.
3. Click "Try again".
   - [ ] The route renders its real content, so the retry re-ran the render rather than reloading the page
4. Undo any remaining edit to the route file.
   - [ ] `git status` in `.dev/playground` shows the route file back as it was

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3. Keep the api running; Scenario 3 needs it.

```sh
git -C .dev/playground checkout -- apps/admin/src/routes
```

## Scenario 3: admin app, signed out

**Setup.** Run once, for this scenario.

1. Keep the api and the admin dev server from Scenario 2 running.
2. Sign out of the admin app, or open `http://localhost:3001` in a private window.

- [ ] Setup complete: `http://localhost:3001` shows the login screen

### TC-3.1: An unknown admin path redirects to login, not to not-found · 🔴 Critical

**Goal.** The guard runs ahead of the not-found screen, so an anonymous visitor cannot learn which admin paths exist.

**Steps**

1. Open `http://localhost:3001/no-such-admin-route` while signed out.
   - [ ] The browser lands on the login screen
   - [ ] The not-found screen does **not** appear, not even for a moment before the redirect
2. Open `http://localhost:3001/users` while signed out.
   - [ ] The browser lands on the login screen the same way, so a real path and a dead path are indistinguishable to a signed-out visitor
3. Sign in as the admin user from Scenario 2, then open `http://localhost:3001/no-such-admin-route`.
   - [ ] Now the not-found screen appears, which confirms the redirect in step 1 came from the guard and not from a broken route

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run at the end of the plan.

```sh
pkill -f "wrangler|vite" && rm -rf .dev/playground
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. Recorded in full in the run's `.afkkit/verified.md`._

All 20 acceptance checks pass. Two carry an adjudicated deviation, described under **Not covered**.

The repo gate, re-run after the review fixes:

```sh
pnpm lint && pnpm typecheck && pnpm test
```

- ✅ `pnpm lint` → all four passes green, ending "All matched files use Prettier code style!"
- ✅ `pnpm typecheck` → "Tasks: 1 successful, 1 total"
- ✅ `pnpm test` → 89 pass 0 fail, then 31 pass 0 fail
- ✅ `pnpm verify:pins` → "2 pin rule(s) agree across their manifests"; `@astrojs/cloudflare` is pinned exactly at `14.3.0`

The web app, over the built output on `wrangler dev`:

```sh
curl -s -o /tmp/body -w 'status=%{http_code} type=%{content_type} size=%{size_download}\n' http://localhost:8790/no-such-page
```

- ✅ `GET /no-such-page` → `status=404`, `text/html`, 5326 bytes; the body carries "This page does not exist" twice and "Back to home" once. `GET /nested/deep/path` answers identically.
- ✅ The built `dist/client/404.html` and `500.html` reference no `_astro/*.js`, so the error screens ship zero JavaScript. The only inline script is the theme boot script the layout already had.
- ✅ `GET /wrangler.json` and `GET /.assetsignore` answer 404, so the build's own config does not leak as an asset.

The deploy configuration:

```sh
cd .dev/playground/apps/web && pnpm exec wrangler deploy --dry-run
```

- ✅ Exits 0 and prints "No bindings found." The review found the adapter adding a `SESSION` KV namespace binding with no id; setting Astro's `session: false` removes it, and `dist/client/wrangler.json` now carries no `kv_namespaces`.
- ✅ Wrangler reports "Using redirected Wrangler configuration", confirming the note now written into `apps/web/wrangler.jsonc`: the build redirects deploy through `.wrangler/deploy/config.json` to the adapter's generated file.

The api Worker, over `wrangler dev`:

```sh
curl -s -w 'status=%{http_code}\n' http://localhost:4000/nope && curl -s -X POST -w 'status=%{http_code}\n' http://localhost:4000/health
```

- ✅ Both answer `status=404`, `application/json`, body `{"error":{"code":"not_found","message":"not found"}}`. A `DELETE /health` answers the same. `GET /health` still answers `200 {"status":"ok"}`.
- ✅ The miss response carries `Vary: Origin` and `Access-Control-Allow-Credentials: true`, so the CORS middleware runs ahead of the not-found handler.
- ✅ `GET /admin/nope` answers the envelope. `GET /auth/nope` answers a bare 404 with an empty body, because the auth module mounts a catch-all and better-auth answers the whole subtree. The api skill now records this.
- ✅ `GET /admin/users` still answers 401 while signed out.

Source and descriptor checks:

```sh
git diff --name-only origin/main...HEAD
```

- ✅ `modules/admin/files/src/routeTree.gen.ts` is not in the diff and `git status` on it is empty, so the generated route tree was not hand-edited.
- ✅ `export const base: Hono<{ Bindings: Bindings; Variables: Variables }>` appears only as diff context, so the api's type annotation is unchanged.
- ✅ `astro.config.mjs` still sets `server: { port: 3000 }` and `vite.server.strictPort: true`, and the diff carries no CORS change.
- ✅ `error-state.tsx` contains no `useState`, `useEffect`, `useRef` or `"use client"`, and neither Astro page carries a `client:` directive.
- ✅ `errors.ts` uses no template literal and no string concatenation, and nests two levels below its namespace.

## Not covered / needs human judgment

- Every case in this plan. The box the automated checks ran on has no browser, so nothing visual was confirmed. That is the whole reason the plan exists.
- `pnpm deps:check` does not pass, and this branch cannot make it pass. It reports 5 pending bumps (`@cloudflare/workers-types`, `hono`, `better-auth`, `@cloudflare/vite-plugin`), none in a package this work touched. The failure is inherited from `main`.
- `apps/web/wrangler.jsonc` deliberately has no `main`. With `output: "static"` the adapter runs assets-only, writes nothing into `dist/server`, and the build fails if `main` is set. The file's own comment and the template's `AGENTS.md` record what to add the day a page first sets `prerender = false`.
- The 500 page serving on a real server failure. No page opts out of prerendering yet, so nothing can throw at request time. TC-1.3 judges the built file instead.
- A real `wrangler deploy`. There are no Cloudflare credentials on the verification box, so only `--dry-run` ran.
- A wrong HTTP method on an unknown web path answers 405 with an empty body, not the 404 page. This is Cloudflare's static-asset behaviour and the branch does not change it. It is carried as a known follow-up on the pull request.
- Performance and concurrency. Both error pages are static files served by the asset handler, so neither dimension has a surface here.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
