# Plan: Source-tree hero and three new illustrated sections

Grilled: 2026-10-29

## Context

The hero drawing on saasaloy.com is an application wireframe with a sign-in scene (`apps/web/src/illustrations/app-wireframe.tsx`). It shows a generic web app, not what Saasaloy does. The site is for developers, and the product's claim is "add each module as source files you own". A drawing of a source tree that gains a folder per `saasaloy add` shows that claim directly.

Research report `docs/research/0007-research-landing-page-gaps-2026-10-28.md` found that the page has no problem statement (G5), shows nothing past the first payment (G1, G3), and never names its stack (G6). Two exploration rounds drew nine illustration variants (`.dev/hero-mockups/round-1/`, `.dev/hero-mockups/round-2/`). The owner kept four of them: F for the hero, and E, H and I for three new sections that answer G5, G1/G3 and G6. The existing sections and their drawings stay as they are.

Success: a developer who reads the page sees the copy model in the hero, the reason it beats a boilerplate, what a full project can contain, and which stack it runs on, without opening the README.

- Target: the click-through rate on "Getting started" in the cookieless analytics, compared over the 30 days before and the 30 days after release, with no fixed number (owner pick, Q10). Measured after release.
- The build checks the gates that already hold for the site: mobile Lighthouse 95 or more in all four categories, zero axe violations at 375, 768 and 1440 px in both themes, and each new SVG at or under 20 KB before compression.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Hero drawing | Variant F, source tree, approved by the owner on 2026-10-29 from round 3 (`.dev/hero-mockups/round-3-placement/after-hero.png`, light theme, 1440 px). It replaces `AppWireframe`. The source is `.dev/hero-mockups/round-2/index.html`, section F. |
| Hero drawing content | An explorer panel, an editor panel and a terminal panel. The base folders (`apps/web/`, `apps/api/`, `packages/ui/`, `packages/env/`, `packages/config/`) show with no marker, because the base ships them. `auth/`, `database/`, `email/` and `payment/` appear one at a time under `packages/` with a "+" and a "U" marker. For each one, the terminal prints `$ saasaloy add <name>` and `+ packages/<name>/`, and the editor tab changes to `packages/<name>/src/index.ts`. The round 3 and round 4 images mark `config/` as added, which is wrong. |
| Existing sections | Stages, catalog, providers, site source and FAQ keep their copy, layout and drawings. The owner rejected the round 3 proposal to put E, H and I in those sections on 2026-10-29. |
| New sections | Three new blocks, owner pick on 2026-10-29. `problem` takes I (module city) and answers G5. `built-on` takes H (orbits) and answers G6. `ship` takes E (module map) and answers G1 and G3. |
| Mockup approval | Round 4, approved by the owner on 2026-10-29: `.dev/hero-mockups/round-4/section-problem.png`, `section-built-on.png`, `section-ship.png` and `full-page.png`, light theme, 1440 px. The drawings in those images are raster stand-ins; the build draws them as SVG. |
| Mockup coverage | Waived on 2026-10-29 (Q7) for the dark theme and the 375 and 768 px layouts of the hero and the three new sections. The build derives them from `apps/web/DESIGN.md` and the round 4 images. qakit captures each of them at 375, 768 and 1440 px in both themes, and the owner judges them in the PR review. A drawing label that renders under 10 px on screen at any width is a defect (Q11). |
| Page order | Hero, problem, built-on, stages, ship, catalog, providers, site source, FAQ, as in round 4. This order keeps every existing section on its round 12 side: the hero right, problem left, built-on right, stages left, ship full width, catalog right, providers left, site source right, FAQ left. |
| Problem block (I) | Drawing left, copy right. No eyebrow, as in every other section (Q2). Title: "Boilerplates make you delete code for a week." Body, from README line 23: "You clone one and inherit forty features, twelve environment variables and someone else's opinions about billing." A contrast line in a block with a `highlight` left border: "A boilerplate gives you forty features on day one. Saasaloy gives you one, and adds the next when the product needs it." The city starts as one landing block with a primary roof. The `auth/`, `database/`, `teams/` and `payment/` buildings rise one at a time, and a crane stands over an empty "next" lot. The crane has no fill. |
| Built-on section (H) | Copy left, drawing right. Title: "Built on Cloudflare and tools you know." Body: "Every project runs on Workers, with D1, KV, R2 and Queues for data and background work." `my-app` sits at the centre of the drawing. The inner ring holds the Cloudflare runtime: Workers, D1, KV, R2, Queues. The outer ring holds the libraries from the README stack table: Astro, TanStack Router, Hono, Drizzle, Better Auth, Postgres, Turborepo, pnpm. The copy repeats every name as a text chip in two groups, "Runtime" and "Libraries", because the drawing is `aria-hidden` and the names must be readable and searchable (Q8). No logos. |
| Ship section (E) | Full width, with the copy above the map. Title: "What you can ship." Body: "Past the first payment: admin screens, team accounts, API keys, subscriptions and background jobs, each one a module you add." A flat transit map, not isometric (Q9), whose lines are job groups: Users (auth, app, admin), Teams (teams, multitenant, api-keys), Money (payment, subscription), Run the product (queue, storage, file-uploads, feature-flags, email). All lines meet at a `my-app` interchange with the primary fill. A legend names the four lines by their stroke pattern. |
| Motion | Owner decision on 2026-10-29, kept in the grill (Q1): E, H and I loop on the clock while they are in view, as the hero does. Each new drawing takes `drawing-load` and `data-loop-in-view`, and `LOOP_SCRIPT` pauses it off screen. This extends the hero's exception to WCAG 2.2.2 in `apps/web/src/styles/web.css` to four drawings. With reduced motion, each drawing shows its final state. |
| Loop script | `apps/web/src/layouts/Layout.astro` emits `LOOP_SCRIPT` once per page, and the hero stops owning it (Q3). `apps/web/scripts/gate-a11y.ts` checks every `[data-loop-in-view]` drawing pauses off screen, not only the first one (Q4). |
| Illustration rules | From plan 0091: hand-built inline SVG in `apps/web/src/illustrations/`, `currentColor` and `highlight` strokes, one `primary` fill per drawing, `aria-hidden="true"`, at most 20 KB before compression. Reuse `Plane`, `Sheet`, `Label`, `Lines`, `IsoBox` and `Assemble` from `parts.tsx`. |
| Copy | Every new string goes in `apps/web/src/content/landing.ts` under the shape rules at the top of that file. Plan 0091's rule holds: every claim on the page also appears in the README. A module name on the page must match the registry, so the `ship` phase depends on the `billing` to `subscription` rename (issue #211, PR #276) (Q13). |
| UI house rules | From `apps/web/DESIGN.md` and plan 0091: square corners, light and dark themes only, the zigzag layout from 64rem with copy first below it, a `blueprint-rule` between each pair of sections, external links open in a new tab through `externalLinkProps`, and blocks ship no JavaScript except the named islands and `LOOP_SCRIPT`. |
| Plan 0091 | Its Section content and Section layout rows get one line each that points to this plan for the hero drawing and the three new sections (Q6). |
| Tests | No new kind of test. The existing `gate:a11y`, Lighthouse and axe gates and `pnpm lint` cover every phase. |
| Outward actions | Approved by the owner on 2026-10-29 (Q14): commit this plan and research report 0007 to `main`, push, and file one issue per phase. Phase 5 is filed `blocked` on #211. |

## Approach

Build the approved hero first. Then move `LOOP_SCRIPT` to the layout so every looping drawing shares it. Then build each new section in its own phase. Each section phase adds one block, one illustration and its copy, so each one ships and is reviewed alone. No phase needs a person before the build: round 4 is approved and the dark and mobile mockups are waived.

The work reuses:

- the isometric helpers in `apps/web/src/illustrations/parts.tsx`
- `drawing-load`, `assemble`, `draw`, `flow`, `float` and `packet` in `apps/web/src/styles/web.css`
- the `[data-loop-in-view]` exemption and its off-screen pause check in `apps/web/scripts/gate-a11y.ts`
- the section recipe in `apps/web/src/pages/index.astro`
- `landing.ts` for all copy
- the round 2 SVG source in `.dev/hero-mockups/round-2/index.html`

Rejected alternatives:

- Put E, H and I in stages, catalog and providers in place of the current drawings. The owner rejected this after round 3.
- One pass of motion on entry for the new sections in place of a loop. The owner kept the loop (Q1).
- Use real screenshots of a generated project for "What you can ship" (report G1). This stays possible later, beside or in place of the map.

### Phase 1: source-tree hero

- Add `apps/web/src/illustrations/source-tree.tsx` from round 2 variant F, with the content in the Hero drawing content row.
- Swap `AppWireframe` for it in `apps/web/src/blocks/hero.tsx`. Keep `drawing-load` and `data-loop-in-view`.
- Delete `app-wireframe.tsx` and the `sign-in-*` keyframes and utilities in `web.css`. Delete `float` and `packet` too if no other drawing uses them.
- Update the comments in `hero.tsx` and `web.css` that describe the wireframe and the 6 s sign-in loop.
- Add the pointer lines to plan 0091's Section content and Section layout rows.

Done when: the built hero matches `after-hero.png` at 1440 px in light, except that `config/` has no marker. `source-tree.tsx` is 20 KB or less. `rg "app-wireframe|sign-in-" apps/web/src` returns nothing. `pnpm lint` passes, and `gate:a11y` passes with the hero loop paused off screen.

### Phase 2: shared in-view loop

- Move `LOOP_SCRIPT` from `hero.tsx` to `apps/web/src/layouts/Layout.astro`, emitted once per page.
- Extend `gate-a11y.ts` to scroll each `[data-loop-in-view]` drawing out of view and check that it pauses.
- Update the comment in `web.css` that names the hero as the one exception.

Done when: the built page has one copy of the script, `gate:a11y` passes, and the gate fails when a drawing keeps running off screen.

### Phase 3: problem section with the module city

- Add `apps/web/src/blocks/problem.tsx`, `apps/web/src/illustrations/module-city.tsx` and `landing.problem` copy.
- Add the section after the hero in `index.astro`, with a `blueprint-rule` on each side.

Done when: the section matches `section-problem.png` at 1440 px in light, with no eyebrow and no fill on the crane. `module-city.tsx` is 20 KB or less. No drawing label renders under 10 px at 375 px. The Lighthouse and axe gates pass.

### Phase 4: built-on section with the stack orbits

- Add `apps/web/src/blocks/built-on.tsx`, `apps/web/src/illustrations/stack-orbits.tsx` and `landing.builtOn` copy, with each stack name as a text chip.
- Add the section after `problem`.

Done when: the section matches `section-built-on.png` at 1440 px in light. Every name in the drawing also appears as text in the section. `stack-orbits.tsx` is 20 KB or less. No drawing label renders under 10 px at 375 px. The gates pass.

### Phase 5: ship section with the module map

- Wait for PR #276 (issue #211, the `billing` to `subscription` rename) to merge.
- Add `apps/web/src/blocks/ship.tsx`, `apps/web/src/illustrations/module-map.tsx` and `landing.ship` copy.
- Check each module name on the map against `modules/*/registry-item.json`.
- Add the section after stages.

Done when: the section matches `section-ship.png` at 1440 px in light. Each map name matches a registry module. `module-map.tsx` is 20 KB or less. No drawing label renders under 10 px at 375 px. On the full page, mobile Lighthouse scores 95 or more in all four categories, and axe reports zero violations at 375, 768 and 1440 px in both themes.

## Open questions

None. Every decision from the grill on 2026-10-29 is settled.

## Non-goals

- No change to the stages, catalog, providers, site source or FAQ sections or their drawings.
- No "Why Saasaloy" band (report G4), FAQ additions (G8), regional payments line (G7), catalog curation (G2) or navbar anchors (G9). Each needs its own plan.
- No real screenshots of a generated project (report G1).
- No dark-theme change to the brand tokens, and no new fonts.
