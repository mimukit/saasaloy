# QA Plan: Landing page as a reusable production template

_Generated 2026-10-18 · against `1213eb5` (uncommitted changes: the full #191 build) · covers the thirteen landing blocks, the real Saasaloy copy, the skip link and link-preview tags, the `verify:a11y` gate, the docs and the skills_

## Summary

- A fresh `saasaloy init` project ships a thirteen-section landing page in the Tailark style that describes Saasaloy, with near-zero JavaScript.
- "Working" means the page reads well in both themes at every width, every interaction works by keyboard and pointer, and a founder can rewrite or reshape it with two edits.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-191-polish-the-landing-page-into-a-reusable-production`.
- Use a desktop Chromium-based browser and a desktop Firefox or Safari. Open DevTools when a step asks for it.
- The playground at `.dev/playground` is the test subject. The commands below scaffold it fresh from the template.
- The site is the built output, served as static files at `http://127.0.0.1:4321`.

Scaffold the playground from the template:

```sh
pnpm install && pnpm play:init
```

Seed the local environment values and write each service's `.env`:

```sh
cp .dev/playground/packages/env/.env.example .dev/playground/packages/env/.env && pnpm -C .dev/playground env:setup
```

Build the playground:

```sh
pnpm -C .dev/playground build
```

Serve the built site in a second terminal, and leave it running:

```sh
python3 -m http.server 4321 -d .dev/playground/apps/web/dist/client
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Built site, desktop, motion on | The page reads well in the light theme | 🔴 Critical |
| TC-1.2 | 1: Built site, desktop, motion on | The page reads well in the dark theme | 🔴 Critical |
| TC-1.3 | 1: Built site, desktop, motion on | Motion plays once and settles | 🟡 Normal |
| TC-1.4 | 1: Built site, desktop, motion on | Pain points, FAQ and links behave | 🔴 Critical |
| TC-1.5 | 1: Built site, desktop, motion on | A keyboard reaches and operates everything | 🔴 Critical |
| TC-1.6 | 1: Built site, desktop, motion on | The copy is true and reads as finished | 🟡 Normal |
| TC-1.7 | 1: Built site, desktop, motion on | The second browser shows the same page | 🟢 Low |
| TC-2.1 | 2: Built site, phone width | The layout holds at 360, 390 and 768 px | 🔴 Critical |
| TC-2.2 | 2: Built site, phone width | The mobile menu traps focus and locks scroll | 🔴 Critical |
| TC-3.1 | 3: Built site, reduced motion, then no JavaScript | Reduced motion shows a still page | 🟡 Normal |
| TC-3.2 | 3: Built site, reduced motion, then no JavaScript | The page works with JavaScript off | 🟡 Normal |
| TC-4.1 | 4: Playground source open for editing | An annual price shows the billing toggle | 🟡 Normal |
| TC-4.2 | 4: Playground source open for editing | The section recipe and the logo recipe work | 🔴 Critical |
| TC-5.1 | 5: Playground open in Claude Code | The landing-copy skill drafts all thirteen sections | 🟢 Low |

## Scenario 1: Built site, desktop, motion on

**Setup.** Run once, for every case in this scenario.

1. Open `http://127.0.0.1:4321` in the Chromium-based browser at a window at least 1280 px wide.
2. In the OS settings, turn off "reduce motion".
3. In the browser, clear the site's local storage, so the theme follows the OS.

- [ ] Setup complete

### TC-1.1: The page reads well in the light theme  ·  🔴 Critical

**Goal.** Every section reads correctly in the light theme at desktop width and matches the approved mockup.

**Steps**

1. Set the OS appearance to light and reload. Scroll the whole page top to bottom.
   - [ ] Every section reads correctly, with no text illegible or invisible on its background
     - navbar: logo, four links, theme toggle, GitHub and Get started
     - hero: pill, headline, lead, both buttons, terminal and file tree, fade at the bottom
     - logo row, pain points, how it works, feature grid, showcase, audience
     - testimonials, pricing (badge on the middle tier), FAQ, CTA with the command chip, footer
   - [ ] The sections share one rhythm: equal side margins and similar gaps between sections
2. Compare the page with the round 3 mockup (`~/scratch/landing-mockup/page.html` on devaloy).
   - [ ] Each section has the layout the owner approved

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The page reads well in the dark theme  ·  🔴 Critical

**Goal.** The same sweep is clean in the dark theme, and the theme toggle switches it.

**Steps**

1. Click the theme toggle in the navbar until the moon icon shows. Scroll the page again.
   - [ ] The same sweep is clean in the dark theme
   - [ ] No border, grid line or chip disappears into the dark background
2. Reload the page.
   - [ ] The dark theme stays, with no white flash during the load

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Motion plays once and settles  ·  🟡 Normal

**Goal.** The CSS motion adds polish and never hides content.

**Steps**

1. Reload the page at the top and watch the hero.
   - [ ] The pill, headline, lead, buttons and terminal fade in from a blur, in that order, within about two seconds
2. Watch the pill and the logo row for ten seconds.
   - [ ] A highlight sweeps across the pill text, and the logo row moves left without a visible jump
3. Hover the logo row.
   - [ ] The row slows down
4. Scroll down slowly from the hero to the footer.
   - [ ] The navbar narrows to a rounded, frosted bar after the first scroll
   - [ ] Cards and rows fade in as they enter the screen, and every one ends fully visible
5. Hover a feature card.
   - [ ] The card rises a little and its icon grid brightens

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: Pain points, FAQ and links behave  ·  🔴 Critical

**Goal.** The interactive parts work with a pointer, and every link goes to a real place.

**Steps**

1. In "Does this sound familiar?", click each closed item in turn.
   - [ ] One item stays open at a time, and the icon in the visual beside the list changes to match it
2. Close the open item.
   - [ ] The visual shows the clock icon of the first item
3. In the FAQ, click each question in turn.
   - [ ] One answer stays open at a time, and the chevron turns on the open one
4. In the pricing section, look above the tiers.
   - [ ] No Monthly/Annual toggle shows, because no default tier has an annual price
5. Click each navbar link: Features, How it works, Modules, FAQ.
   - [ ] Each link scrolls to its section, and the section heading is not hidden under the navbar
6. Open each outbound link in a new tab: the pill, Get started, Star on GitHub, the three tier buttons, Open an issue, the CTA buttons, and the footer links and GitHub icon.
   - [ ] Each one opens a real page in the Saasaloy repo or docs, with no 404

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: A keyboard reaches and operates everything  ·  🔴 Critical

**Goal.** A keyboard user gets a skip link, a visible focus ring and every control.

**Steps**

1. Reload the page, click the address bar, and press Tab once.
   - [ ] A "Skip to content" link appears at the top left
2. Press Enter.
   - [ ] The page moves past the navbar, and the next Tab reaches the hero's pill
3. Press Tab through the whole page to the footer.
   - [ ] Every link, button and FAQ or pain-point question shows a visible focus ring, in a logical order
4. Focus a FAQ question and press Enter, then Space.
   - [ ] Enter opens it and Space closes it
5. Open `/terms`, `/privacy` and `/nope` (the 404 page), and press Tab once on each.
   - [ ] Each page shows the skip link first

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.6: The copy is true and reads as finished  ·  🟡 Normal

**Goal.** Every claim on the page is true for Saasaloy, and nothing reads as a stock template.

**Steps**

1. Read every section's copy, with the repo README open beside it.
   - [ ] Each claim matches the README, the module registry or the docs
     - the 38-module count and the four tiers in the showcase
     - the stage table and the free-tier claim
     - the four skills, the commands in the terminal and the CTA chip
     - the Node and pnpm versions in the FAQ
   - [ ] Nothing invents a customer, a metric, a quote or a logo; the testimonials say plainly that they are placeholders
2. Look at the page as a first-time visitor would.
   - [ ] The page reads as a finished product page, not as a shadcn demo

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.7: The second browser shows the same page  ·  🟢 Low

**Goal.** The page looks and behaves the same in Firefox or Safari.

**Steps**

1. Open `http://127.0.0.1:4321` in the second browser and repeat the sweeps of TC-1.1 and TC-1.4.
   - [ ] The sweeps are clean, and one FAQ answer stays open at a time
   - [ ] Without scroll-driven animation support, cards show at once and the navbar stays full width, with no broken layout

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset is needed. Scenario 2 uses the same build.

## Scenario 2: Built site, phone width

**Setup.** Run once, for every case in this scenario.

1. In the Chromium-based browser, open DevTools and turn on the device toolbar.
2. Set the viewport to 390 × 844 and reload `http://127.0.0.1:4321`.

- [ ] Setup complete

### TC-2.1: The layout holds at 360, 390 and 768 px  ·  🔴 Critical

**Goal.** No section scrolls sideways or squeezes its content on small screens.

**Steps**

1. At 390 px, scroll the whole page in the light theme, then in the dark theme.
   - [ ] Nothing scrolls sideways, and no text, chip or button is cut off
     - the terminal lines wrap; the file tree is hidden
     - the showcase file paths wrap inside their cards
     - pricing tiers and testimonial cards stack in one column
2. Set the viewport to 360 px and scroll again.
   - [ ] The same sweep is clean at 360 px
3. Set the viewport to 768 px and scroll again.
   - [ ] Two-column sections (pain points, showcase, audience, testimonials) look balanced

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The mobile menu traps focus and locks scroll  ·  🔴 Critical

**Goal.** The mobile menu is a correct modal panel for touch and keyboard.

**Steps**

1. At 390 px, wait two seconds, then tap the menu button.
   - [ ] The panel opens with the links, GitHub and Get started, and the button label reads "Close menu"
2. Try to scroll the page behind the panel.
   - [ ] The page does not scroll
3. Press Tab twenty times.
   - [ ] Focus cycles inside the header and never reaches the hero
4. Tap the page below the header.
   - [ ] The panel closes and the page scrolls again
5. Open the panel again and press Escape.
   - [ ] The panel closes, and focus returns to the menu button
6. Open the panel and tap the FAQ link.
   - [ ] The panel closes and the page scrolls to the FAQ

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Turn off the device toolbar.

## Scenario 3: Built site, reduced motion, then no JavaScript

**Setup.** Run once, for every case in this scenario.

1. In DevTools, open the Rendering panel and set "Emulate CSS media feature prefers-reduced-motion" to `reduce`.
2. Reload `http://127.0.0.1:4321` at desktop width.

- [ ] Setup complete

### TC-3.1: Reduced motion shows a still page  ·  🟡 Normal

**Goal.** With reduced motion requested, nothing moves and nothing is hidden.

**Steps**

1. Reload at the top and scroll to the footer.
   - [ ] Nothing fades, slides or sweeps, and every element is visible at once
   - [ ] The logo row stands still, wraps onto two lines and shows each name once

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The page works with JavaScript off  ·  🟡 Normal

**Goal.** The page is complete and usable with no JavaScript.

**Steps**

1. In DevTools, open the Command Menu, run "Disable JavaScript", and reload.
   - [ ] All thirteen sections render, the theme follows the OS, and the theme toggle is hidden
2. Click a FAQ question and a pain-point item.
   - [ ] Each one opens and closes, and the pain-point visual follows the open item
3. Look at the footer copyright.
   - [ ] It shows the build year
4. Run "Enable JavaScript" and reload.
   - [ ] The copyright shows the current year

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Set prefers-reduced-motion back to "No emulation", and keep JavaScript on.

## Scenario 4: Playground source open for editing

**Setup.** Run once, for every case in this scenario.

1. Open `.dev/playground` in an editor. Keep the static server running.
2. After each edit below, rebuild the playground.

```sh
pnpm -C .dev/playground build
```

- [ ] Setup complete

### TC-4.1: An annual price shows the billing toggle  ·  🟡 Normal

**Goal.** A tier with an annual discount brings back an accessible billing toggle.

**Steps**

1. In `packages/ui/src/content/landing.ts`, set the `workers-paid` tier's `annualPrice` to `4`. Rebuild and reload.
   - [ ] A Monthly/Annual toggle shows above the tiers, with "Save 20%" beside Annual
2. Turn on a screen reader (VoiceOver or NVDA). Tab to the toggle and press the right arrow.
   - [ ] The screen reader says "Billing period", the Annual option becomes selected, and the new price is announced
   - [ ] The Workers Paid price changes to $4 with its own suffix

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.2: The section recipe and the logo recipe work  ·  🔴 Critical

**Goal.** A founder can reshape the page and add a logo by following the README alone.

**Steps**

1. Read the "Landing page" section of `.dev/playground/README.md`.
   - [ ] It gives the two edits, the section recipe and the logo recipe in plain steps
2. Follow the recipe to remove the testimonials section: delete its line and import in `apps/web/src/pages/index.astro` and the file `packages/ui/src/blocks/testimonials.tsx`. Move the `<Showcase />` line above `<FeatureGrid />`. Rebuild and reload.
   - [ ] The build passes, the testimonials are gone, the showcase comes before the features, and the spacing stays even
3. In `packages/ui/src/blocks/logo-cloud.tsx`, add a `LOGO_MARKS` entry `"acme-test"` with any simple SVG that uses `fill="currentColor"`. In `landing.ts`, set the `astro` logo's `mark` to `"acme-test"`. Rebuild and reload.
   - [ ] The logo row shows the SVG in place of "Astro", in the muted colour, in both themes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Put the playground back to its scaffolded state, then rebuild.

```sh
pnpm play:restore && pnpm -C .dev/playground build
```

## Scenario 5: Playground open in Claude Code

**Setup.** Run once, for every case in this scenario.

1. Start Claude Code in `.dev/playground`.
2. Run `/saasaloy-setup` and answer with a made-up product (for example, a bookkeeping tool) until it writes `docs/product-brief.md`.

- [ ] Setup complete

### TC-5.1: The landing-copy skill drafts all thirteen sections  ·  🟢 Low

**Goal.** The landing-copy skill rewrites every section and refuses to invent proof.

**Steps**

1. Run `/saasaloy-landing-copy` and open `docs/landing-copy-draft.md`.
   - [ ] The draft has a proposal for every section, from `meta` to `footer`
   - [ ] It keeps the testimonials as placeholders or offers to drop them, and it does not write a quote or a customer logo
   - [ ] It asks to replace every Saasaloy link and the hero terminal

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Discard the skill's edits.

```sh
pnpm play:restore
```

## Automated verification (by AI agent)

_Checks the agent ran itself, on `1213eb5` with the #191 changes uncommitted. No action needed from the tester; listed here for context and sign-off._

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
pnpm verify:content
```

```sh
pnpm verify:a11y
```

```sh
pnpm verify:preset
```

```sh
pnpm deps:verify
```

```sh
pnpm -C .dev/playground lint && pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build
```

- ✅ `pnpm lint` → oxlint (both passes), Stylelint and Prettier clean, after the last edit.
- ✅ `pnpm typecheck` → the scripts and every workspace typecheck.
- ✅ `pnpm test` → 1339 CLI tests, 640 module tests, 70 base tests and 307 script tests pass. `base.test.ts` ran again after the icon registry became an owned file: 48 of 48 pass, and its new check fails when the entry is removed.
- ✅ `scripts/verify-a11y.test.ts` → 9 of 9 pass, and each one fails under a deliberate break of the helper it covers.
- ✅ `pnpm verify:content` → 15 blocks and `index.astro` are clean, and the self-test proves the new disable marker needs a reason.
- ✅ `pnpm verify:a11y` → 0 findings across 32 page loads, on a fresh `play:init` build. The baseline before the rework was 41 findings: 32 skip, 4 contrast, 4 meta and 1 island.
- ✅ `pnpm verify:preset` → the tweakcn preset merges cleanly, the base rules survive, and the `DESIGN.md` fingerprint matches `globals.css`.
- ✅ `pnpm deps:verify` → pins agree, and the fresh playground builds, lints, passes verify-css and typechecks.
- ✅ The generated project's lint, typecheck and build pass.
- ✅ `pnpm dlx @google/design.md lint` on the template's `DESIGN.md` → 0 errors and 0 warnings.
- ✅ Chromium behaviour script on the built site:
  - the footer shows the current year on a page whose HTML says 2019
  - the page hydrates only `Navbar` and `PricingTable`
  - the open pain point picks the visual; with none open, the first item's icon shows
  - with JavaScript off, the FAQ stays single-open and the year falls back to the build year
  - the mobile menu locks scroll, keeps focus in the header, closes on an outside press, and closes on Escape with focus back on the toggle
  - the first Tab stop is "Skip to content", and Enter moves focus to `<main>`
  - `/` carries `og:title`, `og:description`, `og:url`, `og:type`, `og:site_name` and `twitter:card`
- ✅ `smoke.yml` `a11y` job by `workflow_dispatch` → run 39132580896 passed. The same run's `release-smoke` job failed at `pnpm install in full-database-d1`, and the scheduled run on `main` failed the same way the same day, so that failure is not from this change.

## Not covered / needs human judgment

- Real screen-reader output beyond TC-4.1. The gate checks names and roles with axe, not the spoken experience across the page.
- Safari on iOS and Chrome on Android hardware. The phone checks use DevTools emulation.
- `saasaloy update` on an existing project. The new blocks arrive as files, and an existing `index.astro` is the owner's, so nothing changes on that page. A separate update drill covers the merge plan.
- Performance under load. The page is static and ships two small islands; no data volume applies.
- Data and state, security and concurrency. The change has no data layer, no auth and no server code.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
