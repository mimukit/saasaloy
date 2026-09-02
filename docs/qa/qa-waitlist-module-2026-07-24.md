# QA Plan: `waitlist` feature module

_Generated 2026-07-24 · covers the uncommitted `waitlist` module + base React/sections prerequisites + the `package-json-dependency` patch kind (issue #10)_

_Updated 2026-09-02 for issue #62: the sections glob is retired. The waitlist UI now ships as a `@repo/ui` block plus a `WaitlistForm` island, and placing it on the page is a manual wire-up step. Dev ports moved to web `:3000` / api `:4000`. TC-7 now tests the wire-up pointer instead of the glob; re-run the changed cases before trusting their old pass marks._

## Summary
- `saasaloy add waitlist` topo-sorts and installs `api → database → waitlist` behind one prompt, drops a Hono route, a Drizzle table, a presentational `Waitlist` block into `packages/ui/src/blocks/` and a `WaitlistForm` island into `apps/web/src/components/`, and auto-patches `@repo/db` into `apps/api/package.json` so the route can import the DB. It then prints a wire-up pointer; putting the form on the page is your edit (see the `/saasaloy-waitlist` skill's Wire-up section).
- "Working" means: a visitor submits the form on `/`, the row lands in local D1, a duplicate email returns success without a second row, and no config file needed a hand-edit.

## Preconditions
- Branch `issue-10-waitlist-feature-end-to-end-proof`, with the uncommitted changes in the working tree.
- The applier runs against the **local** registry (`SAASALOY_REGISTRY_DIR=<repo>/modules`) via the playground shim — no network registry needed.
- A **fresh** playground so nothing from a prior run masks a real result. Build the CLI and re-init the playground:

```sh
pnpm run play:reset
```

- Add the module (resolves `api → database → waitlist`), then install deps. `pnpm install` may quarantine a too-new pin under `minimumReleaseAge` (3 days) — if so, use the documented cooldown override:

```sh
cd .dev/playground && ./saasaloy add waitlist --yes
```

```sh
corepack pnpm install --config.minimumReleaseAge=0
```

- Wire the form onto the landing page (`add` prints the pointer but never edits a page). In `apps/web/src/pages/index.astro`, add the import beside the other block imports and render the island inside `<main>`, after `<Cta siteName={siteName} />`:

```astro
import WaitlistForm from "@web/components/WaitlistForm";
```

```astro
<WaitlistForm client:load />
```

- Generate + apply the migration (the module ships **no** pre-generated SQL):

```sh
pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
```

- Launch both dev servers (separate terminals) — api on `:4000`, web on `:3000`:

```sh
pnpm --filter @repo/api dev
```

```sh
pnpm --filter web dev
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Landing page renders the wired-up waitlist block on `/` | 🔴 Critical |
| TC-2 | Happy path: submit a valid email → row lands in D1 | 🔴 Critical |
| TC-3 | Duplicate email → success, still one row | 🔴 Critical |
| TC-4 | Invalid email → form blocks / server rejects, no row | 🟡 Normal |
| TC-5 | api unreachable → form shows a graceful error | 🟡 Normal |
| TC-6 | Submitting state + success copy behave correctly | 🟡 Normal |
| TC-7 | `add` prints the wire-up pointer; `remove` says wire-up is not reversed | 🟢 Low |
| TC-8 | Keyboard-only submit + screen-reader status/alert roles | 🟢 Low |

## Test cases

### TC-1 — Landing page renders the wired-up waitlist block on `/`  ·  🔴 Critical
**Steps**
1. Open `http://localhost:3000/` in a browser.
2. Scroll to below the CTA panel (the wire-up anchor from the Preconditions).

**Expected**
- A "Get early access" panel appears after the CTA, no separate `/waitlist` page needed.
- It shows an email input and a "Join the waitlist" button (the React island hydrated — `client:load`).
- No console error about an unresolved `@web/components/WaitlistForm` or `@repo/ui/blocks/waitlist` import.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-2 — Happy path: submit a valid email → row lands in D1  ·  🔴 Critical
**Steps**
1. In the waitlist form, enter `alice@example.com` and click **Join the waitlist**.
2. Confirm the row landed (run against the api workspace):

```sh
cd .dev/playground/apps/api && node_modules/.bin/wrangler d1 execute DB --local --config wrangler.jsonc --persist-to .wrangler/state --command "SELECT id, email, created_at FROM waitlist;"
```

**Expected**
- The form swaps to the success message: "You're on the list — we'll be in touch."
- The browser Network tab shows `POST http://localhost:4000/waitlist` succeeding (`201`).
- The D1 query returns exactly one row: `alice@example.com`, with a populated `created_at`.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-3 — Duplicate email → success, still one row  ·  🔴 Critical
**Steps**
1. Reload `/` and submit `alice@example.com` **again** (same address as TC-2).
2. Re-run the D1 query from TC-2.

**Expected**
- The form shows the **same** success message — no error, no "already registered" leak.
- The D1 query still returns exactly **one** `alice@example.com` row (the `.onConflictDoNothing()` on the unique `email` column held).

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-4 — Invalid email → form blocks / server rejects, no row  ·  🟡 Normal
**Steps**
1. Enter `not-an-email` (no `@`) and try to submit.
2. If the browser's native validation lets anything through, watch the Network tab.
3. Re-run the D1 query from TC-2.

**Expected**
- Native HTML validation (`type="email" required`) blocks submit and shows the browser's inline "please enter an email" bubble — the request never fires.
- If a malformed value *does* reach the server (e.g. via a direct POST), it returns `400` from the zod `z.email()` validator, not `200`.
- No new row appears in D1 for the invalid value.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-5 — api unreachable → form shows a graceful error  ·  🟡 Normal
**Steps**
1. Stop the api dev server (Ctrl-C in its terminal).
2. Submit a valid email from the form.

**Expected**
- The form shows the error message: "Something went wrong — try again." (with `role="alert"`).
- The page does not crash or hang on "Joining…" indefinitely — the `catch` resets `status` to `error`.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-6 — Submitting state + success copy behave correctly  ·  🟡 Normal
**Steps**
1. Restart the api server; submit a fresh valid email (e.g. `bob@example.com`).
2. Watch the button and input during the request (throttle the network in devtools to see it).

**Expected**
- While in-flight, the button reads "Joining…" and both input and button are `disabled` (no double-submit).
- On success the whole form is replaced by the status message; there's no lingering enabled form.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-7 — `add` prints the wire-up pointer; `remove` says wire-up is not reversed  ·  🟢 Low
**Steps**
1. Re-read the `./saasaloy add waitlist --yes` output from the Preconditions (or re-run it with `--dry-run` on a fresh playground).
2. Run `./saasaloy remove waitlist --yes` on a throwaway playground where the wire-up import was added, then reload `/`.

**Expected**
- The add output contains a "Manual wire-up needed" line naming `packages/ui/src/blocks/waitlist.tsx` and pointing at `/saasaloy-waitlist` — `add` never edits `index.astro`.
- The remove output deletes the block and the island, and says plainly that the manual wire-up is **not** auto-reversed.
- The web dev server fails loudly on the now-dangling `WaitlistForm` import until you take the two wire-up lines out yourself.
- Restore the playground afterward (`add` again + wire-up, or `play:reset`).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — Keyboard-only submit + screen-reader roles  ·  🟢 Low
**Steps**
1. With the form focused, Tab to the input, type an email, Tab to the button, press Enter (or Space).
2. If a screen reader is available, listen as the states change.

**Expected**
- The form submits via keyboard alone; focus order is input → button.
- The success node is announced (`role="status"`), and the error node is announced assertively (`role="alert"`).
- The input has an associated `<label for="waitlist-email">`.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

## Regression checks
- [x] `./saasaloy add api` alone still scaffolds `apps/api` + `routes/health.ts` (the api zod/validator additions didn't break the bare capability).
- [x] `GET http://localhost:4000/health` still returns its health payload after the waitlist route is mounted (route glob didn't shadow it).
- [x] Base `index.astro` still renders the hero and Terms/Privacy nav **before** the wire-up edit (the page composes from explicit imports only; an un-wired block changes nothing — verify on a `play:reset` project before adding waitlist).
- [x] `apps/web` and `packages/ui` still typecheck with React added to the base (no stray `.tsx`/JSX config breakage).

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm run test
```

```sh
pnpm run typecheck
```

```sh
pnpm run lint
```

```sh
node packages/cli/dist/index.js init <throwaway> --force --no-install && SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add waitlist --dry-run --yes
```

```sh
cd .dev/playground/apps/api && node_modules/.bin/wrangler d1 execute DB --local --config wrangler.jsonc --persist-to .wrangler/state --command "SELECT name FROM sqlite_master WHERE type='table' AND name='waitlist';"
```

- ✅ `pnpm run test` → **8 files / 70 tests passed** (incl. 5 new `upsertPackageJsonDependency` unit tests + 2 `applyPatch` package-json-dependency integration tests: add-to-section, create-fresh, idempotent byte-for-byte, never-clobber, formatting-preserved).
- ✅ `pnpm run typecheck` → clean (`tsc --noEmit`) across the CLI package.
- ✅ `pnpm run lint` → no lint task defined in the workspace (nothing to run).
- ✅ `add waitlist --dry-run` → resolved **`api → database → waitlist`**, planned **21 files** across `apps/api` + `packages/db` + `apps/web`, surfaced the `PUBLIC_API_URL` env notice, registered `@api` + `@db` aliases, planned all three skill links, and previewed **both** config patches: `apps/api/wrangler.jsonc — wrangler-binding` and `apps/api/package.json — package-json-dependency`.
- ✅ Live playground D1 → `SELECT ... sqlite_master` returns the **`waitlist`** table (migration `0000_*` generated from the dropped schema and applied to local D1; `email` carries a `UNIQUE` index).
- ✅ (from earlier this session) `add waitlist --yes` into `.dev/playground` applied 21 files + both patches; `apps/api/package.json` gained `"@repo/db": "workspace:*"`; all four workspaces (`api`, `db`, `web`, `ui`) typecheck clean after `pnpm install` + `astro sync`; the api dev server booted on workerd at `:5173`.

## Not covered / needs human judgment
- **The live HTTP round-trip** (TC-2/TC-3/TC-4/TC-5) — the form submit, the `200`/`{ok:true}` response, the duplicate no-op, and the `400` on a bad email all need a running api + web and a `curl`/browser POST; `curl` is blocked for the agent in this session, so a human drives these. The D1 table's existence is confirmed above; the row *landing* on submit is the human's to verify.
- **Browser rendering & hydration** (TC-1) — that the React island actually mounts under Astro and the section paints correctly is a visual check.
- **UX feel** (TC-6) — the submitting/disabled/success transitions read well only to a human eye.
- **Accessibility** (TC-8) — keyboard order and screen-reader announcements need a real assistive-tech pass, not a static assertion.
- **CORS preflight in a real browser** — `hono/cors` on the sub-app should answer the `OPTIONS` preflight the `application/json` POST triggers; only a cross-origin browser request (`:3000` → `:4000`) proves it end to end.
- **Production `PUBLIC_API_URL`** — dev uses the localhost fallback; the build-time env for a deployed api Worker is doc-only here (deferred with the remote/deploy story).
