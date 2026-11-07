---
title: apps/app reads its dev port from DEV_PORT
---

## What update does

`apps/app/vite.config.ts` reads `DEV_PORT` from `apps/app/.env.local` with Vite's `loadEnv` and checks it with `devPort()` from `@repo/env/dev-port`. Unset, the port is 3002, as before. A bad value fails at startup and names the file. `strictPort` stays on. In a linked worktree `pnpm dev:ports` writes a port of its own into that file, so two checkouts run `pnpm dev` at the same time.

The `app` row in `packages/env/src/services.ts` gets `devPort: 3002`. That is the port `pnpm dev:ports` keeps in the main checkout and the base of the worktree port.

This needs the base template's `devPort` field and `@repo/env/dev-port` export, which the base note `base/0003-dev-ports` adds. Apply that note first, or the row fails `pnpm typecheck`.

## What the merge plan gets

`apps/app/vite.config.ts`, if you edited it. Keep your edits, import `devPort` from `@repo/env/dev-port` and `loadEnv` from `vite`, make the config a function of `{ mode }`, and set:

```ts
server: {
  port: devPort(
    loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
    3002,
    "apps/app/.env.local"
  ),
  strictPort: true,
},
```

`packages/env/src/services.ts`, if the `app` row there has no `devPort`. Add `devPort: 3002` to it by hand. Without it `pnpm dev:ports` gives this service no port, and in a linked worktree it falls back to 3002, which the main checkout holds.

## What you do

1. Run `pnpm env:setup`. It runs `pnpm dev:ports`, which writes the `DEV_PORT` block into `apps/app/.env.local`.
2. Restart `pnpm dev`, so the dev server reads the new file.

## Verify

```sh
grep -n "devPort" packages/env/src/services.ts
pnpm --filter @repo/app typecheck
```

The first command shows `devPort: 3002` on the `app` row, and the typecheck passes. In a linked worktree, `pnpm dev` starts app on the port `.devports.json` records for it.
