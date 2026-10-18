# Plan: landing page as a reusable production template

Grilled: 2026-10-18

Tracked: [#191](https://github.com/mimukit/saasaloy/issues/191), a sub-issue of [#183](https://github.com/mimukit/saasaloy/issues/183)

Supersedes: [`0025-plan-landing-blocks-production-2026-08-08.md`](0025-plan-landing-blocks-production-2026-08-08.md) (grilled for #60, never built)

## Context

A new project gets the base template's landing page from `saasaloy init`. The page works, but it reads as a stock shadcn demo: a centered badge, `h1`, paragraph and two buttons in the hero, six equal cards in a three-column grid, and a closing `bg-muted` box. A founder rebuilds it before they show it to anyone.

**Success:** a founder ships the page after two edits, and no others. They rewrite `packages/ui/src/content/landing.ts` (every word, link, price and icon name) and they add, remove or reorder sections in `apps/web/src/pages/index.astro`. The page that results looks finished in light and dark themes, at every width, and still ships near-zero JavaScript. Real customer logos are the one stated exception: their SVG drawings go into the `logo-cloud` block's registry, the same way a new feature icon goes into `feature-grid.tsx`.

### Why a new plan and not #60

Plan 0025 covered the same goal and was grilled on 2026-08-08. Issue #60 was closed as completed the same day, but no phase was built. The template still has the original seven landing blocks, no motion layer, no `verify:a11y` gate and no rubric. Several of 0025's premises have also moved:

- **The base is no longer a one-time gift.** ADR 0032 tracks base files. `_saasaloy-base.json` lists `packages/ui/src/blocks/**`, `globals.css` and `Layout.astro` as owned, so `saasaloy update` carries block changes to existing projects. `index.astro` and `landing.ts` are seed files, so `update` never overwrites the owner's page or copy.
- **CI exists.** `.github/workflows/ci.yml` runs `lint`, `typecheck`, `test`, `verify:content` and `verify:pins` on every push.
- **The content module landed (#61).** Every block already reads its words from `landing.ts`, and `pnpm verify:content` fails on copy written back into a block.
- **Page essentials landed.** `Layout.astro` emits a canonical URL and a favicon link, and `404.astro`/`500.astro` render the `error-state` block.

### What is still wrong, read from the code

- `hero.tsx` is the centered default with no visual anchor.
- `feature-grid.tsx` is six uniform cards in a three-column grid.
- Section rhythm is accidental: `hero` uses `py-24 sm:py-32`, the others `py-20`, `faq` is `max-w-3xl` and the rest `max-w-6xl`.
- `footer.tsx` computes `CURRENT_YEAR` at build time, so a static build shows the build year forever.
- `faq.tsx` hydrates the vendored accordion as an island for behavior native `<details>` gives for free.
- `pricing-table.tsx` marks the featured tier by ring colour alone and changes prices with no live announcement.
- The navbar's mobile panel closes on Escape but does not lock scroll, contain focus, or close on an outside click.
- `Layout.astro` has no skip link and no Open Graph or Twitter metadata.
- The page has no social proof and no product visual: no logos, no testimonials, no screenshot.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Relation to plan 0025 | This plan supersedes 0025. It carries over every 0025 decision listed below as "from 0025" and replaces the ones the owner changed or the code made stale. 0025 gains a `Superseded by` line and keeps its file name. |
| Section set | **Ten blocks.** Polish the seven landing blocks (`navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer`) and add three: `logo-cloud`, `testimonials`, `showcase`. `stats`, `integrations` and `cta-banner` from 0025 are dropped. `theme-toggle` and `error-state` stay as they are, outside the count. |
| How a project picks sections | **Explicit imports in `index.astro`, unchanged.** Adding, removing or reordering a section is one import line and one JSX line. A block that a project removes is also deleted from `packages/ui/src/blocks/`. The base `README.md` and `AGENTS.md` document this as a supported operation (from 0025). |
| Palette | **Grayscale stays.** The shadcn `neutral` token set is not replaced. Colour is the theme preset's job (#64). From 0025. |
| Typography | **System font stack, no new font dependency.** This reverses 0025, which shipped Instrument Sans and Serif. Identity comes from layout, a deliberate type ramp, section rhythm and motion. `DESIGN.md` keeps its current `ui-sans-serif` stack. |
| Motion | **CSS only, zero JavaScript, additive.** `tw-animate-css` is already pinned. Hover and focus transitions always on, a load-time cascade for the hero, and below-the-fold entrances gated behind `@supports (animation-timeline: view())` and `prefers-reduced-motion: no-preference`. The un-animated state is the correct, visible state. No `motion` package and no IntersectionObserver. From 0025. |
| Imagery | **Token-drawn inline SVG placeholders.** The `showcase` and `hero` product visuals are mock screens drawn from design tokens: no binary asset, correct in both themes, and plainly a placeholder. Each block owns its own SVG helper, with no shared visual component. From 0025. |
| Brand logos | **None.** `logo-cloud` ships token-drawn placeholder marks. No third-party trademark ships in the template. From 0025. |
| Logo swap point | **The `feature-grid` icon pattern.** `landing.logos.items[]` holds `{ id, name, mark }`, where `mark` is a registry name and `name` is the accessible label. The block holds a registry of inline SVG marks. A founder adds their SVG to the registry and names it in `landing.ts`. A name the registry does not know renders a placeholder mark. |
| Footer year | **The footer emits its own small inline script.** The HTML holds the build year inside a `data-year` span as the no-JS fallback, and a script right after it writes the visitor's current year. Deleting the footer deletes the script. `THEME_INIT_SCRIPT` stays theme-only. |
| Mock screens | **Each block draws its own.** `hero` and `showcase` each hold their own token-drawn SVG, so deleting a block removes all of its code. |
| Testimonials | Placeholder quotes that read as placeholders ("Your customer's words go here"), a name and a role, no avatar image. The content lives in `landing.ts` like every other string. |
| FAQ | **Native `<details name="faq">`.** Single-open natively, works with JavaScript off, and drops one island. `accordion.tsx` stays vendored. From 0025. |
| Content contract | Every new block follows the `landing.ts` shape rules already in that file: an `id` on every list item, `{token}` placeholders, icons and logos as registry names, and `*Href` values beside the copy. `verify:content` covers the new blocks with no change. |
| Islands | After this work only `navbar` (`client:idle`) and `pricing-table` (`client:visible`) hydrate. Every other block, the three new ones included, ships no island. The footer's inline year script is the one other script on the page. |
| The production bar | An explicit rubric with mechanical rows enforced by a new `scripts/verify-a11y.ts` (Playwright and axe over the built playground at 360, 768, 1280 and 1536 px in both themes). Playwright stays a root devDependency of this repo and never ships in the template. Chromium is already cached on devaloy, so the gate runs on the dev box. From 0025. |
| Where the gate runs | **Nightly and by hand.** A second job in `.github/workflows/smoke.yml` builds the playground and runs `pnpm verify:a11y` on the existing schedule. `ci.yml` stays free of playground builds. CONTRIBUTING lists the gate. |
| Default page | **All ten sections on the page.** A visible placeholder gets replaced, and a hidden block gets forgotten. Removal is one documented line. |
| Existing projects | New and changed blocks reach existing projects through `saasaloy update`, because blocks are owned files. Their `index.astro` is seed, so a new block appears on their page only when the owner adds it. The base `AGENTS.md` and the release notes name the new blocks. `update` prints nothing extra. |
| Mockup review | **A throwaway HTML mockup rendered in the T3 thread**, never committed. It shows light and dark at a mobile and a desktop width side by side. `hero`, `feature-grid` and `showcase` get two labelled variants each, and the other sections get one proposal. The plan records the picks as text. |
| Tailark | Layout reference only, no code. `NOTICE` at this repo's root names it. From 0025. |

## Approach

Rebuild the landing blocks in place against a rubric, add three blocks, and fix the page shell, with no change to how a page is composed. The two edit points a founder already has, `landing.ts` and `index.astro`, stay the only two they need.

**Reuses:** the `./blocks/*` wildcard subpath export in `@repo/ui` (new blocks need no packaging work), `copyTemplate` and the base tracking from ADR 0032 (new files need no CLI change), the `landing`/`ui` content split and `verify:content`, the `@theme inline` token contract in `globals.css`, `tw-animate-css`, `scripts/verify-css.ts` as the shape for `verify-a11y.ts`, and `.dev/playground` with `pnpm deps:verify` as the build gate.

**Rejected:** a `sections` array in `landing.ts` rendered by a generic loop. Each block needs its own `client:*` decision, and a loop hides that decision in a lookup table. It also moves structure into the seed copy file, which the landing-copy skill rewrites.

### Phase 1: mockup and rubric

1. Build a throwaway HTML mockup of the full ten-section page, in light and dark themes, at a mobile and a desktop width. Use only the current tokens and the system font stack. Give `hero`, `feature-grid` and `showcase` two labelled variants each (A and B) and the other seven sections one proposal. Render it in the T3 thread and do not commit it.
2. Record the owner's pick for each section under this phase, as text.
3. Write the rubric to `docs/qa/` with the next serial. Rows: responsive, keyboard, semantics, contrast in both themes, colour independence, JS budget, motion, content, identity. Mark each row as gate, QA or owner-judged.

Done when: the owner has picked a layout for each of the ten sections, the choice is recorded under this phase, and the rubric file exists.

### Phase 2: the a11y gate

1. Add `scripts/verify-a11y.ts`. It serves `.dev/playground/apps/web/dist` from `node:http`, drives Playwright Chromium over `/`, `/terms`, `/privacy` and `/404` at four widths in both themes, and runs axe at `wcag2a`, `wcag2aa` and `wcag21aa`, plus an overflow assertion and a JS-budget assertion. It exits non-zero on any violation and fails loudly when `dist` is absent.
2. Add `pnpm verify:a11y` and list it in the CONTRIBUTING gate table.
3. Add a second job to `.github/workflows/smoke.yml` that runs `pnpm play:init`, builds the playground, installs Chromium only, and runs `pnpm verify:a11y`.
4. Run it against the current page and record the baseline violations.

Done when: `pnpm verify:a11y` runs on a fresh playground build on devaloy and prints the baseline violations, a `workflow_dispatch` run of `smoke.yml` runs the new job, and `pnpm deps:verify` stays green.

### Phase 3: rhythm, type ramp and motion tokens

1. Add section-rhythm tokens to `globals.css`: one container width, one section padding, and a narrow-measure variant that `faq` uses on purpose.
2. Set a deliberate type ramp on the system stack: display, section title, lead and body sizes, weights and tracking. Update `DESIGN.md`'s typography and components to match.
3. Add the motion layer as named utilities: hero cascade, gated scroll entrance, marquee, hover lift. Blocks use the class names and write no keyframes.
4. Run `pnpm verify:preset` to confirm a preset still overrides the tokens.

Done when: `pnpm deps:verify`, `pnpm verify:preset` and `pnpm lint` pass, and the contrast rows of `verify:a11y` pass in both themes.

### Phase 4: rework the seven blocks

1. `navbar`: lock scroll while the mobile panel is open, contain focus, close on an outside click, and keep `client:idle`.
2. `hero`: replace the centered default with the Phase 1 layout, anchored by a token-drawn product visual, with the load-time cascade. Keep one `h1`.
3. `feature-grid`: replace the six equal cards with the Phase 1 arrangement, where one feature leads.
4. `pricing-table`: make the billing control a real radio group, announce price changes with `aria-live`, add a non-colour mark to the featured tier, and give each tier a heading.
5. `faq`: move to native `<details name="faq">` and remove its `client:visible`.
6. `cta`: build the Phase 1 closing band.
7. `footer`: render the build year in a `data-year` span and emit a small inline script after it that writes the current year. Lay out the Phase 1 rows.
8. Every block uses the Phase 3 rhythm, ramp and motion tokens, and reads all its words from `landing.ts`.

Done when: `verify:a11y` reports no violation on the seven blocks, `pnpm verify:content` passes, the built page hydrates only `navbar` and `pricing-table`, and a page built with a faked earlier year shows the current year in the browser.

### Phase 5: the three new blocks

1. `logo-cloud`: `landing.logos.items[]` as `{ id, name, mark }`, a registry of token-drawn placeholder marks in the block, a fallback mark for an unknown name, and a CSS marquee paused under reduced motion. The block's header comment shows how to add a real logo to the registry.
2. `testimonials`: a spanning grid of placeholder quotes with name and role, not a row of equal cards.
3. `showcase`: an image-led section with alternating sides, anchored by the token-drawn mock screen.
4. Add each block's copy to `landing.*` and any chrome label to `ui.*`, following the shape rules in `landing.ts`.

Done when: all ten blocks pass `verify:a11y` and `verify:content`, and none of the three new blocks ships JavaScript.

### Phase 6: compose the page and the shell

1. Compose all ten sections in `index.astro` in the Phase 1 order, and keep the hydration comment true for the two remaining islands.
2. Add a skip link, Open Graph and Twitter metadata to `Layout.astro`, built from `PUBLIC_SITE_URL` and `landing.meta.*`.
3. Update the navbar and footer anchors for the new sections, with an empty label still hiding a link.

Done when: the playground's `/` renders all ten sections, `pnpm verify:a11y` passes on `/`, and the built HTML carries a skip link, `og:title`, `og:description`, `og:url` and `twitter:card`.

### Phase 7: docs and skills

1. Document the section recipe (add, remove, reorder, delete the block file) and the logo recipe in the base `README.md` and `AGENTS.md`, and restate the rubric contract there. Name the three new blocks in `AGENTS.md`, so an existing project that runs `saasaloy update` learns they exist.
2. Update `saasaloy-landing-copy` so its draft covers the three new blocks' copy.
3. Update `saasaloy-design` and `DESIGN.md` for the new layout vocabulary and tokens.
4. Add the `Superseded by` line to plan 0025 and the `NOTICE` entry for Tailark.

Done when: a fresh `pnpm play:init` project's `README.md` shows the section recipe, and the landing-copy skill writes a draft that covers all ten sections.

## Open questions

None. The grill on 2026-10-18 settled every open question.

## Non-goals

- The auth screens and the signed-in customer panel. They stay in #183.
- The admin panel. That is #192.
- A brand accent colour or a new typeface.
- Changes to the vendored primitives in `packages/ui/src/components/`.
- A block-selection prompt at `init`.
- The `stats`, `integrations` and `cta-banner` blocks from plan 0025.
- The dev-only UI gallery route (#185).
