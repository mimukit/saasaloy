# {{PROJECT_NAME}}

A Cloudflare-native SaaS, scaffolded with [Saasaloy](https://github.com/mimukit/saasaloy). The base is a
near-inert marketing shell; everything churny (API, database, auth, admin, features) installs on demand.

## Develop

```sh
pnpm install
pnpm dev        # astro dev on apps/web
```

## Test

```sh
pnpm test       # each workspace's own test script, then Vitest over apps/* and packages/*
```

`saasaloy add e2e` adds a browser suite on top. It brings Playwright, four flows against the running apps, and two commands:

```sh
pnpm e2e:install    # download Chromium, once per machine
pnpm e2e            # migrate and seed the database, start the apps, run the flows
```

`pnpm test` never collects a Playwright spec, and `pnpm e2e` never collects a Vitest test.

## Deploy

```sh
pnpm --filter @repo/web build
pnpm --filter @repo/web run deploy    # wrangler deploy (Cloudflare Workers static assets)
```

## Add features

```sh
saasaloy add waitlist       # pulls api, logger, validators, database and a driver
saasaloy add auth           # pulls api, database and a driver
saasaloy list               # what the registry offers, and what you already have
```

`saasaloy list` names every installable module and marks the ones this project already has.
`saasaloy add <name> --dry-run` shows exactly what one would write before it writes it.

## UI components

`apps/web/DESIGN.md` records the web app's design tokens and UI rules for people and agents.

`packages/ui` ships a Tailwind 4 theme, a small set of [shadcn](https://ui.shadcn.com)
primitives, and the marketing blocks the landing page is built from. Import primitives and
blocks by subpath — neither is re-exported from the package root, which carries
project-wide constants only:

```ts
import { siteName } from "@repo/ui";
import { Button } from "@repo/ui/components/button";
import { PricingTable } from "@repo/ui/blocks/pricing-table";
```

To add a primitive the base doesn't include, run the pinned CLI in `packages/ui` — that's
where `components.json` lives:

```sh
pnpm --filter @repo/ui exec shadcn add dialog
```

Components land in `packages/ui/src/components/` as source you own and can edit.

## Landing page

`apps/web/src/pages/index.astro` composes thirteen blocks from `packages/ui/src/blocks/`: `navbar`, `hero`, `logo-cloud`, `pain-points`, `how-it-works`, `feature-grid`, `showcase`, `audience`, `testimonials`, `pricing-table`, `faq`, `cta` and `footer`. The page ships describing Saasaloy itself, so it reads as a finished product on day one. You make it yours with two edits and no others:

1. **Rewrite the words** in `packages/ui/src/content/landing.ts`: every heading, link, price and icon name. The `saasaloy-landing-copy` skill drafts it from your product brief. The brand is `siteName` in `packages/ui/src/index.ts`, which `saasaloy-setup` sets.
2. **Choose the sections** in `index.astro`. Each section is one import and one line.

### The section recipe

- **Remove a section:** delete its line and its import in `index.astro`, then delete its file in `packages/ui/src/blocks/`. Blank its navbar and footer labels in `landing.ts` so no link points at a section that is gone.
- **Reorder:** move the lines. Every block uses the same container and spacing utilities, so any order keeps one rhythm.
- **Bring one back:** copy the block file in from a fresh `saasaloy init`, then add the import and the line.

### The logo recipe

The logo row names each logo in `landing.logos.items` as `{ id, name, mark }`. `mark` is a key in the `LOGO_MARKS` registry at the top of `packages/ui/src/blocks/logo-cloud.tsx`. To add a customer's logo, paste its SVG into that registry under a kebab-case key with `fill="currentColor"`, then put the key in the item's `mark`. A key the registry doesn't know renders the item's `name` as a text wordmark, which is what the default row does.

### What the page promises

Blocks render to static HTML by default. Only two carry a client directive: `Navbar` (`client:idle`) and `PricingTable` (`client:visible`). The FAQ and the pain points open with native `<details>`, all motion is CSS and stops under reduced motion, and the footer adds one inline script that writes the current year. Don't reach for `client:load`.

The page is checked against a written rubric: no axe violation at WCAG 2.1 AA in either theme, no sideways scroll from 360px up, a skip link on every page, and link-preview metadata on `/`. Keep those true when you change a block.

The page composes itself from explicit imports, and nothing discovers a file behind your
back. A module that ships UI writes its block into `packages/ui/src/blocks/` like every
block above, plus a small island under `apps/web/src/components/` that feeds the block
whatever it needs to talk to (blocks stay presentational and take behaviour as props).
`saasaloy add <module>` then prints a pointer to the module's skill, which carries the
import line and the suggested spot. Where it actually goes is your call.
