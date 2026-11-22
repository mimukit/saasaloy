# Plan: Saasaloy UI, an open registry of blocks, themes and templates

Grilled: 2026-11-22

## Context

Saasaloy ships a design layer in the base: 31 vendored `base-nova` primitives and 15 landing blocks in `packages/cli/templates/base/packages/ui/src/`. Only a person who runs `saasaloy init` sees them. The owner wants to release free, MIT-licensed UI blocks, themes and templates to the public, for two reasons. First, the registry is a marketing channel: a developer who uses a block learns that Saasaloy exists. Second, a Saasaloy user gets a way to choose and mix blocks, themes and templates for a new project.

The reference is [Tailark](https://tailark.com/): a shadcn registry of marketing blocks in several visual styles (Quartz, Dusk, Libre), compatible with Radix and Base UI. Tailark puts full access behind a paid plan. Saasaloy makes the full set free, and the funnel to the framework pays for it.

The users are two groups. Any shadcn user installs a block with `shadcn add @saasaloy/<name>`. A Saasaloy user picks a template and a theme at `saasaloy init`.

The public name is **Saasaloy UI**, at `saasaloy.com/ui`. Inside a generated project, `@repo/ui` stays the name of the local package, and each Saasaloy UI page says which is which.

Success: developers outside Saasaloy install the blocks and find Saasaloy through them.

Target: none, by owner decision (grill 2026-11-22). No number gates a phase, and the phases run in order. Cloudflare analytics on saasaloy.com can still count requests to `/r/*.json` if a number is wanted later.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Price and license | Every block, theme and template is free under MIT. Nothing sits behind a paid plan. |
| Layers | Four layers. A **theme** is a token set (colours, radius, fonts, shadows) and changes no markup. A **kit** is a visual family of blocks with one spacing and typography scale. A **block** is one presentational `.tsx` that follows ADR 0030. A **template** is a named recipe: one theme, one kit, an ordered list of blocks, and sample content. |
| Mix rule | A block uses semantic tokens only (`bg-background`, `text-primary`, `var(--radius)`), so every theme fits every block. A check enforces it. Blocks from two kits can be mixed, but the site shows one kit as the default for each template. |
| Target and gate | No target and no gate between phases. The phases run in order (grill Q1, Q10). |
| Primitive family | The registry publishes Base UI (`base-nova`) blocks only in this plan. Radix variants of the marketing blocks come in a later plan. Module blocks stay Base UI only (grill Q2). |
| Source location | Each block stays where it lives today: base blocks in `packages/cli/templates/base/packages/ui/src/blocks/`, module blocks in `modules/<name>/files/`, kit blocks in `packages/cli/templates/kits/<kit>/blocks/`. `apps/web/registry.json` names those files, and the registry build reads them. No second copy of a block exists (grill Q3, Q14). |
| Public copy | The base blocks keep their direct import of `@repo/ui/content/landing`, because Astro serializes island props and the import keeps static blocks at zero JavaScript. The registry build inlines each block's copy, its `ui` labels and a sample `siteName` as prop defaults in the public item only (grill Q11). |
| Public names | Every registry name carries its kit or module: `cobalt-hero`, `dusk-hero`, `auth-sign-in`. The URL is `https://saasaloy.com/r/<name>.json`, and users install with the `@saasaloy/<name>` namespace. The file in the user's project keeps the semantic name (`components/blocks/hero.tsx`). Kit one gets its real name in the Phase 1 mockup round; `cobalt` and `dusk` are placeholders (grill Q12). |
| Primitive dependencies | A block's `registryDependencies` names the shadcn primitive (`button`) when Saasaloy's copy matches upstream `base-nova`, and a Saasaloy URL only for a primitive that differs, such as `calendar`. Each block page says that the block needs a `base-*` style project (grill Q13). |
| `"use client"` | Each block with browser state carries `"use client"` in its source. Astro ignores the directive, so the build stays a plain `shadcn build` plus the copy inlining (grill Q7). |
| Registry transport | Static JSON files under `https://saasaloy.com/r/`, served by the existing `apps/web` Cloudflare deploy. No server, no auth, no database. |
| Name and site | The public name is **Saasaloy UI**. The site lives in `apps/web` at `saasaloy.com/ui`: `/ui` (index), `/ui/blocks/<name>`, `/ui/themes`, `/ui/templates`, `/ui/builder`. The registry JSON stays at `/r/<name>.json`, the shadcn convention. `@repo/ui` stays the name of the package in a generated project (grill Q5, re-grilled 2026-11-22). |
| Registry build | A script runs `shadcn build` from `apps/web/registry.json`, then inlines the copy, and writes `apps/web/public/r/*.json`. `shadcn` is already an exact-pinned dependency of `packages/ui` (ADR 0022). |
| Go-live | The registry goes live at the next CLI release, through the release skill's `apps/web` deploy. No separate deploy (grill Q15). |
| Tests | `scripts/block-tokens.test.ts` (the token-only check) and `scripts/registry.test.ts` (each JSON file against the shadcn registry-item schema, plus a typecheck of the inlined blocks in a fixture) run under `node:test` in CI. A `qakit` step runs `shadcn add` in a real Next.js app by hand. No full Next.js install runs in CI (grill Q9, Q16). |
| Module blocks are public | A module block (sign-in form, pricing table, member list, key table) goes into the public registry as a presentational block. Outside Saasaloy it takes an `onSubmit` or a data prop and nothing more. Its gallery page states that Saasaloy wires it to `auth`, `subscription`, `teams` or `api-keys`. |
| Themes are shadcn presets | `packages/ui/src/styles/brand.css` is already the file `components.json` names, so a shadcn preset merges into it. A Saasaloy theme is a registry item of type `registry:theme` (or `registry:style`) that merges into the same file. |
| Templates change `init` only | Base blocks are `once` files (ADR 0067): written when new, then never updated. A template or a theme changes only what `init` writes, and adds no update path. A template changes `apps/web` only and adds no module (grill Q4). |
| Engine timing | Phases 4 and 7 change `init`, so they wait for issue #365 (one render engine) to merge (grill Q6). |
| UI house rules | The gallery and the builder follow `apps/web/DESIGN.md`: external links open in a new tab, the theme toggle has light and dark only, and cards in one row share one height. |
| Visual approval | One mockup round for each new screen, each kit and each theme. A module block gets its round in its own module's plan. Mockup images go to the `mockups: mimukit/saasaloy` gist (grill Q8). |
| Attended phases | Phases 1, 3 and 6 are attended mockup rounds. Each comes right before the build phase it feeds (grill Q17). |
| Phase 1 mockup approved | 2026-11-22, round 1 (gallery index and block page, light and dark, 1440 and 390 px). Gist: https://gist.github.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a with file prefix `0121-r1`. Issue comment: https://github.com/mimukit/saasaloy/issues/384#issuecomment-7076034604. Kit-one name: `ink`, locked by the owner on 2026-11-22. |
| Phase 3 mockup approved | Decided by the afkkit run on 2026-11-22, pending owner review. Round r2 (landing page in each theme, light and dark, 1440 px; block-page switcher, light and dark, 1440 px and light 390 px; themes page, light 1440 px), local file prefix `0121-r2`. Gist: pending. Issue comment: pending. Themes: `neutral` (default, today's brand.css), `cobalt`, `ember`, `moss`. |

## Approach

Recommended: the **staged registry**. Publish the blocks that exist first, then add themes, module blocks, a second kit and templates, and build the builder last. Each stage ships alone.

It reuses:

- The 15 base blocks in `packages/cli/templates/base/packages/ui/src/blocks/` and the 31 primitives in `.../ui/src/components/`.
- `packages/ui/components.json` (`style: base-nova`, `css: src/styles/brand.css`) and the exact-pinned `shadcn` dependency.
- The docs site `apps/web` (Astro 7, React 19, `@base-ui/react`, deployed to saasaloy.com on Cloudflare), which can render the template blocks as React islands.
- The block rules in ADR 0022 and ADR 0030, the `once` file class in ADR 0067, and the token fingerprint in ADR 0027.
- The module skills' `## Wire-up` sections, which already state how a module block is placed.
- The release skill's site deploy, which publishes the registry.

Alternatives considered:

- **Minimal: registry only.** Publish the 15 blocks and stop. It gives the Saasaloy user nothing to choose. It is Phase 2 of this plan, not the whole plan.
- **Ideal: builder first.** Build the gallery, the theme switcher and the builder before the content grows. It builds a picker with one kit and one theme to pick from.
- **Lateral: contribute upstream.** Add Saasaloy blocks to an existing directory and build no site. The traffic then lands on another site, and the funnel to Saasaloy breaks.

### Phase 1: gallery mockup

Attended: owner approval of the gallery and block page mockups, and of the kit-one name.

- Mock up the Saasaloy UI index page (`/ui`) and one block page (`/ui/blocks/<kit>-hero`) in light and dark, at 1440 and 390 widths.
- The block page shows the live preview, the source, the install command (`shadcn add @saasaloy/<kit>-hero`), the `base-*` style note, and a line that names Saasaloy.
- Propose two or three names for kit one in the same round.
- Post the round to the tracking issue and record the approval in this plan.

Done when: a Design decisions row records the approval date, the round, the gist URL with the file prefix, the issue comment URL, and the kit-one name.

### Phase 2: publish the base blocks as a registry (built 2026-11-22)

- Add `"use client"` to each base block with browser state.
- Add `apps/web/registry.json` that names the 15 base blocks as `<kit>-<block>`, with their files, npm dependencies and `registryDependencies` (shadcn names, a Saasaloy URL only for a primitive that differs from upstream).
- Add the build script: `shadcn build`, then inline each block's `landing` slice, `ui` labels and a sample `siteName` as prop defaults, then write `apps/web/public/r/*.json`. Ship `@repo/ui/lib/*` helpers a block imports as `registry:lib` files. Run the script in the `apps/web` build.
- Add `scripts/block-tokens.test.ts`. It fails on a hard-coded colour (`#hex`, `rgb(`, `oklch(`, a palette class such as `bg-blue-500`) in a block. It allows the `#000` in a `mask-image` gradient, which is an alpha mask.
- Add `scripts/registry.test.ts`. It checks each JSON file against the shadcn registry-item schema and typechecks the inlined blocks in a fixture.
- Build the approved `/ui` index and `/ui/blocks/<name>` pages in `apps/web`.

Done when: `pnpm test` runs both scripts green; `block-tokens.test.ts` fails on a fixture block with `bg-blue-500`; and in the `qakit` step, in an empty Next.js app with a `base-*` style, `pnpm dlx shadcn add ./apps/web/public/r/<kit>-hero.json` writes a hero that renders with no type error.

### Phase 3: theme mockup (built 2026-11-22)

Attended: owner approval of three or four theme presets.

- Mock up the landing page in each theme, light and dark.
- Mock up the theme switcher on the block pages.

Done when: a Design decisions row records the theme approval in the same form as Phase 1.

### Phase 4: themes, the switcher and `init --theme` (built 2026-11-22)

Starts after issue #365 merges.

- Add each approved theme as a registry item that merges into `brand.css`.
- Add the `/ui/themes` page, and add the switcher to the block pages. It changes the tokens of every preview at once and changes the install command to name the theme.
- Add `saasaloy init --theme=<name>`. With no flag, a terminal gets one question, the same way `--testing` works today.
- Update the seeded `apps/web/DESIGN.md` and its token fingerprint (ADR 0027) to read the chosen theme.

Done when: `saasaloy init app --theme=<name> --yes` in `.dev` writes a `brand.css` with that theme's tokens, `pnpm build` passes in the new project, and `DESIGN.md` names the theme.

### Phase 5: module blocks in the registry (built 2026-11-22)

- Add the presentational block of each UI-bearing module to `registry.json` as `<module>-<block>`: `auth` forms, `subscription` pricing and invoice list, `teams` member list and invite dialog, `api-keys` key table.
- Each block page shows the Saasaloy wire-up next to the plain `shadcn add` command.
- A module block that does not exist yet comes with its module's own plan, not with this one.

Done when: `scripts/registry.test.ts` covers each listed module block, and in the `qakit` step each one installs with `shadcn add` in the Phase 2 Next.js app and renders with stub props.

### Phase 6: second kit and templates mockup

Attended: owner approval of the second kit, of each template, and of the builder page.

- Mock up the second kit's versions of the landing blocks.
- Mock up two or three templates as full landing pages.
- Mock up the builder page.

Done when: a Design decisions row records the approval in the same form as Phase 1.

### Phase 7: second kit, templates and the builder

Starts after issue #365 merges.

- Add the second kit's blocks under `packages/cli/templates/kits/<kit>/blocks/`, named `<kit>-<block>` in the registry.
- Add each template as a recipe file: theme, kit, ordered block list, sample content. List them on `/ui/templates`.
- Add `saasaloy init --template=<name>`. It writes the kit's blocks in place of the base blocks, the template's theme, and a composed `apps/web/src/pages/index.astro`.
- Build the builder page at `/ui/builder`: pick a template, change the theme, add, remove or reorder blocks. The output is one command to copy.

Done when: a command copied from the builder, run in `.dev`, writes a project whose landing page matches the builder preview, and `pnpm build` passes in that project.

## Open questions

None. The grill on 2026-11-22 settled every question in the draft.

## Non-goals

- No paid tier, no account, and no licence key.
- No Radix variants in this plan. A later plan adds them for the marketing blocks.
- No template that adds modules at `init`. Revisit after issue #365.
- No visual drag-and-drop page editor. The builder picks and orders whole blocks only.
- No update path for blocks or themes already in a project. ADR 0067 keeps them `once` files.
- No dashboard or app-screen templates. The `shell` and `app` modules own those screens.
- No Figma kit.
- No CLI telemetry.
- No new UI for a module that does not have one yet. Each module plan owns its own block.
