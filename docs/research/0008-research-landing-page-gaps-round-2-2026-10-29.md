# Research: landing page gaps, round 2

- **Date:** 2026-10-29
- **Scope:** `apps/web` on `main` at `71168f97` (PR #291). Sources: `apps/web/src/content/landing.ts`, `apps/web/src/pages/index.astro`, `apps/web/src/blocks/*`, `apps/web/src/lib/module-catalog.ts`, `apps/web/src/styles/web.css`, `modules/*/registry-item.json`, plan 0092, issues #211 and #290. I read the source. I did not render the page.
- **Follows:** `docs/research/0007-research-landing-page-gaps-2026-10-28.md`. The gap ids G1 to G9 below refer to that report.

## Summary

The work since round 1 closed four of the nine gaps, fully or in part. The page now has a problem statement, a stack section, an agent section, module counts and a catalog that groups providers into their capability tile. The hero now shows `saasaloy add` at work in a source tree.

What is still missing is the part after sign-in. The page still ends its story at "Payments", it still shows no screen of a generated project, and the "What you can ship" section waits on issue #211. Four new problems came in with the changes:

1. The stages section and the catalog tabs use two different stage lists for the same idea.
2. The page lost its second command field and its dogfood proof, so the only call to action is at the top.
3. The problem statement now sits fourth, after the solution it sets up.
4. The built-on section dropped Cloudflare, so the page no longer names the runtime outside the providers section.

My recommendation for the next round, in order: unify the two stage lists, add a closing call to action, move the problem section up, and add "Validate on the free tier" plus `saasaloy update` as visible claims. All four are copy or order changes. The ship section stays the largest open item, and #211 blocks it.

## Status of the round 1 gaps

| Gap | Round 1 finding | Now | Open part |
|-----|-----------------|-----|-----------|
| G1 | No product on the page | Partly open | The hero shows a source tree, not a product. No screen of the admin, the app or Cmd+K. Plan 0092 makes screenshots a non-goal, and its `ship` section (a transit map, still a drawing) waits on #211. |
| G2 | Catalog buries modules | Mostly closed | Providers and drivers are chips on their parent tile, tabs are stages, counts show. Open: registry descriptions, tier badges, no command or link per tile. See N1 and N5. |
| G3 | Stages stop at payments | Open | `landing.stages.items` still has five items and ends at "Payments". |
| G4 | Agents, update, cost missing | One of three closed | Agents: closed by the new `siteSource` block. Update: still FAQ only. Cost: still absent from the whole page. |
| G5 | No problem statement | Mostly closed | The section exists. The "shadcn/ui for a full-stack SaaS" line is still README only, and the section order weakens it (N3). |
| G6 | Stack not named | Mostly closed | Nine names show. Zod, React Email, Playwright and D1 do not, and Cloudflare left the section (N4). |
| G7 | Regional payments hidden | Open | The `payment` tile shows the chip `manual`, which does not say bKash or Nagad. |
| G8 | FAQ gaps | Open | The FAQ has the same six items as on 2026-10-28. |
| G9 | Navbar, numbers, demo | Partly closed | Counts: closed. Demo: closed by the hero source tree. Navbar: still three external links and no in-page anchors. |

## New and remaining gaps

### N1. Two stage lists for one idea (high)

The stages section and the catalog tabs both sort modules by stage, and they do not agree.

| Stages section (`landing.stages`) | Catalog tab (`stage` in the registry) | Catalog tab contents |
|-----------------------------------|----------------------------------------|----------------------|
| Landing page, Waitlist | Validate | api, database, logger, validators, waitlist |
| Sign-in | MVP | admin, app, auth, e2e, email, shell, command, email-react |
| Teams | Teams | multitenant, teams |
| Payments | Money | billing, payment |
| (none) | Scale | kv, queue, sms, storage, api-keys, env-infisical, feature-flags, file-uploads, ratelimit |

A visitor reads "Sign-in" as a stage in one section and "MVP" in the next. The catalog's "Scale" tab holds nine modules that the stages section never names, which is the G3 gap seen from the other side. The landing page itself is a stage in the first list and has no tile in the second, because the base is not a module.

**Fix.** Make the registry `stage` field the one source. Use the same five labels in both sections, and give each stage in the stages section a one-line summary of the tab it matches. A sixth stage, "Scale", in the stages section closes most of G3 with no new section. Then a stage title in the stages section can link to `#catalog` with that tab selected, which needs only a radio `id` per tab.

### N2. One call to action, at the top (high)

The old site-source section had a second command field with `npx saasaloy init my-app`. Commit `d7c66f7e` replaced that section with the agent section, which has a docs link and no command. The page now shows the command once, in the hero. A visitor who reads to the FAQ meets the footer and no next step. That old section was also the page's only proof that the product works ("This site starts with Saasaloy"), and the page lost it.

**Fix.** Add a closing block after the FAQ with the command field and the two hero links. Put the dogfood line in it: "This site began as the landing page `saasaloy init` writes." It costs one block and reuses `CommandField`.

### N3. The problem comes after the solution (medium)

The page order is hero, stages, built-on, problem, catalog. Plan 0092 set hero, problem, built-on, stages. Commit `fa718d1a` moved stages up, and the problem section ended up fourth. A visitor sees the method and the stack before the pain that the method answers. "Boilerplates make you delete code for a week" works as the second section, where it explains why the hero says "a landing page today".

**Fix.** Move `<Problem />` to directly after the hero. Check the zigzag sides from plan 0092 after the move, because the sides depend on order.

### N4. Cloudflare left the built-on section, and cost never arrived (medium)

Plan 0092 set the title "Built on Cloudflare and tools you know" and a Runtime ring of Workers, D1, KV, R2 and Queues. The shipped title is "Built on tools you already know", and a comment in `landing.ts` says the providers section names the vendor. The providers section does name Cloudflare, but as one vendor among many. The meta title still says "starter kit for Cloudflare". So the page title promises Cloudflare, and the body plays it down.

The free-tier argument from the README ("a hosting bill close to zero") is still on no part of the page. It is the most direct reason a founder at the validate stage picks Saasaloy over a kit that needs a VPS or Vercel Pro.

**Fix.** Add a third chip group, "Runtime": Workers, D1, KV, R2, Queues. Add one line to the providers lead or to the Validate stage: "Validate the idea on the Cloudflare free tier." Name the two modules that need a paid Workers plan (`email-cloudflare`, `queue-cloudflare`) in a FAQ item, so the claim stays honest.

### N5. Tiles still speak to contributors (medium)

The catalog tiles still show the registry `description` and a Capability or Feature badge. The counts line reads "16 capabilities · 10 features · 17 providers · 4 drivers". A founder does not know what separates a capability from a feature, and the badge takes the place where a command would help. Examples of tile text that needs the repo to understand:

- `shell`: "the coss primitive set under @repo/ui/*/shell".
- `api-keys`: "on the Better Auth api-key plugin, stored as a hash; pick api-keys-organization or api-keys-user as the owner".
- `teams`: "copy-ID invitations".
- `payment`: "the provider contract, the status machine and staff review routes".

The tiles also have no `saasaloy add <name>` command, no docs link and no "adds api, database" line, although `dependsOn` is in every descriptor and the catalog already reads it for `parentOf`.

**Fix.** Add an optional `summary` field to the descriptor for the catalog, written for a founder, and fall back to `description` when it is absent. Replace the tier badge with the command. Show `dependsOn` as "needs auth, admin" in small text. Change the counts line to "26 modules · 17 providers · 4 drivers", or drop the tier words.

### N6. The motion budget grew (medium)

The page now has five loops while in view: the hero source tree, the problem city, the built-on orbits, the agent crew in the agent section, and the stages highlight on a 15 s cycle (`web.css:572`). Each one carries `data-loop-in-view`. Plan 0092 records the WCAG 2.2.2 exception as an owner decision for four drawings. The agent crew is a fifth. Two risks remain. A loop over 5 seconds with no pause control fails 2.2.2 for a user who has not set reduced motion, and five moving parts on one page pull the eye from the copy. The stages timer also moves the highlight away from a row a reader is reading, unless the pointer rests on it.

**Fix.** Keep the hero loop. Make the other drawings play once and stop on their final state. If you keep the loops, add one page-level pause button in the navbar, which also clears 2.2.2.

### N7. The FAQ, the navbar and the meta stayed the same (low)

- FAQ: the five questions from G8 are still open. "What does it cost to host?" and "How is it different from a boilerplate?" are the two most useful.
- Navbar: no anchors to `#stages`, `#catalog` or `#faq`. The page is now ten sections long, so a jump link matters more than it did.
- `astro.config.mjs:54` sets `site` to `https://saasaloy.brainaloy.workers.dev`. That clears the `example.com` canonical from the SEO report. Re-run seokit when `saasaloy.com` is live.
- `landing.meta.imageAlt` describes `public/og.png` as a module map with api, auth, database, email and payment. Check that it still matches the image after the brand work.

## Proposed page order

| # | Section | Change |
|---|---------|--------|
| 1 | Hero | Add the shadcn line to the description |
| 2 | Problem | Move up from position 4 |
| 3 | Stages | Use the registry stage labels, add "Scale", link each stage to its catalog tab |
| 4 | Built on | Add the Runtime chip group |
| 5 | Ship | Build after #211 (plan 0092, phase 5) |
| 6 | Catalog | Founder summaries, command per tile, `dependsOn` line |
| 7 | Providers | Add the free-tier line |
| 8 | Agents | Keep |
| 9 | FAQ | Add cost, boilerplate, stack, first-module questions |
| 10 | Get started | New closing block with the command field and the dogfood line |

## Order of work

1. Copy and order only, no mockup: N3 (move problem), the shadcn line, the free-tier line, the FAQ items, the Runtime chip group.
2. N2, the closing block. It reuses the hero command field and an existing layout, but it is a new section, so it needs a short mockup round under the AGENTS.md UI rule.
3. N1 and N5 together, because both touch stage labels and the tile. This needs a registry field (`summary`) and a mockup round for the tile.
4. Plan 0092 phase 5, the ship section, after #211 merges.
5. N6, the motion decision. It reverses an owner decision from plan 0092, so it needs your call first.

## Open questions

- Do you want the stages section and the catalog tabs on one stage list (N1)? I recommend yes, with the registry `stage` as the source.
- Should Cloudflare come back into the built-on section (N4)? The meta title still names it, so I recommend yes.
- Do you keep five loops on the page (N6), or do the section drawings play once?
