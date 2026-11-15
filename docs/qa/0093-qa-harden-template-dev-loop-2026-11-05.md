# QA Plan: Harden the template dev loop, lint, web and module defaults (#306)

_Generated 2026-11-05 · against `94e0f06b` (clean) · covers the base template dev loop, the web sitemap and robots.txt, env:setup defaults, the ui `@source` guard, api CORS, admin first load, the R2 bucket test, Khudebarta errors, and the skill text_

## Summary
- The change fixes the dev loop, lint hook and env defaults in the base template, and it hardens the api, admin, storage-cloudflare and sms-khudebarta modules.
- "Working" means that a new project types, lints, tests and commits without a manual fix, and that the admin app paints a neutral background on its first load.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-306-harden-the-template-dev-loop` at `94e0f06b`.
- Playground: `.dev/playground`, with the modules admin, database-d1, storage-cloudflare and sms-khudebarta. CONTRIBUTING.md names it throwaway. `pnpm play:reset` rebuilds it.
- Admin URL: `http://localhost:3001`. API URL: `http://localhost:4000`. Web URL: `http://localhost:3000`.
- No credentials are necessary. The cases use the signed-out admin screens only.
- Screenshots: local to this run at `94e0f06b` and not committed. The names under each case match the labels in the gallery at `~/qakit/0093-qa-harden-template-dev-loop-2026-11-05/index.html`.

Launch the api from the worktree root:

```sh
cd .dev/playground/apps/api && pnpm dev
```

Launch the admin app in a second terminal:

```sh
cd .dev/playground/apps/admin && pnpm dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Admin and api running, signed out | Light background reads as neutral grey | 🟡 Normal |
| TC-1.2 | 1: Admin and api running, signed out | Dark theme is unchanged | 🟢 Low |
| TC-1.3 | 1: Admin and api running, signed out | First load shows no colour flash | 🟡 Normal |
| TC-2.1 | 2: The branch diff, no server | New skill and AGENTS.md text is correct | 🟢 Low |

## Scenario 1: Admin and api running, signed out

**Setup.** Run once, for every case in this scenario.

1. Start the two servers from **Environment**.
2. Open `http://localhost:3001` in a private browser window, so no session cookie exists.

- [ ] Setup complete

### TC-1.1: Light background reads as neutral grey  ·  🟡 Normal

**Goal.** The admin light theme uses a neutral grey background, not the old cream.

**Steps**

1. Set the theme to light. Look at the sign-in screen at a desktop width and at 375 px.
   - [ ] The page background is a neutral light grey, and the card, inputs and button read clearly on it
     - no warm or cream tint on the page background
     - the white card is distinct from the background
     - the dark "Sign in" button label is legible
     - screenshots: `admin-login-light-1440` · `admin-login-light-375`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Dark theme is unchanged  ·  🟢 Low

**Goal.** The colour change touches the light theme only.

**Steps**

1. Set the theme to dark. Look at the sign-in screen again.
   - [ ] The dark sign-in screen looks as it did before this change
     - screenshots: `admin-login-dark-1440` · `admin-login-dark-375`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: First load shows no colour flash  ·  🟡 Normal

**Goal.** The first paint is the final background colour, and the session check shows a blank screen, not a flash of content.

**Steps**

1. Open the browser DevTools. In the Network panel, tick "Disable cache" and set throttling to "Fast 4G".
2. Set the theme to light, then reload `http://localhost:3001` three times.
   - [ ] Each load paints the neutral grey background first, with no white or cream frame before it
   - [ ] The screen stays blank until the sign-in card appears, with no half-drawn layout
3. Set the theme to dark, then reload three times.
   - [ ] The same loads are clean in dark

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the two servers with Ctrl+C in each terminal.

## Scenario 2: The branch diff, no server

**Setup.** No setup is necessary.

- [ ] Setup complete

### TC-2.1: New skill and AGENTS.md text is correct  ·  🟢 Low

**Goal.** The new guidance tells an agent the right action in each case.

**Steps**

1. Read the new text in the database and auth skills.

   ```sh
   git diff 0e87d34e 94e0f06b -- modules/database/skills modules/auth/skills
   ```

   - [ ] The seed-date rule, the migration-number rule and the signed-in state section each give correct steps
2. Read the hotfix line in the base template AGENTS.md.

   ```sh
   git diff 0e87d34e 94e0f06b -- packages/cli/templates/base/AGENTS.md
   ```

   - [ ] The line says that a hotfix commit uses `fix`, and the wording is clear

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test modules/storage/files/src/define.test.ts
```

```sh
cd .dev/playground && pnpm typecheck && pnpm lint && pnpm test
```

```sh
cd .dev/playground && git commit -m "chore(admin): regenerate the route tree" -- apps/admin/src/routeTree.gen.ts
```

```sh
cd .dev/playground && echo 'hotfix(admin): x' | npx commitlint
```

```sh
curl -s -i http://localhost:3000/sitemap.xml
```

```sh
curl -s http://localhost:3000/robots.txt
```

```sh
curl -s -i -X OPTIONS http://localhost:4000/admin/auth/get-session -H 'Origin: http://localhost:3001' -H 'Access-Control-Request-Method: GET'
```

```sh
curl -s -i -X OPTIONS http://localhost:4000/admin/auth/get-session -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET'
```

- ✅ `pnpm lint` at `94e0f06b` → exit 0.
- ✅ `pnpm typecheck` at `94e0f06b` → exit 0.
- ❌ `pnpm test` at `94e0f06b`, first run → 1 failure: `modules/storage/files/src/define.test.ts` failed at file level with no failed subtest, under a load average of 14. #306 does not touch that file.
- ✅ The same file alone with the resolve hook → every subtest passes.
- ✅ `pnpm test` at `94e0f06b`, second run at a load average of 3.5 → exit 0, with no failure in any runner (1023, 94 and 535 node tests).
- ✅ The playground files match HEAD: `cmp` shows no difference for the web config, sitemap, robots.txt, ui guard, env sources, lint-staged config, admin `index.html`, admin `__root.tsx` and the Khudebarta provider.
- ✅ Playground `pnpm typecheck` and `pnpm lint` → exit 0. The web typecheck now runs `astro sync && tsc --noEmit`.
- ✅ Playground `pnpm test` → 12 files, 154 tests passed. This includes `apps/api/test/r2-bucket.test.ts`, `apps/api/src/routes/cors.test.ts`, `apps/web/src/lib/sitemap.test.ts` and `apps/web/src/lib/ui-sources.test.ts`.
- ✅ A playground commit of only `routeTree.gen.ts` → the hook passes, and commit `f90c411` lands.
- ✅ `hotfix(admin): x` → commitlint refuses it with `type-enum`, as AGENTS.md now says.
- ✅ `GET /sitemap.xml` → 200, `application/xml`, with `/`, `/privacy/` and `/terms/` under `https://example.com`, and no `404` or `500` page.
- ✅ `GET /robots.txt` → `User-agent: *`, `Allow: /`, `Sitemap: https://example.com/sitemap.xml`.
- ✅ Preflight from `http://localhost:3001` → 204, `access-control-allow-origin: http://localhost:3001`, `access-control-max-age: 7200`.
- ✅ Preflight from `https://evil.example` → 204 with no `access-control-allow-origin` header, so the browser blocks the call.
- ✅ Earlier checks on the uncommitted tree with the same file content (2026-11-04): `astro sync` beside a running `astro dev` kept all 534 `deps_ssr` files; `env:setup` filled an absent `BETTER_AUTH_URL` from the example default; the R2 test failed on `R2_BUCKET_NAME=playground-web` and named both buckets; the admin build held `_headers` with the `/assets/*` rule.

### Browser checks
_Driven with `playwright-cli` against `http://localhost:3001` at `94e0f06b`. 4 screenshots, local to this run and not committed._

- ✅ `/` signed out · redirect → `/login?redirect=%2F`.
- ✅ `/login` · preload link → `http://localhost:4000/admin/auth/get-session`, `as="fetch"`, `crossorigin="use-credentials"`.
- ✅ `/login` light theme · body background → `oklch(0.97 0 0)` at 1440 px and at 375 px.
- ✅ `/login` dark theme · body background → `oklch(0.134 0 0)`.
- ✅ `/login` · horizontal overflow → none at 1440 px and at 375 px.
- ✅ `/login` · console → no error from the app. Two 404 errors for `/favicon.ico` exist before and after this change.

## Not covered / needs human judgment
- The first-load feel (TC-1.3) needs a human eye on a throttled reload.
- The pending screen during a slow session check is not captured. It shows only while the session call is in flight.
- The `Cache-Control` rule in `_headers` takes effect only on Cloudflare Pages. No local server applies it.
- Security: the change adds no auth path. The CORS check above covers the one header that changed.
- Concurrency and performance: the change adds no shared state. The CORS max-age is the only performance change, and the preflight check covers it.
- Accessibility: the pending screen has `role="status"` and a screen-reader label. A screen-reader pass is not part of this plan.
- The base update note is not a file yet. The release that ships #306 must add it from the plan's release task.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
