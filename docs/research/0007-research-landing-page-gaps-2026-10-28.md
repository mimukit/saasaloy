# Research: landing page gaps, with a focus on module value

- **Date:** 2026-10-28
- **Scope:** `apps/web` as it is in the working tree on 2026-10-28, including the uncommitted hero and wireframe changes. Sources: `apps/web/src/content/landing.ts`, `apps/web/src/pages/index.astro`, `apps/web/src/blocks/*`, `modules/*/registry-item.json`, `README.md`, `docs/seo/0001-seo-saasaloy-com-2026-10-27.md`, `docs/plans/0091-plan-public-site-and-brand-2026-10-26.md`.
- **Question:** Where does the page fail to tell a founder why Saasaloy is the right start for a new SaaS, and which modules should the page show to fix that?

## Summary

The page explains the method well: start small, add modules, own the source, swap providers. It does not show the result. A visitor leaves with no picture of what a finished Saasaloy project contains, and the strongest modules are hidden.

Five gaps carry most of the cost:

1. The page shows no product. The registry ships an admin SPA with seven screens, a user app, a Cmd+K palette and a data table, and the page shows only line drawings.
2. The module catalog treats 47 modules as equals. It sorts by an internal tier and then by name, so `teams` and `waitlist` sit behind "Show all modules" in the Features tab.
3. The stages stop at "Payments". The modules that make a B2B SaaS (admin, multitenant, API keys, feature flags, subscriptions) appear in no stage.
4. Three differentiators from the README are absent from the page: the agent skills (28 modules ship one), `saasaloy update` with a merge plan, and the near-zero hosting cost on the Cloudflare free tier.
5. The page has no "why", the problem statement. The README's best argument, "boilerplates make you delete code for a week", is not on the page.

My recommendation is one new section, "What you can ship", plus a curated catalog. Details follow.

## The page today

| # | Section | What it says | What it leaves out |
|---|---------|--------------|--------------------|
| 1 | Hero | "A landing page today. Your next module tomorrow." Open source starter kit for Cloudflare. `npx saasaloy init my-app`. | What "the next module" can be. The wireframe callouts name only Application, Sign-in, Source files, Database and Email. |
| 2 | Stages | Five stages: landing, waitlist, auth, teams, payment. | Everything after the first payment: admin, tenancy, API keys, flags, jobs, subscriptions. |
| 3 | Catalog | "Choose the modules you need." 47 tiles, four tier tabs, eight tiles per tab before "Show all". | A ranking, a command per tile, links, dependencies, grouping by job. |
| 4 | Providers | One interface, `*_PROVIDER` env var, local `-console` / `-memory` providers. | The cost argument and the Postgres driver (only in the FAQ). |
| 5 | Site source | This site started with `saasaloy init`. | Nothing missing. It is good proof, but it proves only the smallest stage. |
| 6 | FAQ | What, ownership, Cloudflare account, providers, updates, production status. | Cost, agents, stack, "how is it different from a boilerplate", "what do I add first". |

## Gaps

### G1. The page shows no product (high)

A starter kit sells the screens a founder does not have to build. Saasaloy ships these, and the page shows none of them:

- The admin SPA (`admin`) with route files for users, teams, roles, flags, API keys, payments, files and billing (`modules/*/files/admin/routes/*.tsx`).
- The user app (`app`) with sign-in, sign-up and a home screen on the `shell` frame.
- The Cmd/Ctrl+K palette, `G`-then-letter navigation and the `?` shortcut sheet (`command`).
- The data table, status pill and detail panel primitives in `shell`.

All seven illustrations are abstract line art (`apps/web/src/illustrations/`). Plan 0091 lists "generated raster illustrations" as a non-goal, but a real screenshot of a generated project is not a generated illustration. It is evidence.

**Fix.** Add a "What you can ship" section after the stages. Show three to four real screenshots of a generated project: the admin users table, the teams screen, the feature flags screen and the Cmd+K palette. Put the `saasaloy add` command that produced each screen under it. This needs a mockup round under the AGENTS.md UI rule.

### G2. The catalog buries the valuable modules (high)

`catalogRows` in `apps/web/src/lib/module-catalog.ts` sorts by tier, then by name. With `CATALOG_VISIBLE_ROWS = 8`, a visitor sees this before "Show all":

| Tab | Visible tiles | Hidden tiles |
|-----|---------------|--------------|
| All | admin, api, app, auth, billing, database, e2e, email | 39 others, every feature, provider and driver |
| Features | api-keys, command, email-react, env-infisical, feature-flags, file-uploads, multitenant, ratelimit | teams, waitlist |
| Drivers | api-keys-organization, api-keys-user, database-d1, database-postgres | none |
| Providers | 8 of 17 | 9 |

So the default view shows `e2e` and hides `teams` and `waitlist`, the two modules the stages section just promoted. The tier rule also files `api-keys-organization` and `api-keys-user` under Drivers, because each carries `conflictsWith`. That is correct for ADR 0055, but a visitor who looks for API keys does not look under Drivers.

Other problems in the same block:

- The tier words (capability, feature, provider, driver) are repo vocabulary from ADR 0026 and ADR 0033. A founder thinks in jobs: "sign people in", "get paid", "run a team account".
- The descriptions are registry text for contributors. Examples: "copy-ID invitations", "the coss primitive set under @repo/ui/*/shell", "on the Better Auth api-key plugin, stored as a hash; pick api-keys-organization or api-keys-user as the owner".
- A tile has no `saasaloy add <name>` command, no docs link and no "needs" line. The descriptors already carry `dependsOn`.
- Seventeen provider tiles and four driver tiles take 45% of the grid. They repeat the providers section below.

**Fix.** Keep the registry as the data source, and add a small curated layer in `landing.ts`:

- Group the visible tiles by job, not by tier. Proposed groups: Start (landing, waitlist), Users (auth, app, admin), Teams and tenancy (teams, multitenant, api-keys), Money (payment, billing), Run the product (queue, storage, file-uploads, feature-flags, ratelimit, email, sms), Quality (e2e, validators, logger).
- Write one founder-facing line per featured module. Keep the registry text as the detail.
- Show the command on each tile, plus the modules it pulls in ("adds api, database").
- Fold providers into their capability tile as chips (`email`: cloudflare, plunk, console). Remove the Providers and Drivers tabs from the catalog.
- Keep "Show all modules" for the full registry list.

The shape rules in `landing.ts` still allow this: an array of featured ids with stable `id`s and no positional keys.

### G3. The stages stop at the first payment (high)

`landing.stages.items` ends at "Add payments when someone wants to pay." The README's own story continues: teams and tenancy, then billing. A B2B founder evaluates a kit on the parts after sign-in, and these modules are on no stage:

- `admin`: a staff console on day one.
- `multitenant`: `forTenant(db, tenantId)` makes an unfiltered tenant query a compile error. No other starter kit I know of makes that claim, and the page never makes it.
- `api-keys-organization` / `api-keys-user`: hashed, scoped keys for a public API.
- `feature-flags`: per-tenant overrides, percentage rollouts and kill switches.
- `billing`: subscriptions and plan entitlements with a 402 gate.

There is also a mismatch. The stage says "Payments" and links to `payment`, which takes one-off payments. A SaaS reader expects subscriptions at that stage. The comment in `landing.ts` says "The page never says `billing`", and the memory note records that `billing` becomes `subscription` (owner decision, 2026-10-20). Once that rename lands, add a "Subscriptions" stage.

**Fix.** Extend the stages to seven or eight: landing, waitlist, sign-in, admin, teams and tenancy, payments, subscriptions, scale (flags, API keys, rate limits). Or keep five stages and let the G1 section carry the rest. I prefer the first option, because the stage list is the page's strongest idea and it should reach a real product.

### G4. Three differentiators are missing (high)

The README lists these under "How it works". The page carries none of them, or carries one only in the FAQ.

1. **Agent skills.** 28 modules ship a `skills/saasaloy-<name>/` folder, and the base adds seven more (`saasaloy-config`, `saasaloy-deploy`, `saasaloy-design`, `saasaloy-env`, `saasaloy-landing-copy`, `saasaloy-setup`, `saasaloy-testing`). Every project also gets `AGENTS.md`, `CLAUDE.md` and `DESIGN.md`. In 2026 most founders build with a coding agent. "Each module teaches your agent how to extend it" is a reason to pick Saasaloy over a plain boilerplate. The word "agent" does not appear on the page.
2. **Update and remove.** A copied-source kit usually cannot take upstream fixes. `saasaloy update` re-applies modules with a merge plan, and `saasaloy remove` undoes a module from its manifest. This answers the first objection to "you own the code". It appears only as FAQ item `updates`.
3. **Cost.** The README says Workers, D1, KV and R2 keep most modules on the free tier, "a hosting bill close to zero". The providers section talks about vendor choice and never about money.

**Fix.** Add a three-point "Why Saasaloy" band after the hero, or add the three points to the providers section. Suggested lines: "Your coding agent knows every module.", "Take upstream fixes with `saasaloy update`.", "Validate the idea on the free tier."

### G5. No problem statement (medium)

The page starts with the solution. The README's "Why Saasaloy exists" names the pain exactly: a weekend lost to OAuth callbacks, a folder of dead projects, a boilerplate with forty features and twelve env vars. The one-line positioning "Think shadcn/ui for a full-stack SaaS" is also README-only. That line tells a developer the model in six words.

**Fix.** Put the shadcn line in the hero description or under it. Add a short contrast block before the stages: "A boilerplate gives you forty features on day one. Saasaloy gives you one, and adds the next when the product needs it." This also covers the SEO report's "honest comparison" item without a separate page.

### G6. The stack is not named (medium)

The page never names Astro, Hono, Drizzle, Better Auth, TanStack Router, Zod, React Email, Playwright, D1 or Postgres. A developer filters a starter kit by stack before anything else. The names are also search terms that the SEO report says the page lacks.

**Fix.** Add a one-row "Built on" strip, text or small logos, under the hero or in the catalog lead. Use the catalog's empty `description` slot if you want no new block.

### G7. Regional payments are hidden (medium)

`payment-manual` takes bKash, Nagad, Rocket and bank transfers that staff confirm by hand. `sms-khudebarta` sends to Bangladeshi numbers. No mainstream starter kit covers this market, and the footer already says "Developed with love from Bangladesh". Today both modules are tiles 9 to 17 in the Providers tab, hidden by default.

**Fix.** Give it one line in the payments stage or in the providers section: "Take bKash and Nagad payments with staff review, or Stripe." Keep it as a supporting point, not a headline, so the page stays global.

### G8. The FAQ leaves common questions open (medium)

Add these questions:

- "What does it cost to host?" Answer with the free-tier claim, and say which modules need a paid Workers plan (`email-cloudflare`, `queue-cloudflare`).
- "How is it different from a boilerplate?" The copy model, the stages, and update with a merge plan.
- "Does it work with Claude Code, Codex or Cursor?" The skills and `AGENTS.md`.
- "Which modules should I add first?" Point at the stages.
- "What stack does it use?" The G6 list.

### G9. Smaller items (low)

- The navbar has only external links. Add in-page anchors to `#stages`, `#catalog` and the FAQ, so a visitor can jump to the modules.
- The page shows no numbers. "47 modules, 8 capabilities with swappable providers, MIT" is a fact a visitor remembers. Compute the counts from the registry at build time, as the catalog does.
- No "one command" demo. A short terminal block for `saasaloy add auth` that lists the modules it resolves (`api`, `database`, a driver) and the files it writes would show dependency resolution, which no section shows now.
- The site-source section proves only the `init` stage. If the G1 screenshots come from a real generated project, link that project's source as well.

## Proposed page order

| # | Section | Status |
|---|---------|--------|
| 1 | Hero, with the shadcn line and a "Built on" strip | Edit |
| 2 | Why Saasaloy: agent skills, update, free tier | New |
| 3 | Stages, extended to the full product | Edit |
| 4 | What you can ship: real screenshots with their commands | New |
| 5 | Modules, grouped by job, providers folded in as chips | Edit |
| 6 | Providers | Keep |
| 7 | Site source | Keep |
| 8 | FAQ, five more items | Edit |

## Modules to feature, ranked

The rank is by how much each module tells a founder "this kit saves me weeks".

1. `auth` + `app`: sign-in, sessions and a user app on day one.
2. `admin`: a staff console that every later module adds a screen to.
3. `teams` + `multitenant`: organizations, roles and the compile-time tenant guard.
4. `payment` + `billing`: one-off payments and subscriptions behind one contract, local providers included.
5. `feature-flags`: rollouts and kill switches with an admin screen.
6. `api-keys`: a public API with scoped, hashed keys.
7. `queue` + `storage` + `file-uploads`: background jobs, cron and file uploads.
8. `command`: Cmd+K and keyboard navigation, visible proof of product polish.
9. `waitlist`: the cheapest first step, already in the stages.
10. `e2e`: Playwright flows that sign in as the seeded admin, the quality signal for a technical buyer.

## Order of work

1. Copy-only edits in `landing.ts`: the shadcn line, the "Why" points in an existing section, the FAQ items, the regional payments line. These need no mockup.
2. The catalog curation (G2). It changes UI, so it needs a mockup round first.
3. The "What you can ship" section (G1) and the extended stages (G3), in one mockup round, because both change the page's height and rhythm.
4. Wait for the `billing` to `subscription` rename before you add the Subscriptions stage, so the page does not ship a name that changes a week later.

## Open questions

- Do you accept real screenshots on the page? Plan 0091 forbids generated raster illustrations only, but the brand so far is line art.
- Should the regional payments line stay on the main page, or go to a later per-module page (SEO report "Build next")?
- Do you want the counts (47 modules) on the page while the project is a proof of concept? A number invites a check of each module's maturity.
