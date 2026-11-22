# QA Plan: Saasaloy UI, an open registry of blocks (issue #384, plan 0121)

_Generated 2026-11-22 · refreshed 2026-11-22 against `baef11ae` (clean apart from this untracked plan; first run at `a852ae37`) · covers the Saasaloy UI registry, its pages (/ui, block pages, themes, templates, builder), `init --theme`, `init --template --blocks` and the dusk kit, diff range main...HEAD_

## Summary
- Saasaloy UI publishes the base, module and dusk blocks and four themes as a shadcn registry, and the CLI writes a theme, a template and a block list into a new project.
- Working means a plain shadcn app installs and builds the blocks, the pages show the right commands, and a builder command gives a project that matches the builder preview.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-384-publish-saasaloy-ui-an-open-registry-of-blocks` at `baef11ae`, worktree `/home/dev/worktrees/saasaloy/issue-384-publish-saasaloy-ui-an-open-registry-of-blocks`.
- Rebase: before the PR opened, the branch was rebased onto `origin/main` at `3c611751` (v0.12.0). The same changes now sit at head `6798feff` in place of `baef11ae`. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm docs:check` each exited 0 at `6798feff`. The browser results above were not run again after the rebase, because main changed only docs, skill text and the release version.
- Base URL `http://localhost:3000` (apps/web has no `.env.local`, so the dev port is 3000). No credentials are necessary.
- The mockups for the visual cases are in `.afkkit/mockups/` with the prefixes `0121-r1-` (gallery), `0121-r2-` (themes and switcher) and `0121-r3-` (templates, builder, dusk).
- Screenshots: local to this run and not committed. The /ui, block, switcher, themes, templates and builder screenshots are from `baef11ae`. The `c15-*` and `next-app-*` screenshots are from `a852ae37`, because the fix commit does not change the project template or the registry blocks. The names under each case match the labels in the gallery.

Launch with:

```sh
ASTRO_DEV_BACKGROUND=1 pnpm --filter @saasaloy/web dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Site dev server running | The /ui index matches mockup round r1 | 🟡 Normal |
| TC-1.2 | 1: Site dev server running | The block pages match mockup round r1 | 🟡 Normal |
| TC-1.3 | 1: Site dev server running | The themes page and the switcher match round r2 | 🟡 Normal |
| TC-1.4 | 1: Site dev server running | The templates page and the builder match round r3 | 🟡 Normal |
| TC-2.1 | 2: New project from a builder command | The landing page matches the builder preview | 🔴 Critical |
| TC-3.1 | 3: Plain Next.js app with the blocks installed | The installed blocks look right outside Saasaloy | 🟢 Low |

## Scenario 1: Site dev server running

**Setup.** Run once, for every case in this scenario.

1. Start the site with the launch command in **Environment**.
2. Open the four mockup folders side by side with the browser.

- [ ] Setup complete

### TC-1.1: The /ui index matches mockup round r1  ·  🟡 Normal

**Goal.** The block gallery looks like the approved r1 index at both widths and in both modes.

**Steps**

1. Open `http://localhost:3000/ui` at 1440 px in light mode. Compare it with `0121-r1-index-light-1440.png`.
   - [ ] The page matches the mockup in layout, hierarchy and spacing
     - header, title and install command at the top
     - filter chips in one row: All, Ink, Dusk, the block types, Auth, Waitlist (the mockup shows placeholder chips, decision 29)
     - cards in rows of one height, each with its wireframe thumb
     - screenshots: `index-light-1440` · `index-dark-1440` · `index-light-390` · `index-dark-390`
2. Set dark mode with the site toggle. Then set the width to 390 px in both modes.
   - [ ] The same check is clean in dark and at 390 px, with nothing illegible on its background

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The block pages match mockup round r1  ·  🟡 Normal

**Goal.** A base block page and a module block page look like the approved r1 block page.

**Steps**

1. Open `http://localhost:3000/ui/blocks/ink-hero` at 1440 px in light mode. Compare it with `0121-r1-block-light-1440.png`.
   - [ ] The page matches the mockup
     - Preview and Code tabs, the toolbar with the theme control and the light/dark and desktop/mobile pairs
     - the live preview frame, the install command, the base-* style note that names Saasaloy
     - screenshots: `block-light-1440` · `block-dark-1440` · `block-light-390` · `block-dark-390`
2. Set dark mode, then 390 px.
   - [ ] The same check is clean in dark and at 390 px
3. Open `http://localhost:3000/ui/blocks/auth-sign-in`.
   - [ ] The two command panels ("Any shadcn project" and "In a Saasaloy project") read as one pair and the sign-in preview looks finished
     - screenshots: `block-module-light-1440` · `block-module-dark-1440` · `block-module-light-390` · `block-module-dark-390`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The themes page and the switcher match round r2  ·  🟡 Normal

**Goal.** The themes page and the block page theme switcher look like the approved r2 images.

**Steps**

1. Open `http://localhost:3000/ui/themes` at 1440 px. Compare it with `0121-r2-themes-light-1440.png`.
   - [ ] The four theme cards match the mockup, and each card shows its samples in its own colours and radius
     - screenshots: `themes-light-1440` · `themes-dark-1440` · `themes-light-390` · `themes-dark-390`
2. Set the width to 390 px.
   - [ ] Each card fits the screen, and its install command scrolls inside its own field without a clipped Copy button
3. Open `http://localhost:3000/ui/blocks/ink-pricing-table`. Pick cobalt in the theme control. Compare it with `0121-r2-switcher-light-1440.png`.
   - [ ] The preview recolours to cobalt and the cobalt install command shows, as in the mockup
     - screenshots: `switcher-light-1440` · `switcher-dark-1440` · `switcher-light-390`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The templates page and the builder match round r3  ·  🟡 Normal

**Goal.** The templates page and the builder look like the approved r3 images.

**Steps**

1. Open `http://localhost:3000/ui/templates` at 1440 px. Compare it with `0121-r3-templates-light-1440.png`.
   - [ ] The three template cards (launch, focus, glow) match the mockup
     - screenshots: `templates-light-1440` · `templates-dark-1440` · `templates-light-390` · `templates-dark-390`
2. Open `http://localhost:3000/ui/builder`. Compare it with `0121-r3-builder-light-1440.png` and `0121-r3-builder-light-390.png`.
   - [ ] The builder matches the mockup at both widths and in both modes
     - screenshots: `builder-light-1440` · `builder-dark-1440` · `builder-light-390` · `builder-dark-390`
3. Pick glow and moss. Remove logo-cloud. Move faq up. Add how-it-works.
   - [ ] The edited list, the command and the preview read clearly together
     - screenshots: `builder-edited-light-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the dev server with Ctrl+C before Scenario 2.

## Scenario 2: New project from a builder command

**Setup.** Run once, for every case in this scenario.

1. Build the CLI.

```sh
pnpm --filter saasaloy build
```

2. Write the project with the command the builder printed in TC-1.4.

```sh
node packages/cli/dist/index.js init .dev/qa-builder --template=glow --theme=moss --blocks=navbar,hero,feature-grid,testimonials,faq,pricing-table,cta,how-it-works,footer --yes --no-git
```

3. Prepare and build the project.

```sh
cd .dev/qa-builder && git init -q && pnpm env:setup && pnpm build
```

4. Start the site of the new project.

```sh
cd .dev/qa-builder && pnpm --filter @repo/web dev
```

- [ ] Setup complete

### TC-2.1: The landing page matches the builder preview  ·  🔴 Critical

**Goal.** A copied builder command gives a landing page that a reader takes for the builder preview.

**Steps**

1. Open the new project's landing page at 1440 px. Open the builder URL `http://localhost:3000/ui/builder?template=glow&theme=moss&blocks=navbar,hero,feature-grid,testimonials,faq,pricing-table,cta,how-it-works,footer` beside it.
   - [ ] The two pages show the same blocks in the same order, in the same kit styles and the same moss colours
     - dusk hero, features, testimonials, FAQ, pricing and CTA panel; ink how-it-works, navbar and footer
     - the builder frame is narrower than the page (990 px at a 1440 window), so its grids can wrap differently
     - the project copy names Saasaloy where the frame names Acme
     - screenshots: `c15-project-light-1440` · `c15-builder-preview-light-1440` · `c15-project-dark-1440` · `c15-builder-preview-dark-1440`
2. Set dark mode on both pages.
   - [ ] The same comparison holds in dark

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the project's dev server, then remove the project.

```sh
rm -rf .dev/qa-builder
```

## Scenario 3: Plain Next.js app with the blocks installed

**Setup.** Run once, for every case in this scenario. The agent ran the same steps; **Automated verification** records them.

1. Create the app, initialise shadcn with base-nova, add ink-hero, auth-sign-in, auth-sign-up and waitlist-form, and render them with stub props on `app/page.tsx`, as **Automated verification** shows.

- [ ] Setup complete

### TC-3.1: The installed blocks look right outside Saasaloy  ·  🟢 Low

**Goal.** The blocks keep their look in a plain shadcn app with no Saasaloy theme.

**Steps**

1. Open the app at 1440 px after `pnpm build` and `pnpm start`.
   - [ ] The hero, the two auth cards and the waitlist form look finished in the neutral base-nova theme
     - screenshots: `next-app-light-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Remove the app.

```sh
rm -rf .dev/qa-next
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Logs are in `.afkkit/logs/` of the worktree (not committed). Each line names the revision it ran on.

**Refresh at `baef11ae`.** The fix commit changes `apps/web/src/pages/ui/{themes,templates}.astro` and `blocks/[name].astro` (class names only), the `--yes` help line of `init` and `docs/wiki/generated/cli.md`, and `scripts/registry.test.ts`. `git diff --stat a852ae37 baef11ae -- packages/cli/templates modules apps/web/registry.json apps/web/public` is empty. The agent ran C3, C5, C8, C13 and C16 again at `baef11ae`. The other checks keep their `a852ae37` result, for the reason on each line.

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
pnpm docs:check
```

```sh
git ls-files -z | xargs -0 node_modules/.bin/prettier --check --ignore-unknown
```

```sh
pnpm --filter saasaloy build
```

```sh
pnpm --filter @saasaloy/web run registry:build
```

```sh
pnpm dlx create-next-app@latest .dev/qa-next --ts --tailwind --app --eslint --use-pnpm --yes --skip-install --no-src-dir --import-alias "@/*"
```

```sh
cd .dev/qa-next && pnpm install && pnpm dlx shadcn@4.21.0 init --defaults --yes --no-monorepo
```

```sh
python3 -m http.server 4410 --bind 127.0.0.1 --directory "$REG"
```

```sh
cd .dev/qa-next && pnpm dlx shadcn@4.21.0 add "$REG/r/ink-hero.json" --yes
```

```sh
cd .dev/qa-next && pnpm dlx shadcn@4.21.0 add "$REG/r/auth-sign-in.json" --yes && pnpm dlx shadcn@4.21.0 add "$REG/r/auth-sign-up.json" --yes && pnpm dlx shadcn@4.21.0 add "$REG/r/waitlist-form.json" --yes
```

```sh
cd .dev/qa-next && pnpm build && pnpm exec next start -p 4420
```

```sh
node packages/cli/dist/index.js init .dev/qa-theme --theme=cobalt --yes --no-git
```

```sh
node packages/cli/dist/index.js init .dev/qa-template --template=focus --theme=ember --blocks=navbar,hero,feature-grid,testimonials,faq,cta,footer --yes --no-git
```

```sh
node packages/cli/dist/index.js init .dev/qa-builder --template=glow --theme=moss --blocks=navbar,hero,feature-grid,testimonials,faq,pricing-table,cta,how-it-works,footer --yes --no-git
```

```sh
cd .dev/<project> && git init -q && git add -A && pnpm env:setup && pnpm build
```

`$REG` is a temporary copy of `apps/web/public/r` in the session scratchpad. The foundation and the module items name `https://saasaloy.com/r/<item>.json`, which is not live yet. The copy rewrites only that prefix to `http://127.0.0.1:4410/r/`, and the local server serves it. The copy is otherwise byte-equal to the build output.

Acceptance checks (`.afkkit/checks.md`):

- ✅ C1 (`a852ae37`, not affected: the fix changes no block file) → `.afkkit/logs/qa-c1.log`. Of the 15 base blocks, navbar and pricing-table start with `"use client"`; the other 13 have no hook, own handler or browser API. error-state passes an `action.onClick` prop through, and footer holds `document` only inside an inline script string (decision 20). Dusk pricing-table, sign-in, sign-up and waitlist start with `"use client"`.
- ✅ C2 (`a852ae37`, not affected: registry.json and `public/r` are unchanged; registry.test.ts passes again at `baef11ae` under C3) → registry.json names 15 `ink-<block>` items (`ink-audience` to `ink-theme-toggle`) and `saasaloy-foundation`. `registry:build` exit 0, "wrote 35 items to public/r/"; every registry.json item has its `public/r/<name>.json`, and `public/r/registry.json` lists 35 items with the foundation. Log `.afkkit/logs/qa-c2-c7-c10-c12.log`.
- ✅ C3 (`baef11ae`) → `pnpm test` exit 0; the `test:scripts` pass with block-tokens.test.ts and registry.test.ts reports 1095 pass, 0 fail (1094 at `a852ae37`, plus the new `@repo/` import-form case). Log `.afkkit/logs/qa2-test.log`.
- ✅ C4 (`a852ae37`; the same tests pass again at `baef11ae` in `qa2-test.log`) → "fails a fixture block with a palette class" and "allows the #000 in a mask-image gradient and a token shadow tint" pass in `pnpm test` (log lines 4789 and 4791).
- ✅ C5 (agent part, `baef11ae`) → see **Browser checks**: 24 cards, 13 chips, one height per row, install command, Preview and Code tabs, the hero preview, `npx shadcn@latest add @saasaloy/ink-hero`, the style note "Needs a base-* style project (base-nova). Built by Saasaloy." The visual match is TC-1.1 and TC-1.2.
- ✅ C6 (`a852ae37`, not affected: the fix changes no registry item, so the installed files are the same) → create-next-app 16.4.6, `shadcn@4.21.0 init --defaults` wrote `style: "base-nova"`. `shadcn add` of ink-hero exit 0, created `components/blocks/hero.tsx` and five `lib/` files and pulled the foundation from the local server. `pnpm build` in the app exit 0 ("Running TypeScript ... Finished TypeScript"). The page rendered `<h1>` "Ship the SaaS, not the scaffolding." with no console error. Logs `.afkkit/logs/qa-next-{create,install,shadcn-init,add-ink-hero,build}.log`, file list `qa-next-files.log`.
- ✅ C7 (`a852ae37`, not affected: the theme items are unchanged; the theme test passes again in `qa2-test.log`) → `public/r/theme-{neutral,cobalt,ember,moss}.json` have type `registry:theme` with 34 light and 33 dark cssVars; primary `oklch(0.205 0 0)`, `oklch(0.47 0.2 264)`, `oklch(0.64 0.19 40)`, `oklch(0.52 0.13 155)`. registry.test.ts "ships each theme as a registry:theme item named theme-<name>" passes (it asserts the keys equal brand.css). No live `shadcn add` of a theme ran.
- ✅ C8 (agent part, `baef11ae`) → `/ui/themes` at 390 px has no sideways scroll: `scrollWidth - clientWidth = 0` in light and in dark (131 px at `a852ae37`). The four cards end at x = 366 px, and each of the four install commands sits in an `overflow-x` field that ends at x = 270 px and scrolls inside it. The switcher passes again: cobalt sets `data-ui-theme=cobalt` and the cobalt `--primary` in the frame and shows the `theme-cobalt` command at light-1440, dark-1440 and light-390; at 390 the control is a select. Evidence `.afkkit/logs/qa2-browser-check.log`, `.afkkit/logs/qa2-fit-390.log`, screenshots `themes-light-390` and `themes-dark-390`.
- ✅ C9 (`a852ae37`, not affected: only the `--yes` help text of `init` changed, not its behaviour) → `init .dev/qa-theme --theme=cobalt` exit 0; brand.css `--radius: 0.5rem`, `--primary: oklch(0.47 0.2 264)` (dark `oklch(0.67 0.168 264)`); DESIGN.md "Its theme is `cobalt`"; saasaloy.json `"theme": "cobalt"`; `pnpm env:setup` exit 0; `pnpm build` exit 0. Logs `.afkkit/logs/qa-e2e-qa-theme-*.log`, `qa-e2e-evidence.log`.
- ✅ C10 (`a852ae37` for the registry items; the `/ui/blocks/auth-sign-in` page part ran again at `baef11ae`, panels 254 and 254 px, no sideways scroll at 1440 or 390) → registry items `auth-sign-in`, `auth-sign-up`, `waitlist-form` exist; `/ui/blocks/auth-sign-in` shows `npx shadcn@latest add @saasaloy/auth-sign-in` and `npx saasaloy add auth app`, panels 254 and 254 px high; registry.test.ts "publishes each module block as <module>-<block> from its module's file" passes.
- ✅ C11 (`a852ae37`, not affected: the module blocks are unchanged) → in the C6 app, `shadcn add` of auth-sign-in (7 files: auth-card, brand-mark, four shell primitives, sign-in), auth-sign-up (1 new file, 6 identical skipped) and waitlist-form (input, label, waitlist) each exit 0. `app/stubs.tsx` renders `SignInCard`, `SignUpCard` and `Waitlist` with stub `onSubmit` props; `pnpm build` exit 0. The page shows "Sign in to Acme", "Create your Acme account" and "Get early access", no console error; a waitlist submit shows "You’re on the list — we’ll be in touch." Logs `.afkkit/logs/qa-next-add-*.log`, `qa-next-build.log`.
- ✅ C12 (`a852ae37`, not affected: the dusk kit is unchanged; its token tests pass again in `qa2-test.log`) → six files in `packages/cli/templates/kits/dusk/blocks/` (cta, faq, feature-grid, hero, pricing-table, testimonials); registry.json names the six `dusk-<block>` items; each "uses semantic tokens only" in `pnpm test` (log lines 4783 to 4788).
- ✅ C13 (agent part, `baef11ae`) → see **Browser checks**: launch, focus, glow; cards 844 px each; no sideways scroll at 1440 or 390 in either mode; Copy gives `npx saasaloy@latest init my-app --template=glow`; the builder edits print `npx saasaloy@latest init my-app --template=glow --theme=moss --blocks=navbar,hero,feature-grid,testimonials,faq,pricing-table,cta,how-it-works,footer`, the URL holds the state, a reload gives the same command, and the frame has `data-ui-theme=moss`.
- ✅ C14 (`a852ae37`, not affected: the template, kit and init code paths are unchanged) → `init .dev/qa-template --template=focus --theme=ember --blocks=navbar,hero,feature-grid,testimonials,faq,cta,footer` exit 0: saasaloy.json theme ember, template focus, the list; index.astro Navbar, Hero, FeatureGrid, Testimonials, Faq, Cta, Footer in that order; brand.css ember `--primary: oklch(0.64 0.19 40)`; `pnpm build` exit 0. The glow run below writes the dusk kit files. Logs `.afkkit/logs/qa-e2e-qa-template-*.log`, `qa-e2e-evidence.log`.
- ✅ C15 (agent part, `a852ae37`, not affected: the builder page and the project template are unchanged; the builder command reads the same at `baef11ae`) → the builder command ran as `init .dev/qa-builder` exit 0; saasaloy.json theme moss, template glow, kit dusk; index.astro order Navbar, Hero, FeatureGrid, Testimonials, Faq, PricingTable, Cta, HowItWorks, Footer, the builder order; the six dusk files are byte-equal to the kit, navbar, how-it-works and footer equal ink; brand.css `--primary: oklch(0.52 0.13 155)`; `pnpm build` exit 0 ("1 successful"). The built page's sections run hero, features, testimonials, faq, pricing, cta, how-it-works. The visual match is TC-2.1. Logs `.afkkit/logs/qa-e2e-qa-builder-*.log`, `qa-e2e-builder-evidence.log`, `qa-c15-browser.log`.
- ✅ C16 (`baef11ae`) → `pnpm lint` exit 0 (both oxlint passes, Stylelint, and `prettier --check .` "All matched files use Prettier code style!"); `pnpm typecheck` exit 0 (1 successful); `pnpm test` exit 0 (root passes 1702, 164 and 1095, Vitest 471, 0 fail); `pnpm docs:check` exit 0 ("60 generated pages are current"), so `docs/wiki/generated/cli.md` matches the new `--yes` help line. Logs `.afkkit/logs/qa2-{lint,typecheck,test,docs-check}.log`. At `a852ae37` `pnpm lint` exited 2 on an afkkit scratch tree; that tree is gone, and the lint passes in full.

### Browser checks
_Driven with playwright-core 1.66 (the playwright-cli install) against `http://localhost:3000` (dev server) at `baef11ae`. Dark mode sets the site's `theme` key before load. 38 screenshots: 33 from `baef11ae`, and the five `c15-*` and `next-app-*` ones from `a852ae37`. All are local to this run and not committed. Full logs `.afkkit/logs/qa2-browser-check.log` (132 ✅, 0 ❌) and `.afkkit/logs/qa2-fit-390.log` (8 ✅, 0 ❌)._

- ✅ every page (/ui, /ui/blocks/ink-hero, /ui/blocks/ink-pricing-table, /ui/blocks/auth-sign-in, /ui/themes, /ui/templates, /ui/builder) at each variant · console and page errors → none
- ✅ every page at each variant · external links have `target="_blank"` and `rel` with noopener → 1 or 2 external links each, 0 bad
- ✅ every page at each variant · page mode follows the `theme` key → light or dark as set
- ✅ every page at 1440 and 390, light and dark · no sideways scroll → 0 px, /ui/themes included
- ✅ /ui/themes, /ui/templates, /ui/blocks/auth-sign-in, /ui/blocks/ink-hero at 390, light and dark · every card and panel inside the screen → right edge 366 px or less
- ✅ /ui/themes at 390 · install commands → 4 of 4 in a scrolling field that ends at x = 270 px
- ✅ /ui/blocks/auth-sign-in at 390 · install commands → 3 of 3 in a scrolling field that ends at x = 249 px
- ✅ /ui · block cards → 24 (15 ink, 6 dusk, 3 module blocks)
- ✅ /ui · cards in one row share one height → heights 302 and 322, 0 rows with mixed heights
- ✅ /ui · chips → All, Ink, Dusk, Features, Calls to action, Errors, FAQ, Navigation, Heroes, Social proof, Pricing, Auth, Waitlist
- ✅ /ui · Dusk chip → 6 cards visible; Auth chip → auth-sign-in, auth-sign-up
- ✅ /ui · header links → Blocks, Themes, Templates, Builder, Get Saasaloy
- ✅ /ui/blocks/ink-hero · tabs → Preview, Code; Code shows the `export function Hero` source and hides the preview
- ✅ /ui/blocks/ink-hero · live preview → `<h1>` "Ship the SaaS, not the scaffolding."; install command `npx shadcn@latest add @saasaloy/ink-hero`; the base-* note names Saasaloy
- ✅ /ui/blocks/auth-sign-in · both commands → `npx shadcn@latest add @saasaloy/auth-sign-in` and `npx saasaloy add auth app`, panels 254 and 254 px
- ✅ block toolbar · dark press → frame dark, site light; mobile press → frame 390 px
- ✅ switcher light-1440, dark-1440, light-390 · cobalt → `data-ui-theme=cobalt`, one visible command `npx shadcn@latest add @saasaloy/theme-cobalt`
- ✅ /ui/themes · four cards → neutral, cobalt, ember, moss, with four theme commands
- ✅ /ui/templates · three cards → launch, focus, glow, 844 px each; Copy gives `npx saasaloy@latest init my-app --template=glow`
- ✅ /ui/templates · Open in builder → `/ui/builder?template=launch`, `focus`, `glow`
- ✅ /ui/builder · edits print `npx saasaloy@latest init my-app --template=glow --theme=moss --blocks=navbar,hero,feature-grid,testimonials,faq,pricing-table,cta,how-it-works,footer`; the URL holds the state; a reload gives the same command; the frame has `data-ui-theme=moss`
- ✅ Next.js app (C6, C11, at `a852ae37`) · `http://127.0.0.1:4420/` → 4 headings, 3 forms, no console error, waitlist success line after a submit

## Not covered / needs human judgment
- The visual match to the mockups (TC-1.1 to TC-1.4) and to the builder preview (TC-2.1) needs a human eye.
- Live `shadcn add` from `https://saasaloy.com/r/` is not covered: the URLs are not live until the site deploys. The local copy proves the item content only.
- A live `shadcn add` of a theme item (`theme-<name>.json`) did not run; registry.test.ts covers its cssVars keys.
- The site ran on the dev server; the production build of apps/web was not browsed in this run (the builders browsed it in G4b).
- Performance and Lighthouse scores are out of scope for this issue.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
