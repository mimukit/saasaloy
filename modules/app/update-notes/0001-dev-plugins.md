---
title: apps/app takes the devGzip and restartOnLockfile dev plugins
---

## What update does

`apps/app/vite.config.ts` imports `devGzip` and `restartOnLockfile` from `@repo/tooling/vite` and adds both to the end of `plugins`. `devGzip()` gzips what the dev server sends, which cuts a cold load over a remote connection to about a quarter of the bytes. `restartOnLockfile()` restarts the dev server when `pnpm-lock.yaml` changes, because Vite 8 keeps a failed import cached after the package is installed. Both run under `vite dev` only. `apps/app/package.json` gets `@repo/tooling` as a devDependency.

This needs the base template's `@repo/tooling/vite` export, which the base note `0002-dev-stop-and-dev-plugins` adds.

## What the merge plan gets

`apps/app/vite.config.ts` and `apps/app/package.json`, if you edited them. Keep your edits, add the import line, and add these two entries after `tailwindcss()` in `plugins`:

```ts
devGzip(),
restartOnLockfile(),
```

Add `"@repo/tooling": "workspace:*"` to the devDependencies.

## What you do

1. Run `pnpm install`, so `apps/app` links `@repo/tooling`.

## Verify

```sh
pnpm --filter @repo/app typecheck
pnpm --filter @repo/app build
```

Both pass. Then start `pnpm dev`, run `touch pnpm-lock.yaml` in a second terminal, and check that the app dev server prints `pnpm-lock.yaml changed, restarting so new packages resolve.`
