# QA Plan: theme switcher (light / dark / system) + shadcn preset swapping

_Generated 2026-08-07 · covers `issue-64-theme-switcher-for-light-dark-and-shadcn-theme` vs `main` (6 commits, issue #64)_

## Summary

- The base template gains a tri-state theme control. `packages/ui/src/lib/theme.ts` holds the
  constants and `THEME_INIT_SCRIPT` — a pre-paint inline script string that `Layout.astro` bakes
  into every page's `<head>`. It reads the stored choice, falls back to the OS, writes
  `data-theme` on `<html>`, toggles the `.dark` class, drives every `[data-theme-toggle]` through
  one delegated click listener, and follows OS changes **only** while the state is `system`.
  `packages/ui/src/blocks/theme-toggle.tsx` is the button: three lucide icons, no state, no
  `onClick`, no `client:*` directive — CSS picks the icon off `html[data-theme]`. The second half
  is documentation plus a guard: the template's `AGENTS.md` documents swapping the whole token set
  with `shadcn add <registry:style url>`, and `scripts/verify-preset.ts` (`pnpm verify:preset`)
  runs that recipe for real and asserts the base's hand-written CSS survived it.
- "Working" means: no flash of the wrong theme on any load, the cycle reaches all three states and
  persists, the OS is followed only under `system`, the landing page ships **zero** extra JS for
  the toggle, the control is *absent* rather than dead with JS off, and every one of the seven base
  blocks reads correctly in light and dark on both the default token set and a swapped preset.

**Split of work in this document.** Everything decidable from source or from the built artifacts —
the script's state machine under normal, degraded-storage and tampered-attribute conditions, the
absence of a hydration island, the compiled CSS variants and their source order, the unescaped
inline script, the Node-importability of `theme.ts` — the agent already ran against the existing
build; see [Automated verification](#automated-verification-by-ai-agent). What is left is
everything that needs eyes on a real browser: the flash, the palette across seven blocks × two
presets, JS-off, a live OS switch, the fixed button's placement, and real degraded-storage engines.

## Run log

_Fill in when you run the plan._

| Field | Value |
|---|---|
| Tester | |
| Date run | |
| Build / commit | |

**Overall**

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan — do this once, before Scenario 1.

- **Run this on a machine with a browser.** The repo's dev box is headless; none of these cases can
  be judged over SSH. Either clone the branch locally, or forward the preview port over Tailscale
  and add `--host` to the serve command.
- Branch under test: `issue-64-theme-switcher-for-light-dark-and-shadcn-theme`.
- Everything below is run from the worktree root. Paths are relative to it.
- Node 24+ and pnpm 11, per the repo's toolchain.
- Browsers: one Chromium-based and one Firefox at minimum. Safari if you have a Mac — it is the
  only engine that reproduces the private-mode storage failure natively (TC-3.1).

**Know which token set the playground is carrying.** This is the plan's real cost driver. There are
only two states, and each is one command away:

| State | `--primary` in `.dev/playground/packages/ui/src/styles/globals.css` | Command that produces it |
|---|---|---|
| **Default** (base tokens) | `oklch(0.205 0 0)` — near-black | `pnpm deps:verify` |
| **Swapped** (tweakcn `modern-minimal`) | `oklch(0.6231 0.1880 259.8145)` — blue | `pnpm verify:preset` |

Check which one you are in before starting:

```sh
grep -m1 -- "--primary:" .dev/playground/packages/ui/src/styles/globals.css
```

> **The worktree as handed to you is already in the Swapped state**, with a matching build in
> `.dev/playground/apps/web/dist` — `pnpm verify:preset` was the last thing that ran. If you want to
> save one full scaffold-and-build, run **Scenario 4 first**, then run Scenario 1's setup and
> continue from Scenario 1. Otherwise just run the plan in order; Scenario 1's setup puts you back
> in Default.

**Both setup commands destroy `.dev/playground` and re-scaffold it** (`deps:verify` and
`verify:preset` each begin with `pnpm play:init`). Anything you added there by hand — a
`saasaloy add` module, an edited `globals.css` — is gone. That is by design; `.dev` is scratch.

Serve the built site (static output, so `astro preview` is enough):

```sh
pnpm -C .dev/playground/apps/web preview
```

For the cases that ask you to poke at the DOM or edit a file and watch it react, use the dev server
instead — fixed port 3000, `strictPort`, so a busy port fails loudly rather than drifting:

```sh
pnpm -C .dev/playground/apps/web dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — Default preset, JS on, no stored choice | No flash of the wrong theme on a first visit | 🔴 Critical |
| TC-1.2 | 1 — Default preset, JS on, no stored choice | The full cycle, its labels, and persistence across a reload | 🔴 Critical |
| TC-1.3 | 1 — Default preset, JS on, no stored choice | A live OS theme change — honoured under `system`, ignored under an explicit choice | 🔴 Critical |
| TC-1.4 | 1 — Default preset, JS on, no stored choice | Visual sweep: all seven blocks, light and dark, default tokens | 🔴 Critical |
| TC-1.5 | 1 — Default preset, JS on, no stored choice | The fixed bottom-right button against real page content | 🟡 Normal |
| TC-1.6 | 1 — Default preset, JS on, no stored choice | Keyboard and screen-reader reachability | 🟡 Normal |
| TC-1.7 | 1 — Default preset, JS on, no stored choice | `/privacy` and `/terms` — themed, but no control | 🟡 Normal |
| TC-1.8 | 1 — Default preset, JS on, no stored choice | `data-theme` really is the JS-present marker | 🟢 Low |
| TC-2.1 | 2 — Default preset, JavaScript disabled | The control is absent, not dead | 🔴 Critical |
| TC-3.1 | 3 — Default preset, storage blocked | All three states still reachable with a dead `localStorage` | 🔴 Critical |
| TC-3.2 | 3 — Default preset, storage blocked | Persistence is the only casualty | 🟡 Normal |
| TC-4.1 | 4 — Swapped preset (tweakcn `modern-minimal`) | Visual sweep: all seven blocks, light and dark, swapped tokens | 🔴 Critical |
| TC-4.2 | 4 — Swapped preset (tweakcn `modern-minimal`) | The toggle's own chrome on a palette it was not designed against | 🟡 Normal |
| TC-4.3 | 4 — Swapped preset (tweakcn `modern-minimal`) | The `AGENTS.md` recipe describes what actually happened | 🟡 Normal |

## Scenario 1 — Default preset, JS on, no stored choice

The baseline: a scaffolded project with the template's own tokens, seen by a first-time visitor.

**Setup** — once, for every case in this scenario.

1. Put the playground back on the default token set and build it. This re-scaffolds `.dev/playground`
   from the template and takes a few minutes.

   ```sh
   pnpm deps:verify
   ```

   - [ ] The command exits 0
   - [ ] `grep -m1 -- "--primary:" .dev/playground/packages/ui/src/styles/globals.css` prints `oklch(0.205 0 0)`

2. Serve it.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

3. Open the printed URL in a **fresh** private/incognito window, or clear the site's storage in
   DevTools → Application → Local Storage. Every case below assumes no `theme` key exists yet.

   - [ ] DevTools → Application → Local Storage shows no `theme` key for this origin

- [ ] Setup complete

### TC-1.1 — No flash of the wrong theme on a first visit  ·  🔴 Critical

**Goal** — the pre-paint script resolves the theme before the browser paints, for a visitor with no
stored choice, on both OS preferences.

**Steps**

1. Set your OS to **dark** mode. Hard-reload the page (Cmd/Ctrl+Shift+R).
   - [ ] The very first frame is dark — no white flash, not even for one frame
   - [ ] The button in the bottom-right corner shows the **monitor** icon
2. Slow yourself down enough to catch a flash: DevTools → Network → throttle to "Slow 4G", then
   hard-reload again.
   - [ ] Still no light-coloured frame before the dark page appears
3. Set your OS to **light** mode. Hard-reload.
   - [ ] The first frame is light — no dark flash
   - [ ] The button still shows the **monitor** icon
4. Repeat step 1 in the second browser (Firefox if you started in Chromium).
   - [ ] Same result — no flash

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — The full cycle, its labels, and persistence across a reload  ·  🔴 Critical

**Goal** — one press moves the state exactly one step around `light → dark → system → light`, the
page repaints, the accessible name follows, and a returning visitor lands on their choice with no
flash.

**Steps**

1. With your OS in **light** mode and the state at `system`, hover the corner button and read its
   tooltip/accessible name in DevTools (the `aria-label` attribute on the `<button>`).
   - [ ] `aria-label` is `Theme: system. Switch to light.`
   - [ ] `<html>` carries `data-theme="system"` and no `dark` class
2. Click it once.
   - [ ] The icon becomes the **sun**
   - [ ] `<html>` is `data-theme="light"`, no `dark` class
   - [ ] `aria-label` is now `Theme: light. Switch to dark.`
   - [ ] Local Storage has `theme` = `light`
3. Click again.
   - [ ] The icon becomes the **moon** and the page repaints dark immediately — no reload needed
   - [ ] `<html>` is `data-theme="dark"` **and** carries the `dark` class
   - [ ] `aria-label` is `Theme: dark. Switch to system.`
   - [ ] Local Storage has `theme` = `dark`
4. Click a third time.
   - [ ] The icon becomes the **monitor** and the page returns to light (matching your light OS)
   - [ ] `<html>` is `data-theme="system"`, no `dark` class
   - [ ] The `theme` key is **removed** from Local Storage, not set to `"system"`
5. Click once more, to confirm the cycle wraps.
   - [ ] Back to the sun icon / `light`
6. Now the returning-visitor case. Leave it on `dark` (two more clicks), then hard-reload with the
   OS still in **light** mode.
   - [ ] The first frame is dark — the stored choice beats the OS, with no light flash in between
   - [ ] The moon icon is showing before you interact with anything
7. Close the tab entirely, reopen the URL.
   - [ ] Still dark

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — A live OS theme change — honoured under `system`, ignored under an explicit choice  ·  🔴 Critical

**Goal** — the `matchMedia` listener re-resolves without a reload while the state is `system`, and
does nothing at all once the visitor has chosen.

**Steps**

1. Get the state to `system` (cycle until the monitor icon shows) with the OS in **light** mode.
   Put the browser window and your OS appearance setting side by side so you can see both.
2. Flip the OS to **dark** without touching the page.
   - [ ] The page repaints dark on its own, no reload
   - [ ] `<html>` still reads `data-theme="system"` — the choice did not become `dark`
   - [ ] The icon is still the **monitor**, and the `aria-label` still says `Theme: system.`
3. Flip the OS back to **light**.
   - [ ] The page repaints light on its own
4. Now click once to reach `light` (explicit). Flip the OS to **dark**.
   - [ ] The page stays light — the OS is ignored
   - [ ] `<html>` still reads `data-theme="light"` and has no `dark` class
5. Click to `dark` (explicit). Flip the OS to **light**.
   - [ ] The page stays dark
6. Click to `system`.
   - [ ] The page immediately snaps to the current OS preference (light)

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — Visual sweep: all seven blocks, light and dark, default tokens  ·  🔴 Critical

**Goal** — issue #64's AC 10, first half: every base block is legible and correctly coloured in both
palettes on the template's own token set. This is the case the whole plan exists for; take your time.

The seven blocks, in page order: **navbar** (sticky, top) · **hero** · **feature-grid** ·
**pricing-table** · **faq** · **cta** · **footer**.

**Steps**

1. Set the state to `light`. Scroll the whole page top to bottom at a desktop width (≥1280px).
   - [ ] navbar — logo/site name, links and its own control are legible; the sticky bar's
         background is opaque enough that content scrolling under it does not show through as mush
   - [ ] hero — heading, sub-copy and both buttons have real contrast; the primary button's label is
         readable against the primary fill
   - [ ] feature-grid — card borders are visible against the page background, icons are not
         invisible, body copy is muted but readable
   - [ ] pricing-table — the monthly/annual toggle reads in both positions; the highlighted/featured
         plan is distinguishable from the others; check marks are visible
   - [ ] faq — collapsed and expanded rows both read; the chevron is visible; separators are visible
   - [ ] cta — the band's background separates from the section above and below it
   - [ ] footer — column headings, links, the separator rule and the copyright line are all legible
   - [ ] No element anywhere is invisible-on-its-own-background (the classic token-swap failure)
2. Set the state to `dark`. Scroll the whole page again.
   - [ ] navbar — as above, in dark
   - [ ] hero — as above, in dark
   - [ ] feature-grid — as above, in dark
   - [ ] pricing-table — as above, in dark
   - [ ] faq — as above, in dark
   - [ ] cta — as above, in dark
   - [ ] footer — as above, in dark
   - [ ] Nothing is pure-black-on-dark or pure-white-on-light where a muted token was intended
3. Check the surfaces the tokens do not paint but `color-scheme` does.
   - [ ] In dark, the scrollbar and the page's default canvas are dark, not a bright strip
   - [ ] In light, they are light
4. Set the state to `system` with the OS in dark, then in light.
   - [ ] Both resolutions render identically to the explicit `dark` and `light` sweeps above

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.5 — The fixed bottom-right button against real page content  ·  🟡 Normal

**Goal** — `fixed right-4 bottom-4 z-50` does not occlude anything a visitor needs, at any width.

The button is `size-7` (28px) with a translucent background and a backdrop blur, and it floats above
everything at `z-50` — the same layer as the sticky navbar.

**Steps**

1. At 1280px width, scroll to the very bottom of the page.
   - [ ] The button does not cover the footer's copyright line
   - [ ] The button does not cover any footer link
2. Resize to 768px (tablet) and repeat.
   - [ ] Nothing in the footer is covered
3. Resize to 375px (iPhone-class), then 320px (the narrowest width worth supporting). Scroll to the
   bottom of each.
   - [ ] The button does not sit on top of a footer link or the copyright at either width
   - [ ] The button does not push anything off-screen or cause a horizontal scrollbar
4. Scroll to the pricing and FAQ sections at 375px.
   - [ ] The button does not cover a pricing plan's CTA button
   - [ ] The button does not cover an FAQ row's expand target
5. Scroll to the very top so the sticky navbar is showing.
   - [ ] The corner button and the navbar's own controls never overlap or collide visually
6. Judge it as a user would.
   - [ ] Against a light page the translucent button is discoverable rather than nearly invisible
   - [ ] Against a dark page, likewise
   - [ ] It is comfortably tappable with a thumb on a real phone, or note here if 28px feels too
         small (the 44px touch-target guideline says it might)

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.6 — Keyboard and screen-reader reachability  ·  🟡 Normal

**Goal** — the control is operable and describable without a mouse, given it has no visible text
label at all.

**Steps**

1. Load the page and press Tab repeatedly from the top.
   - [ ] The corner button receives focus at some point without needing a mouse
   - [ ] Its focus ring is clearly visible in light mode
   - [ ] Its focus ring is clearly visible in dark mode
2. With it focused, press Enter.
   - [ ] The theme advances one step
3. Press Space.
   - [ ] The theme advances one more step
4. Turn on a screen reader (VoiceOver ⌘F5 on macOS, NVDA on Windows) and Tab to the button.
   - [ ] It is announced as a button with the name `Theme: <state>. Switch to <next>.`
   - [ ] After pressing it, moving focus away and back announces the **new** state, not the old one
5. Check contrast with DevTools' colour picker on the button's icon against its background.
   - [ ] The icon meets at least 3:1 against the button surface in light mode
   - [ ] The same in dark mode

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.7 — `/privacy` and `/terms` — themed, but no control  ·  🟡 Normal

**Goal** — the theme follows the visitor across the site even though only the landing page renders
the toggle, and those pages do not flash either.

The other two pages share `Layout.astro`, so they get the boot script; `index.astro` is the only page
that renders the button.

**Steps**

1. On the landing page, set the theme to `dark`. Click the footer's **Privacy** link.
   - [ ] `/privacy` renders dark, with no light flash during the navigation
   - [ ] There is **no** theme button in the bottom-right corner of this page
   - [ ] `<html>` on this page carries `data-theme="dark"` and the `dark` class
2. Navigate to `/terms`.
   - [ ] Same: dark, no flash, no button
3. Hard-reload `/privacy` directly.
   - [ ] Still dark on the first frame
4. Set the theme back to `light` on the landing page, then revisit `/privacy`.
   - [ ] Light, no flash

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.8 — `data-theme` really is the JS-present marker  ·  🟢 Low

**Goal** — the block's claim that it renders nothing in a document that does not inline the boot
script, confirmed without building a second host.

**Steps**

1. In DevTools' Elements panel, select the `<html>` element and delete its `data-theme` attribute.
   - [ ] The corner button disappears entirely — it does not go blank, greyed or iconless
   - [ ] Nothing else on the page shifts or reflows as a result
2. Add `data-theme="light"` back by hand.
   - [ ] The button reappears with the sun icon
3. Set it to a junk value, `data-theme="purple"`.
   - [ ] The button is visible but shows **no** icon (no state matches) — it does not show all three
         icons stacked

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 2. Nothing to tear down; just clear
the stored choice so the next scenario starts as a first-time visitor.

Clear it in DevTools → Application → Local Storage, or from the console:

```sh
localStorage.removeItem("theme"); location.reload();
```

## Scenario 2 — Default preset, JavaScript disabled

Same build as Scenario 1 — do **not** rebuild. Only the browser setting changes.

**Setup** — once, for every case in this scenario.

1. Leave the preview server running from Scenario 1.
2. Disable JavaScript for the origin. In Chromium: DevTools → Cmd/Ctrl+Shift+P → "Disable
   JavaScript". In Firefox: `about:config` → `javascript.enabled` → `false`.
3. Hard-reload the page.

   - [ ] Setup complete

### TC-2.1 — The control is absent, not dead  ·  🔴 Critical

**Goal** — issue #64's AC 4: with JS off there is no button to click rather than a button that does
nothing when clicked.

**Steps**

1. Look at the bottom-right corner.
   - [ ] There is no button there at all — not a visible-but-inert one, not an empty box
2. Inspect `<html>` in the Elements panel.
   - [ ] It has **no** `data-theme` attribute
   - [ ] It has no `dark` class
3. Scroll the whole page.
   - [ ] The page renders fully in the light palette and is completely legible
   - [ ] Nothing is unstyled, and no section collapses or leaves a visible hole where the toggle
         would have been
   - [ ] The hydrated blocks (navbar, pricing-table, faq) still render their static markup — the
         page degrades, it does not break
4. Re-enable JavaScript and hard-reload.
   - [ ] The button comes back

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — re-enable JavaScript before Scenario 3.

## Scenario 3 — Default preset, storage blocked

Same build again — no rebuild. This scenario reproduces the environments where `localStorage` reads
and writes *throw*, which is the failure mode that was a review blocker on this branch: cycling read
its state from storage, so with storage dead every press landed on `light` and the visitor could
never reach `dark` or `system`. The fix cycles from the painted `data-theme` attribute instead. This
case exists to confirm that fix on a real engine.

**Setup** — once, for every case in this scenario. Any **one** of these three is enough; all three
is better if you have the browsers.

1. **Chromium, cookies blocked** — Settings → Privacy → "Block all cookies" for this site (this
   blocks `localStorage` too, and makes it throw). Reload the page.
2. **Safari private window** (macOS only) — the native reproduction.
3. **A sandboxed iframe** — the cheapest one, works in any browser. With the preview server running,
   save this next to the playground and open it directly. Adjust the port if `astro preview` printed
   a different one.

   ```sh
   printf '<iframe sandbox="allow-scripts" src="http://localhost:4321/" style="width:100%%;height:100vh;border:0"></iframe>' > /tmp/theme-sandbox.html && open /tmp/theme-sandbox.html
   ```

- [ ] Setup complete — note in the run log which of the three you used

### TC-3.1 — All three states still reachable with a dead `localStorage`  ·  🔴 Critical

**Goal** — the cycle survives storage that throws on every call: the visitor loses persistence, not
the ability to choose. This is the regression the review caught.

**Steps**

1. Open the console and confirm storage really is dead in this context.

   ```sh
   try { localStorage.setItem("probe", "1"); console.log("storage WORKS — wrong context"); } catch (e) { console.log("storage throws:", e.name); }
   ```

   - [ ] The console prints `storage throws:` and an error name — if it prints `storage WORKS`, the
         setup did not take and this case proves nothing
2. Look at the corner button.
   - [ ] It is visible (the boot script survived the throwing read)
   - [ ] It shows the **monitor** icon — the state fell back to `system`
   - [ ] No uncaught exception in the console
3. Click it once.
   - [ ] The icon becomes the **sun** and the page is light
4. Click again.
   - [ ] The icon becomes the **moon** and the page repaints **dark** — this is the exact step that
         used to fail, so look hard
5. Click again.
   - [ ] The icon returns to the **monitor** and the page follows the OS
6. Click twice more.
   - [ ] `light`, then `dark` — the cycle keeps advancing indefinitely, it never sticks on one state
7. Check the console once more.
   - [ ] Still no uncaught exception from any of the five presses

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.2 — Persistence is the only casualty  ·  🟡 Normal

**Goal** — a blocked-storage visitor gets a correctly themed page on every load, just not a
remembered one.

**Steps**

1. Set the theme to `dark`, then reload the page (still in the blocked-storage context).
   - [ ] The page comes back at `system`, following the OS — the choice is forgotten, as expected
   - [ ] The first frame is correct for the current OS preference — no flash, no unstyled page
2. Set the OS to dark and reload.
   - [ ] The page loads dark on the first frame
3. Set the OS to light and reload.
   - [ ] The page loads light on the first frame

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — undo the storage block (re-allow cookies / close the private window / close the iframe
page) and stop the preview server before Scenario 4.

## Scenario 4 — Swapped preset (tweakcn `modern-minimal`)

The second half of AC 10 and the whole preset story. **This scenario's setup destroys the Scenario
1–3 build**, which is why it runs last.

**Setup** — once, for every case in this scenario.

1. Apply the preset for real. This re-scaffolds `.dev/playground`, fetches the preset over the
   network, runs `shadcn add`, rebuilds, and asserts the base's own CSS rules survived. It needs
   internet and tweakcn to be up.

   ```sh
   pnpm verify:preset
   ```

   - [ ] The command exits 0
   - [ ] Its last line reports `--primary swapped to` a value that is not the base's
2. Confirm the playground is in the Swapped state.

   ```sh
   grep -m1 -- "--primary:" .dev/playground/packages/ui/src/styles/globals.css
   ```

   - [ ] Prints `oklch(0.6231 0.1880 259.8145)` (blue), not `oklch(0.205 0 0)`
3. Serve it.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

4. Open the site in a fresh private window with no stored `theme` key.

- [ ] Setup complete

### TC-4.1 — Visual sweep: all seven blocks, light and dark, swapped tokens  ·  🔴 Critical

**Goal** — issue #64's AC 10, second half: the blocks are written against tokens, not against the
template's specific colours, so a whole-palette swap must not break any of them.

**Steps**

1. Set the state to `light` and scroll top to bottom at desktop width.
   - [ ] The page is visibly a *different* palette from Scenario 1 — the primary colour is blue, not
         near-black. If it looks identical, the preset did not reach the browser; suspect a stale
         build or a cached page before recording a pass
   - [ ] navbar — legible, sticky background still opaque enough
   - [ ] hero — the primary button's label is readable against the **new** primary fill (this is the
         single most likely thing a preset breaks)
   - [ ] feature-grid — card borders still visible against the new background
   - [ ] pricing-table — the featured plan is still distinguishable; check marks still visible
   - [ ] faq — chevrons and separators still visible
   - [ ] cta — the band still separates from its neighbours
   - [ ] footer — links, separator and copyright still legible
2. Set the state to `dark` and scroll again.
   - [ ] navbar — legible in dark
   - [ ] hero — legible in dark, primary button label readable
   - [ ] feature-grid — legible in dark
   - [ ] pricing-table — legible in dark
   - [ ] faq — legible in dark
   - [ ] cta — legible in dark
   - [ ] footer — legible in dark
3. Check the pieces that are not tokens.
   - [ ] Border radius, spacing and font still look deliberate — the preset may bring its own
         `--radius` and font mappings, and the result should still look like one design
   - [ ] The scrollbar and canvas still follow the theme in both palettes
4. Cycle all three states once.
   - [ ] The toggle behaves identically to Scenario 1 — the preset changed nothing about the mechanism

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.2 — The toggle's own chrome on a palette it was not designed against  ·  🟡 Normal

**Goal** — the button's `border-border/60 bg-background/80 backdrop-blur` is defined in
`index.astro`, not in the preset, so a swapped palette is the case where it can go wrong.

**Steps**

1. In `light`, scroll so the button sits over the hero, then over a feature card, then over the cta
   band, then over the footer.
   - [ ] The button stays visible against all four backgrounds
   - [ ] Its border is discernible, not lost in the background
   - [ ] The backdrop blur reads as intentional rather than as a smear
2. Repeat in `dark`.
   - [ ] Visible against all four in dark too
3. Tab to it.
   - [ ] The focus ring is visible in both palettes on the new tokens

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.3 — The `AGENTS.md` recipe describes what actually happened  ·  🟡 Normal

**Goal** — issue #64's AC 8: a developer following the template's documented recipe gets the result
the docs promise, including the warning that they now own the file.

**Steps**

1. Read the "Swapping the whole theme for a preset" section of
   `packages/cli/templates/base/AGENTS.md` and compare it against the file the run produced.

   ```sh
   diff <(git show HEAD:packages/cli/templates/base/packages/ui/src/styles/globals.css) .dev/playground/packages/ui/src/styles/globals.css
   ```

   - [ ] The three `@source` lines, `@custom-variant dark`, and the `@layer base` block are all
         still present in the playground's file (they appear as context, not as deletions)
   - [ ] The differences are confined to `:root`, `.dark` and `@theme inline`
   - [ ] `@theme inline` has *gained* mappings rather than lost any — the doc says to expect this
2. Confirm the doc's claim about `components.json`.

   ```sh
   diff <(git show HEAD:packages/cli/templates/base/packages/ui/components.json) .dev/playground/packages/ui/components.json
   ```

   - [ ] No output — the file is byte-identical
3. Read the section as a developer who has never seen it.
   - [ ] The `pnpm --filter @repo/ui exec shadcn add <url>` command is copy-pasteable as written
   - [ ] Both sources are named and linked: `https://ui.shadcn.com/create` and `https://tweakcn.com`
   - [ ] It states plainly that this edits a base file with no update path, and that the developer
         owns it afterwards
   - [ ] It states that light/dark switching is unaffected — and TC-4.1 step 4 just confirmed that

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — nothing required. `.dev/playground` is scratch and stays in the Swapped state; the next
`pnpm play:init` or `pnpm deps:verify` re-scaffolds it back to the default tokens. Stop the preview
server.

## Automated verification (by AI agent)

_Checks the agent ran itself — no action needed from the tester; listed here for context and
sign-off._

**The repo gate was already green before this plan was written and was deliberately not re-run:**
`pnpm test` (121 tests), `pnpm typecheck`, `pnpm deps:verify` and `pnpm verify:preset` all passed on
this branch. The built artifacts those runs produced are what everything below was read from —
nothing was rebuilt, because rebuilding would have destroyed the very build the plan tests against.

**1. The state machine, driven headlessly.** `THEME_INIT_SCRIPT` was imported from
`packages/cli/templates/base/packages/ui/src/lib/theme.ts` and executed against a hand-rolled DOM
stub (documentElement attributes and classList, `matchMedia` with a fireable `change`, a
`localStorage` that can be made to throw, a delegated-click target). 12 assertions, all green:

- ✅ First visit, OS light → `data-theme="system"`, no `dark` class, label `Theme: system. Switch to light.`
- ✅ First visit, OS dark → `dark` class applied at boot, i.e. before `DOMContentLoaded`
- ✅ Cycle `system → light` → attribute `light`, no `dark` class, storage `light`
- ✅ Cycle `light → dark` → attribute `dark`, `dark` class on, storage `dark`
- ✅ Cycle `dark → system` → attribute `system`, `dark` class off, storage key **removed**
- ✅ Returning visitor with `theme=dark` and OS light → dark at boot, correct label
- ✅ OS flip to dark while `system` → repaints dark, attribute stays `system`
- ✅ OS flip to dark while explicitly `light` → **ignored**, stays light
- ✅ Storage throwing on every call → cycle yields `system → light → dark → system → light`, i.e.
  all three states reachable (the review blocker, confirmed fixed)
- ✅ Storage throwing, then reload → back to `system`; persistence is the only loss
- ✅ Junk stored value (`"purple"`) → treated as `system`, resolves off the OS
- ✅ Tampered `data-theme` → `THEME_ORDER.indexOf` returns `-1` and the cycle lands on `light` rather
  than `undefined`

**2. `theme.ts` imports cleanly in Node** (AC 7 — no `window`/`document`/`localStorage` at module
scope):

```sh
node --input-type=module -e "const m = await import('./packages/cli/templates/base/packages/ui/src/lib/theme.ts'); console.log(Object.keys(m).sort().join(','), m.THEME_INIT_SCRIPT.length)"
```

- ✅ Imports with no error under Node's type stripping. Exports:
  `THEME_ATTRIBUTE, THEME_INIT_SCRIPT, THEME_LABELS, THEME_ORDER, THEME_STORAGE_KEY,
  THEME_TOGGLE_ATTRIBUTE, getStoredTheme, resolveTheme, setTheme`. Script is 2365 chars and contains
  no `</script>` sequence that could close the tag early.

**3. The script lands in the built HTML unescaped, un-deferred and pre-stylesheet** (AC 2 — the
plan's own flagged risk, since `typecheck` is blind to it):

```sh
head -c 4000 .dev/playground/apps/web/dist/index.html
```

- ✅ Emitted as a bare `<script>` — no `type="module"`, no `defer`, no `async`, so it is
  parser-blocking and runs before first paint.
- ✅ Body is verbatim source including comments and newlines; Astro did not escape, minify, wrap or
  hoist it.
- ✅ It appears **before** `<link rel="stylesheet" href="/_astro/Layout.TACDzEbT.css">` in `<head>`.
- ✅ Present in `privacy/index.html` and `terms/index.html` too, via the shared layout.

**4. Zero additional JavaScript for the toggle** (AC 3):

```sh
grep -o 'component-export="[^"]*"' .dev/playground/apps/web/dist/index.html | sort | uniq -c
```

- ✅ Exactly three hydration islands — `Navbar`, `PricingTable`, `Faq` — the same three as before
  this branch. `ThemeToggle` appears in **zero** islands and the string `ThemeToggle` does not occur
  in the built HTML at all.
- ✅ The button ships as static markup: `<button type="button" data-slot="button" data-theme-toggle=""
  aria-label="Theme: system. Switch to light." …>` with all three lucide SVGs inline.

**5. The CSS variants compiled, and win by source order:**

```sh
grep -o '[^}{]*data-theme[^}{]*{[^}]*}' .dev/playground/apps/web/dist/_astro/Layout.TACDzEbT.css
```

- ✅ `:where([data-theme]) .in-data-theme\:inline-flex{display:inline-flex}` — the reveal rule exists.
- ✅ `:where([data-theme=light]) .in-data-\[theme\=light\]\:block` and its `dark`/`system` siblings —
  the icon swap is pure CSS off `<html>`, no JS.
- ✅ **Specificity trap checked.** `:where()` contributes zero, so the reveal rules tie with `.hidden`
  at `(0,1,0)` and source order decides. `.hidden{display:none}` is at byte 8473; the reveal rules
  are at 22040 and 22278 — later, so they win. The button is hidden without `data-theme` and shown
  with it, which is what makes the JS-off case work.

**6. Per-page rendering:**

```sh
grep -o 'data-theme-toggle=""' .dev/playground/apps/web/dist/index.html | wc -l
```

- ✅ Exactly one toggle on `index.html`, zero on `privacy/index.html` and `terms/index.html` — the
  block is placed page-level as designed, not in the shared layout.

**7. The preset really swapped the tokens** (AC 11, from the `verify:preset` run that produced the
current build):

```sh
grep -o -- '--primary:[^;]*' .dev/playground/apps/web/dist/_astro/Layout.TACDzEbT.css | head -3
```

- ✅ Built CSS carries `--primary:oklch(62.31% .188 259.815)` — tweakcn's `modern-minimal` blue, not
  the template's `oklch(0.205 0 0)`. The swap reached the build output, not just the source file.

**8. Wiring** (AC 9):

- ✅ `verify:preset` is declared in the root `package.json` and is **not** part of the `deps:verify`
  chain, so the standing gate makes no third-party network call.

## Not covered / needs human judgment

- **Everything visual.** No agent on this branch's dev box has a browser, so the flash, the palette
  across seven blocks × two presets, the button's placement and every contrast judgment are the
  human's alone. That is the whole point of TC-1.1, TC-1.4, TC-1.5 and TC-4.1.
- **Real engines under degraded storage.** The 12 headless assertions above prove the *logic*
  survives a throwing `localStorage`; they cannot prove Safari private mode or Chromium's "block all
  cookies" behave the way the stub does. TC-3.1 is the only real evidence.
- **The React SPA host** (AC 6). The block claims to be importable unchanged by a Vite app that
  injects `THEME_INIT_SCRIPT` at `head-prepend`. No such host exists in this repo yet — that plugin
  is an acceptance criterion of issue #13 (`feat(admin): admin capability module`). Nothing here
  tests it; the block's Node-safe `theme.ts` (check 2 above) is the necessary precondition, not the
  proof.
- **Presets other than `modern-minimal`.** `verify:preset` probes exactly one tweakcn URL. A preset
  that ships a radically different `--radius` or font stack could still look wrong in a way this
  plan would not catch. TC-4.1 step 3 is a partial hedge.
- **`https://ui.shadcn.com/create`**, the *first* source the docs recommend. It has no fixed URL to
  probe, so neither the script nor this plan exercises it — only the tweakcn shape is proven, and the
  docs' claim is that the mechanism is the `registry:style` item rather than the host.
- **Third-party uptime.** `pnpm verify:preset` (and therefore all of Scenario 4) fails if tweakcn is
  down or has moved the URL. That failure is not a defect in this branch — record it as Skipped.
- **Performance.** The inline script is ~2.4KB unminified and untranspiled on every page. No one has
  measured its effect on any Core Web Vital; it is almost certainly noise next to the 180KB React
  client chunk, but "almost certainly" is not a measurement.
- **Print stylesheet and forced-colors / high-contrast mode.** Deliberately skipped — the base ships
  no print styles and no `forced-colors` handling, so there is nothing this branch changed there.
- **View transitions.** Skipped, and not applicable: the base is a static MPA with no
  `<ClientRouter />`, so every navigation is a full document load that re-runs the boot script.
  TC-1.7 covers the navigation case that does exist.
