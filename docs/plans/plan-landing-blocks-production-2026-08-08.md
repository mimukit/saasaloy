# Plan — Production-ready landing blocks

Grilled: 2026-08-08

Tracked: [#60](https://github.com/mimukit/saasaloy/issues/60)

## Context

Epic [#40](https://github.com/mimukit/saasaloy/issues/40) gave the base template seven marketing blocks — `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer` — and proved the design layer works. PR [#68](https://github.com/mimukit/saasaloy/pull/68) adds an eighth, `theme-toggle`, so **eight** is the number this work inherits. They are demonstration-grade: enough to show that a styled landing page composes, not enough that a founder could put the output in front of a visitor.

[ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md) makes that a permanent condition rather than a temporary one. Base files are a **one-time gift**: `init` is a pure copy, there is no manifest entry, no content hash, no `--diff` update path. Whatever quality the blocks have when `init` runs is the floor every downstream project inherits forever. Raising it once is worth more than it looks — and every decision below is weighed against "every generated project carries this permanently."

**Success** = the page `saasaloy init` produces is one a founder ships after replacing the copy, not one they rebuild. Concretely: it clears the rubric below, it still ships near-zero JavaScript, and it does not read as a stock shadcn demo.

### What is actually wrong today

Read against the eight blocks as they stand:

- **The "content through props" criterion is already largely met.** Every block is props-driven with in-file copy defaults. The real gap is media and rich content — Astro serializes island props, so a component or a slot cannot cross the `.astro` boundary. That constraint is load-bearing and shapes the whole plan.
- **The generic-default tells are concrete.** `feature-grid.tsx` is six uniform cards in a 3-column grid — the exact reflex the issue names. `hero.tsx` is badge → `h1` → paragraph → two centered buttons, with no visual anchor at all. There is no `--font-sans` token at all, so every generated site renders in Tailwind's default system stack.
- **Section rhythm is inconsistent.** `hero` is `py-24 sm:py-32`; every other block is `py-20`. `faq` is `max-w-3xl`; everything else is `max-w-6xl`. Nothing chose this.
- **Real defects.** `footer.tsx`'s `year = new Date().getFullYear()` evaluates at **build time** in a static build, so a site built today displays 2026 forever. `cta.tsx` ships both default `href`s as `/`. `pricing-table.tsx` signals the featured tier with `ring-primary` alone — a colour-only distinction — and changes prices with no live announcement. The navbar's mobile menu handles Escape but does not lock body scroll, contain focus, or close on outside click.
- **Page-level essentials are missing entirely.** No skip-to-content link, no Open Graph or canonical metadata in `Layout.astro`, no 404 page, no favicon. (`astro.config.mjs` already sets `site: "https://example.com"`, so canonical and absolute OG URLs have a base to build from.)

### The verification reality

**This repo has no CI.** There is no `.github/` directory. `deps:verify`, `deps:check`, `verify:css` and `verify:preset` are all run by hand and documented in `CONTRIBUTING.md`. Any gate this plan adds inherits that condition; "wire it into CI" is not an available move without introducing CI, which is out of scope here.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **The production bar** | An explicit **rubric** (below), enforced by a new `scripts/verify-a11y.ts` driving Playwright + axe over the built playground at four viewports in both themes. Wired to `pnpm verify:a11y`, **run manually and listed in CONTRIBUTING's gate table** — the same footing as every other gate in this repo. Not inside `deps:verify`: that would make a browser download the price of every dependency bump. Taste rows stay owner-judged; the mechanical rows stop being taste. |
| **CI** | **Out of scope, filed separately.** "A gate nobody runs is not a gate" is a real objection, but it applies equally to `deps:verify` and `deps:check` today. The fix is repo-wide CI adoption, not a workflow smuggled in under a UI issue. |
| **Scope of polish** | **Blocks + theme tokens.** Vendored primitives in `src/components/` stay untouched (ADR 0022 deliberately keeps them aligned with what a later `shadcn add` produces). |
| **Palette** | **Grayscale stays.** The shadcn `neutral` token set is not replaced. A scaffolding template that picks an accent picks it for every downstream founder, permanently and with no update path; #64's preset switcher already makes colour a runtime choice for anyone who wants one. Identity is carried by **typography, layout, rhythm and motion** instead — the harder route, and the one that does not impose a brand. |
| **Typography** | **Ship a real typeface: Instrument Sans (UI) + Instrument Serif (display headings).** With colour off the table, type is the primary identity lever. A display serif against a neutral sans is what separates "grayscale on purpose" from "nobody picked a colour." This is a deliberate imposition, accepted knowingly — unlike an accent hue, a typeface is swappable by changing two `@import`s and two tokens. |
| **Font delivery** | **Self-hosted via exact-pinned Fontsource npm packages**, `@import`ed in `globals.css`: `@fontsource-variable/instrument-sans@5.3.0` (variable) and `@fontsource/instrument-serif@5.3.0` (static regular + italic; Instrument Serif has no variable cut). **No `<link>` to `fonts.googleapis.com`** — that is a blocking cross-origin request in an edge-static template, and it transmits every visitor's IP to Google without consent, which LG München I ruled a GDPR violation in Jan 2022 and which triggered a wave of warning letters across DE/AT. Shipping that into every generated EU project, with no update path, is not a trade worth making for markup convenience. |
| **Not the Astro fonts API (yet)** | Astro 7's fonts API is stable and would give subsetting plus `<Font />` preloading, but its `google` provider fetches from an unpinned upstream at build time — invisible to `deps:update` and to every gate this repo has, which is the exact failure class [ADR 0016](../adr/adr-0016-in-script-cooldown-gate-for-invisible-manifests-2026-07-24.md) exists to close. Its npm/Fontsource provider would be pinned *and* optimised; the config shape was not confirmed from the docs, so it is a **candidate upgrade after Phase 2 lands**, not the starting point. |
| **Block set** | **Expand to 14.** Polish the eight, add six: `logo-cloud`, `testimonials`, `stats`, `showcase`, `integrations`, `cta-banner`. Ship all fourteen composed on the page. |
| **Pruning** | **Documented deletion, not a prompt.** A block is one self-contained file behind a wildcard subpath export, so removing one is `rm` plus a line in `index.astro`. That recipe goes in the base `README.md` and `AGENTS.md` as a **supported operation**. A block-selection prompt at `init` would turn ADR 0022's pure copy into a conditional scaffold. |
| **FAQ** | **Native `<details name="faq">`.** Native single-open (Baseline since Sept 2024, ~97%; degrades to independent toggles), works with JavaScript off, drops an island. `accordion.tsx` **stays vendored** — it is the worked example the base `AGENTS.md` teaches compound-primitive island boundaries from, and it is still what `shadcn add` expects to find. |
| **Tailark's role** | **Layout reference only, our identity.** With grayscale and our own typeface settled, what is taken from [tailark/blocks](https://github.com/tailark/blocks) is *arrangement* — no code, no palette, no type, no assets. It cannot be vendored anyway (see below). |
| **Attribution** | **`NOTICE` at this repo's root only**, naming tailark/blocks (MIT) as a layout reference, plus one sentence in the ADR 0022 amendment. Nothing enters the template: no generated project should inherit a licence file for code that was never copied. |
| **Motion** | **CSS-only, zero JavaScript.** `tw-animate-css@1.4.0` is already pinned in `@repo/ui`, so this needs no new template dependency. Three tiers: (1) hover/focus transitions and the marquee, always on; (2) a **load-time cascade for the hero**, which needs no scroll timeline and therefore works everywhere; (3) **below-the-fold entrance animation** gated behind `@supports (animation-timeline: view())` **and** `@media (prefers-reduced-motion: no-preference)`. `motion` (Framer Motion) is **rejected** — it forces a `client:*` directive onto every animated block, which is the property #40 was built to protect. IntersectionObserver is rejected for the same reason. |
| **Motion is additive, never subtractive** | The un-animated state is the **correct, visible** state. No block starts at `opacity: 0` outside the `@supports` block. Scroll-driven animation is ~85% global with Firefox still behind `layout.css.scroll-driven-animations.enabled`; a Firefox visitor must see a complete page, not a blank one. |
| **Imagery** | **Token-drawn inline SVG placeholders.** A "product screenshot" mock built from design tokens — no binary asset, no licence question, correct in both themes, and obviously a placeholder so nobody ships it by accident. Image-led layouts work at `init` with zero payload. |
| **Brand logos** | **None, ever.** `logo-cloud` and `integrations` ship token-drawn placeholder marks with a documented swap point. Tailark's blocks import 20 third-party brand SVGs (Spotify, Vercel, Supabase, OpenAI, Claude…); shipping those in a scaffolding template means every generated site claims customers it does not have, over trademarks we do not hold. |
| **`integrations` naming** | **Keep the name; ship placeholder-labelled tiles** — `Your CRM`, `Your billing`, `Your warehouse`. The block is a *layout the founder fills*, and its name describes what founders put there. `testimonials` ships no real testimonials either and nobody finds that misleading; explicit placeholder labels stop an unedited ship reading as a claim. |
| **Page-level essentials** | **In scope here.** Skip link, OG/Twitter/canonical, `404.astro` and favicon all land in `Layout.astro` and `index.astro` — the two files this plan already rewrites. Splitting them out buys a clean conceptual seam and costs a second rebase over the same lines. With `site` already configured, canonical and OG URLs are `new URL(Astro.url.pathname, Astro.site)`. |
| **`theme-toggle`** | **Rubric yes, restyle no.** It must clear `verify:a11y` and consume the new rhythm and type tokens, but its markup and its seat beside `<Navbar />` are #64's decision and stay. This plan does not re-litigate a merged PR. |
| **Rubric durability** | **A tool-repo artefact**, at `docs/qa/landing-page-rubric.md`. Its *contract* — one `h1`, AA in both themes, additive motion, named-and-justified islands — is restated in the base `AGENTS.md` so the agent editing blocks downstream is told to preserve it. `verify-a11y` does **not** ship into the template: Playwright in every generated project is a large permanent payload against ADR 0022's deliberately minimal gift. |
| **Naming** | Semantic kebab-case, unchanged from ADR 0022 — `logo-cloud.tsx`, `cta-banner.tsx`. Never Tailark's or shadcn's `{category}-{NN}` numbering. |
| **Sequencing** | **Land after [#68](https://github.com/mimukit/saasaloy/pull/68) merges.** It is open and mergeable, and rewrites `Layout.astro`, `index.astro`, `globals.css` and `AGENTS.md` — the same files this work rewrites — while adding `theme-toggle.tsx`, `lib/theme.ts` and `scripts/verify-preset.ts`. Rebase on it. #62 and #61 follow this. |
| **Relationship to #64** | This work **does not touch** the theme control. Token work must keep the preset swap green (`pnpm verify:preset`). Grayscale actually makes this easier: presets have nothing to fight. |

### Why Tailark cannot be vendored

Verified against the repo at `registry/bases/base/dusk/` (MIT, 2.3k stars, pushed 2026-07-29). The public per-item endpoints at `tailark.com/r/<item>.json` return **401** — those are the pro catalogue, correctly excluded. Of the free Base-UI `dusk` blocks:

- `next/image` and `next/link` throughout — neither exists in an Astro React island.
- `'use client'` on 20 files; `motion` (Framer Motion) on 10, essentially every logo-cloud marquee.
- 20 third-party brand SVGs, plus a testimonial pulling a remote Pexels video.
- Hardcoded copy with **no props at all**, and raw palette classes (`bg-stone-100`, `bg-emerald-600`, `text-black`) that bypass the token system and break dark mode outright.

So the rewrite happens whether we start from their diff or from a blank file — starting from the diff just adds a cleanup pass. What is genuinely worth taking is the **layout vocabulary**: asymmetric two-column section headers (heading left, body right), border-top stat rows, spanning bento grids. That is the direct antidote to our reflexive 3-column card grid, and with grayscale settled it is the main thing carrying identity.

## Approach

### What this reuses

- **`@repo/ui`'s `./blocks/*` subpath export** — already a wildcard, so six new blocks need zero packaging work and the no-barrel guarantee holds automatically.
- **`copyTemplate`** (`packages/cli/src/lib/scaffold.ts`) — recursively walks the template, so new files need no CLI change.
- **`scripts/verify-css.ts`** — the shape `verify-a11y.ts` copies: a TypeScript script under the root `typecheck:scripts` gate, asserting something `build` cannot see.
- **`pnpm verify:preset`** (#64) — the precedent for a manual gate documented in CONTRIBUTING rather than automated.
- **`tw-animate-css@1.4.0`** — already pinned in `@repo/ui`; motion adds no template dependency.
- **The `@theme inline` token contract** — `--font-sans` and `--font-serif` are already Tailwind theme keys, so typography lands as tokens, not utilities.
- **`pnpm deps:update` / `deps:check`** — the two Fontsource packages are template deps in `@repo/ui`'s `package.json`, so they enter the existing invisible-manifest tracking with no new machinery (ADR 0016).
- **The block conventions in the template's `AGENTS.md`** — one file, one export, props-with-defaults, no component props across `.astro`. New blocks inherit them; the doc gains rows, not rules.
- **`.dev/playground`** — the base template is not a workspace member, so `pnpm deps:verify` remains the only real gate. Every phase ends there.

### The production bar

The rubric (durable copy: `docs/qa/landing-page-rubric.md`). Rows marked **gate** fail `pnpm verify:a11y`; the rest are judged against the QA plan.

| Row | Bar | How it is judged |
|-----|-----|------------------|
| Responsive | No horizontal scroll, no clipped content, no orphaned control at 360 / 768 / 1280 / 1536 px | gate (overflow assertion) + QA |
| Keyboard | Every interactive element reachable and operable; visible focus ring; no trap; logical order; skip link first | gate (axe) + QA |
| Semantics | One `h1`; ordered headings; `header`/`nav`/`main`/`footer` landmarks; lists are lists; `aria-hidden` on decorative icons | gate (axe) |
| Contrast | WCAG AA for every text/background pair, **light and dark** | gate (axe, run twice) |
| Colour independence | No state signalled by colour alone (the featured pricing tier is the live offender) | QA |
| JS budget | Static blocks ship zero JS; hydrated islands are named and justified in `index.astro` | gate (built-asset assertion) |
| Motion | Animation is additive; `prefers-reduced-motion` honoured; page complete without `animation-timeline` support | QA (Firefox + reduced-motion pass) |
| Content | Every block's copy and links reachable through props; no string a founder must hunt for in markup | review |
| Identity | Deliberate, not stock — type pairing used with intent, asymmetry where it earns its place, consistent rhythm | owner |

---

### Phase 1 — Rebase, rubric, and the a11y gate

1. Rebase on `main` once #68 merges. Confirm `pnpm deps:verify` and `pnpm verify:preset` are green **before** any block changes, so later failures are attributable.
2. Write `docs/qa/landing-page-rubric.md` — the durable artefact; this plan is not its home.
3. Add `scripts/verify-a11y.ts`: serve `.dev/playground/dist` from `node:http` (no dependency), drive Playwright Chromium over `/`, `/terms`, `/privacy` at 360/768/1280/1536, in light and forced `.dark`, run `@axe-core/playwright` at `wcag2a`/`wcag2aa`/`wcag21aa`, plus the overflow and JS-budget assertions. Fail loudly with an actionable message when `dist` is absent rather than reporting a false pass. Non-zero exit on any violation.
4. Wire `pnpm verify:a11y` and add it to CONTRIBUTING's gate table beside `verify-css` and `verify:preset`. Playwright and `@axe-core/playwright` are **root devDependencies of the tool repo only** — no init payload. Install Chromium only (`playwright install --with-deps chromium`).
5. Baseline the current eight and record the violations. This is the before-picture the issue's audit criterion asks for.
6. File the CI-adoption issue separately, referencing this gate and the three that already exist.

**Gate:** `verify:a11y` runs and reports; `deps:verify` still green.

### Phase 2 — Design identity: typography, rhythm, motion, placeholder

1. Add `@fontsource-variable/instrument-sans@5.3.0` and `@fontsource/instrument-serif@5.3.0` as exact-pinned dependencies of `@repo/ui`. `@import` them at the **top** of `globals.css` (CSS `@import` must precede other rules) and map `--font-sans` / `--font-serif` in `@theme inline`. Confirm `pnpm deps:check` picks both up.
2. Build the type scale on that pairing: serif for display headings, sans for UI and body — weights, tracking, measure and a deliberate size ramp. This is where identity lives now that colour is off the table.
3. **Do not touch the palette.** The grayscale `neutral` token set stays as-is; verify AA contrast is already met in both themes and record it, rather than re-deriving it.
4. Add section-rhythm tokens so blocks stop hardcoding `py-20` against `py-24 sm:py-32`. One container width; `faq`'s narrower measure becomes a deliberate variant, not an accident.
5. Add the motion layer to `globals.css` as named utilities — hero load cascade (ungated, works everywhere), scroll entrance (double-gated), marquee, hover lift. Blocks reference class names; no block writes keyframes.
6. Build the token-drawn placeholder as a block-local inline SVG helper (**not** a shared component — Astro island boundaries make a shared visual component a liability, and each block owning its own mock keeps the one-file rule).
7. Re-run `pnpm verify:preset`: a preset swap must still override tokens cleanly.
8. **Optional follow-up, only if Phase 2 is green:** evaluate Astro 7's fonts API with its npm/Fontsource provider as a drop-in upgrade for subsetting and `<Font />` preload. Do not block the phase on it.

**Gate:** `deps:verify` + `verify:css` + `verify:preset` + `deps:check` green; contrast rows pass in both themes; fonts render with no network request at runtime.

### Phase 3 — Rework the eight

Each block re-lands against the rubric. The specific work, from reading them:

- **`navbar`** — lock body scroll while the mobile panel is open, contain focus within it, close on outside click, mark the current anchor. Stays `client:idle`. Leaves the seat beside it free for #64's control.
- **`hero`** — break the centred badge/`h1`/paragraph/two-buttons default. Asymmetric layout anchored by the token-drawn mock, with the serif display face carrying the headline and the load-time motion cascade. Single `h1` preserved.
- **`feature-grid`** — retire the six-uniform-cards reflex for an arrangement where one feature leads. Icons stay decorative and `aria-hidden`.
- **`pricing-table`** — the billing control becomes a real radio group; price changes announce via `aria-live`; the featured tier gains a non-colour signal alongside the ring; each tier gets its own heading and its feature list an accessible name.
- **`faq`** — move to native `<details name="faq">`/`<summary>`. Drops a hydrated island, works with JavaScript off, accessible by default, single-open preserved natively. `accordion.tsx` stays vendored.
- **`cta`** — a deliberate band rather than `bg-muted` plus a hairline ring. Fix both default `href`s, which currently point at `/`.
- **`footer`** — fix the frozen copyright year (compute it in the browser or drop the year, but do not ship a build-time constant that silently rots). Add the rows a real footer carries.
- **`theme-toggle`** — rubric only. Verify it clears `verify:a11y` and consumes the new tokens. Markup and placement unchanged.

**Gate:** `verify:a11y` clean for all eight; `deps:verify` green.

### Phase 4 — The six new blocks

Each is one self-contained `.tsx` with props-and-defaults, reached only by its `./blocks/*` subpath.

- **`logo-cloud`** — token-drawn placeholder marks, CSS marquee, paused under reduced motion. Documented swap point for real logos.
- **`testimonials`** — a spanning grid, not a row of equal cards. Quote, attribution, role. No avatars shipped.
- **`stats`** — border-top numeric rows against an asymmetric header, set in the display serif. The credibility block the set lacks entirely.
- **`showcase`** — image-led narrative section (Tailark calls this `content`), alternating sides, anchored by the placeholder mock.
- **`integrations`** — token-drawn tiles labelled `Your CRM`, `Your billing`, `Your warehouse`. A layout the founder fills, explicitly placeholdered so an unedited ship makes no claim.
- **`cta-banner`** — a lighter mid-page call to action, distinct in weight from the closing `cta`.

**Gate:** `verify:a11y` clean for all fourteen; `deps:verify` green.

### Phase 5 — Compose the page and the page-level essentials

1. Rewrite `index.astro` to compose the expanded set, keeping the `sections/*.astro` glob intact (#62 retires it later, not here) and #64's control in place.
2. Keep the hydration comment honest — after Phase 3 only `navbar`, `pricing-table` and `theme-toggle` carry a directive.
3. Add a skip-to-content link, Open Graph / Twitter / canonical metadata to `Layout.astro` (via `new URL(Astro.url.pathname, Astro.site)`), a `404.astro`, and a favicon.

**Gate:** `verify:a11y` clean; JS budget assertion passes; `deps:verify` green.

### Phase 6 — Docs and governance

1. **Amend ADR 0022** (do not supersede — its decisions all still hold) with: the grayscale-stays reasoning, the shipped-typeface decision and why a Google Fonts `<link>` was rejected, the CSS-only motion stance and why `motion` was rejected, the no-brand-logos rule, and the expansion from 8 to 14 blocks. One sentence crediting tailark/blocks as layout reference, linking the root `NOTICE`.
2. Base `AGENTS.md` — the new blocks, the motion utilities, the placeholder swap point, the no-brand-logos rule, the font swap point, the block-deletion recipe, and the rubric contract restated as rules for downstream editors.
3. Base `README.md` — the composed page, the block list, and the "delete what you don't use" recipe as a supported operation.
4. Add a `NOTICE` at **this repo's root** crediting tailark/blocks (MIT) for layout reference. Nothing enters the template.
5. `CONTEXT.md` — the terms this introduces.
6. `CONTRIBUTING.md` — `verify:a11y` joins the gate table.
7. A qakit manual QA plan covering the non-gated rubric rows: colour independence, motion under Firefox and reduced-motion, identity.
8. `pnpm deps:check` green.

## Deferred by decision

Not open questions — resolved as "not here":

- **CI adoption.** Filed as its own issue. Until it lands, `verify:a11y` is manual like every other gate in this repo.
- **Astro fonts API.** Fontsource `@import`s ship first; the fonts API's npm provider is a candidate upgrade once Phase 2 is green and its config shape is confirmed.
- **An accent colour.** Grayscale is the shipped default. #64's preset switcher is the affordance for anyone who wants colour; no branded preset is authored here.

## Non-goals

- **Copywriting.** [#61](https://github.com/mimukit/saasaloy/issues/61) owns the copy interview; this work makes the content surfaces it writes into.
- **Retiring the `sections/*.astro` glob.** [#62](https://github.com/mimukit/saasaloy/issues/62) owns it; the glob stays intact here.
- **The theme switcher.** [#64](https://github.com/mimukit/saasaloy/issues/64) / PR #68 owns it. This work rebases on it and must not regress it.
- **Editing the vendored primitives** in `src/components/` — ADR 0022 keeps them aligned with what a later `shadcn add` produces.
- **App-shell blocks** (dashboard, sidebar, data table) — `apps/admin` still does not exist.
- **Publishing the blocks as a public shadcn registry.**
- **Vendoring Tailark**, adding `motion`, or shipping any third-party brand asset.
- **A block-selection prompt at `init`** — ADR 0022's pure copy stands.
- **Shipping `verify-a11y` into the template.**
- **SEO beyond the page itself** — no sitemap, no structured data, no keyword work.
- **An update path for base files.** ADR 0022 settled this; the one-time gift stands.
