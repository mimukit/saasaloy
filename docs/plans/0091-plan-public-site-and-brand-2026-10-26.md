# Plan: Saasaloy public site, brand guidelines and design system

Grilled: 2026-10-26

> Tracked in [#287](https://github.com/mimukit/saasaloy/issues/287). Revised and re-grilled on 2026-10-26 after the round 10 mockup and the DESIGN.md rewrite.

## Context

Saasaloy has a published CLI (`saasaloy@0.7.0` on npm), 48 modules, a README and a reader-facing wiki under `docs/wiki/`. It has no public website, no logo, and no written brand rules. The repository's `homepage` field is empty. The only visual identity is the README banner the owner picked on 2026-10-26: `assets/branding/readme-banners/06-module-map.png`, an almost-black technical grid with off-white lowercase type, lime accents and outlined module squares. Its generation prompt is in `assets/branding/readme-banners/prompts-round-2.json`. The issue states that the banner choice does not approve a final logo or page design.

The audience is the technical founder the README speaks to: a developer who wants to test a SaaS idea without first building auth, billing and tenancy. The page explains what Saasaloy is, and it gets that visitor to run `npx saasaloy init my-app`, with the repository and the getting-started guide one click away.

The site lives at `apps/web`, a package in this repo's root pnpm workspace. It started as a copy of the base template's `apps/web` and the parts of `packages/ui` that page uses, so it begins from the landing page the product generates. It is a fork: `saasaloy update` never touches it, and the `.dev/playground` flow and the release smoke test keep testing `init`. A later docs site reads `docs/wiki/` from the same repo.

Goal: a visitor understands Saasaloy in one screen and leaves with the init command, the repo, or the guide.

Target: mobile Lighthouse score of 95 or more in performance, accessibility, best practices and SEO, and zero axe violations at 375, 768 and 1440 px in both themes (set by the owner on 2026-10-26; no baseline, because no site exists). Visits come from Cloudflare Web Analytics and are measured after release; they are not a build gate.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Issue scope | All seven phases stay in [#287](https://github.com/mimukit/saasaloy/issues/287). The owner set this in the grill on 2026-10-26. Phase 1 is complete. Phases 3 to 6 are the build, and the owner judges the logo mark in the PR review. Phase 7 runs after the merge. On 2026-10-26 the owner moved Phase 2 and every deploy step to the end: the build does the landing page first, without the Cloudflare secrets, the analytics variable, the `site.yml` deploy job or the `wrangler deploy --dry-run`. |
| Site home | `apps/web`, a package named `@saasaloy/web` in the root workspace (`packages: ["apps/*", "packages/*"]`). Root `pnpm install`, root turbo and root lint cover it, with one lockfile. One repo keeps the copy, the module list, the brand files and later the docs in one PR. The owner set this on 2026-10-26, after a scaffold into a nested `site/` project showed the cost of a second workspace root (see Rejected). |
| Source | A copy of `packages/cli/templates/base/apps/web` with the `@repo/ui` pieces it uses copied into `apps/web/src/`: every block, the `button` and `card` primitives, `lib/`, `content/` and `styles/`. `@repo/ui/*` imports become `@web/*`. The shell-only primitives, `containers/` and the CSS probe `lib/sentinel.ts` are not copied. Commit `327c456d` landed this. |
| No env or config packages | `@repo/env` and `@repo/config` are not copied. `src/site.ts` holds `siteName` and `locale`. The public origin is `site` in `astro.config.mjs`, and the layout builds the canonical URL from `Astro.site`. `PUBLIC_API_URL` is gone, because the site calls no API. |
| Template updates | None automatic. `apps/web` is a fork, and `saasaloy update` never reaches it. A base template fix that the site wants is copied by hand in its own PR. |
| Template boundary | No change to `packages/cli/templates/base` or to any module. A base template bug the site finds is filed as its own issue (see Outward actions) and fixed in `apps/web` only, with a comment naming the issue. |
| Stack | What the base ships: Astro 7 static output, Tailwind 4 and React islands. The round 10 page has sections the base blocks do not have, so Phase 5 adds four blocks in `apps/web/src/blocks/`: `stages`, `module-catalog`, `providers` and `site-source`. It restyles `navbar`, `hero`, `faq`, `footer`, `error-state` and `theme-toggle` through tokens. It deletes `audience`, `cta`, `feature-grid`, `how-it-works`, `logo-cloud`, `pain-points`, `pricing-table`, `showcase` and `testimonials`, with the content and primitives only they use. |
| Hosting and URL | Cloudflare Workers static assets through the base `wrangler.jsonc` (assets only, `404-page` handling). The worker `name` in `apps/web/wrangler.jsonc` is `saasaloy`, so the URL is `saasaloy.<account>.workers.dev`. No custom domain in this plan. |
| Site workflow | A new root workflow, `.github/workflows/site.yml`. Phase 3 adds two jobs. The pull request job runs install, lint, test and build for `@saasaloy/web`. The deploy job runs `pnpm --filter @saasaloy/web deploy:production` on a push to `main` that touches `apps/web/**`, `modules/**` or `docs/wiki/**`. Phase 5 adds the Lighthouse and axe gate to the pull request job. |
| Deploy credentials | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, exported to the deploy step. `wrangler deploy` reads both from the environment. Phase 2 provisions them, and Phase 3 runs `wrangler deploy --dry-run`. |
| Root lint | The root `pnpm lint` covers `apps/web`. `oxlint.config.mjs` gives `apps/web/**` the template's rule map, Node globals for its config files, browser globals for `src/`, and the vendored primitives' label exemption. Prettier and Stylelint need no change. |
| husky | No change. The root hooks cover `apps/web` like every other workspace file. |
| Install scripts | Root `pnpm-workspace.yaml` allows `workerd` and `sharp` to run their install scripts, the same pair the base template allows. |
| Tests | The catalog tier rule has unit tests in `apps/web/src/lib/module-catalog.test.ts`, run with `node --test` through an `apps/web` `test` script, which `turbo run test` picks up. The page itself is checked by Lighthouse, axe and qakit, not by unit tests. |
| Primary action | The hero shows `npx saasaloy init my-app` in a command field with a copy button. Getting started and GitHub sit under it as inline links. |
| Pages | One landing page and the 404 page. The base `privacy` and `terms` pages are removed, and `500` stays. |
| Theme | Light and dark, through the base `theme-toggle` and `THEME_INIT_SCRIPT` with no edit. A first-time visitor gets the OS setting, and the toggle choice persists. Dark is the brand's lead palette in the logo, the social card and the banner. |
| Palettes | The cobalt blueprint direction, selected on 2026-10-26. Light uses pale paper `#f6f7f9`, cobalt `#315fe8`, navy `#0b2253` and gray prose `#626b78`. Dark uses navy `#101722`, off-white `#eef2f8`, pale blue `#8fa8ff` and muted prose `#a9b5c7`. Solid buttons use cobalt with white labels in both themes. The first hero sentence uses navy in light and off-white in dark; the second uses the theme's blue accent. These choices replace the banner's lime direction for the site. The other roles (border, card, muted, secondary, ring) are mixes of these values, listed in `apps/web/DESIGN.md`. |
| Fonts | Geist for headlines, prose and controls, and Geist Mono for commands, module names, paths and diagram labels. The owner picked the pair on 2026-10-26. Self-hosted through `@fontsource` packages with `font-display: swap`. |
| Corners | Square. Every frame, button, field, tab, tag, table and accordion row has a zero radius. The stage marker circle is the one exception. The owner set this on 2026-10-26. |
| Copy | The README keeps its long pitch. The site uses the round 10 copy, listed in the Section content row. Every claim on the site must also appear in the README, and the proof-of-concept note stays visible. Where a page claim and the README differ, Phase 5 edits the page copy, never the README. |
| Section content | From the round 10 prompt in `.dev/mockup-287/round-10-full-page/prompts.json`. Hero: "A landing page today. Your next module tomorrow." and, since the SEO audit (`docs/seo/0001-seo-saasaloy-com-2026-10-27.md`, CONT-ANSWER), the lead "An open source SaaS starter kit for Cloudflare. Start small, and add each module as source files you own.", so the page names its category. Stages: "Add code when the product needs it." Catalog: "Choose the modules you need." Providers: "Cloudflare by default. Providers you can change." Site source: "This site starts with Saasaloy." FAQ: "Before you start." with the five questions from the prompt, after a sixth, "What is Saasaloy?", that the same audit added. Footer: "Start small. Own the source." |
| Stage names | Landing page (`init`), Waitlist (`add waitlist`), Sign-in (`add auth`), Teams (`add teams`), Payments (`add payment`). Each command names a module that exists in `modules/`. The page does not say `billing`. |
| Stages highlight | The highlight follows hover and focus. At rest it sits on Landing page, the first stage, which departs from the round 10 image on purpose. Each stage title is a link: Landing page to `docs/wiki/getting-started.md`, every other stage to its module's row in `docs/wiki/modules.md`, opened in a new tab through `externalLinkProps`. CSS alone moves the highlight: `:has()` on the section fills the hovered or focused row's marker, its row tint and its slab in the illustration. No script. Settled in the grill on 2026-10-26 (Q4, Q16, Q17, Q19). |
| Module catalog | Replaces the five-module map. A table of every module, read at build time from `../../modules/*/registry-item.json`. The tier comes from the registry: a module with `conflictsWith` is a driver, a module whose patches register into a `providers` array is a provider, and every other module takes its `type`. On the 2026-10-26 registry that gives 4 drivers and 17 providers, the same sets as the README's Modules table. A rename such as `billing` to `subscription` reaches the page with no copy edit. |
| Catalog display | Round 11, option C, approved by the owner on 2026-10-27 to close the empty area beside the table that round 10 left at 1440 px. The heading and the filter tabs share a row with the illustration, and the modules sit below as a full-width grid of tiles: four across from 64rem, two from 40rem, one below that. Each tile shows the module name, its type tag and the registry `description` in `body-small`, cut to three lines only in the four-across grid. The mockup's Purpose column is dropped. Filter tabs All, Capabilities, Features, Providers and Drivers are CSS-only radio inputs with `:has()`, and All is selected on load. A tab filters first, then the grid shows its first 8 tiles and a no-JS "Show all modules" checkbox opens the rest. The illustration is a fixed drawing of the seven mockup modules. Settled in the grill on 2026-10-26 (Q2, Q3, Q5, Q6); layout changed on 2026-10-27. |
| Illustrations | Hand-built inline SVG, one per section, drawn in isometric line art after the round 10 images. Strokes use `currentColor` and the `highlight` token, and one element per drawing fills with `primary`, so each drawing follows the theme. They are simpler than the raster mockup. Each SVG is decorative (`aria-hidden="true"`), because the copy carries every fact, and stays at or under 20 KB before compression. |
| Responsive layout | Sections stack below `64rem` and go two-column from `64rem`. A stacked section puts its illustration below the copy at full container width. |
| Section layout | Round 12, option A (zigzag), approved by the owner on 2026-10-28, because five of six sections put the drawing on the right and the page read as one repeated shape. From `64rem` the drawing alternates sides: right in the hero, left in stages, right in the catalog, left in providers, right in site source and left in the FAQ. Only stages and the FAQ change, and below `64rem` every section still stacks copy first. The images are in `.dev/mockup-287/round-12-section-layout/`, beside options B and C, which were not picked. |
| Motion | CSS only, and still under reduced motion. Interface motion: `blur-in`, `reveal`, `nav-float`, `press`, `appear`, `disclosure` and the theme toggle's view transition. Drawing motion (added 2026-10-28): `drawing`, `drawing-load`, `assemble`, `draw`, `flow`, `cycle-flow`, `cycle-shift`, `packet` and `blink`. Below the fold the drawings' entries and loops are tied to the scroll; in the hero they run on the clock and each stops within 5s, because the page has no pause control (WCAG 2.2.2). `gate:a11y` checks both rules. Phase 5 deletes `beam-in`, `marquee`, `shine-text` and the unused `hover-lift` from `web.css`. DESIGN.md's Motion section is the full reference. |
| Version display | The hero note reads "Version {version}. Proof of concept. Not for production use yet.", with the version read from `packages/cli/package.json` at build time (`apps/web/src/lib/cli-version.ts`). The SEO audit added it (CONT-DATE) so a reader can date the page. `apps/web/turbo.json` lists that file as a build input. |
| Links | Navbar: Docs to `docs/wiki/index.md`, GitHub to the repository, Guide to `docs/wiki/getting-started.md`. Footer: GitHub, Getting started, Changelog to `packages/cli/CHANGELOG.md`, and MIT license to `LICENSE.md`. Site source: `https://github.com/mimukit/saasaloy/tree/main/apps/web`. Every link to GitHub opens in a new tab. |
| Analytics | Cloudflare Web Analytics, with no cookies. The token is `PUBLIC_CF_ANALYTICS_TOKEN`, read at build time from `import.meta.env`. The beacon is left out when the token is unset. `site.yml` reads it from the repository variable that Phase 2 creates. A `workers.dev` host has no zone, so Cloudflare cannot inject the script automatically. |
| Logo scope | A lowercase wordmark, lowercase `saasaloy` in Geist in the `highlight` colour, and a square module mark for the favicon, the GitHub avatar and social cards. Phase 6 draws three mark options, uses the first in every asset, and shows all three in the QA plan. The owner picks in the PR review, and a different pick is a review fix. Each mark ships as light-on-dark and dark-on-light SVG. Until Phase 6 lands, the site keeps the base `favicon.svg`. |
| Brand guidelines home | `assets/branding/README.md` beside the logo and banner files: logo use, clear space, colours, type, image style, voice, and the social and repository asset sizes. |
| Design system home | `apps/web/DESIGN.md`, rewritten on 2026-10-26 from the round 10 mockup with the tokens above and checked by the designkit linter. Tokens live in `apps/web/src/styles/brand.css`. |
| Mockup approval | Round 10 is the approved full page: desktop and mobile, light and dark, in `.dev/mockup-287/round-10-full-page/`. It combines the round 9 hero with round 5 variation A for the other six sections. The owner confirmed the approval in the grill on 2026-10-26. |
| Mockup coverage | Waived on 2026-10-26 for the 768 px page, the copy button states, the FAQ open and closed states, the theme toggle states, the stage hover state and the 404 page. The build derives these from `apps/web/DESIGN.md` and the round 10 images. qakit captures each of them at 375, 768 and 1440 px in both themes, and the owner judges them in the PR review. The AGENTS.md rule still holds for any later visual change. |
| UI house rules | From `apps/web/DESIGN.md`, the base `packages/ui/AGENTS.md` and AGENTS.md: use semantic tokens, never raw hex; keep light and dark pairs together; no shadow, glow or gradient; no radius except the stage marker; Geist Mono for commands, module names, paths and environment values; cards in a row share one height; a value that waits on a request shows a skeleton; the error-state block is the one error screen; external links open in a new tab through `externalLinkProps`; the theme toggle has light and dark only; no copy that goes stale. |
| Gate tooling | `@lhci/cli` and `@axe-core/playwright`, exact-pinned devDependencies in `apps/web`, run in `site.yml` against the built `dist/client`. axe runs in both themes at all three widths. Lighthouse runs once on mobile, where headless Chromium reports a light OS. |
| Outward actions (approved 2026-10-26) | A merge to `main` deploys the site through the Phase 3 deploy job. After the deploy passes the Phase 7 checks, Phase 7 may run `gh repo edit --homepage <url>` and add the site link to the README. The build may file base template bugs as issues labelled `needs-planning` and link them from the PR. |

## Approach

Copy the base landing page into `apps/web` as a root workspace package, put the round 10 tokens and fonts into it, restyle the base blocks the page keeps, add four blocks for the sections the base lacks, draw the illustrations as inline SVG, and make the brand assets. It reuses the base template's static Astro build, its `wrangler.jsonc`, its theme script, its `error-state` block, its DESIGN.md format and `externalLinkProps`.

Rejected, for the record:

- A Saasaloy project scaffolded by `saasaloy init` into a nested `site/` folder (the first choice, tried and dropped on 2026-10-26). It needed a second workspace root and lockfile, root lint ignores, and its own lint run in CI. The root pre-commit hook rejected the scaffold's `packages/env` tests, and a local CLI build recorded an unpublished `cliVersion` in its lock. Its one gain, a standing test of `init` and `update`, the playground flow and the release smoke test already give.
- A separate `saasaloy-site` repo. Full dogfood, but the module list, the copy and later the docs from `docs/wiki/` would cross two repos, and a wiki change would have to start a deploy in the other repo.
- Generated raster illustrations. Closest to the mockup, but two images per section, colours that drift from the tokens, and weight against the Lighthouse target.
- A hand-kept provider and driver list, or a short label map for the catalog. The registry already holds the facts, and a list drifts on the next new module.
- A follow-up issue for the logo and the deploy. The owner keeps them in #287 and reviews the logo in the PR.

### Phase 1: approve the brand and page mockups

Attended: the owner approves the mockup screenshots and records the round. Complete on 2026-10-26.

- Make image mockups in `.dev/mockup-287/`. The owner requested image mockups rather than HTML on 2026-10-26.
- Iterate until the owner approves. Record the round, the font pair and the corner rule in Design decisions.

Done when: Design decisions carries the Mockup approval row with a date and round number, the Fonts and Corners rows are recorded, and the round 10 images are in `.dev/mockup-287/round-10-full-page/`.

### Phase 2: provision deploy access and analytics

Attended: the owner creates the Cloudflare API token, the Web Analytics site and the repository secrets and variable. This phase finishes before an unattended run starts.

- Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Repository variable: `PUBLIC_CF_ANALYTICS_TOKEN`, from a Web Analytics site for the `saasaloy.<account>.workers.dev` hostname.
- Record the account subdomain, so the plan names the final URL.

Done when: `gh secret list` shows both Cloudflare secrets, `gh variable list` shows the analytics token, and this plan names the final URL.

### Phase 3: finish `apps/web` in the root workspace

Commit `327c456d` did the copy, the import rewrite, `src/site.ts`, the worker name, the page removals, the workspace entry, the install scripts and the oxlint overrides.

- Add `.github/workflows/site.yml` with the pull request job and the deploy job from the Site workflow row.
- Add the `apps/web` `test` script from the Tests row.
- Run `pnpm --filter @saasaloy/web exec wrangler deploy --dry-run` with the Cloudflare credentials exported.

Done when: root `pnpm install` exits 0, root `pnpm lint` passes, `pnpm --filter @saasaloy/web build` writes `apps/web/dist/client/index.html`, `astro dev` serves the page at `http://localhost:3000`, the dry run names the worker `saasaloy`, and the `site.yml` pull request job is green.

### Phase 4: design system (built 2026-10-26)

- Replace the neutral tokens in `apps/web/src/styles/brand.css` with the values in `apps/web/DESIGN.md`, including the `highlight` pair and its `@theme inline` mapping, and set `--radius` to `0`.
- Self-host Geist and Geist Mono through `@fontsource` packages, exact-pinned, with `font-display: swap`, and map them to the sans and mono font tokens.
- Add the blueprint decoration to `web.css`: the page grid background and the section rule with its end crosshairs and tick marks.
- Restyle `navbar`, `footer`, `faq`, `error-state`, `theme-toggle`, `button` and `card` through tokens and props.
- Update the DESIGN.md stamp, and its Motion section to the Motion row, and run the designkit linter.

Done when: the designkit linter exits 0 on `apps/web/DESIGN.md` with no warnings, and every colour and font in the built CSS traces to a token in that file.

### Phase 5: build the landing page

- Build the seven sections in round 10 order: hero, stages, catalog, providers, site source, FAQ and footer, with the copy in the Section content row and the links in the Links row.
- Add the `stages`, `module-catalog`, `providers` and `site-source` blocks, by the Stages highlight, Module catalog and Catalog display rows. Write the tier tests.
- Draw the hero illustration and the four section illustrations as inline SVG, by the Illustrations row.
- Add the copy button to the command field, with the copied state in place.
- Read `PUBLIC_CF_ANALYTICS_TOKEN` from `import.meta.env`, and render the beacon only when it is set.
- Delete the blocks, content, primitives and `web.css` utilities the page no longer uses.
- Set page metadata and the canonical link.
- Check that every claim on the page appears in the README, and edit the page copy where it does not.
- Add the Lighthouse and axe gate to the `site.yml` pull request job.

Done when: the built page matches the round 10 images at 1440 and 375 px in both themes, except that the stages section rests on Landing page; the catalog has one tile per `modules/*/registry-item.json`, and its Providers and Drivers tabs show the 17 and 4 modules the README lists; the tier tests pass; the copy button, the stage highlight on hover and focus, the catalog tabs and "Show all modules", the GitHub link and the getting-started link work in the headless browser; and in the pull request job mobile Lighthouse scores 95 or more in all four categories and axe reports zero violations at 375, 768 and 1440 px in both themes.

### Phase 6: brand assets and guidelines

The owner judges the mark in the PR review, so this phase runs unattended.

- Draw three square module mark options as SVG, in the line style of the illustrations, and use the first in every asset below.
- Export the wordmark and the mark as SVG in light-on-dark and dark-on-light, plus the favicon set, a 512 px GitHub avatar, and a 1200×630 social card. Wire the favicon, the social card and the Open Graph tags into `apps/web`.
- Put all three mark options in the QA plan for the owner's pick.
- Write `assets/branding/README.md` with the rules for logo, colour, type, image style, voice, and asset sizes for the site, the repository and social media.

Done when: `assets/branding/` holds both SVG variants of the wordmark and the mark, the three mark options, the favicon set, the avatar and the social card; the built site serves the new favicon and names the social card in its Open Graph tags; the QA plan shows the three options; and `assets/branding/README.md` covers each item in the list above.

### Phase 7: deploy and verify

Runs after the PR merges, outside an unattended run.

- Let the `site.yml` deploy job publish the merge through `wrangler deploy`.
- Run Lighthouse and axe against the deployed URL.
- When both pass, run `gh repo edit --homepage <url>` and add the site link to the README.

Done when: `https://saasaloy.<account>.workers.dev` serves the page, an unknown path returns the 404 page with status 404, mobile Lighthouse scores 95 or more in all four categories, axe reports zero violations at 375, 768 and 1440 px in both themes, the Web Analytics dashboard records a visit, and the repository `homepage` field shows the URL.

## Open questions

None. Each decision settled in the grill on 2026-10-26.

## Non-goals

- Changes to the base template, its landing blocks or any module (the issue's boundary).
- A dark-first edit to the site's `THEME_INIT_SCRIPT`. The site follows the OS on the first visit.
- A docs site. Docs stay in `docs/wiki/` on GitHub for this plan. A later plan renders them in `apps/web` from the same files; the catalog's `docs-site` module is separate work.
- A `/modules` page, a `/brand` page, a blog, i18n or a waitlist form.
- Buying or attaching a custom domain.
- New README banners, or a light variant of the banner.
- Automated update PRs for the site.
- Generated raster illustrations on the page.
