# QA Plan: Return to the requested route after sign-in

_Generated 2026-08-31 · against `71cf27f` · covers issue #100, the admin app's login redirect_

## Summary

- The admin guard records the route an anonymous visitor asked for, and the login screen sends the visitor there after sign-in.
- Working means a guarded deep link survives the login hop, a direct `/login` sign-in still lands on `/`, and a hostile `redirect` value falls back to `/`.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-100-return-to-the-requested-route-after-sign-in`, commit `71cf27f`.
- Repo root: `/home/dev/worktrees/saasaloy/issue-100-return-to-the-requested-route-after-sign-in`.
- Sandbox: `.dev/playground`. It already exists. `apps/admin` is added, installed and built. Do not rescaffold it and do not run `pnpm run play:init` again.
- Base URLs: admin SPA on `http://localhost:3001`, api Worker on `http://localhost:4000`. Both ports are fixed. The api CORS allowlist and `trustedOrigins` name `http://localhost:3001`, so the ports must not drift.
- Browser: any modern desktop browser. This plan needs a real address bar.
- No feature flag guards this change.

### E1. Add a deep-link destination

The sandbox route tree holds only `/` and `/login`. Without a third route there is no non-trivial destination to test. Create `.dev/playground/apps/admin/src/routes/users.tsx` with this content.

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/users")({
  component: () => <main className="p-8">Users screen</main>,
});
```

The router plugin rewrites `src/routeTree.gen.ts` when the dev server starts. Delete this file after the run.

### E2. Give the api its secrets

```sh
cp .dev/playground/apps/api/.dev.vars.example .dev/playground/apps/api/.dev.vars
```

Set `BETTER_AUTH_SECRET` to any non-empty string and leave the rest at their defaults.

### E3. Create the local database

```sh
cd .dev/playground && pnpm --filter @repo/db db:migrate:local
```

### E4. Start both apps

```sh
cd .dev/playground && pnpm dev
```

Turbo starts the api on `:4000` and the admin SPA on `:3001`.

### E5. Create two accounts

The admin app has no sign-up screen by design. Create both users through the api.

```sh
curl -i -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"qa-password-1","name":"QA Admin"}'
```

```sh
curl -i -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -d '{"email":"plain@example.com","password":"qa-password-1","name":"QA Plain"}'
```

### E6. Promote one account to admin

```sh
cd .dev/playground && pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "update user set role = 'admin' where email = 'admin@example.com'"
```

Confirm the roles.

```sh
cd .dev/playground && pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select email, role from user"
```

`admin@example.com` must read `admin`. `plain@example.com` must read `user`.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Signed out, admin account ready | Deep link records the path and sign-in returns to it | 🔴 Critical |
| TC-1.2 | 1: Signed out, admin account ready | Direct `/login` sign-in lands on `/` | 🔴 Critical |
| TC-1.3 | 1: Signed out, admin account ready | A hostile or unknown destination falls back to `/` | 🔴 Critical |
| TC-1.4 | 1: Signed out, admin account ready | A rejected password keeps the destination | 🟡 Normal |
| TC-2.1 | 2: Signed in as admin | The guard still moves an admin off `/login` | 🔴 Critical |
| TC-3.1 | 3: Signed in as non-admin | A non-admin still reaches AccessDenied | 🔴 Critical |

## Scenario 1: Signed out, admin account ready

**Setup.** Run once, for every case in this scenario.

1. Open the browser.
2. Clear the site data for `http://localhost:3001` and `http://localhost:4000`, or open a private window.
3. Open `http://localhost:3001/`. The app must show the login screen.

- [ ] Setup complete

Every case below ends with a sign-out step, so the next case starts from the same state.

### TC-1.1: Deep link records the path and sign-in returns to it · 🔴 Critical

**Goal.** An anonymous visitor who asks for `/users?page=2#row-3` reaches that exact URL after sign-in.

**Steps**

1. Paste `http://localhost:3001/users?page=2#row-3` in the address bar. Press Enter.
   - [ ] The app shows the login screen, and the address bar reads `/login?redirect=%2Fusers%3Fpage%3D2%23row-3`
     - the path is `/login`
     - the `redirect` value is percent-encoded
     - the encoded value carries the search `?page=2` and the hash `#row-3`
2. Enter `admin@example.com` and `qa-password-1`. Click Sign in.
   - [ ] The app lands on `/users?page=2#row-3`, with the search and the hash intact
   - [ ] The "Users screen" text renders, and no error text appears
3. Sign out from the shell.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Direct `/login` sign-in lands on `/` · 🔴 Critical

**Goal.** With no `redirect` param, sign-in uses the default destination `/`.

**Steps**

1. Paste `http://localhost:3001/login` in the address bar. Press Enter.
   - [ ] The address bar keeps the bare `/login`, with no query string
2. Enter `admin@example.com` and `qa-password-1`. Click Sign in.
   - [ ] The app lands on `/`, and the admin shell renders
3. Sign out from the shell.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A hostile or unknown destination falls back to `/` · 🔴 Critical

**Goal.** A `redirect` value from the address bar cannot send the visitor off this origin, and cannot name a route that does not exist.

**Steps**

1. Paste `http://localhost:3001/login?redirect=https://evil.example` in the address bar. Press Enter.
   - [ ] The login screen renders, and the app drops the `redirect` param from the address bar
2. Enter `admin@example.com` and `qa-password-1`. Click Sign in.
   - [ ] The app lands on `http://localhost:3001/`, and the browser never leaves this origin
3. Sign out. Repeat steps 1 and 2 for each value below. Use the value exactly as written.
   - `http://localhost:3001/login?redirect=//evil.example/x`
   - `http://localhost:3001/login?redirect=/\evil.example`
   - `http://localhost:3001/login?redirect=/nope`
   - `http://localhost:3001/login?redirect=/login`
   - [ ] Every value lands on `http://localhost:3001/` after sign-in
   - [ ] No value produces a second hop back to the login screen, and no value produces a redirect loop
4. Sign out from the shell.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: A rejected password keeps the destination · 🟡 Normal

**Goal.** A failed sign-in attempt does not lose the recorded destination.

**Steps**

1. Paste `http://localhost:3001/users?page=2#row-3` in the address bar. Press Enter.
2. Enter `admin@example.com` and the wrong password `nope`. Click Sign in.
   - [ ] The screen shows one error message, and the address bar still carries the `redirect` param
3. Enter the correct password `qa-password-1`. Click Sign in.
   - [ ] The app lands on `/users?page=2#row-3`
4. Sign out from the shell.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Sign out, then clear the site data for `http://localhost:3001`.

## Scenario 2: Signed in as admin

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login`.
2. Sign in as `admin@example.com` / `qa-password-1`.
3. Confirm the admin shell renders at `/`.

- [ ] Setup complete

### TC-2.1: The guard still moves an admin off `/login` · 🔴 Critical

**Goal.** The change does not break the signed-in admin's login-page redirect.

**Steps**

1. Paste `http://localhost:3001/login` in the address bar. Press Enter.
   - [ ] The app redirects to `/`, and the login form never renders
2. Paste `http://localhost:3001/login?redirect=/users` in the address bar. Press Enter.
   - [ ] The app still redirects to `/`, and the `redirect` param does not move the signed-in admin
3. Paste `http://localhost:3001/users?page=2#row-3` in the address bar. Press Enter.
   - [ ] The app opens the Users screen directly, with no login hop

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Sign out, then clear the site data for `http://localhost:3001`.

## Scenario 3: Signed in as non-admin

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login`.
2. Sign in as `plain@example.com` / `qa-password-1`.

- [ ] Setup complete

### TC-3.1: A non-admin still reaches AccessDenied · 🔴 Critical

**Goal.** The role check still runs before the login-page redirect, so a non-admin sees AccessDenied and never the shell.

**Steps**

1. Read the screen after the sign-in in Setup.
   - [ ] The AccessDenied panel renders, and no admin screen content appears
2. Paste `http://localhost:3001/login` in the address bar. Press Enter.
   - [ ] The AccessDenied panel renders again, and the app does not redirect to `/`
3. Paste `http://localhost:3001/users?page=2#row-3` in the address bar. Press Enter.
   - [ ] The AccessDenied panel renders, and the Users screen never appears

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Sign out. Stop `pnpm dev`. Delete `.dev/playground/apps/admin/src/routes/users.tsx` and let the router plugin rewrite `routeTree.gen.ts`.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
git show 71cf27f -- modules/admin/files/src/routes/__root.tsx
```

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm typecheck
```

```sh
cd .dev/playground && pnpm --filter @repo/admin build
```

```sh
cd .dev/playground && pnpm --filter @repo/admin typecheck
```

```sh
diff modules/admin/files/src/lib/redirect.ts .dev/playground/apps/admin/src/lib/redirect.ts
```

Results, 7 checks and 6 probes, all agent-confirmable halves green:

- ✅ C1, the guard records the path → the diff shows `throw redirect({ to: LOGIN_PATH, search: { redirect: location.href } })`. A router probe built the URL `"/login?redirect=%2Fusers%3Fpage%3D2%23row-3"`.
- ✅ C2, sign-in uses the requested path → `pnpm test` passes the `resolveDestination` suite. A probe showed `buildLocation({ href: "/users?page=2#row-3" })` gives pathname `/users`, search `{page: 2}`, hash `row-3`.
- ✅ C3, no param falls back to `/` → the test `falls back when there is no destination at all` passes, and an absent query key parses to `search.redirect === undefined`.
- ✅ C4a, off-origin shapes are refused → the 8 `toInternalPath` tests pass. A probe pushed `//evil.example/x`, `/\evil.example` and `https://evil.example` through the shipped `validateSearch` and each one produced an empty search object.
- ✅ C4b, the route tree gates the destination → a probe on `@tanstack/react-router` 1.170.32 with `router-core` 1.171.27 returned `undefined` for `getMatchedRoutes("/nope")[2]`, and a defined route for `/`, `/users`, `/users/42` and `/login`. `resolveDestination` refuses `/login` at its own gate.
- ✅ C5, the repo gates → `pnpm lint` exit 0, `pnpm test` exit 0 with `tests 51 / pass 51 / fail 0`, `pnpm typecheck` exit 0, sandbox `@repo/admin build` exit 0.
- ✅ C6, the guard order → `__root.tsx` still runs the anonymous early return, then the recorded redirect, then the `isAdmin` throw, then the signed-in-admin redirect to `/`. The diff inserts no line between the role check and the login-page redirect.
- ✅ C7, the helper ships → `diff` reports `redirect.ts` identical in the module and the sandbox, and `redirect.test.ts` is absent from the sandbox, which matches the descriptor.
- ✅ Probe P5, a repeated query key → `?redirect=/a&redirect=/b` parses to an array, and `toInternalPath` drops it. An object is dropped too, so no string coercion path exists.
- ❌ `pnpm --filter @repo/admin typecheck` in the sandbox exits 1 with two errors, both in `apps/api/src/index.ts` at lines 119 and 145, `Argument of type 'Bindings' is not assignable to parameter of type 'LoggerEnv'`. Both are pre-existing on `main` and neither is in `apps/admin`.

## Not covered / needs human judgment

- Every browser check. The build box has no browser, so C1, C2, C3 and C6 keep the human halves this plan covers.
- The sign-in call itself. `auth.signIn`, `forgetSession()` and `router.invalidate()` were never exercised, because no api was running.
- A prefix match on a param route. `getMatchedRoutes` matches a prefix, so `/users/42/extra` resolves to `/users/$userId` and passes the second gate. The visitor stays on this origin and lands on the router's not-found handling. Review finding N1 records this as a nit, not a blocker. The sandbox has no param route, so this plan does not test it.
- A router-version regression. No repo test drives the real `getMatchedRoutes(...)[2]` idiom; the suite injects a hand-written predicate. Review finding N2 records it.
- The trailing-slash destination `/login/`. Nobody probed it. The worst case is one extra hop back to `/`.
- Cross-browser handling of `/\evil.example`. TC-1.3 covers one browser only. Run it in a second browser if you have one.
- Accessibility, responsive layout, dark mode and performance. This change adds no new UI; it only changes where a navigation ends.
- Concurrency. The change has no shared state and no retry path.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
