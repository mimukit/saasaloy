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
pnpm --filter web build
pnpm --filter web run deploy    # wrangler deploy (Cloudflare Workers static assets)
```

## Add features

```sh
saasaloy add waitlist       # pulls api + database
saasaloy add billing        # pulls auth + Stripe
```
