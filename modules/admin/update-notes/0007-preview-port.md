---
title: vite preview in apps/admin uses the dev port
---

## What update does

`apps/admin/vite.config.ts` gets a `portFor(mode)` function that returns the `DEV_PORT` from `apps/admin/.env.local`, or 3001 when it is unset. The `server` block and a new `preview` block both call it. `vite preview` takes `strictPort`, `cors` and `host` from `server`, but its port defaults to 4173, so before this change a built app answered on 4173 and not on the origin that `pnpm dev:ports` wrote into the other apps' env. The e2e suite's built mode serves the built app with `vite preview` (issue #399).

## What update merges

`apps/admin/vite.config.ts`, if you edited it. Keep your edits, add the function below `ENV_LOCAL`, and replace the `server` block with the two blocks:

```ts
function portFor(mode: string): number {
  return devPort(
    loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
    3001,
    ENV_LOCAL
  );
}

// inside defineConfig
server: { port: portFor(mode), strictPort: true },
preview: { port: portFor(mode) },
```

## What you do

Nothing.

## Verify

```sh
pnpm --filter @repo/admin build
pnpm --filter @repo/admin preview
```

The preview prints the same port as `pnpm dev` for this app. Stop `pnpm dev` first, because the two share the port.
