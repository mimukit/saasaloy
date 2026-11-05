---
title: apps/api restarts its dev server after an install
---

## What update does

`apps/api/vite.config.ts` imports `restartOnLockfile` from `@repo/tooling/vite` and adds it after `cloudflare()` in `plugins`. It restarts the dev server when `pnpm-lock.yaml` changes, because Vite 8 keeps a failed import cached after the package is installed. It runs under `vite dev` only. `apps/api/package.json` gets `@repo/tooling` as a devDependency.

This needs the base template's `@repo/tooling/vite` export, which the base note `0002-dev-stop-and-dev-plugins` adds.

## What the merge plan gets

`apps/api/vite.config.ts` and `apps/api/package.json`, if you edited them. Keep your edits, add the import line, and make `plugins` read `[cloudflare(), restartOnLockfile()]`. Add `"@repo/tooling": "workspace:*"` to the devDependencies.

## What you do

1. Run `pnpm install`, so `apps/api` links `@repo/tooling`.

## Verify

```sh
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api build
```

Both pass. Then start `pnpm dev`, run `touch pnpm-lock.yaml` in a second terminal, and check that the api dev server prints `pnpm-lock.yaml changed, restarting so new packages resolve.`
