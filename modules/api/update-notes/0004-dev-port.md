---
title: apps/api reads its dev port from DEV_PORT
---

## What update does

`apps/api/vite.config.ts` reads `DEV_PORT` from `apps/api/.env.local` with Vite's `loadEnv` and checks it with `devPort()` from `@repo/env/dev-port`. Unset, the port is 4000, as before. A bad value fails at startup and names the file. `strictPort` stays on. In a linked worktree `pnpm dev:ports` writes a port of its own into that file, so two checkouts run `pnpm dev` at the same time.

The `api` row in `packages/env/src/services.ts` gets `devPort: 4000`. That is the port `pnpm dev:ports` keeps in the main checkout and the base of the worktree port. `apps/api/wrangler.jsonc` keeps `dev.port: 4000`, and its comment now says to run `wrangler dev --port <DEV_PORT>` in a linked worktree, because wrangler does not read `DEV_PORT`.

This needs the base template's `devPort` field and `@repo/env/dev-port` export, which the base note `base/0003-dev-ports` adds. Apply that note first, or the row fails `pnpm typecheck`.

## What the merge plan gets

`apps/api/vite.config.ts`, if you edited it. Keep your edits, import `devPort` from `@repo/env/dev-port` and `loadEnv` from `vite`, make the config a function of `{ mode }`, and set:

```ts
server: {
  cors: false,
  port: devPort(
    loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
    4000,
    "apps/api/.env.local"
  ),
  strictPort: true,
},
```

`packages/env/src/services.ts`, if the `api` row there has no `devPort`. Add `devPort: 4000` to it by hand. Without it `pnpm dev:ports` gives this service no port, and in a linked worktree it falls back to 4000, which the main checkout holds.

## What you do

1. Run `pnpm env:setup`. It runs `pnpm dev:ports`, which writes the `DEV_PORT` block into `apps/api/.env.local`.
2. Restart `pnpm dev`, so the dev server reads the new file.

## Verify

```sh
grep -n "devPort" packages/env/src/services.ts
pnpm --filter @repo/api typecheck
```

The first command shows `devPort: 4000` on the `api` row, and the typecheck passes. In a linked worktree, `pnpm dev` starts api on the port `.devports.json` records for it.
