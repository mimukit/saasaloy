# Plan: Saasaloy public site, brand guidelines and design system

Grilled: 2026-10-26

> Tracked in [#287](https://github.com/mimukit/saasaloy/issues/287).

## Context

Saasaloy has a published CLI (`saasaloy@0.7.0` on npm), 48 modules, a README and a reader-facing wiki under `docs/wiki/`. It has no public website, no logo, and no written brand rules. The repository's `homepage` field is empty. The only visual identity is the README banner the owner picked on 2026-10-26: `assets/branding/readme-banners/06-module-map.png`, an almost-black technical grid with off-white lowercase type, lime accents and outlined module squares. Its generation prompt is in `assets/branding/readme-banners/prompts-round-2.json`. The issue states that the banner choice does not approve a final logo or page design.

The audience is the technical founder the README speaks to: a developer who wants to test a SaaS idea without first building auth, billing and tenancy. The page explains what Saasaloy is, and it gets that visitor to run `npx saasaloy init my-app`, with the repository and the getting-started guide one click away.

The site is itself a Saasaloy project. It is scaffolded with the published CLI into `site/` of this repo, so the landing page the product advertises is the landing page the product generates. That makes the site a standing dogfood test of `init` and `update`.

Goal: a visitor understands Saasaloy in one screen and leaves with the init command, the repo, or the guide.

Target: mobile Lighthouse score of 95 or more in performance, accessibility, best practices and SEO, and zero axe violations at 375, 768 and 1440 px in both themes (set by the owner on 2026-10-26; no baseline, because no site exists). Visits come from Cloudflare Web Analytics and are measured after release; they are not a build gate.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Site home | A Saasaloy project at `site/` in this repo, created by `saasaloy init`. It keeps its own `pnpm-workspace.yaml` root, like `.dev/playground`. The root workspace (`packages: ["packages/*"]`) and root turbo do not include it. One repo keeps the copy, the module list and the brand files in one PR. |
| Scaffold CLI | The published CLI: `npx saasaloy@0.7.0 init site --testing=off`, run from the repo root. `init` skips `git init` by itself because `site/` sits inside a tracked working tree (`packages/cli/src/commands/init.ts:229`). Template updates reach the site through `saasaloy update`, never by hand-copying from `packages/cli/templates/base`. |
| Update cadence | A step in the CONTRIBUTING "Releasing" checklist: after each npm publish, run `npx saasaloy@<new> update` in `site/` and open a PR titled `chore(site): update to saasaloy <version>`. |
| Template boundary | No change to `packages/cli/templates/base` or to any module. A base template bug the site finds is filed as its own issue (see Outward actions) and worked around in `site/` only, with a comment naming the issue. |
| Stack | What the base ships: Astro 7 static output, Tailwind 4, React islands, `@repo/ui` blocks (`hero`, `navbar`, `feature-grid`, `faq`, `cta`, `footer`, `theme-toggle`). The site restyles these blocks; it adds a new block only where no base block fits (the module map). |
| Hosting and URL | Cloudflare Workers static assets through the base `wrangler.jsonc` (assets only, `404-page` handling). The worker `name` in `site/apps/web/wrangler.jsonc` changes from `site-web` to `saasaloy`, so the URL is `saasaloy.<account>.workers.dev`. No custom domain in this plan. |
| Deploy job | A new root workflow, `.github/workflows/site.yml`, runs `pnpm -C site deploy:production` on a push to `main` that touches `site/**` or `modules/**`. Issue #199's `infra-ci-deploy` does not apply: it writes `site/.github/workflows/`, which GitHub ignores. The same workflow runs install, lint, build and the gate on pull requests. |
| Deploy credentials | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, exported to `deploy:production`. `ENV_SOURCE` stays unset, because exported variables override the value source. Phase 3 runs a `--dry-run` deploy first. |
| Root lint | `site/` joins the root oxlint, Prettier, Stylelint and lint-staged ignores. CI runs `pnpm -C site lint`, which checks the site with the template's own rules. |
| husky | No change. In `site/`, husky prints ".git can't be found" and exits 0, and the root hooks cover commits. Phase 3 confirms `pnpm install` in `site/` exits 0. |
| Primary action | The hero shows `npx saasaloy init my-app` with a copy button. GitHub and the getting-started guide sit beside it as secondary links. |
| Pages | One landing page and the 404 page. The base `privacy` and `terms` pages are removed, and `500` stays. |
| Theme | Light and dark, through the base `theme-toggle` and `THEME_INIT_SCRIPT` with no edit. A first-time visitor gets the OS setting, and the toggle choice persists. Dark is the brand's lead palette in the logo, the social card and the banner. |
| Palettes | Dark comes from the banner: near-black, off-white, lime. Light gets its own accent that meets 4.5:1 on its background, because banner lime fails that ratio on white. Phase 1 shows both. |
| Fonts | Phase 1 compares two open-licence pairings: Geist with Geist Mono, and Inter Display with JetBrains Mono. Self-hosted through `@fontsource` packages with `font-display: swap`, at most two families. The owner picks from screenshots. |
| Copy | The README keeps its long pitch. The site uses a short version and links to the README "Why Saasaloy exists" section. Every claim on the site must also appear in the README, and the early-stage warning stays visible. |
| Module map | A hand-placed diagram of `api`, `database`, `auth`, `email` and `payment` in the banner's style, then a list of every module grouped by type, with `description` and `dependsOn`. The list is read at build time from `../modules/*/registry-item.json`, so a rename such as `billing` to `subscription` reaches the page with no copy edit. |
| Version display | None. The page shows no CLI version. |
| Doc links | Getting started: `https://github.com/mimukit/saasaloy/blob/main/docs/wiki/getting-started.md`. Repository: `https://github.com/mimukit/saasaloy`. |
| Analytics | Cloudflare Web Analytics, with no cookies. The token is `PUBLIC_CF_ANALYTICS_TOKEN`, declared through the site's `packages/env`. The beacon is left out when the token is unset. `site.yml` reads it from a repository variable. A `workers.dev` host has no zone, so Cloudflare cannot inject the script automatically. |
| Logo scope | A lowercase wordmark taken from the banner, and a square module mark for the favicon, the GitHub avatar and social cards. Mockup round 1 shows three mark options. Each ships as light-on-dark and dark-on-light SVG. |
| Brand guidelines home | `assets/branding/README.md` beside the logo and banner files: logo use, clear space, colours, type, image style, voice, and the social and repository asset sizes. |
| Design system home | `site/DESIGN.md`, the project's own spec-compliant DESIGN.md that the base already ships, rewritten with the brand tokens and checked by the designkit linter. Tokens live in `site/packages/ui/src/styles/globals.css`. |
| Visual reference | `assets/branding/readme-banners/06-module-map.png`. Mockup approval: pending (Phase 1). |
| UI house rules | Phase 1 reads the base `DESIGN.md` and the base `ui` AGENTS.md and lists the rules here before the mockup. Rules already stated for this repo: cards in a row share one height; the mockup covers the navbar over the hero and every toggle state (from the #191 lesson in AGENTS.md); external links open in a new tab. |
| Mockup coverage | The full page in both themes at 375, 768 and 1440 px. Component states (copy button before and after a click, FAQ open and closed) in dark at all three widths and in light at 1440 px. The theme toggle in both states. The 404 page in both themes. |
| Gate tooling | `@lhci/cli` and `@axe-core/playwright`, exact-pinned devDependencies in the `site/` root, run in `site.yml` against the built `dist/client`. axe runs in both themes at all three widths. Lighthouse runs once on mobile, where headless Chromium reports a light OS. |
| Outward actions (approved 2026-10-26) | A merge to `main` deploys the site (Phase 2 records the consent). After the deploy passes the Phase 7 checks, the build may run `gh repo edit --homepage <url>` and add the site link to the README in the same PR. The build may file base template bugs as issues labelled `needs-planning` and link them from the PR. |

## Approach

Scaffold a real Saasaloy project into `site/`, restyle its base landing page with a brand derived from the README banner, add one module map block that reads the registry, and deploy the static output to Cloudflare. It reuses the base template's static Astro build, its `wrangler.jsonc`, its `@repo/ui` blocks, theme script and tokens, its DESIGN.md format, its `packages/env` gate, its `deploy:production` script, and the `.dev/mockup-*` screenshot flow from issue #217.

Rejected, for the record:

- A plain Astro workspace in the root `pnpm-workspace.yaml`. Less upkeep, but no dogfood claim, and the site would not exercise `init` or `update`.
- A separate `saasaloy-site` repo. Full dogfood, but the module list and copy drift from this repo, and the brand files split across two repos.

### Phase 1: approve the brand and page mockups

Attended: the owner approves the mockup screenshots and records the round.

- List the UI house rules from the base `DESIGN.md` and `ui` AGENTS.md in Design decisions.
- Build static HTML mockups in `.dev/mockup-287/` and screenshot them with the headless browser.
- Brand sheet: three module mark options, the wordmark at three sizes in both pairings, the dark and light palettes with contrast ratios, and one social card.
- Landing page and 404 page, with the coverage in the Mockup coverage row.
- Iterate until the owner approves. Record the date, the round, the chosen mark, the chosen font pairing and the light accent in Design decisions.

Done when: Design decisions carries a mockup approval row with a date and round number, the font and mark picks are recorded, and the screenshots for that round are in `.dev/mockup-287/shots/`.

### Phase 2: provision deploy access and analytics

Attended: the owner creates the Cloudflare API token, the Web Analytics site and the repository secrets and variable, and agrees that a merge to `main` publishes the site.

- Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Repository variable: `PUBLIC_CF_ANALYTICS_TOKEN`, from a Web Analytics site for the `saasaloy.<account>.workers.dev` hostname.
- Record the account subdomain, so the plan names the final URL.

Done when: `gh secret list` shows both Cloudflare secrets, `gh variable list` shows the analytics token, and this plan names the final URL.

### Phase 3: scaffold `site/` and fit it into the repo

- Run `npx saasaloy@0.7.0 init site --testing=off` from the repo root and commit the result unchanged as its own commit, so later diffs show only the site's own edits.
- Rename the worker to `saasaloy` in `site/apps/web/wrangler.jsonc`.
- Remove `privacy.astro` and `terms.astro`.
- Add `site/` to the root oxlint, Prettier, Stylelint and lint-staged ignores.
- Add `.github/workflows/site.yml`: on pull requests, install, lint and build inside `site/`; on push to `main` with `site/**` or `modules/**` changes, also deploy.
- Add the update step to the CONTRIBUTING "Releasing" checklist.
- Confirm `pnpm install` in `site/` exits 0, and run `pnpm -C site deploy:production -- --dry-run` with the Cloudflare credentials exported.

Done when: `pnpm lint` at the root passes, `pnpm -C site lint` passes, `pnpm -C site build` writes `site/apps/web/dist/client/index.html`, the dry run names the worker `saasaloy`, and the `site.yml` pull request job is green.

### Phase 4: brand assets and guidelines

- Export the approved wordmark and mark as SVG in light-on-dark and dark-on-light, plus the favicon set, a 512 px GitHub avatar, and a 1200×630 social card.
- Write `assets/branding/README.md` with the approved rules for logo, colour, type, image style, voice, and asset sizes for the site, the repository and social media.
- Keep the banner prompts as the image style reference, and note which banner is current.

Done when: `assets/branding/` holds both SVG variants of the wordmark and the mark, the favicon set, the avatar and the social card, and `assets/branding/README.md` covers each item in the list above.

### Phase 5: design system

- Replace the neutral tokens in `site/packages/ui/src/styles/globals.css` with the approved light and dark palettes, type and radius, and self-host the approved fonts.
- Rewrite `site/DESIGN.md` with those tokens and the component rules, and validate it with the designkit linter.
- Restyle the base blocks the page uses through tokens and props, not forks, where the block allows it.

Done when: the designkit linter passes on `site/DESIGN.md`, and every colour and font in the built CSS traces to a token in that file.

### Phase 6: build the landing page

- Sections: hero with the init command and copy button, how it works (the stages from the README: landing page, waitlist, auth, teams, billing), the module map, the provider story (Cloudflare by default, local console and memory providers), a dogfood note ("this site is a Saasaloy project"), FAQ, footer.
- Write the module map block: the five-module diagram, then the grouped list read from `../modules/*/registry-item.json` at build time.
- Declare `PUBLIC_CF_ANALYTICS_TOKEN` in the site's env descriptors and preset, and render the beacon only when it is set.
- Set the Astro `site` URL, page metadata, the social card, the favicon and the canonical link.
- Write the copy from the README. Check that every claim on the page appears in the README.
- Add the Lighthouse and axe gate to `site.yml`.

Done when: the built page matches the approved Phase 1 screenshots at 375, 768 and 1440 px in both themes, the module list has one entry per directory under `modules/`, the copy button, GitHub link and getting-started link work in the headless browser, and the gate passes in the pull request job.

### Phase 7: deploy and verify

- Merge, and let `site.yml` deploy through `deploy:production`.
- Run Lighthouse and axe against the deployed URL.
- When both pass, run `gh repo edit --homepage <url>` and add the site link to the README in a follow-up PR.

Done when: `https://saasaloy.<account>.workers.dev` serves the page, an unknown path returns the 404 page with status 404, mobile Lighthouse scores 95 or more in all four categories, axe reports zero violations at 375, 768 and 1440 px in both themes, the Web Analytics dashboard records a visit, and the repository `homepage` field shows the URL.

## Open questions

None. Each decision settled in the grill on 2026-10-26.

## Non-goals

- Changes to the base template, its landing blocks or any module (the issue's boundary).
- A dark-first edit to the site's `THEME_INIT_SCRIPT`. The site follows the OS on the first visit.
- A docs site. Docs stay in `docs/wiki/` on GitHub; the catalog's `docs-site` module is separate work.
- A `/modules` page, a `/brand` page, a blog, i18n or a waitlist form.
- Buying or attaching a custom domain.
- New README banners, or a light variant of the banner.
- Automated update PRs for the site.
