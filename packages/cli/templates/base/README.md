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
saasaloy add waitlist       # pulls api + database
saasaloy add billing        # pulls auth + Stripe
```

## UI components

`packages/ui` ships a Tailwind 4 theme and a small set of [shadcn](https://ui.shadcn.com)
primitives. Import them by subpath:

```ts
import { Button } from "@repo/ui/components/button";
```

To add one the base doesn't include, run the pinned CLI in `packages/ui` — that's where
`components.json` lives:

```sh
pnpm --filter @repo/ui exec shadcn add dialog
```

Components land in `packages/ui/src/components/` as source you own and can edit.
