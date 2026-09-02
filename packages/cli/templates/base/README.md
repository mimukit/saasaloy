# {{PROJECT_NAME}}

A Cloudflare-native SaaS, scaffolded with [Saasaloy](https://github.com/mimukit/saasaloy). The base is a
near-inert marketing shell; everything churny (API, database, auth, admin, features) installs on demand.

## Develop

```sh
pnpm install
pnpm dev        # astro dev on apps/web
```

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

`DESIGN.md` records the project's design tokens and UI rules for people and agents.

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

`apps/web/src/pages/index.astro` composes the blocks in `packages/ui/src/blocks/` —
`navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer`. Each is one
self-contained `.tsx` with its copy as in-file defaults, so editing the file is how you
change the page.

Blocks render to static HTML by default. Only the three that need browser state carry a
client directive (`Navbar` is `client:idle`; `PricingTable` and `Faq` are
`client:visible`) — the rest ship no JavaScript at all. Don't reach for `client:load`.

The page composes itself from explicit imports, and nothing discovers a file behind your
back. A module that ships UI writes its block into `packages/ui/src/blocks/` like every
block above, plus a small island under `apps/web/src/components/` that feeds the block
whatever it needs to talk to (blocks stay presentational and take behaviour as props).
`saasaloy add <module>` then prints a pointer to the module's skill, which carries the
import line and the suggested spot. Where it actually goes is your call.
