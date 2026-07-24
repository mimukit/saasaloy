# QA Plan: `auth` capability module

_Generated 2026-07-25 · re-verified 2026-07-26 after rebasing onto `origin/main` · covers the 5 commits on `issue-12-auth-capability-module` vs `origin/main` (issue #12)_

## Summary
- `saasaloy add auth` scaffolds `packages/auth` (Better Auth, DB-backed httpOnly session cookies), wires `@repo/auth` into `apps/api`, drops a thin `routes/auth.ts` + a hand-authored Drizzle schema snapshot into `packages/db`, adds `nodejs_compat` to `apps/api/wrangler.jsonc`, and moves credentialed CORS into `modules/api`'s spine.
- "Working" means: the scaffold lands and resolves its deps correctly; a keyless local sign-up/sign-in sets an httpOnly cookie that a credentialed cross-origin call from an allowed localhost origin can use; deleting the session row in D1 revokes it (401); and a future `billing`/`teams`-style plugin-array patch lands on the real `packages/auth/src/auth.ts` with zero codemod changes.

## Preconditions
- Branch `issue-12-auth-capability-module`, worktree at `/Users/mukit/orca/workspaces/saasaloy/issue-12-auth-capability-module`.
- Use `.dev/playground` per `AGENTS.md` / `CONTRIBUTING.md` — never a global CLI link.
- The agent already ran `add auth` once into `.dev/playground` for the automated checks below (see **Automated verification**). Reset first so you start from a clean, unlinked workspace:

```sh
pnpm run play:reset
```

- Scaffold + apply auth (and its `api`/`database` deps) fresh:

```sh
cd .dev/playground
./saasaloy add auth --yes
```

- Install deps, then a real Cloudflare dev loop (D1 + Workers) for the manual cases:

```sh
pnpm install
```

- Apply the D1 migration for the dropped auth schema, then start the Worker:

```sh
pnpm --filter @repo/db db:generate
pnpm --filter @repo/db db:migrate:local
pnpm --filter @repo/api dev
```

- For the cross-origin cases, also run a second local origin to call from — e.g. `apps/web` (Astro, `http://localhost:4321`) or any static page served on one of the two dev-fallback origins baked into both `modules/api` and `packages/auth`: `http://localhost:4321`, `http://localhost:5173`.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Keyless sign-up sets an httpOnly session cookie | 🔴 Critical |
| TC-2 | Credentialed cross-origin call from an allowed localhost origin succeeds | 🔴 Critical |
| TC-3 | Revocation: deleting the session row makes the next authed call 401 | 🔴 Critical |
| TC-4 | A disallowed origin is rejected, not silently allowed | 🟡 Normal |
| TC-5 | Explicit `COOKIE_DOMAIN` produces a real cross-subdomain `Set-Cookie` | 🟡 Normal |
| TC-6 | `api.`-prefixed `BETTER_AUTH_URL` derives the apex cookie domain end-to-end | 🟡 Normal |
| TC-7 | Sign-in (returning user) also sets a fresh session cookie | 🟢 Low |

## Test cases

### TC-1 — Keyless sign-up sets an httpOnly session cookie  ·  🔴 Critical
**Steps**
1. With the Worker running (`pnpm --filter @repo/api dev`) and no `BETTER_AUTH_SECRET` set (keyless dev default), sign up a new user from a browser or client using `@repo/auth/client`:

```ts
import { createClient } from "@repo/auth/client";
const client = createClient("http://localhost:8787"); // your wrangler dev port
await client.signUp.email({ email: "a@b.com", password: "password123", name: "A" });
```

2. Inspect the response's `Set-Cookie` header (browser DevTools → Network → the `/auth/sign-up/email` request, or `curl -i`).

**Expected**
- A `Set-Cookie` header is present with `HttpOnly` set.
- No `Domain` attribute (host-only) — `BETTER_AUTH_URL` is unset or `localhost`, so `deriveCookieDomain` returns `undefined`.
- The console prints Better Auth's dev-secret warning (no `BETTER_AUTH_SECRET` set) but sign-up still succeeds.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Credentialed cross-origin call from an allowed localhost origin succeeds  ·  🔴 Critical
**Steps**
1. From a page served on `http://localhost:4321` (or `:5173`) — a different origin/port than the API Worker — call a session-protected route with credentials:

```ts
fetch("http://localhost:8787/auth/get-session", { credentials: "include" });
```

2. Confirm the cookie set in TC-1 rides along and the call succeeds.

**Expected**
- The browser sends the cookie cross-origin (no CORS error in the console).
- The response's `Access-Control-Allow-Origin` header echoes back `http://localhost:4321` (or `:5173`) exactly — never `*`.
- `Access-Control-Allow-Credentials: true` is present.
- The call returns the active session (200), not a CORS rejection.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Revocation: deleting the session row makes the next authed call 401  ·  🔴 Critical
**Steps**
1. With a valid session cookie from TC-1, confirm an authed call succeeds first (e.g. `GET /auth/get-session` or any route using `getSession`).
2. Find and delete the session row in local D1:

```sh
pnpm --filter @repo/db exec wrangler d1 execute app-db --local --config ../../apps/api/wrangler.jsonc --command "select id from session"
pnpm --filter @repo/db exec wrangler d1 execute app-db --local --config ../../apps/api/wrangler.jsonc --command "delete from session where id = '<id-from-above>'"
```

3. Repeat the same authed call with the same (now-stale) cookie.

**Expected**
- Step 1's call succeeds (200 / valid session payload).
- After the delete, the same cookie yields `401` — `getSession` returns `null` and the route (or Better Auth's own `get-session` endpoint) reports unauthenticated.
- No server error/crash — a missing session row is a normal "logged out" state, not an exception.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — A disallowed origin is rejected, not silently allowed  ·  🟡 Normal
**Steps**
1. From a page served on an origin **not** in `CORS_ORIGINS` / the dev fallback (e.g. `http://localhost:9999`), repeat TC-2's credentialed fetch against the running Worker.

**Expected**
- The browser blocks the response as a CORS failure (no `Access-Control-Allow-Origin` header echoing that origin).
- The Worker does not set the cookie for / does not leak session data to this origin.
- This confirms the allowlist is enforced live, not just in the pure-function check the agent already ran (see Automated verification).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Explicit `COOKIE_DOMAIN` produces a real cross-subdomain `Set-Cookie`  ·  🟡 Normal
**Steps**
1. Set `COOKIE_DOMAIN=.example.test` and `BETTER_AUTH_URL=https://api.example.test` as Worker vars (e.g. in `.dev.vars` or `wrangler dev --var`), restart the Worker.
2. Repeat TC-1's sign-up and inspect `Set-Cookie`.

**Expected**
- `Set-Cookie` includes `Domain=.example.test`.
- Better Auth's `advanced.crossSubDomainCookies.enabled: true` path is active — i.e. the explicit `COOKIE_DOMAIN` wins over derivation, matching `deriveCookieDomain`'s documented rule #1.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — `api.`-prefixed `BETTER_AUTH_URL` derives the apex cookie domain end-to-end  ·  🟡 Normal
**Steps**
1. Unset `COOKIE_DOMAIN`, set `BETTER_AUTH_URL=https://api.example.test` only, restart the Worker.
2. Repeat TC-1's sign-up and inspect `Set-Cookie`.

**Expected**
- `Set-Cookie` includes `Domain=.example.test` (derived: `api.` stripped, leading dot added) — matching the agent's pure-function verification of `deriveCookieDomain`, now confirmed through Better Auth's actual cookie-writing path.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Sign-in (returning user) also sets a fresh session cookie  ·  🟢 Low
**Steps**
1. Using the user created in TC-1, sign out (clear cookies) and sign in again:

```ts
await client.signIn.email({ email: "a@b.com", password: "password123" });
```

**Expected**
- A new `Set-Cookie` is issued (new session row in `session` table).
- Same httpOnly / domain behavior as TC-1's sign-up.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `./saasaloy add api` alone (no auth) still scaffolds and serves `/health` — the new CORS middleware doesn't break the base api capability.
- [ ] `./saasaloy add database` alone still generates/migrates/round-trips a row — auth's schema drop doesn't disturb database's existing barrel.
- [ ] Skill symlinks for `saasaloy-api`, `saasaloy-database`, **and** `saasaloy-auth` all land under `.claude/skills/` pointing into `.agents/skills/`.
- [ ] Re-running `add auth --yes --force` is a clean no-op on the workspace files (only already confirmed for the two patches by the agent — spot check the scaffolded files too).
- [ ] **Post-rebase interaction:** `apps/api/package.json` carries *both* `"@repo/db"` (added by `database`'s own patch, new on `origin/main`) and `"@repo/auth"` (added by this branch) — two `package-json-dependency` patches against the same file, neither clobbering the other, and `zod`/`@hono/zod-validator` from `api` still intact.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
npx turbo run test --force
```

```sh
npx turbo run typecheck
```

```sh
pnpm run play:reset
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

- ✅ `npx turbo run test --force` (fresh, no cache) → **82 tests passed** across 9 files, including the extended `jsonc.test.ts` coverage for the bare-string `compatibility_flags` entry. Note: the `package-json-dependency` patch kind is **no longer part of this branch** — `origin/main` landed the same capability independently as `src/lib/patch/pkg-json.ts` (with a richer `section`/`name`/`range` payload covering all four dependency maps), so the rebase dropped this branch's duplicate `package-json.ts` and re-pointed `auth`'s patch at main's implementation. What this branch still contributes to the patch engine is the `wrangler-binding` widening to accept a bare-string entry (needed for `compatibility_flags`).
- ✅ `npx turbo run typecheck` → clean (`tsc --noEmit`).
- ✅ **AC-1 (resolution + scaffold + env checklist):** `add auth --dry-run --yes` in a fresh playground → plan correctly ordered `api → database → auth`, listed all 23 files (`packages/auth/{package.json,tsconfig.json,src/{auth,server,client}.ts}`, `apps/api/src/routes/auth.ts`, `packages/db/src/schema/auth.ts`, 3 SKILL.md files), registered the `@auth → packages/auth/src` alias, and printed the **Env vars to set** panel with all four vars (`CORS_ORIGINS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN`) and their descriptions.
- ✅ `add auth --yes` (real apply, re-run post-rebase) → applied all 23 files plus **4** patches; verified on disk:
  - `apps/api/package.json` gained `"@repo/auth": "workspace:*"` in `dependencies` (review item confirmed — real `add auth`, not just a unit test), alongside the `"@repo/db": "workspace:*"` entry `database`'s own patch now adds (new on `origin/main`) and the `zod`/`@hono/zod-validator` deps `api` now ships. The two `package-json-dependency` patches against the same file compose cleanly — hence 4 patches, up from 3 pre-rebase.
  - `apps/api/wrangler.jsonc` gained `"compatibility_flags": ["nodejs_compat"]`, with the existing `d1_databases` binding and file comment left intact (review item confirmed).
  - `apps/api/src/routes/auth.ts` is the documented thin forward (`auth.handler(c.req.raw)`, no `better-auth` import).
  - `packages/db/src/schema/auth.ts` landed with `user`/`session`/`account`/`verification` tables, including the `updatedAt` default fix from commit `30fbaf3`.
- ✅ `add auth --yes --force` (re-apply) → **idempotent**: `apps/api/package.json`'s `dependencies` block still has exactly one `@repo/auth` entry, `wrangler.jsonc`'s `compatibility_flags` still has exactly one `nodejs_compat` entry (`grep -c` → 1), all scaffold files reported `unchanged`.
- ✅ **AC-4 (plugin-array patch against a dry-run fixture):** ran `insertIntoPluginArray` from `packages/cli/src/lib/patch/ts-module.ts` directly against the **real scaffolded** `packages/auth/src/auth.ts` (not the synthetic unit-test fixture) with a `billing`-shaped patch (`{ exportName: "auth", arrayProp: "plugins", call: "stripe", import: { name: "stripe", from: "@better-auth/stripe" } }`) → output added `import { stripe } from "@better-auth/stripe";` and changed `plugins: []` to `plugins: [stripe()]`, leaving every other line (including the `cookieDomain`/`trustedOrigins` logic and comments) byte-identical. Confirms the codemod works against the module's actual shape, with zero codemod changes needed.
- ✅ **Cookie-domain derivation** (review item): extracted `deriveCookieDomain`'s logic and ran it against all four documented cases:
  - `BETTER_AUTH_URL=http://localhost:8787` → `undefined` (host-only) ✅
  - `BETTER_AUTH_URL=http://127.0.0.1:8787` → `undefined` (host-only) ✅
  - `BETTER_AUTH_URL=https://api.example.com` → `.example.com` (apex, `api.`-prefix stripped) ✅
  - `BETTER_AUTH_URL=https://app.example.com` (unrecognized shape) → `undefined` (conservative host-only fallback) ✅
  - `COOKIE_DOMAIN=.x.com` set alongside `BETTER_AUTH_URL=https://api.x.com` → `.x.com` (explicit wins) ✅
- ✅ **Credentialed CORS origin reflection** (review item): extracted the `cors()` middleware's `origin` callback logic and confirmed:
  - An allowed dev-fallback origin (`http://localhost:4321`) is reflected back verbatim (not `*`).
  - A configured `CORS_ORIGINS` list reflects an exact match and rejects (`null`) a non-match.
  - A missing `Origin` header returns `null` (no reflection).
  - Source-level check (`grep`) confirms `credentials: true` is set and no literal `"*"` origin string exists in `modules/api/files/src/index.ts`.
- ✅ `pnpm install` in `.dev/playground` → **now succeeds** (414 packages, ~11s). The pre-rebase run was blocked by `ERR_PNPM_NO_MATURE_MATCHING_VERSION` on the repo's 3-day `minimumReleaseAge` cooldown; `origin/main` has since dropped `minimumReleaseAge` from the base template workspace, so that gate is gone and the old TC-7 covering it was removed from this plan.
- ✅ `pnpm run typecheck` **inside `.dev/playground`** (the integration check that matters most for the rebase) → clean across `@repo/api`, `@repo/auth`, and `@repo/db`. This is what proves `auth` still compiles against `origin/main`'s `@repo/db` exports map: this branch originally added its own `"." + "./client"` exports to `modules/database/files/package.json`, main landed a different `"./client" + "./schema/*" + "./repositories/*"` map, and the rebase dropped this branch's version in favor of main's — `packages/auth/src/auth.ts` imports `@repo/db/client`, which main's map covers.
- ✅ `pnpm run build` in `.dev/playground` → both build tasks succeed end-to-end.
- ⚠️ **Still not exercised: a live Worker.** `wrangler dev` + local D1 migrations + real sign-up/session/CORS traffic were not brought up in this pass (the browser-based cross-origin cases need a human at a browser regardless). TC-1 through TC-6 and TC-7 all require a live Worker and are left for the human tester.

## Not covered / needs human judgment
- **Any live-server behavior** — actual sign-up/sign-in cookie issuance, cross-origin credentialed fetch, session revocation, and the two cookie-domain end-to-end cases (TC-1 through TC-7) — all need a running `wrangler dev` Worker + migrated local D1, which the agent did not bring up in this pass. The agent verified the underlying pure logic (`deriveCookieDomain`, the CORS `origin` callback) in isolation and confirmed the whole playground installs, typechecks, and builds, which is strong evidence but not a substitute for observing the real `Set-Cookie` / `Access-Control-Allow-Origin` headers Better Auth and Hono's `cors()` middleware actually emit.
- **A real `add billing`-style consumer** — no `billing`/`teams` module exists yet in this repo to exercise the plugin-array patch through an actual `saasaloy add` call end-to-end; the agent instead ran the codemod directly against the real scaffolded `auth.ts` with a `billing`-shaped patch spec, which exercises the same code path the future module's `patches[]` entry would trigger.
- **Social OAuth / email verification** — deliberately not wired in this module (documented in the `saasaloy-auth` skill); nothing to test here.
- **Version-pin currency** for `better-auth` and friends — chosen at build time without a live registry check. The pins install cleanly, but nothing here confirms they are the best current choice; `pnpm deps:check` is the gate for that.
