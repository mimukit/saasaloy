---
title: Add pnpm dev:stop, the @repo/tooling/vite dev plugins and two plain-http helpers
version: 0.9.0
---

## What update does

- The root `package.json` gets a `dev:stop` script, `node packages/tooling/src/dev-stop.ts`. It stops the `pnpm dev` servers of this checkout and leaves every other worktree's servers running. It finds them by the ports in `.devports.json` (the pinned ports when there is none) and by dev processes whose working directory is inside the checkout, then stops each one and its children with SIGTERM, and SIGKILL after 5 s.
- `packages/tooling` gets `src/dev-stop.ts`, a `src/vite/` folder and an `exports` map with one entry, `"./vite"`. `@repo/tooling/vite` exports `devGzip()`, which gzips the dev server's responses, and `restartOnLockfile()`, which restarts a Vite dev server when `pnpm-lock.yaml` changes. Both run under `vite dev` only. `vite` 8.3.1 joins the package's devDependencies for the plugin types.
- `apps/web/package.json` gets `@repo/tooling` as a devDependency, and `apps/web/astro.config.mjs` adds `devGzip()` to `vite.plugins`. The web app does not take `restartOnLockfile()`, because a bare Vite restart under `astro dev` replaces the watcher that Astro's own config reload listens on. Restart `pnpm dev` by hand after an install there.
- `packages/ui/src/lib/random-id.ts` exports `randomId()`, a v4 UUID built on `crypto.getRandomValues()`. `packages/ui/src/lib/clipboard.ts` exports `copyText(text)`, which falls back to a hidden textarea and the copy command. Both work on a plain-http page that is not localhost, where `crypto.randomUUID()` and `navigator.clipboard` are missing. Each ships with a test beside it.

## What the merge plan gets

- The root `package.json`, if you edited it. Keep your scripts and add `"dev:stop": "node packages/tooling/src/dev-stop.ts"`.
- `packages/tooling/package.json`, if you edited it. Take the `exports` block and the `vite` devDependency.
- `apps/web/package.json` and `apps/web/astro.config.mjs`, if you edited them. Take the `@repo/tooling` devDependency, the `devGzip` import and the `devGzip()` entry in `vite.plugins`.

## What you do

1. Run `pnpm install`, so `apps/web` links `@repo/tooling` and `packages/tooling` gets `vite`.
2. In browser code of your own, replace `crypto.randomUUID()` with `randomId()` from `@repo/ui/lib/random-id`, and `navigator.clipboard.writeText(text)` with `copyText(text)` from `@repo/ui/lib/clipboard`. `copyText` rejects when the copy fails, as `writeText` does. This command lists the places to check:

   ```sh
   grep -rnE "crypto\.randomUUID|navigator\.clipboard" apps packages --include=*.ts --include=*.tsx --include=*.astro
   ```

   Leave server code alone: a Worker or a Node script has `crypto.randomUUID()` in every context.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm dev:stop
```

`pnpm test` runs the new tests in `packages/tooling` and `packages/ui`. With nothing running, `pnpm dev:stop` prints `dev:stop: nothing runs in this checkout.` and exits 0. Start `pnpm dev`, run `pnpm dev:stop` from a second terminal, and check that each dev port is free again.
