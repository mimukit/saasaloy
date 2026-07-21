# {{PROJECT_NAME}}

A Cloudflare-native SaaS, scaffolded with [Saasaloy](https://github.com/). The base is a
near-inert marketing shell; everything churny (API, database, auth, admin, features)
installs on demand.

## Develop

```sh
pnpm install
pnpm dev        # astro dev on apps/web
```

## Deploy

```sh
pnpm --filter web build
pnpm --filter web deploy    # wrangler deploy (Cloudflare Workers static assets)
```

## Add features

```sh
saasaloy add waitlist       # pulls api + database
saasaloy add billing        # pulls auth + Stripe
```

## Layout

- `apps/web` — Astro marketing site (landing, terms, privacy).
- `packages/ui` — shared UI (stub until a feature needs components).
- `packages/config` — shared TypeScript config (`@repo/config`).
- `.agents/` — canonical agent guidance. Edit fragments here, then run `pnpm sync` to
  regenerate `AGENTS.md`, `CLAUDE.md`, and `.claude/skills` (all git-ignored).
