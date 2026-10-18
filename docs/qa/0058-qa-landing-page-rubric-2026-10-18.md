# Rubric: the landing page as a production template

_Written 2026-10-18 for [plan 0068](../plans/0068-plan-landing-page-template-2026-10-18.md) Phase 1 · tracked in #191 · applies to `packages/cli/templates/base/apps/web/src/pages/index.astro`, the thirteen landing blocks in `packages/ui/src/blocks/`, and `Layout.astro`_

## How to read this

The rubric is the production bar the plan names. A page passes when every row passes. Each row has one of three kinds:

- **gate**: `pnpm verify:a11y` or another `pnpm verify:*` script checks it. A violation exits non-zero. No person judges it.
- **QA**: a person checks it by hand on a built playground, with the steps in the row.
- **owner**: the repo owner judges it. No script or step can settle it.

`verify:a11y` serves `.dev/playground/apps/web/dist` and drives Chromium over `/`, `/terms`, `/privacy` and `/404` at 360, 768, 1280 and 1536 px, in the light and the dark theme. That is 32 page loads per run. Phase 2 adds the script. Until then, every gate row is unchecked.

## Rows

| Row | Kind | Pass when |
|-----|------|-----------|
| Responsive: no overflow | gate | At each of the four widths, `document.documentElement.scrollWidth` is not greater than the viewport width, on every route. |
| Responsive: layout at each width | QA | At 360, 768, 1280 and 1536 px, no text clips, no button wraps its label, and no two-column layout squeezes a column below about 16rem. |
| Keyboard: reach and operate | QA | Tab reaches every link, button, radio and `summary` in DOM order. Enter or Space operates each. The navbar's mobile panel opens, holds focus inside it, closes on Escape and on an outside click, and returns focus to the menu button. |
| Keyboard: visible focus | gate | axe reports no `focus-order-semantics` or `scrollable-region-focusable` violation. A QA pass confirms that every focused control shows the `--ring` outline. |
| Keyboard: skip link | gate | The first Tab stop on every route is a skip link whose target is `<main>`. |
| Semantics: landmarks and headings | gate | axe at `wcag2a`, `wcag2aa` and `wcag21aa` reports no violation. Each route has exactly one `h1`, one `main`, and a `nav` with an accessible name. |
| Semantics: controls | gate | The billing control is a `radiogroup` (native radios in a `fieldset` with a `legend`). FAQ items are native `details` elements with a shared `name`. Each pricing tier has a heading. |
| Contrast: light theme | gate | axe `color-contrast` passes on every route at every width with the `light` class. |
| Contrast: dark theme | gate | The same check passes with the `dark` class. |
| Colour independence | gate + QA | The featured pricing tier carries a text badge, so colour is not its only mark (gate: the badge element exists). A QA pass in a greyscale filter confirms that no state relies on hue. |
| Live price change | gate | The element that shows a tier's price has `aria-live="polite"`. Switching the billing radio changes its text. |
| JS budget: islands | gate | The built `index.html` holds exactly two `astro-island` elements, `Navbar` and `PricingTable`. No other block hydrates. |
| JS budget: inline scripts | gate | The only inline scripts on `/` are the theme pre-paint script from `Layout.astro` and the footer year script. |
| JS budget: no-JS render | QA | With JavaScript off, all thirteen sections render, the FAQ and the pain-points list open and close, the open pain point shows its own visual, the footer shows the build year, and every link works. |
| Motion: reduced motion | gate + QA | With `prefers-reduced-motion: reduce` emulated, no element has a running animation (gate: `document.getAnimations()` returns none that run). A QA pass confirms that the logo row wraps as a static row. |
| Motion: additive | QA | With animations disabled in DevTools, every element sits in its final visible place. Nothing waits on an animation to appear. |
| Motion: budget | owner | Only the hero cascade, the gated scroll entrance, the logo marquee and the hover lift move. Nothing else animates. |
| Content: one source | gate | `pnpm verify:content` passes. Every visible string comes from `landing.*` or `ui.*`. |
| Content: placeholders read as placeholders | owner | Testimonials, logo marks and mock screens are plainly placeholders. No invented customer name, metric, quote or trademark ships. |
| Content: two edits | QA | A rewrite of `landing.ts` plus a section change in `index.astro` produces a finished page with no other file edited. Test it by removing `testimonials` and reordering `showcase` above `feature-grid`. |
| Footer year | QA | Build with the system clock set to an earlier year. The built HTML shows that year in the `data-year` span. The browser shows the current year. |
| Page metadata | gate | The built `/` carries `og:title`, `og:description`, `og:url`, `twitter:card` and a canonical link. |
| Theme presets | gate | `pnpm verify:preset` passes: a preset still overrides every token the blocks read. |
| Identity | owner | The page reads as the Tailark visual language of karigorai.com and bornoai.com, not as a stock shadcn demo. Each section matches the layout the owner picked in Phase 1. |

## Not on this rubric

- Real screenshots, real logos and real quotes. They are the founder's job after `init`.
- Lighthouse scores. The JS budget and contrast rows cover what the plan asks for, and a score moves with the machine that runs it.
