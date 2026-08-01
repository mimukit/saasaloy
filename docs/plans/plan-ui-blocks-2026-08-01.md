# Plan — UI blocks in `packages/ui`

Grilled: 2026-08-01
Tracked: [#40](https://github.com/mimukit/saasaloy/issues/40) (epic)

## Context

`packages/ui` in the base template is a stub. It exports one string (`siteName`) and its own comment admits the situation: "real shadcn-based React components arrive when a feature module needs them." Meanwhile the build-spec's layout ([§3.1](plan-saasaloy-build-spec-2026-07-21.md)) has always described it as "BASE — shadcn-based React components," and the `waitlist` module — our first proof that the machinery generalizes — ships a completely unstyled HTML form.

There is no Tailwind, no shadcn, and no `cn()` anywhere in this repo today.

The goal: give the base a real design layer — Tailwind 4 + a vendored set of shadcn primitives + a set of **marketing blocks** (compositions of those primitives) in `@repo/ui` — so that `saasaloy init` produces a landing page that looks like a product instead of a placeholder, and so every downstream module has a styled surface to drop into.

**Success** = `saasaloy init` yields a project whose landing page is composed from `@repo/ui/blocks/*`, builds and typechecks green in `.dev/playground`, ships near-zero JavaScript for static blocks, and lets a user run `pnpm dlx shadcn@latest add <component>` to extend it.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Where blocks live** | The **base template** (`packages/cli/templates/base/packages/ui`), not a module. Every `init` gets them. This supersedes [ADR 0003](../adr/adr-0003-base-is-landing-page-only-2026-07-22.md)'s explicit "no Tailwind/React" clause — React already landed in the base, and this finishes the job. Needs a new ADR. |
| **Primitive sourcing** | **Hybrid.** Vendor only the primitives the blocks actually need into `packages/ui/src/components/`; document `pnpm dlx shadcn@latest add <x>` for everything else. Keeps the vendored surface small without stranding users. |
| **Primitive family** | **`base-nova`** — Base UI (`@base-ui/react@1.6.0`). What the shadcn docs now show everywhere. **Irreversible**: `style` cannot be changed after init. Note shadcn's own `astro-monorepo` template still ships `radix-nova`, so we diverge from it deliberately. **Escape hatch if Base UI churns:** initted projects are insulated (vendored source + exact pin can't break retroactively), and the template can swap families in a future release affecting only new inits — blocks never expose the primitive family in their APIs, so a swap is a contained rewrite of `src/components/`. Churn cost lands solely on template maintenance at `deps:update` time. |
| **Block format** | **React `.tsx`** in `packages/ui/src/blocks/`. Renders statically inside Astro (zero JS) and stays reusable by a future admin SPA. Also sidesteps the compound-primitive trap below, since each block is one self-contained island. |
| **First block set** | Marketing/landing: `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer`. |
| **Astro major** | **Bundled as Phase 0.** The base pins `astro: ^5`; latest is `7.1.6`. Land the new UI foundation on current Astro rather than build it twice. |
| **Dark mode** | shadcn's standard `.dark` class + a pre-paint inline script reading `prefers-color-scheme`. No toggle UI in the base. Keeps CLI-added components theming correctly. |
| **Theme ownership** | `packages/ui/src/styles/globals.css` owns `@import "tailwindcss"`, the `@source` globs, and the OKLCH token set (`baseColor: neutral`). `apps/web` imports it via a `./globals.css` subpath export. One theme, reusable by future apps. |
| **Block naming** | Semantic kebab-case (`hero.tsx`, `pricing-table.tsx`), **not** shadcn's `{category}-{NN}`. That numbering disambiguates variants in a public registry; we have neither. |
| **Update path for base files** | **One-time gift, accepted.** `init` stays a pure copy — no manifest entries for base files. Blocks are you-own-the-code source meant to be edited; hash-drift tracking would flag every project immediately because editing is the expected use. Recorded as a consequence in the new ADR. |
| **Inert-base thesis** | **Narrowed, not refuted.** The new ADR reframes ADR 0003's claim: the base stays inert on *functional* surfaces (no services, no auth, no network deps); presentation-layer deps rot aesthetically, not dangerously. |
| **`shadcn` runtime dep** | **Keep it live** (no `eject`). Exact-pinned, so no less frozen than an inlined blob — but users upgrade in one move, and future `pnpm dlx shadcn add` components stay coherent with the `shadcn/tailwind.css` they assume. Ejecting creates a silent-drift failure class. |
| **Pin style** | **Exact is authoritative.** Phase 0 migrates every remaining `^` range in the template to exact pins (it touches those lines anyway). Keeps inits reproducible; `deps:update` already treats ranges as migrations. |
| **Smoke test home** | **A `scripts/verify-css.mjs` step appended to the `deps:verify` pipeline** after `build` — greps `.dev/playground/dist/**/*.css` for a sentinel utility emitted only from `packages/ui`, exits non-zero if missing. No new test infra. |
| **`components.json` placement** | **`packages/ui` only.** No `apps/web/components.json` until a second app (`admin`) exists. The documented extension recipe runs the CLI from `packages/ui` (e.g. `pnpm -C packages/ui dlx shadcn@latest add <x>`). |
| **Tree-shaking** | **Resolved by design.** Each block is a self-contained `.tsx` behind its own `./blocks/*` subpath export with consumer-side transpile — importing one block loads only that file and its imports. Guard: **no barrel re-exports of blocks** from the root `.` export. |

## Approach

### What this reuses

- **`saasaloy.json`'s `@ui → packages/ui/src` alias** — already present, so future modules can drop files at `@ui/blocks/*` with **zero CLI changes**.
- **The `sections/*.astro` glob** in `index.astro` — the landing page's existing file-drop extension point. Blocks compose *alongside* it; the convention `waitlist` depends on stays intact.
- **`copyTemplate`** (`packages/cli/src/lib/scaffold.ts:12`) — recursively walks the template, so new `.css`/`.tsx` files need no CLI work.
- **`pnpm deps:update` / `deps:verify`** — the only gate that actually exercises template code (see "the verification reality" below).
- **`@repo/ui`'s JIT wiring** — `workspace:*` + consumer-side transpile, no build step.

### The one thing that will silently break this

Verified empirically against a real Tailwind 4.3.3 build: **Tailwind's automatic class detection is rooted at the current working directory**, and `astro dev` runs with cwd = `apps/web`. Without an explicit `@source`, every utility class inside `packages/ui` is **silently dropped** — no error, no warning, just missing CSS.

Worse, shadcn's own `astro-monorepo` template has an off-by-one in its globs: from `packages/ui/src/styles/`, `../../../apps/**` resolves to `packages/apps/**`, which does not exist. It works there only by accident, because cwd-rooted auto-detection covers the app — and that cover vanishes when Turborepo builds from the repo root. A non-matching `@source` glob does not error.

So `packages/ui/src/styles/globals.css` ships **corrected** globs:

```css
@source "../**/*.{ts,tsx}";                      /* packages/ui/src/**  */
@source "../../../../apps/**/*.{ts,tsx,astro}";  /* four levels, not three */
```

pnpm symlinks resolve to realpath, so no symlink-aware path math is needed. **Phase 1 carries a smoke test asserting a `packages/ui`-only class reaches the built CSS** — this failure mode is invisible to `build` and `typecheck`.

### The verification reality

The base template is **not** a workspace member — root `pnpm-workspace.yaml` globs `packages/*` one level deep, so `packages/cli/templates/base/**` is never typechecked or linted by the tool repo. The only real gate is:

```sh
pnpm deps:verify   # play:init → pnpm install → build → typecheck in .dev/playground
```

Every phase below ends there.

---

### Phase 0 — Astro 5 → 7 in the base (#41)

The base is two majors behind by design, not neglect: [ADR 0016](../adr/adr-0016-in-script-cooldown-gate-for-invisible-manifests-2026-07-24.md)'s resolver caps within the current major, so majors only move on a deliberate `--allow-major`.

Breaking changes **surveyed 2026-08-01** (Astro v6/v7 upgrade guides + release blogs + npm registry). What applies to this template:

- `Astro.glob()` was removed in v6 — **not used**; `index.astro` already uses `import.meta.glob`, which is unchanged. No action.
- v7's Rust compiler is mandatory and **stricter**: unclosed non-void tags are build errors and invalid HTML passes through uncorrected. Audit all three `.astro` pages.
- v7 changed `compressHTML` default `true` → `'jsx'`: whitespace between inline elements is stripped by JSX rules. Visual-diff the built pages; add explicit `{" "}` where needed.
- v7 ships **Vite 8 (Rolldown)**. Plain string `vite.alias` entries are fine (only `customResolver` is deprecated — not used). `@tailwindcss/vite@4.3.3` supports Vite 8 (peer `^5.2 || ^6 || ^7 || ^8`).
- `@astrojs/react` **6.x is the Astro 7/Vite 8 line** (5.x targets Vite 7 and will mismatch). No hydration/directive changes; `client:visible`/`client:idle` unchanged in both majors.
- `src/fetch.ts` is a reserved filename in v7 — not present; keep it that way.
- Node floor is `>=22.12.0` (unchanged in v7); base is `>=24` — fine. Cloudflare static-asset deployment: nothing breaking; no `compatibility_date` gate for pure static assets.

Steps:

1. Bump `apps/web`: `astro@7.1.6`, `@astrojs/react@6.0.2`, `react`/`react-dom@19.2.8`, matching `@types/*` — all verified current on npm as of 2026-08-01.
2. **Migrate every remaining `^` range in the template to exact pins** (per the pin-style decision) — `astro`, `react`, and any others `deps:update` flags as range→exact.
3. Audit the three pages for strict-HTML violations; visual-check `compressHTML: 'jsx'` whitespace.
4. Update `astro.config.mjs` if any config shape changed; preserve the `@web` vite alias and its comment (plain alias — no Vite 8 impact).
5. Consider bumping `wrangler.jsonc`'s `compatibility_date` (cosmetic for static assets; keeps the fallback warning away).

**Gate:** `pnpm deps:verify` green; playground `astro dev` serves all three pages.

### Phase 1 — Tailwind 4 foundation + theme (#42)

1. `apps/web`: add `tailwindcss@4.3.3` + `@tailwindcss/vite@4.3.3`; register the plugin in `astro.config.mjs`'s `vite.plugins`. Do **not** use `@astrojs/tailwind` — it is EOL and never supported Tailwind 4.
2. Create `packages/ui/src/styles/globals.css`: the Tailwind/`tw-animate-css`/`shadcn/tailwind.css` imports, the corrected `@source` globs above, `@custom-variant dark`, and the OKLCH `:root` / `.dark` token sets (`baseColor: neutral`, `cssVariables: true`).
3. Create `packages/ui/src/lib/utils.ts` — the canonical `cn()` (`twMerge(clsx(inputs))`).
4. Rewrite `packages/ui/package.json`: subpath exports (`.`, `./globals.css`, `./lib/*`, `./components/*`, `./blocks/*`) and deps — `@base-ui/react@1.6.0`, `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `lucide-react@1.28.0`, `tw-animate-css@1.4.0`, `shadcn@4.16.1`.
5. Create `apps/web/src/layouts/Layout.astro` — imports `@repo/ui/globals.css`, carries the pre-paint dark script, exposes `<slot />`. **The base has no shared layout today**; all three pages duplicate an inline `<style>`.
6. Port `index.astro`, `terms.astro`, `privacy.astro` onto `Layout`; delete the inline styles.
7. **Add the class-detection smoke test**: `scripts/verify-css.mjs` in the tool repo, appended as a step in the `deps:verify` pipeline after `build`. It greps `.dev/playground/dist/**/*.css` for a sentinel utility class emitted only from `packages/ui` source and exits non-zero if missing.

**Gate:** `pnpm deps:verify` green **and** the smoke test passes.

### Phase 2 — `components.json` + vendored primitives (#42)

1. Add `packages/ui/components.json` **only** (no app-side file until `admin` exists) — `style: "base-nova"`, `baseColor: "neutral"`, `cssVariables: true`, `rsc: false`, `iconLibrary: "lucide"`, blank `tailwind.config` (required for v4), aliases routing `ui`/`utils` at `@repo/ui`.
2. Vendor the primitives the blocks need into `packages/ui/src/components/`: `button`, `input`, `label`, `card`, `badge`, `accordion`, `separator`.
3. Strip any `"use client"` the CLI injects — harmless in Astro, but noise.
4. Document extension in the base `AGENTS.md` + `README.md`: run the CLI **from `packages/ui`** (e.g. `pnpm -C packages/ui dlx shadcn@latest add <x>`), using **`pnpm dlx`**, never `npx` — the base `AGENTS.md` bans `npx` outright.

**Gate:** `pnpm deps:verify` green.

### Phase 3 — The blocks (#43)

Build `packages/ui/src/blocks/`: `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer`.

- Props-driven with sensible defaults — configurable without editing, but not over-abstracted. These are you-own-the-code, meant to be edited.
- **Each block is entirely self-contained in one `.tsx`.** Compound primitives (accordion, dropdown, dialog) throw "X must be used within Y" if composed across the `.astro` boundary, because each island is a separate React root. Composing whole blocks is the fix, and it falls out of the `.tsx` decision for free.
- Avoid filenames starting with `_` — `copyTemplate` renames `_foo` → `.foo`.
- **No barrel re-exports of blocks** from the root `.` export — each block is reachable only via its `./blocks/*` subpath, so importing one block never pulls in the others' dependencies.

**Gate:** `pnpm deps:verify` green.

### Phase 4 — Compose the landing page (#43)

1. Rewrite `index.astro` to compose blocks, **keeping the `sections/*.astro` glob** intact.
2. Static-render by default. Hydrate only what needs it: navbar mobile menu, pricing toggle, FAQ accordion — `client:visible` / `client:idle`, never a blanket `client:load`.

**Gate:** playground page loads; confirm the JS payload for static blocks is ~zero.

### Phase 5 — Downstream reconciliation (#44)

Restyle the `waitlist` module (`modules/waitlist/files/web/`) — `WaitlistForm.tsx` and `waitlist.astro` — against `@repo/ui` primitives. Its raw HTML will look broken beside styled blocks. Re-run `docs/qa/qa-waitlist-module-2026-07-24.md`.

### Phase 6 — Docs & governance (#43)

1. **New ADR** superseding ADR 0003's "no Tailwind" clause. It records: the base-template choice; the `base-nova` bet **and its escape hatch** (template can swap families; initted projects insulated); the **narrowed inert thesis** (base stays inert on functional surfaces — presentation deps rot aesthetically, not dangerously); the **one-time-gift consequence** (base files unmanaged, no update path, by design); and the decision to keep `shadcn` as a live runtime dep.
2. `CONTEXT.md`: update the **Base** definition; add a **Block** term.
3. Base `AGENTS.md` / `README.md`: `@repo/ui` conventions + the shadcn CLI recipe.
4. `pnpm deps:check` green.

## Resolved during grill (2026-08-01)

All nine open questions were settled; resolutions live in the **Design decisions** table and are folded into the phases above. In brief:

1. **Update path** — one-time gift accepted; `init` stays a pure copy. Recorded in the ADR.
2. **`base-nova` maturity** — proceed; escape hatch is a template-side family swap (see decisions table).
3. **Near-inert thesis** — narrowed, not refuted; the ADR reframes it around functional vs presentation surfaces.
4. **`shadcn` runtime dep** — kept live; ejecting creates silent drift against future CLI-added components.
5. **Pins** — exact is authoritative; Phase 0 migrates all remaining ranges.
6. **Smoke test** — `scripts/verify-css.mjs` step in the `deps:verify` pipeline.
7. **Astro 7 breaking changes** — surveyed (see Phase 0); nothing reshapes Phase 1. `import.meta.glob` survives; the real v7 risks are strict HTML errors and `compressHTML: 'jsx'` whitespace.
8. **`apps/web/components.json`** — deferred until `admin` exists; `packages/ui` only, CLI run from `packages/ui`.
9. **Tree-shaking** — resolved by design (per-block subpath exports, no barrel re-exports).

## Non-goals

- **App-shell blocks** (dashboard, sidebar, data table, stat tiles) — `apps/admin` doesn't exist; building for it now is speculative.
- **Auth/form blocks** beyond restyling the existing waitlist form.
- **A theme-switcher UI.** Dark mode follows the OS; a toggle is a later concern.
- **Publishing blocks as a public shadcn registry** — internal to the base for now.
- **Converting `packages/ui` into a module.** Explicitly rejected in favor of the base; the update-path question that could have forced it was resolved in favor of the one-time gift.
- **Restyling any module other than `waitlist`.**
