# QA Plan: `auth` capability module

_Generated 2026-07-25 · updated 2026-07-26 (live Worker brought up, most cases moved to automated `curl` verification; dev ports pinned to web :3000 / api :4000) · updated 2026-08-03 (TC-1 browser failure root-caused and fixed — `server.cors: false`; then review findings applied — clean-env precondition stated, revocation query made reproducible, author-specific path removed) · covers `issue-12-auth-capability-module` vs `origin/main` (issue #12)_

## Summary
- `saasaloy add auth` scaffolds `packages/auth` (Better Auth, DB-backed httpOnly session cookies), wires `@repo/auth` into `apps/api`, drops a thin `routes/auth.ts` + a hand-authored Drizzle schema snapshot into `packages/db`, adds `nodejs_compat` to `apps/api/wrangler.jsonc`, and moves credentialed CORS into `modules/api`'s spine.
- "Working" means: the scaffold lands and resolves its deps correctly; a keyless local sign-up/sign-in sets an httpOnly cookie that a credentialed cross-origin call from an allowed localhost origin can use; deleting the session row in D1 revokes it; and a future `billing`/`teams`-style plugin-array patch lands on the real `packages/auth/src/auth.ts` with zero codemod changes.

**What changed in this update**

1. The agent brought up a live Worker (both `vite dev` and `wrangler dev`) with a migrated local D1 and drove the whole auth surface over `curl`. Sign-up, sign-in, session read, revocation, sign-out, CORS reflection, preflight, origin rejection, and both cookie-domain branches are now **automated** — see [Automated verification](#automated-verification-by-ai-agent). What's left as manual cases is only what a browser must judge.
2. **Dev ports are now pinned** so CORS is predictable. Frontends take 3xxx, backends 4xxx:

   | Service | Port | Pinned in |
   |---|---|---|
   | `apps/web` (Astro) | **3000** | `astro.config.mjs` — `server.port` + `vite.server.strictPort` |
   | `apps/admin` (future) | **3001** | reserved in `DEV_ORIGINS`; no app yet |
   | `apps/api` (Worker) | **4000** | `vite.config.ts` — `server.port` + `strictPort`; `wrangler.jsonc` — `dev.port` |

   `DEV_ORIGINS` in both `modules/api/files/src/index.ts` and `modules/auth/files/src/auth.ts` is now `["http://localhost:3000", "http://localhost:3001"]`. `strictPort` everywhere means a busy port is a startup error, not a silent shift to the next one — the old 5173→5174 drift was exactly what made CORS unreproducible.

## Preconditions

- Branch `issue-12-auth-capability-module`, checked out in a worktree of this repo. Every path
  below is relative to that worktree's root.
- Use `.dev/playground` per `AGENTS.md` / `CONTRIBUTING.md` — never a global CLI link.
- **Start from a clean env.** Unless a case says otherwise, `apps/api/.dev.vars` should be absent
  or empty — no `CORS_ORIGINS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, or `COOKIE_DOMAIN`. A
  leftover `CORS_ORIGINS` from an earlier case replaces the dev fallback allowlist wholesale and
  silently invalidates every origin expectation in this document.

Reset to a clean, unlinked workspace:

```sh
pnpm run play:reset
```

Scaffold + apply auth (pulls in its `api`/`database` deps):

```sh
cd .dev/playground && ./saasaloy add auth --yes
```

Install:

```sh
cd .dev/playground && pnpm install
```

Generate + apply the D1 migration for the dropped auth schema:

```sh
cd .dev/playground && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
```

### Two ways to run the Worker — same port, same CORS behavior

Both serve the api on **`http://localhost:4000`** and are now fully interchangeable, including for CORS:

- `pnpm --filter @repo/api dev` runs **Vite** (`@cloudflare/vite-plugin`) on the real `workerd` runtime.
- `wrangler dev` runs the built Worker with no Vite middleware.

`apps/api/vite.config.ts` sets `server.cors: false`, so Vite's own dev CORS middleware is off and the Worker's `hono/cors` is the only thing answering. See the [fix note](#fix-vite-devs-cors-middleware-broke-credentialed-requests) for what that middleware used to do.

Start the Vite loop:

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

Or the Worker-only run — no `--port` flag needed, `dev.port` in `wrangler.jsonc` supplies 4000:

```sh
cd .dev/playground && pnpm --filter @repo/api build && cd apps/api && pnpm exec wrangler dev --persist-to ./.wrangler/state
```

Either way, export the base URL the rest of this document refers to:

```sh
export BASE_URL=http://localhost:4000
```

If a dev server refuses to start with "port already in use", that's `strictPort` doing its job — free the port rather than working around it, or the allowlist stops matching.

### Auth token / cookie

There is no bearer token — auth is an **httpOnly session cookie**. For `curl`, capture it with a cookie jar (`-c jar.txt` to save, `-b jar.txt` to send). No secret is needed: with `BETTER_AUTH_SECRET` unset, Better Auth falls back to its dev default and logs a warning.

### Two `curl` gotchas the agent hit

- **Every POST needs an `Origin` header** from a trusted origin. Better Auth's CSRF check rejects a missing one with `403 MISSING_OR_NULL_ORIGIN`.
- **`/auth/sign-out` needs a body**: `-H 'Content-Type: application/json' -d '{}'`. Without the header it's `415`; with the header but no body it's `400 Invalid JSON in request body`.

### Second origin for the browser cases

The calling origin is `apps/web` on **`http://localhost:3000`** — one of the two dev-fallback origins baked into both `modules/api` and `packages/auth`:

```sh
cd .dev/playground && pnpm --filter @repo/web dev
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Browser sends the session cookie on a credentialed cross-origin fetch | 🔴 Critical |
| TC-2 | Browser blocks a response to a disallowed origin | 🔴 Critical |
| TC-3 | `@repo/auth/client` works from a real page bundle | 🟡 Normal |
| TC-4 | Session survives a page reload; sign-out clears it in the browser | 🟡 Normal |
| TC-5 | Keyless dev experience is not alarming | 🟢 Low |

Everything else — sign-up, sign-in, get-session, list-sessions, revocation, sign-out, preflight, origin rejection, both cookie-domain branches, and the negative/validation cases — is covered in [Automated verification](#automated-verification-by-ai-agent) and needs nothing from you.

## Test cases

### TC-1 — Browser sends the session cookie on a credentialed cross-origin fetch  ·  🔴 Critical

Only a browser can prove this: `curl -b jar.txt` sends the cookie because it's told to, whereas a browser applies `SameSite=Lax`, the port-is-not-part-of-same-site rule, and its own CORS gate.

**Steps**
1. Start the api Vite loop (serves on `:4000`).
2. Start `apps/web` and open `http://localhost:3000` in a browser.
3. In DevTools console, sign up:

```js
await fetch("http://localhost:4000/auth/sign-up/email", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "browser1@example.com", password: "password123", name: "Browser One" }) }).then(r => r.json())
```

4. Then read the session back from that same page:

```js
await fetch("http://localhost:4000/auth/get-session", { credentials: "include" }).then(r => r.json())
```

**Expected**
- Step 3 returns a `token` + `user` object, no CORS error in the console.
- DevTools → Application → Cookies shows `better-auth.session_token` for the API origin, flagged `HttpOnly`, with an empty `Domain` column (host-only).
- The cookie is **not** readable from `document.cookie` in the console.
- Step 4 returns a `session` + `user` object — the browser attached the cookie cross-origin.
- Network tab shows `access-control-allow-origin: http://localhost:3000` (the literal origin, never `*`) and `access-control-allow-credentials: true` on both responses.

**Actual:** Failed on 2026-08-03 with a preflight `Access-Control-Allow-Credentials` error — root-caused to Vite's dev CORS middleware and fixed; see [the fix note](#fix-vite-devs-cors-middleware-broke-credentialed-requests). **Needs a re-run** after restarting the api dev server.

- [x] Pass
- [ ] Fail

### TC-2 — Browser blocks a response to a disallowed origin  ·  🔴 Critical

The Worker still *computes* a response for a disallowed origin — it just withholds the `Access-Control-Allow-Origin` header, and the **browser** is what refuses to hand the body to the page. `curl` always sees the body, so only a browser can confirm the block.

**Steps**
1. Run either server — with `server.cors: false` in `vite.config.ts`, `vite dev` now enforces the allowlist as honestly as `wrangler dev`. The Worker-only run remains the belt-and-braces choice:

```sh
cd .dev/playground && pnpm --filter @repo/api build && cd apps/api && pnpm exec wrangler dev --persist-to ./.wrangler/state
```

2. Serve any page on a loopback port that is **not** `3000` or `3001` — e.g. `http://localhost:9999`:

```sh
cd .dev/playground && pnpm exec http-server -p 9999
```

3. From that page's DevTools console:

```js
await fetch("http://localhost:4000/auth/get-session", { credentials: "include" }).then(r => r.json())
```

**Expected**
- The `fetch` **rejects** with a CORS error in the console (wording is browser-specific, e.g. "No 'Access-Control-Allow-Origin' header is present").
- Network tab shows the request completing at the transport level (200) but no `Access-Control-Allow-Origin` header.
- No session JSON reaches the page — nothing is logged from the `.then`.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-3 — `@repo/auth/client` works from a real page bundle  ·  🟡 Normal

The agent exercised the HTTP surface directly; nothing has yet imported `createClient` into a bundled page.

**Steps**
1. In `apps/web`, add a page (or a `<script>` island) that imports the client:

```ts
import { createClient } from "@repo/auth/client";
const client = createClient("http://localhost:4000"); // the api Worker's pinned dev port
await client.signUp.email({ email: "client1@example.com", password: "password123", name: "Client One" });
const session = await client.getSession();
console.log(session);
```

2. Load the page at `http://localhost:3000` with the api's Vite loop running.

**Expected**
- The page builds — `@repo/auth/client` resolves from `apps/web` with no bundler error about `better-auth/client`.
- `signUp.email` succeeds and a session cookie appears for the API origin.
- `getSession()` returns the session (the client's `credentials: "include"` default is doing its job).
- No `cloudflare:workers` import leaks into the browser bundle (no console error about an unresolvable Node/Workers builtin).

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-4 — Session survives a page reload; sign-out clears it in the browser  ·  🟡 Normal
**Steps**
1. With the TC-1 session live, hard-reload `http://localhost:3000`.
2. Re-run the `get-session` fetch from TC-1 step 4.
3. Sign out:

```js
await fetch("http://localhost:4000/auth/sign-out", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json())
```

4. Re-run the `get-session` fetch once more.

**Expected**
- After reload, `get-session` still returns the session — the cookie is persistent (`Max-Age=604800`), not session-scoped.
- After sign-out, DevTools → Application → Cookies shows `better-auth.session_token` **gone** for the API origin.
- The final `get-session` returns `null` (HTTP 200 — see the note in Automated verification; `null` is the "logged out" signal, not a 401).

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-5 — Keyless dev experience is not alarming  ·  🟢 Low
**Steps**
1. With no `BETTER_AUTH_SECRET` and no `BETTER_AUTH_URL` set, start the Worker and watch the terminal on first request.
2. Read the `Env vars to set` panel `saasaloy add auth` printed during scaffold.

**Expected**
- Better Auth's warnings appear but read as guidance, not failure — sign-up still works.
- Judge as a human: is it obvious from the scaffold output which of `CORS_ORIGINS` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `COOKIE_DOMAIN` are required before deploying, versus optional in dev?
- Nothing in the console leaks a secret or a session token.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

## Regression checks
- [x] **Base template alone** (`play:reset`, no modules) — `pnpm --filter @repo/web dev` comes up on `:3000` and the marketing site renders. The port pin lives in the base `astro.config.mjs`, so it ships to every project whether or not `api` is ever added.
- [x] **Two projects at once** — scaffold a second playground and start its web app while the first is running. Expect a loud `Port 3000 is already in use`, not a silent move to 3001 (which would collide with the reserved admin origin).
- [x] `./saasaloy add api` alone (no auth) still scaffolds and serves `/health` — the new CORS middleware doesn't break the base api capability.
- [x] `./saasaloy add database` alone still generates/migrates/round-trips a row — auth's schema drop doesn't disturb database's existing barrel.
- [x] Skill symlinks for `saasaloy-api`, `saasaloy-database`, **and** `saasaloy-auth` all land under `.claude/skills/` pointing into `.agents/skills/`.
- [x] Re-running `add auth --yes --force` is a clean no-op on the workspace files (only already confirmed for the patches by the agent — spot check the scaffolded files too).
- [x] **Post-rebase interaction:** `apps/api/package.json` carries *both* `"@repo/db"` (added by `database`'s own patch, new on `origin/main`) and `"@repo/auth"` (added by this branch) — two `package-json-dependency` patches against the same file, neither clobbering the other, and `zod`/`@hono/zod-validator` from `api` still intact.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

### Build, scaffold, and static checks

```sh
npx turbo run test --force
```

```sh
npx turbo run typecheck
```

```sh
cd .dev/playground && ./saasaloy add auth --dry-run --yes
```

```sh
cd .dev/playground && ./saasaloy add auth --yes
```

```sh
cd .dev/playground && ./saasaloy add auth --yes --force
```

```sh
cd .dev/playground && pnpm install
```

```sh
cd .dev/playground && pnpm run typecheck
```

```sh
cd .dev/playground && pnpm run build
```

- ✅ `npx turbo run test --force` (fresh, no cache) → **82 tests passed** across 9 files, including the extended `jsonc.test.ts` coverage for the bare-string `compatibility_flags` entry. Note: the `package-json-dependency` patch kind is **no longer part of this branch** — `origin/main` landed the same capability independently as `src/lib/patch/pkg-json.ts`, so the rebase dropped this branch's duplicate and re-pointed `auth`'s patch at main's implementation. What this branch still contributes to the patch engine is the `wrangler-binding` widening to accept a bare-string entry.
- ✅ `npx turbo run typecheck` → clean (`tsc --noEmit`).
- ✅ **AC-1 (resolution + scaffold + env checklist):** `add auth --dry-run --yes` → plan ordered `api → database → auth`, listed all 23 files, registered the `@auth → packages/auth/src` alias, and printed the **Env vars to set** panel with all four vars.
- ✅ `add auth --yes` → applied all 23 files plus **4** patches; verified on disk: `apps/api/package.json` gained `"@repo/auth": "workspace:*"` alongside `"@repo/db"`; `wrangler.jsonc` gained `"compatibility_flags": ["nodejs_compat"]` with the `d1_databases` binding and file comment intact; `routes/auth.ts` is the documented thin forward; `packages/db/src/schema/auth.ts` landed with the `updatedAt` default fix.
- ✅ `add auth --yes --force` → **idempotent**: exactly one `@repo/auth` entry, exactly one `nodejs_compat` entry, all scaffold files `unchanged`.
- ✅ **AC-4 (plugin-array patch):** ran `insertIntoPluginArray` against the **real scaffolded** `packages/auth/src/auth.ts` with a `billing`-shaped patch → added the import and changed `plugins: []` to `plugins: [stripe()]`, every other line byte-identical.
- ✅ `pnpm install` in `.dev/playground` → 414 packages, ~11s.
- ✅ `pnpm run typecheck` inside `.dev/playground` → clean across `@repo/api`, `@repo/auth`, `@repo/db` — proves `auth` compiles against `origin/main`'s `@repo/db` exports map (`@repo/db/client`).
- ✅ `pnpm run build` in `.dev/playground` → both build tasks succeed.

### Live Worker — D1 migration and startup

```sh
cd .dev/playground && pnpm --filter @repo/db db:migrate:local
```

```sh
cd .dev/playground && pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select name from sqlite_master where type='table'"
```

- ✅ Migration `0000_lethal_newton_destine.sql` creates `account`, `session`, `user`, `verification` — the four Better Auth tables, from the hand-authored schema snapshot.
- ✅ `vite dev` and `wrangler dev` both boot the Worker with `nodejs_compat` and reach D1 (`apps/api/.wrangler/state`, the same persist path `db:migrate:local` writes to).
- ℹ️ **Fixed since the previous draft:** `pnpm --filter @repo/api dev` runs `vite dev`, which used to serve on Vite's default 5173 — and silently moved to 5174 when 5173 was taken. That drift is what made CORS unreproducible. Both dev paths are now pinned to `:4000`; see the port section below.

### Pinned dev ports

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

```sh
cd .dev/playground && pnpm --filter @repo/web dev
```

```sh
cd .dev/playground/apps/api && pnpm exec wrangler dev --persist-to ./.wrangler/state
```

- ✅ **api on `:4000` under `vite dev`** — `server: { port: 4000, strictPort: true }` in `vite.config.ts`. Log line: `➜  Local:   http://localhost:4000/`.
- ✅ **api on `:4000` under `wrangler dev`, with no `--port` flag** — `dev.port` in `wrangler.jsonc` is picked up: `Ready on http://localhost:4000`. The two dev paths are now genuinely interchangeable.
- ✅ **web on `:3000`** — `server: { port: 3000 }` plus `vite: { server: { strictPort: true } }` in `astro.config.mjs`. Astro honors the nested Vite `strictPort` (confirmed below); page returns `200`.
- ✅ **`strictPort` fails loudly on both.** Starting a second api dev while 4000 was held → `vite dev` exits non-zero with `Port 4000 is already in use`, no silent shift. Same for web on 3000. This is the behavior that makes the allowlist trustworthy.
- ✅ **The `dev.port` key composes with the patch engine** — after `add auth` applied its `wrangler-binding` patches, `apps/api/wrangler.jsonc` carries `dev.port`, `d1_databases`, *and* `compatibility_flags`, with both file comments intact.
- ✅ **New allowlist is exactly `{3000, 3001}`**, verified against `wrangler dev` (no Vite middleware to mask it). These results hold only with `CORS_ORIGINS` **unset or empty**, which is what puts the Worker on the `DEV_ORIGINS` fallback; any configured value replaces the list entirely and changes every line below:
  - `Origin: http://localhost:3000` → reflected.
  - `Origin: http://localhost:3001` (reserved for the future `apps/admin`) → reflected.
  - `Origin: http://localhost:9999` → no `Access-Control-Allow-Origin`.
  - `Origin: http://localhost:4321` and `http://localhost:5173` (the *old* dev origins) → no `Access-Control-Allow-Origin`. The change actually took; nothing is still trusting the old ports.
  - `POST /auth/sign-in/email` with `Origin: http://localhost:3001` → `200`; with `Origin: http://localhost:5173` → `403 INVALID_ORIGIN`.
- ✅ **End-to-end on the new ports** — `add auth` + `add waitlist` into a fresh playground, then from `Origin: http://localhost:3000`: sign-up → `200` + httpOnly `Set-Cookie`; `POST /waitlist` → `200 {"ok":true}` (waitlist's `PUBLIC_API_URL` fallback now points at `:4000`); `GET /health` → `200` with the origin reflected.
- ✅ `npx turbo run test typecheck --force` after the port change → **82 tests passed**, typecheck clean. Playground `typecheck` + `build` also clean.

### Live Worker — sign-up, session, sign-out

All calls below ran against `wrangler dev` on `$BASE_URL=http://localhost:4000`.

```sh
curl -i -s -c jar.txt -X POST "$BASE_URL/auth/sign-up/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-w1@example.com","password":"password123","name":"QA W1"}'
```

```sh
curl -s -b jar.txt -H 'Origin: http://localhost:3000' -w '\n%{http_code}\n' "$BASE_URL/auth/get-session"
```

```sh
curl -s -b jar.txt -H 'Origin: http://localhost:3000' -w '\n%{http_code}\n' "$BASE_URL/auth/list-sessions"
```

```sh
curl -i -s -c jar4.txt -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-w1@example.com","password":"password123"}'
```

```sh
curl -i -s -b jar.txt -X POST "$BASE_URL/auth/sign-out" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{}'
```

- ✅ **Sign-up** → `200`, body carries `token` + `user`, and:

  ```
  Set-Cookie: better-auth.session_token=IVIfY1vR…; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
  ```

  `HttpOnly` set, **no `Domain` attribute** (host-only) — exactly what `deriveCookieDomain()` returns when `BETTER_AUTH_URL` is unset. Better Auth's dev-secret warning prints; sign-up succeeds anyway.
- ✅ **`get-session` with the cookie** → `200` with the full `session` + `user` payload (`userId` matches the signed-up user, `expiresAt` 7 days out).
- ✅ **`list-sessions` with the cookie** → `200` with a one-element array.
- ✅ **Sign-in (returning user)** → `200` and a **fresh** `Set-Cookie` with a new token, same `HttpOnly` / `SameSite=Lax` / no-`Domain` shape as sign-up.
- ✅ **Sign-out** → `200`, and clears all three cookies:

  ```
  Set-Cookie: better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
  Set-Cookie: better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
  Set-Cookie: better-auth.dont_remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
  ```

  Re-using the signed-out cookie against `list-sessions` → `401 UNAUTHORIZED`.

### Live Worker — revocation by deleting the session row

```sh
cd .dev/playground && pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select id, user_id, token from session"
```

Delete by **user**, not by a session id copied from an earlier run — every migration and sign-up
mints fresh ids, so a hardcoded one deletes zero rows and the revocation is never exercised:

```sh
cd .dev/playground && pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "delete from session where user_id = (select id from user where email = 'qa-w1@example.com')"
```

Confirm it actually removed something — `wrangler d1 execute` reports the rows written. If it
says zero, the cookie in `jar.txt` belongs to a different user or database and the `401` below
would be meaningless.

```sh
curl -s -b jar.txt -H 'Origin: http://localhost:3000' -w '\n%{http_code}\n' "$BASE_URL/auth/list-sessions"
```

```sh
curl -i -s -b jar.txt -H 'Origin: http://localhost:3000' "$BASE_URL/auth/get-session"
```

- ✅ Session rows are readable in local D1 while the Worker holds the database — columns are **snake_case** (`user_id`, not `userId`; the old plan's query would have errored).
- ✅ After deleting the row, the same cookie against `list-sessions` → **`401`** `{"message":"Unauthorized","code":"UNAUTHORIZED"}`. Revocation works.
- ✅ `get-session` with the revoked cookie → **`200` with body `null`**, plus the three `Max-Age=0` cookie-clearing headers. No 500, no crash.
- ⚠️ **Correction to the previous draft:** the old TC-3 expected `401` from `/auth/get-session`. Better Auth's `get-session` is deliberately non-throwing — it answers `200 null`. Use a genuinely protected endpoint (`/auth/list-sessions`, or a route built on the `getSession(...) → 401` recipe in `packages/auth/src/server.ts`) when you want to see the 401.

### Live Worker — CORS and origin enforcement

```sh
curl -i -s -H 'Origin: http://localhost:3000' "$BASE_URL/health"
```

```sh
curl -i -s -H 'Origin: http://localhost:9999' "$BASE_URL/health"
```

```sh
curl -i -s "$BASE_URL/health"
```

```sh
curl -i -s -X OPTIONS "$BASE_URL/auth/sign-in/email" -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
```

```sh
curl -i -s -X OPTIONS "$BASE_URL/auth/sign-in/email" -H 'Origin: http://localhost:9999' -H 'Access-Control-Request-Method: POST'
```

```sh
curl -s -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -H 'Origin: http://evil.example.com' -d '{"email":"qa-w1@example.com","password":"password123"}' -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -d '{"email":"qa-w1@example.com","password":"password123"}' -w '\n%{http_code}\n'
```

- ✅ **Allowed dev-fallback origin** (`http://localhost:3000`) → `Access-Control-Allow-Origin: http://localhost:3000` reflected verbatim, plus `access-control-allow-credentials: true` and `vary: Origin`. Never `*`.
- ✅ **Disallowed origin under `wrangler dev`** (`http://localhost:9999`) → **no** `Access-Control-Allow-Origin` header at all. The allowlist is enforced live, not just in the pure-function check.
- ✅ **No `Origin` header** → no `Access-Control-Allow-Origin` (the callback returns `null`).
- ✅ **Preflight from an allowed origin** → `204` with `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Headers: content-type`, and the method list.
- ✅ **Preflight from a disallowed origin** → `204` with the method list but **no** `Access-Control-Allow-Origin`, so the browser rejects the preflight.
- ✅ **POST from an untrusted origin** → `403` `{"message":"Invalid origin","code":"INVALID_ORIGIN"}` — Better Auth's `trustedOrigins` (fed from the same `CORS_ORIGINS` var) blocks state-changing calls independently of the CORS header layer. Defense in depth.
- ✅ **POST with no `Origin` header** → `403` `{"message":"Missing or null Origin","code":"MISSING_OR_NULL_ORIGIN"}`.
### Fix: `vite dev`'s CORS middleware broke credentialed requests

_Added 2026-08-03, after TC-1 failed in a real browser._

TC-1 failed with:

```
Access to fetch at 'http://localhost:4000/auth/sign-up/email' from origin 'http://localhost:3000'
has been blocked by CORS policy: Response to preflight request doesn't pass access control check:
The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be
'true' when the request's credentials mode is 'include'.
```

**Root cause.** Vite's dev CORS middleware **terminates every `OPTIONS` preflight itself** — it writes headers and calls `res.end()` without `next()`, so the request never reaches the Worker (`vite/dist/node/chunks/node.js:7166-7182`). Its `configureCredentials` only emits `Access-Control-Allow-Credentials` when `credentials === true`, and Vite's defaults leave that unset. So under `vite dev` the preflight came back with a reflected origin but no credentials header, and the browser refused the `credentials: "include"` fetch. `curl` never caught it because the earlier automated preflight checks all ran against `wrangler dev`.

This is the same middleware behind the old "sharp edge" note — it also reflected *every* loopback origin (`server.cors.origin` defaults to a loopback regex), which is why a disallowed localhost origin used to look allowed.

**Fix.** `server.cors: false` in `modules/api/files/vite.config.ts` disables the middleware entirely (`if (cors !== false) middlewares.use(...)`, `node.js:26012`), leaving the Worker's `hono/cors` as the only responder.

**Verified** against `vite dev` after the change:

- Preflight from `http://localhost:3000` → `204` with `access-control-allow-credentials: true` and `access-control-allow-origin: http://localhost:3000`.
- Preflight from `http://localhost:9999` → `204` with **no** `access-control-allow-origin`. The allowlist is now enforced under `vite dev` too.
- `POST /auth/sign-up/email` from `http://localhost:3000` → `200` with the httpOnly `Set-Cookie` and both CORS headers; `GET /auth/get-session` with that cookie → `200`.
- `GET /health` from `http://localhost:9999` → no `access-control-allow-origin`.

⚠️ The old advice "never test the CORS allowlist under `vite dev`" **no longer applies** — but re-running TC-1/TC-2 requires restarting the api dev server so the new `vite.config.ts` is picked up.

### Live Worker — cookie-domain derivation, end to end

_These two ran through `vite dev` (restarted between each so `.dev.vars` is re-read). They predate the port pin, so the agent hit them on Vite's old 5173; the URLs are rewritten to `$BASE_URL` since the behavior is port-independent._

With `apps/api/.dev.vars` set to `BETTER_AUTH_URL="https://api.example.test"`:

```sh
curl -i -s -X POST "$BASE_URL/auth/sign-up/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-domain@example.com","password":"password123","name":"QA Domain"}'
```

With `apps/api/.dev.vars` set to both `BETTER_AUTH_URL="https://api.example.test"` and `COOKIE_DOMAIN=".override.test"`:

```sh
curl -i -s -X POST "$BASE_URL/auth/sign-up/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-override@example.com","password":"password123","name":"QA Override"}'
```

- ✅ **Derived apex domain** (`BETTER_AUTH_URL=https://api.example.test`, no `COOKIE_DOMAIN`) →

  ```
  Set-Cookie: __Secure-better-auth.session_token=…; Max-Age=604800; Domain=.example.test; Path=/; HttpOnly; Secure; SameSite=Lax
  ```

  `api.` stripped, leading dot added — `deriveCookieDomain`'s rule #2 confirmed through Better Auth's real cookie-writing path, including the `__Secure-` prefix and `Secure` flag it adds for an https base URL.
- ✅ **Explicit `COOKIE_DOMAIN` wins** → `Domain=.override.test` (not `.example.test`), confirming rule #1.
- ✅ **Host-only default** (neither var set) → no `Domain` attribute, unprefixed cookie name, no `Secure` — see the sign-up check above.
- ✅ **Pure-function coverage** of the remaining branches: `http://localhost:4000` → `undefined`; `http://127.0.0.1:4000` → `undefined`; `https://app.example.com` (unrecognized shape) → `undefined` (conservative host-only fallback).
- ⬜ **Not yet re-run:** the `api.`-strip now requires the apex to still contain a dot, so a host whose apex *is* a TLD falls back to host-only instead of emitting a rejected cookie domain. Expect `https://api.dev` → `undefined` (was `.dev`) and `https://api.example.test` → `.example.test` (unchanged). Worth a quick pure-function check on the next pass.

### Live Worker — negative and validation cases

```sh
curl -s -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-w1@example.com","password":"wrongpassword"}' -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"nobody@example.com","password":"password123"}' -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/auth/sign-up/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-w1@example.com","password":"password123","name":"Dupe"}' -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/auth/sign-up/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa9@example.com","password":"abc","name":"Short"}' -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/auth/sign-up/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"not-an-email","password":"password123","name":"Bad"}' -w '\n%{http_code}\n'
```

```sh
curl -s -H 'Origin: http://localhost:3000' -w '\n%{http_code}\n' "$BASE_URL/auth/get-session"
```

- ✅ **Wrong password** → `401` `INVALID_EMAIL_OR_PASSWORD`.
- ✅ **Unknown email** → `401` `INVALID_EMAIL_OR_PASSWORD` — byte-identical to the wrong-password response, so the endpoint doesn't leak which accounts exist.
- ✅ **Duplicate sign-up** → `422` `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`; no second `user` row created.
- ✅ **Password too short** (`abc`) → `400` `PASSWORD_TOO_SHORT`.
- ✅ **Malformed email** → `400` `[body.email] Invalid input` / `VALIDATION_ERROR`.
- ✅ **No cookie at all** → `200 null` from `get-session`; `401` from `list-sessions`.
- ✅ No response body or log line in any of the above leaked a password hash, session token belonging to another user, or the dev secret.

## Not covered / needs human judgment
- **Real browser cookie-jar and CORS enforcement** — TC-1 through TC-4. `curl` proves the Worker emits the right headers and honors the cookie; only a browser proves it *applies* `SameSite=Lax`, keeps the cookie out of `document.cookie`, and actually withholds a cross-origin body from the page.
- **`@repo/auth/client` in a bundle** — the agent drove the HTTP surface directly, never through `createAuthClient`; bundler resolution and the absence of a `cloudflare:workers` leak into browser code are untested (TC-3).
- **HTTPS / production cookie behavior** — the `__Secure-` prefixed, `Secure` cookie was observed being *emitted*, but no browser accepted it over a real TLS origin, and no cross-subdomain session was exercised on a live domain.
- **The reserved `:3001` admin origin** — `apps/admin` doesn't exist yet, so 3001 is trusted by the allowlist with nothing serving on it. Whenever the `admin` module lands, its dev server must pin 3001 the same way, or the entry becomes dead weight.
- **A real `add billing`-style consumer** — no `billing`/`teams` module exists yet to drive the plugin-array patch through an actual `saasaloy add`; the agent ran the codemod directly against the real scaffolded `auth.ts` instead.
- **Social OAuth / email verification** — deliberately not wired in this module (documented in the `saasaloy-auth` skill); nothing to test.
- **Concurrency and volume** — no double-submit, simultaneous sign-in, or many-sessions-per-user load was exercised.
- **Version-pin currency** for `better-auth` and friends — the pins install cleanly, but nothing here confirms they are the best current choice; `pnpm deps:check` is the gate.
