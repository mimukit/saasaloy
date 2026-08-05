# QA Plan: Astro 7 + exact-pin base template

_Generated 2026-08-01 · covers commit `7a63705` (branch `issue-41-upgrade-the-base-to-astro-7-and-exact-pins`, vs `origin/main`) — issue #41, Phase 0 of `docs/plans/plan-ui-blocks-2026-08-01.md`_

## Summary
- The base template at `packages/cli/templates/base/` moves from Astro 5 to Astro 7 (Vite 8 / Rolldown, `@astrojs/react` 6, React 19.2.8), and every remaining `^` range in the template becomes an exact pin.
- "Working" means: a freshly scaffolded project still installs, builds, and serves all three pages identically to before — no visual regression, no mutated workspace config, no new warnings.

## Preconditions
- Branch `issue-41-upgrade-the-base-to-astro-7-and-exact-pins` checked out, commit `7a63705` in the tree.
- Node `>=24`, pnpm 11 (`engineStrict: true` in the template will refuse otherwise).
- Nothing else listening on port `4321`.
- Per `AGENTS.md`, all CLI exercising happens in `.dev/`. **The base template is not a pnpm workspace member of this repo** — it is never typechecked or linted by the tool repo, so `pnpm deps:verify` (which scaffolds `.dev/playground` and builds it) is the only real gate. Start from a genuinely clean playground:

```sh
pnpm run play:destroy
```

```sh
pnpm run deps:verify
```

- To serve the playground for the visual cases (from the repo root):

```sh
pnpm -C .dev/playground/apps/web exec astro dev --port 4321
```

- ⚠️ **Astro 7 daemonizes `astro dev`.** It prints the URL and returns to your prompt instead of blocking — Ctrl-C will not stop it. Stop it explicitly when you're done:

```sh
pnpm -C .dev/playground/apps/web exec astro dev stop
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Landing page `/` renders correctly in a browser | 🔴 Critical |
| TC-2 | `Terms · Privacy` separator keeps its spaces under `compressHTML: 'jsx'` | 🔴 Critical |
| TC-3 | `/terms` and `/privacy` render and link back home | 🔴 Critical |
| TC-4 | A fresh `saasaloy init` + install leaves `pnpm-workspace.yaml` untouched | 🔴 Critical |
| TC-5 | Astro 7 dev-server lifecycle (daemon start/status/stop, HMR) | 🟡 Normal |
| TC-6 | Built output via `astro preview` matches the dev render | 🟡 Normal |
| TC-7 | Dark mode, responsive layout, and keyboard nav still behave | 🟢 Low |

## Test cases

### TC-1 — Landing page `/` renders correctly in a browser  ·  🔴 Critical
**Steps**
1. Start the dev server (see Preconditions).
2. Open `http://localhost:4321/` in a browser with devtools open.

**Expected**
- The `<h1>` shows the project name (`playground`), centred, at a large clamped size.
- Below it: "A Cloudflare-native SaaS, scaffolded with Saasaloy." and "Add features with `saasaloy add <module>`." — the `<module>` renders as literal text in a monospace `<code>`, not as a stray/eaten HTML tag.
- The `<nav>` with Terms and Privacy sits below, at reduced opacity.
- The devtools **Console** is free of errors — in particular no unresolved-import or React-version-mismatch error.
- The devtools **Network** tab shows no 404s.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-2 — `Terms · Privacy` separator keeps its spaces under `compressHTML: 'jsx'`  ·  🔴 Critical
**Steps**
1. On `http://localhost:4321/`, look closely at the nav line at the bottom of the page.
2. Compare against `main` if you want a side-by-side: this is the one place in the template where two inline `<a>` elements are separated only by literal whitespace (`</a> · <a>` in `index.astro`), which is exactly what Astro 7's new `compressHTML: 'jsx'` default is allowed to strip.
3. Repeat the look on the **built** output after TC-6.

**Expected**
- It reads `Terms · Privacy` with a visible space on **both** sides of the `·`.
- It does **not** read `Terms·Privacy` or `Terms ·Privacy`.
- Both words are still separate, clickable links.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

> Agent note: the serialized HTML was confirmed to contain `</a> · <a` in both the dev response and the built `dist/index.html` (see Automated verification). This case exists so a human confirms it *looks* right as rendered, since collapsing can also happen at paint time.

### TC-3 — `/terms` and `/privacy` render and link back home  ·  🔴 Critical
**Steps**
1. Click **Terms** in the nav.
2. Click **← Home**.
3. Click **Privacy** in the nav.
4. Click **← Home** again.

**Expected**
- `/terms` shows the heading "Terms of Service" and the placeholder paragraph.
- `/privacy` shows the heading "Privacy Policy" and its placeholder paragraph.
- The `← Home` link on each renders with the arrow glyph intact and a space before "Home", and navigates back to `/`.
- No console errors on either page.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-4 — A fresh `saasaloy init` + install leaves `pnpm-workspace.yaml` untouched  ·  🔴 Critical
**Steps**
1. This must be run at *your* clock time, not the agent's — pnpm's release-age cooldown is measured against "now", so a pin that was safely old today can trip the check later. Scaffold a throwaway project:

```sh
pnpm run play:reset
```

2. Install into it:

```sh
pnpm -C .dev/playground install
```

3. Diff the scaffolded workspace file against the template it came from:

```sh
diff packages/cli/templates/base/pnpm-workspace.yaml .dev/playground/pnpm-workspace.yaml && echo IDENTICAL
```

4. Confirm nothing cooldown-related was written anywhere:

```sh
grep -rn "minimumReleaseAge" .dev/playground/pnpm-workspace.yaml .dev/playground/.npmrc 2>/dev/null || echo "clean"
```

**Expected**
- Step 3 prints `IDENTICAL` with no diff output.
- Step 4 prints `clean`.
- Specifically, **no** `minimumReleaseAgeExclude:` block has been appended. pnpm 11 silently appends those entries when a pinned version is younger than the configured cooldown — the mutation is invisible to build and typecheck, and it would ship as a surprise diff in every downstream `saasaloy init`. This is the single most likely way this change breaks users.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-5 — Astro 7 dev-server lifecycle (daemon start/status/stop, HMR)  ·  🟡 Normal
**Steps**
1. Start the dev server and note that your shell prompt **returns immediately**:

```sh
pnpm -C .dev/playground/apps/web exec astro dev --port 4321
```

2. Query it:

```sh
pnpm -C .dev/playground/apps/web exec astro dev status
```

3. With the browser open on `/`, edit `.dev/playground/apps/web/src/pages/index.astro` — change the hero paragraph text — and save. Watch the browser.
4. Revert the edit, then stop the server:

```sh
pnpm -C .dev/playground/apps/web exec astro dev stop
```

**Expected**
- Start returns to the prompt and prints the URL plus `Stop: astro dev stop` — this is **new in Astro 7**; under Astro 5 the process blocked the terminal. Ctrl-C no longer stops it.
- `astro dev status` reports the running server and its pid.
- The browser hot-reloads the edited paragraph without a manual refresh.
- `astro dev stop` prints `Stopped dev server (pid …)` and the port is released.
- Judge whether this daemonized behaviour is acceptable for `pnpm dev` / `turbo run dev` in a scaffolded project, or whether the template's `dev` script needs a follow-up flag.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-6 — Built output via `astro preview` matches the dev render  ·  🟡 Normal
**Steps**
1. Build and preview the production output:

```sh
pnpm -C .dev/playground build
```

```sh
pnpm -C .dev/playground/apps/web exec astro preview --port 4321
```

2. Walk `/`, `/terms`, `/privacy` in the browser and compare each against what you saw in TC-1 through TC-3.

**Expected**
- All three pages look identical to the dev render — same spacing, same layout, same styles applied.
- The `Terms · Privacy` spacing from TC-2 survives in the minified build (this is where `compressHTML` actually runs).
- No console errors.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-7 — Dark mode, responsive layout, and keyboard nav still behave  ·  🟢 Low
**Steps**
1. Toggle your OS (or devtools) to dark mode and reload `/`. The template sets `color-scheme: light dark`.
2. Resize to a narrow mobile viewport (≈375px).
3. From the page, press Tab repeatedly.

**Expected**
- Dark mode inverts background and text legibly; contrast on the reduced-opacity nav is still readable.
- At 375px the `clamp()`-sized `<h1>` scales down and nothing overflows horizontally.
- Tab reaches **Terms** then **Privacy** in that order, each with a visible focus ring; Enter follows the link.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

## Regression checks
- [x] `saasaloy init` into a brand-new directory still produces a project that installs on the first try, with no peer-dependency error from React 19.2.8 being pinned exactly in both `apps/web` and `packages/ui` (`peerDependencies.react` is now an exact pin, not a range — confirm pnpm doesn't warn).
- [x] `@repo/ui`'s `siteName` export still resolves into `apps/web` (it drives the `<h1>` and `<title>` on `/`).
- [x] The `@web` vite alias comment in `apps/web/astro.config.mjs` is still present and accurate.
- [x] No `src/fetch.ts` exists in `apps/web` (reserved filename in Astro 7 — keep it that way when adding modules later).
- [x] Adding a module that drops a `sections/*.astro` file still lands it on the landing page via the `import.meta.glob` in `index.astro` (unchanged in v6/v7; `Astro.glob()` was the removed API and isn't used).

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm run play:destroy && pnpm run deps:verify
```

```sh
diff packages/cli/templates/base/pnpm-workspace.yaml .dev/playground/pnpm-workspace.yaml && echo IDENTICAL
```

```sh
pnpm -C .dev/playground build --force
```

```sh
ls .dev/playground/node_modules/.pnpm | grep -E '^(astro@|vite@|@astrojs\+react@|react@|wrangler@|turbo@|typescript@)'
```

```sh
python3 -c "h=open('.dev/playground/apps/web/dist/index.html',encoding='utf-8').read(); i=h.find('<nav'); print(repr(h[i:i+160]))"
```

```sh
cd .dev/playground/apps/web && node_modules/.bin/wrangler deploy --dry-run
```

```sh
for p in / /terms /privacy; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321$p"; done
```

```sh
pnpm deps:check
```

- ✅ `pnpm run play:destroy && pnpm run deps:verify` → **exit 0** on a from-scratch playground. `pnpm install` resolved 410 / added 286 packages in 5.4s across 4 workspace projects with no peer warnings and no `engineStrict` failure; `turbo run build` succeeded; 3 pages built.
- ✅ **`pnpm-workspace.yaml` was NOT mutated by install** → `diff` printed `IDENTICAL`, and `grep minimumReleaseAge` over the playground's `pnpm-workspace.yaml` and `.npmrc` found nothing. No `minimumReleaseAgeExclude` block was appended. (TC-4 asks a human to re-confirm this at their own clock time, since the cooldown window is relative to now.)
- ✅ `pnpm -C .dev/playground build --force` → cache bypassed, real Astro 7 build in **986ms**, `3 page(s) built`, `output: "static"`, no compiler warnings. The Rust compiler (mandatory in v7, stricter about unclosed tags) accepted all three `.astro` pages without complaint.
- ✅ Installed versions match the pins exactly → `astro@7.1.6`, `@astrojs/react@6.0.2`, `react@19.2.8`, `wrangler@4.115.0`, `turbo@2.10.7`, `typescript@5.9.3`. `astro --version` self-reports **v7.1.6**, and the transitive Vite is **8.2.0** — confirming the Vite 8 / Rolldown line is what actually got installed, not a Vite 7 fallback.
- ✅ **`compressHTML: 'jsx'` whitespace preserved** → built `dist/index.html` contains `<a href="/terms" …>Terms</a> · <a href="/privacy" …>Privacy</a>` — a literal space on both sides of the `·` survived minification. No `{" "}` fix was needed. `/terms` and `/privacy` likewise kept the space in `<a href="/">← Home</a>`.
- ✅ **`@web` alias resolves under Vite 8 / Rolldown** → the base template ships no file that imports `@web/...`, so the alias is otherwise untested by the build. The agent temporarily added `src/components/AliasProbe.tsx` and `src/sections/zz-alias-probe.astro` (importing `@web/components/AliasProbe` and rendering it `client:load`), rebuilt, and found `ALIAS_RESOLVED` in the emitted HTML — the plain-string `vite.resolve.alias` still works, and a React island still renders. **Both probe files were removed and the playground rebuilt clean afterward** (`grep ALIAS_RESOLVED` → 0).
- ✅ `wrangler deploy --dry-run` → exit 0, read 7 files from `dist`, `Total Upload: 0.35 KiB`, `No bindings found`. **No compatibility-date warning** — the bump to `2026-07-22` did its job.
- ✅ `astro dev` served all three pages → `/` **200**, `/terms` **200**, `/privacy` **200**, and the dev-server HTML carried the same correctly spaced `Terms · Privacy` nav. **The server was stopped afterward** (`astro dev stop`, port 4321 confirmed free).
- ⚠️ `turbo run typecheck` → `WARNING No tasks were executed as part of this run. Tasks: 0 successful, 0 total`. **Pre-existing, not a regression from this change**: no package in the base template defines a `typecheck` script, so the `typecheck` leg of `deps:verify` is currently a no-op. The `deps:verify` gate is really install-plus-build today. Worth a follow-up issue.
- ❌ `pnpm deps:check` → **exit 1**, `8 pending`. **Pre-existing drift, not a regression**: it flags `vite 8.1.5 → 8.2.0` in `modules/api/files/package.json` and `modules/database/files/package.json` (untouched by this branch), plus normal post-pin drift that has landed since the versions were chosen — `wrangler 4.115.0 → 4.118.0`, `turbo 2.10.7 → 2.10.8`, `@types/react 19.2.17 → 19.2.18`. It also notes the template's deliberate major-lag on `@types/node` (24 vs repo's 26) and `typescript` (5 vs repo's 7), which is by design per ADR 0016. This gate was already red on `main`; do not treat it as a blocker for this change.

## Not covered / needs human judgment
- **Visual rendering** — every case above that says "looks right" needs eyes. The agent verified the *serialized* HTML string; only a human can confirm the browser paints it with the spacing and layout intended.
- **The `·` separator as rendered** — HTML-level confirmation is not the same as pixel-level confirmation; a font or CSS quirk could still visually close the gap.
- **HMR feel** under Vite 8 / Rolldown — whether edit-to-repaint is fast and reliable is a felt quality, not a measurable one here.
- **The daemonized `astro dev`** (TC-5) — whether it's an acceptable developer experience for a scaffolded project's `pnpm dev`, and whether `turbo run dev` behaves sanely when the child process detaches, is a judgment call this plan surfaces rather than settles.
- **A real Cloudflare deploy** — only `--dry-run` was exercised. An actual `wrangler deploy` against a real account, and the deployed site's behaviour, is untested.
- **Cross-browser and real-device** — everything above was checked in a single browser at desktop size. Safari/Firefox and a physical phone are the human's to cover.
- **Downstream modules on Astro 7** — `add api` / `add database` / `add waitlist` against an Astro 7 base is out of scope for this Phase 0 change and is covered by the later phases of `docs/plans/plan-ui-blocks-2026-08-01.md`. Note `deps:check` already shows those modules pinning Vite 8.1.5.
