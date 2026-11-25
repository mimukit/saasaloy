---
title: vite preview in apps/app uses the dev port
---

## What update does

`apps/app/vite.config.ts` gets a `portFor(mode)` function that returns the `DEV_PORT` from `apps/app/.env.local`, or 3002 when it is unset. The `server` block and a new `preview` block both call it. `vite preview` takes `strictPort`, `cors` and `host` from `server`, but its port defaults to 4173, so before this change a built app answered on 4173 and not on the origin that `pnpm dev:ports` wrote into the other apps' env. The e2e suite's built mode serves the built app with `vite preview` (issue #399).

The `preview` script in `apps/app/package.json` becomes `vite preview --host`, like `dev`, so a built app also answers on a non-loopback host from `pnpm dev:ports --host <host>`.

## What update merges

`apps/app/package.json`, if you edited its `preview` script. Add `--host` to it.

`apps/app/vite.config.ts`, if you edited it. Keep your edits, add the function below `ENV_LOCAL`, and replace the `server` block with the two blocks:

```ts
function portFor(mode: string): number {
  return devPort(
    loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
    3002,
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
pnpm --filter @repo/app build
pnpm --filter @repo/app preview
```

The preview prints the same port as `pnpm dev` for this app. Stop `pnpm dev` first, because the two share the port.
