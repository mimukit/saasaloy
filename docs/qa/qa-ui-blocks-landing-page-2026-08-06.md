# QA Plan: Marketing blocks, landing page, and design-layer docs

_Generated 2026-08-06 · covers `origin/main...HEAD` on `issue-43-marketing-blocks-landing-page-and-design-layer` (4 commits) · issue #43_

## Summary

- Adds seven self-contained marketing blocks to the base template's `packages/ui/src/blocks/` — `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer` — and rewrites `apps/web/src/pages/index.astro` to compose them, plus the ADR/glossary/base-docs that govern the design layer.
- "Working" means a scaffolded project builds and serves a landing page that looks designed, where exactly three blocks are interactive (navbar menu, pricing toggle, FAQ accordion), the other four ship no JavaScript, and the `sections/*.astro` file-drop extension point still works.

## Preconditions

- **You need a machine with a browser.** Every case below is a visual or interaction judgment. The dev box (devaloy) is headless, so nothing here was confirmed by the agent — see [Automated verification](#automated-verification-by-ai-agent) for what was.
- Branch: `issue-43-marketing-blocks-landing-page-and-design-layer`.
- Node >= 24, pnpm 11. No credentials, services, or env vars — the base has no network dependency.
- The base template is **not** a workspace member of this repo. You exercise it by scaffolding a playground into `.dev/`, which is what every command below does.

Scaffold a fresh playground from the template and install it:

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

Start the dev server — port **3000**, `strictPort`, so a busy port fails loudly instead of drifting:

```sh
pnpm -C .dev/playground dev
```

Then open `http://localhost:3000`. For a production-shaped check (TC-8), build and preview instead — `astro preview` serves on the same port 3000, so stop the dev server first:

```sh
pnpm -C .dev/playground build && pnpm -C .dev/playground --filter @repo/web preview
```

**Do not read `pnpm deps:check` as a regression.** It exits **1** on unmodified `main` too, from upstream npm drift in `modules/api` (`hono 4.12.33 → 4.12.34`). This branch changes **zero** dependency manifests — confirmed below.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | The landing page renders all seven blocks, in order, styled | 🔴 Critical |
| TC-2 | Navbar mobile menu — open, Escape, focus return, link-click close | 🔴 Critical |
| TC-3 | Pricing monthly/annual toggle | 🔴 Critical |
| TC-4 | FAQ accordion | 🔴 Critical |
| TC-5 | Dark mode across the new blocks, no white flash | 🔴 Critical |
| TC-6 | The `sections/*.astro` file-drop extension point still works in dev | 🔴 Critical |
| TC-7 | Same-page anchors clear the sticky header | 🟡 Normal |
| TC-8 | Static blocks work with JavaScript disabled | 🟡 Normal |
| TC-9 | Responsive layout from 320px to wide | 🟡 Normal |
| TC-10 | Keyboard navigation, focus rings, and the toggle's labels | 🟡 Normal |
| TC-11 | `saasaloy add waitlist` still composes into the page | 🟡 Normal |
| TC-12 | Copy, defaults, and overall UX judgment | 🟢 Low |

## Test cases

### TC-1 — The landing page renders all seven blocks, in order, styled · 🔴 Critical

The agent confirmed every block's text reaches the built HTML, but not that any of it *looks* right. That part is yours.

**Steps**

1. Open `http://localhost:3000` at a desktop width (≥ 1280px).
2. Scroll the whole page, top to bottom.

**Expected**

- Order top to bottom: sticky navbar → hero → feature grid → pricing → FAQ → CTA panel → footer.
- Navbar: site name on the left, `Features · Pricing · FAQ` in the middle, a "Get started" button on the right. It stays pinned while you scroll, with a translucent/blurred background — page content should show through it, not sit on an opaque bar.
- Hero: an "Now in early access" badge, a large balanced headline, a paragraph naming the project, and two buttons ("Get started" filled, "See pricing" outlined).
- Feature grid: six cards, each with an icon in a rounded muted square, a title, and a description. 3 columns wide, 2 columns at tablet.
- Pricing: three cards — Free / Pro / Enterprise. **Pro** is visually promoted (a ring around the card plus a "Most popular" badge). Enterprise shows the word "Custom", not a currency amount.
- FAQ: five questions, all collapsed on first load.
- CTA: a single rounded muted panel with a headline, a line of copy, and two buttons.
- Footer: the site name + tagline on the left, "Product" and "Legal" link groups, a separator rule, and a `© 2026 <name>. All rights reserved.` line.
- Nothing is unstyled, edge-to-edge, or collapsed to the top-left.
- The project name (the value of `siteName`) appears in the navbar, hero copy, CTA copy, and footer — not the literal string `Acme`, and not `{{PROJECT_NAME}}`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Navbar mobile menu — open, Escape, focus return, link-click close · 🔴 Critical

This is the one hand-written interaction in the diff and the only thing above the fold that carries JavaScript. Every sub-behavior below is a separate line of code that can fail on its own.

**Steps**

1. Narrow the viewport to 375px (devtools device toolbar, or resize the window below the `md` breakpoint at 768px).
2. Confirm the desktop links and the header "Get started" button are now hidden and a hamburger button has appeared.
3. Click the hamburger.
4. Press **Escape**.
5. Press **Tab** once, without clicking anything first, and watch where focus lands.
6. Open the menu again and click one of the links (e.g. "Pricing").
7. Open the menu again and click the "Get started" button inside the panel.
8. Widen the viewport back past 768px **while the menu is open**.

**Expected**

- Closed: hamburger icon. Open: the icon swaps to an X.
- Open: a panel drops below the header with the three links stacked plus a "Get started" button, separated from the header by a top border.
- Escape closes the panel.
- **After Escape, focus is back on the toggle button** — it shows a focus ring, and the single Tab in step 5 moves to the *next* control after the toggle, not to the top of the page. This is the specific fix in commit `201f7f2`; if Tab jumps you to the browser chrome or the page's first link, it failed.
- Clicking a link closes the panel and scrolls to that section.
- Clicking the panel's "Get started" closes the panel and jumps to the CTA section.
- Widening past 768px hides the panel (it's `md:hidden`) and restores the desktop links.
- No layout shift or flash of the panel on initial page load — it must never appear before you click.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Pricing monthly/annual toggle · 🔴 Critical

Hydrated with `client:visible`, so the JavaScript only arrives once the section scrolls into view. Scroll to it before clicking.

**Steps**

1. Scroll to the pricing section (or click "Pricing" in the navbar).
2. Note the prices while "Monthly" is selected.
3. Click **Annual**.
4. Click **Monthly** again.
5. Reload the page and scroll back down.

**Expected**

- On first view, **Monthly** is the selected segment (filled/secondary) and **Annual** is the unselected one (ghost).
- Monthly: Free = `$0`, Pro = `$29`, Enterprise = `Custom`.
- Annual: Free = `$0`, Pro = `$23`, Enterprise = `Custom`.
- With Annual selected, the suffix under a numeric price reads `/month, billed annually`; with Monthly it reads just `/month`.
- Enterprise shows `Custom` with **no** `/month` suffix in either mode.
- A `Save 20%` badge sits beside the toggle in both modes.
- The two buttons swap appearance as selection changes; the selected one is visibly distinct, not just subtly different.
- After reload, it resets to Monthly (there is no persistence, by design).
- The card heights don't jump when prices change.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — FAQ accordion · 🔴 Critical

The accordion is a compound Base UI primitive kept whole inside one block precisely so its React context survives Astro's island boundary. If that were wrong, you'd see a runtime "must be used within" error rather than a broken animation.

**Steps**

1. Scroll to the FAQ section.
2. Open the browser console **before** the section scrolls into view, and keep it visible.
3. Click the first question.
4. Click a second question.
5. Click the first question again.

**Expected**

- **No console error at all** — specifically nothing containing "must be used within".
- Clicking a question expands its answer with a height animation, not an instant snap.
- The trigger's chevron/indicator rotates.
- Clicking an open question collapses it.
- All five answers are readable and none is clipped mid-sentence.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Dark mode across the new blocks, no white flash · 🔴 Critical

The pre-paint script in `Layout.astro` is unchanged by this branch, but the blocks introduce many new surfaces (cards, badges, rings, the muted CTA panel, the translucent header) that had no dark-mode representation before.

**Steps**

1. Set your OS to **dark** mode.
2. Hard-reload `http://localhost:3000` (Cmd/Ctrl+Shift+R) a few times and watch the *first* paint.
3. Read the whole page in dark mode.
4. Switch the OS to **light** mode, reload, and read it again.

**Expected**

- **No white flash on first paint**, not even a single frame.
- In dark mode: feature cards, pricing cards, and the CTA panel are all distinguishable from the page background — not one flat slab.
- The Pro card's `ring-2 ring-primary` is visible in both modes.
- The sticky header's blur/translucency reads correctly over dark content.
- Muted body text (`text-muted-foreground`) is legible in both modes — feature descriptions, FAQ answers, footer links, pricing feature lists.
- Badges ("Now in early access", "Most popular", "Save 20%") are readable in both modes.
- The separator rule in the footer is visible but not harsh.
- There is no theme toggle anywhere — following the OS is the whole feature.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — The `sections/*.astro` file-drop extension point still works in dev · 🔴 Critical

This is the convention the `waitlist` module depends on. The agent confirmed a dropped section reaches the built HTML in the right place; what you're checking is that it works under the **dev server** (HMR, no restart) and that it looks right where it lands.

**Steps**

1. With the dev server running, create a section file:

```sh
mkdir -p .dev/playground/apps/web/src/sections && printf -- '---\n---\n<p class="rounded-lg bg-muted p-4 text-muted-foreground">Hello from a dropped-in section.</p>\n' > .dev/playground/apps/web/src/sections/test.astro
```

2. Watch the browser without reloading manually.
3. Delete the file:

```sh
rm .dev/playground/apps/web/src/sections/test.astro
```

**Expected**

- The section appears **without restarting the dev server**.
- It renders **between the CTA panel and the footer**, inside a centered max-width container with side padding — not full-bleed, and not jammed against the footer.
- It is **styled** (rounded corners, muted background, padding), which proves Tailwind still scans app source.
- Deleting the file makes it disappear again, and the empty wrapper `div` goes with it — no stray gap above the footer.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Same-page anchors clear the sticky header · 🟡 Normal

The header is 3.5rem tall and the sections carry `scroll-mt-20` (5rem). The margin is deliberate; only a real scroll shows whether it's enough.

**Steps**

1. From the top of the page, click "Features" in the navbar.
2. Click "Pricing", then "FAQ".
3. Click a "Get started" button in the hero, then one in a pricing card.
4. Repeat all of the above from the **footer's** "Product" links.
5. Repeat at a 375px viewport, using the mobile menu.

**Expected**

- Each jump lands with the section's heading fully visible **below** the sticky header — never tucked underneath it or half-cut.
- "Get started" / "Start free trial" / "Talk to sales" all land on the CTA panel.
- The URL hash updates (`#features`, `#pricing`, `#faq`, `#cta`).
- Pressing the browser Back button returns you to the previous position.
- Nothing scrolls the page horizontally.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — Static blocks work with JavaScript disabled · 🟡 Normal

The agent proved at the bundle level that hero, feature-grid, CTA and footer emit no JS chunk. This case proves the *user-visible* half: the page is still a usable marketing page without JavaScript.

**Steps**

1. Stop the dev server, then build and preview a production bundle:

```sh
pnpm -C .dev/playground build && pnpm -C .dev/playground --filter @repo/web preview
```

2. Disable JavaScript in devtools (Chrome: Cmd/Ctrl+Shift+P → "Disable JavaScript").
3. Hard-reload the preview URL and read the whole page.

**Expected**

- Hero, feature grid, CTA and footer render **completely and correctly** — all copy, all six feature icons, all links.
- Pricing renders its cards with **monthly** prices and the toggle visible but inert.
- FAQ renders its five questions; answers stay collapsed and clicking does nothing.
- The navbar renders its desktop links; the hamburger is inert.
- All `<a href>` links — including the anchors and `/terms` `/privacy` — still navigate.
- Nothing is blank, invisible, or collapsed to zero height.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-9 — Responsive layout from 320px to wide · 🟡 Normal

**Steps**

1. Step the viewport through 320px, 375px, 768px, 1024px, and 1440px.
2. At each width, scroll the full page.

**Expected**

- **No horizontal scrollbar at any width**, including 320px.
- Hero headline scales down and never overflows; the two hero buttons stack vertically below `sm` and sit side by side above it.
- Feature grid: 1 column on mobile, 2 at `sm`, 3 at `lg`.
- Pricing: 1 column stacked below `lg`, 3 columns at `lg` and up. The Pro ring is not clipped when stacked.
- Footer: 1 column on mobile, 2 at `sm`, 4 at `lg`.
- Navbar: desktop links and header CTA hidden below 768px, hamburger hidden at and above it — never both at once, never neither.
- Nothing overlaps, is cut off, or touches the screen edge.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-10 — Keyboard navigation, focus rings, and the toggle's labels · 🟡 Normal

**Steps**

1. From the top of the page, press **Tab** repeatedly all the way to the footer.
2. Reach the pricing toggle and operate it with Enter/Space.
3. Reach a FAQ trigger and operate it with Enter/Space, then try Arrow keys between triggers.
4. At 375px, Tab to the hamburger and open it with Enter/Space.
5. With a screen reader or the devtools accessibility pane, inspect the hamburger while closed and while open.

**Expected**

- Focus order follows visual order, top to bottom.
- **Every** focused control shows a visible focus ring, in both light and dark mode — including the links inside the muted CTA panel and the footer.
- The pricing toggle operates from the keyboard, and the selected segment reports `aria-pressed="true"` while the other reports `false`.
- FAQ triggers open and close from the keyboard.
- The hamburger's accessible name is **"Open menu"** when closed and **"Close menu"** when open, and `aria-expanded` flips with it.
- `aria-controls="navbar-mobile-menu"` is present **only while the menu is open** — when closed the attribute must be absent entirely, not pointing at a missing element.
- The two navs are distinguishable by name ("Main" and "Mobile"), and the footer's two link groups by "Product" and "Legal".

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-11 — `saasaloy add waitlist` still composes into the page · 🟡 Normal

The whole reason the glob had to survive the rewrite.

**Steps**

1. Stop the dev server. Install the module into the playground:

```sh
cd .dev/playground && ./saasaloy add waitlist --yes
```

2. Reinstall and restart:

```sh
pnpm -C .dev/playground install && pnpm -C .dev/playground dev
```

3. Load the page and find the waitlist section.

**Expected**

- The command succeeds and writes into `apps/web/src/sections/`.
- The waitlist form renders on the landing page, between the CTA panel and the footer.
- It picks up the theme — inputs and buttons match the blocks around it, rather than looking like unstyled browser defaults.
- The form is interactive (it is the module's own `client:load` island, which is expected and is not the blanket page-level `client:load` the conventions ban).
- The seven blocks above it are unaffected.
- Reset the playground before moving on:

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-12 — Copy, defaults, and overall UX judgment · 🟢 Low

These blocks are the first thing every generated project shows a visitor, and the copy is the default that ships. Read it as a stranger would.

**Steps**

1. Read the page top to bottom as marketing copy, not as code.
2. Check the docs the branch added: `packages/cli/templates/base/README.md` ("UI components" and the new "Landing page" section) and `packages/cli/templates/base/AGENTS.md` (the blocks conventions).

**Expected**

- Copy is generic enough to ship to any project, but not so empty it reads as lorem ipsum.
- No placeholder artifacts — no `Acme`, no `TODO`, no `Lorem`, no `{{PROJECT_NAME}}`.
- The pricing tiers, the FAQ answers, and the feature list describe something plausible without over-promising.
- British/American spelling is at least internally consistent within a block.
- The README's "Landing page" section accurately describes what you just tested — the three hydrated blocks and the `sections/*.astro` hook.
- A developer reading `AGENTS.md` would know how to add an eighth block without guessing.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks

- [ ] `/terms` and `/privacy` still render their centered prose column and their `← Home` link.
- [ ] The footer's "Legal" group reaches both pages, and both link back.
- [ ] `pnpm play:reset` still scaffolds a working project from scratch.
- [ ] Dev server still comes up on port **3000** and fails loudly if the port is taken.
- [ ] `pnpm -C .dev/playground clean` runs without error and leaves no `dist`/`.astro` behind.
- [ ] `siteName` still imports from `@repo/ui`'s root export on all three pages.
- [ ] The `@web` Vite alias still resolves for a dropped-in section.
- [ ] The vendored primitives are still individually importable by subpath — the blocks did not become the only way to reach them.

## Automated verification (by AI agent)

_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Full pipeline from a destroyed playground (scaffold → install → build → verify-css → typecheck):

```sh
pnpm run play:destroy && pnpm deps:verify
```

Confirm exactly which components hydrate and with which directive:

```sh
grep -o 'component-export="[^"]*"\|client="[a-z]*"' .dev/playground/apps/web/dist/index.html
```

List the emitted JS chunks — the static blocks must not appear:

```sh
ls -la .dev/playground/apps/web/dist/_astro/
```

Confirm the anchor targets the navbar and footer point at actually exist in the built HTML:

```sh
grep -o 'id="[a-z-]*"\|href="#[a-z]*"' .dev/playground/apps/web/dist/index.html | sort | uniq -c
```

Prove the `sections/*.astro` glob survived the rewrite:

```sh
mkdir -p .dev/playground/apps/web/src/sections && printf -- '---\n---\n<p class="rounded-lg bg-muted p-4 text-muted-foreground">Hello from a dropped-in section.</p>\n' > .dev/playground/apps/web/src/sections/test.astro && pnpm -C .dev/playground build && grep -o 'max-w-6xl px-6 pb-20.\{0,120\}' .dev/playground/apps/web/dist/index.html
```

Prove the typecheck stage actually covers `src/blocks/` (the middle command must exit **1**):

```sh
printf '\nconst PROBE: number = "nope"\nexport { PROBE }\n' >> .dev/playground/packages/ui/src/blocks/hero.tsx
pnpm -C .dev/playground typecheck
cp packages/cli/templates/base/packages/ui/src/blocks/hero.tsx .dev/playground/packages/ui/src/blocks/hero.tsx
```

Dependency drift gate:

```sh
pnpm deps:check
```

### Results

- ✅ `pnpm deps:verify` from a destroyed playground → **green end to end**, exit 0. Scaffold → `pnpm install` → `turbo run build` (3 pages built) → `verify-css` → `turbo run typecheck`, all with genuine `cache miss` executions rather than replayed cache.
- ✅ `verify-css` → sentinel `--saasaloy-css-probe` found in `_astro/Layout.BXBSnpSg.css`. Tailwind is still scanning `packages/ui`, so the blocks' utilities reach the built CSS.
- ✅ `@repo/ui:typecheck` (`tsc --noEmit`) → exit 0. All seven blocks compile against the vendored primitives — every `Card*`, `Badge`, `Button`, `Separator` and `Accordion*` sub-component the blocks import exists and accepts the props passed, and `Button`'s `icon-sm` size and `ref` prop are real.
- ✅ **Negative test of the typecheck stage** — a deliberate `const PROBE: number = "nope"` appended to the playground's `blocks/hero.tsx` made `turbo run typecheck` exit **1** with `src/blocks/hero.tsx(67,7): error TS2322`. `src/blocks/` is genuinely inside the typecheck program, not silently excluded. The file was restored and the gate re-ran green (`FULL TURBO`, proving a byte-identical restore).
- ✅ **Hydration is exactly what was specified.** The built `index.html` contains **three** `<astro-island>` elements and no more: `Navbar` (`client="idle"`), `PricingTable` (`client="visible"`), `Faq` (`client="visible"`).
- ✅ **The four static blocks ship zero JavaScript.** `dist/_astro/` contains island entry chunks for `navbar` (2.3 KB), `pricing-table` (6.2 KB) and `faq` (18 KB) only — there is **no** `hero`, `feature-grid`, `cta`, or `footer` chunk. Their markup is fully server-rendered: "Everything the first release needs", "Start building today" and "All rights reserved" are all present in the static HTML.
- ✅ `/terms` and `/privacy` contain **zero** `astro-island` elements — the blocks did not leak JavaScript onto the other pages.
- ✅ **Anchors and their targets line up.** `id="features"`, `id="pricing"`, `id="faq"` and `id="cta"` are all present; the 12 same-page `href="#…"` links resolve to those four ids with no dangling anchor. `scroll-mt-20` appears on all four anchored sections and compiles to `scroll-margin-top: calc(var(--spacing) * 20)` (5rem) against a 3.5rem (`h-14`) sticky header.
- ✅ **`aria-controls` is conditional.** The server-rendered navbar (menu closed) emits **no** `aria-controls` attribute at all — no idref pointing at an element that doesn't exist.
- ✅ **The `sections/*.astro` extension point survived the rewrite.** A dropped-in `test.astro` rebuilt and rendered inside the `mx-auto w-full max-w-6xl px-6 pb-20` wrapper, positioned between `</main>`'s CTA and the `<footer>`. With no section files, the wrapper `div` is not emitted at all.
- ✅ **Block conventions hold, mechanically checked.** Each of the seven files exports exactly one PascalCase component plus its prop interfaces; there is **no** `export default` anywhere in `src/blocks/`, no `blocks/index.ts` barrel, no `_`-prefixed filename, and `packages/ui/src/index.ts` re-exports only `siteName`. `package.json` exposes `"./blocks/*": "./src/blocks/*.tsx"`, so a block is reachable solely by its own subpath.
- ✅ **No blanket `client:load`.** The only `client:load` in the whole repo outside prose is `modules/waitlist/files/web/sections/waitlist.astro`, which is the module's own island and pre-dates this branch.
- ✅ **Every doc cross-link resolves** — ADR 0022's references to ADR 0003 / 0006 / 0016 and to `plan-ui-blocks-2026-08-01.md` all point at files that exist, as does ADR 0003's new "Amended by ADR 0022" link and `CONTEXT.md`'s link to ADR 0022. `CONTEXT.md`'s **Base** entry now names `packages/tsconfig`, which matches what the template actually ships.
- ⚠️ `pnpm deps:check` → exit **1**, reporting `hono 4.12.33 → 4.12.34` in `modules/api/files/package.json`. **This is not a regression.** It fails identically on unmodified `main`; this branch touches **zero** dependency manifests (`git diff origin/main...HEAD --name-only` matches no `package.json`, no `registry-item.json`, no lockfile). Issue #43's "`deps:check` green" acceptance criterion is blocked by upstream npm drift, not by this work.
- ⚠️ Root `pnpm lint` and `pnpm test` run **0 tasks** — no package in the tool repo declares either script. Pre-existing, out of scope for #43, and worth knowing so nobody reads their "success" as coverage.
- ⚠️ `.astro` files are **not typechecked anywhere.** `apps/web` declares no `typecheck` script (`astro check` would need `@astrojs/check` added to the template), so `index.astro`'s block imports, prop names, and `client:*` directives rest entirely on `astro build` succeeding. It does — but a typo in a prop name would not be caught.

## Not covered / needs human judgment

- **Everything visual, without exception.** The dev box is headless — no browser, no GUI. The agent verified the *build output*, never a rendered pixel. Dark mode, the white-flash check, focus rings, layout at any width, and the look of every block are unverified.
- **Every interaction.** The navbar menu's open/close, the Escape handler and its focus return, the pricing toggle, and the FAQ accordion were confirmed only to *compile and be hydrated with the right directive*. Whether they behave was not tested. TC-2, TC-3 and TC-4 are the whole proof.
- **Runtime errors in the browser.** Nothing executed the client bundles. A React error that only surfaces on hydration — the compound-primitive "must be used within" trap especially — would pass every check above. Keep the console open for TC-2 through TC-4.
- **Visual diff against `origin/main`.** No screenshots were captured. This is a deliberate redesign, so "looks right" is the tester's eye and nothing more.
- **Browser/OS matrix.** Only whatever browser the tester uses. The theme's `oklch()` needs Safari 15.4+ / Chrome 111+, and `text-balance`/`text-pretty` degrade silently on older engines.
- **Real-device mobile.** Devtools device emulation is not a phone. Touch targets, the sticky header under a mobile URL bar, and momentum scrolling behind an open menu need real hardware to judge.
- **Screen readers.** The ARIA attributes were read out of the HTML, not announced by NVDA/JAWS/VoiceOver. TC-10's label expectations are structural, not experiential.
- **Performance under a real network.** Chunk sizes were measured uncompressed on disk (~258 KB of JS total, dominated by the ~180 KB shared React runtime the three islands pull in). No Lighthouse run, no throttled-3G check, no measurement of when `client:idle` actually fires.
- **Copy quality.** TC-12 is a judgment call the agent cannot make. This copy ships to every project scaffolded from the template.
