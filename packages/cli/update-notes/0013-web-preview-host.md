---
title: astro preview in apps/web listens on every interface
version: 0.13.0
---

## What update does

The `preview` script in `apps/web/package.json` becomes `astro preview --host 0.0.0.0`. The `dev` script already passes `--host`, so the dev server answers on a non-loopback host from `pnpm dev:ports --host <host>`, but the preview listened on localhost only. The e2e suite's built mode serves the built site with this script (issue #399). Astro 7's `astro preview` ignores a bare `--host`, so the script names `0.0.0.0`.

## What update merges

`apps/web/package.json`, if you edited its `preview` script. Keep your edits and add `--host 0.0.0.0` to it.

## What you do

Nothing.

## Verify

```sh
pnpm --filter @repo/web build
pnpm --filter @repo/web preview
```

The preview prints a `Network` address beside `Local`.
