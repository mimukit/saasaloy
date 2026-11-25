---
title: vite preview in apps/api uses the dev port
---

## What update does

`apps/api/vite.config.ts` gets a `portFor(mode)` function that returns the `DEV_PORT` from `apps/api/.env.local`, or 4000 when it is unset. The `server` block and a new `preview` block both call it. `vite preview` takes `strictPort`, `cors` and `host` from `server`, but its port defaults to 4173, so before this change a built app answered on 4173 and not on the origin that `pnpm dev:ports` wrote into the other apps' env. The e2e suite's built mode serves the built app with `vite preview` (issue #399).

## What update merges

`apps/api/vite.config.ts`, if you edited it. Keep your edits, add the function below `ENV_LOCAL`, and replace the `server` block with the two blocks:

```ts
function portFor(mode: string): number {
  return devPort(
    loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
    4000,
    ENV_LOCAL
  );
}

// inside defineConfig
server: { cors: false, port: portFor(mode), strictPort: true },
preview: { port: portFor(mode) },
```

## What you do

Nothing.

## Verify

```sh
pnpm --filter @repo/api build
pnpm --filter @repo/api preview
```

The preview prints the same port as `pnpm dev` for this app. Stop `pnpm dev` first, because the two share the port.
