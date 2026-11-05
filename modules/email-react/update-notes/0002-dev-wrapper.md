---
title: The email preview reads its port from DEV_PORT
---

## What update does

The `dev` script in `packages/email-react/package.json` becomes `node scripts/dev.ts`. The new `scripts/dev.ts` reads `DEV_PORT` from `packages/email-react/.env.local` and starts `email dev --dir src/templates --port <port>`. Unset, the port is 3003, as before. A bad value fails at startup and names the file. In a linked worktree `pnpm dev:ports` writes a port of its own into that file, so two checkouts run the preview at the same time.

The module now adds an `email-react` row to `SERVICES` in `packages/env/src/services.ts`, with `file: "packages/email-react/.env"` and `devPort: 3003`. `packages/email-react/package.json` gets `@repo/env` and `@types/node` 26.6.3 as devDependencies, and `tsconfig.json` adds `scripts` to `include` and `node` to `types`.

This needs the base template's `devPort` field and `@repo/env/dev-port` export, which the base note `base/0003-dev-ports` adds. Apply that note first, or the new row fails `pnpm typecheck`. The note `email-react/0001-preview-port` names the old `email dev --port 3003` script; this note replaces that script.

## What the merge plan gets

`packages/email-react/package.json`, if you edited it. Keep your edits, set `"dev": "node scripts/dev.ts"`, and add the two devDependencies.

`packages/email-react/tsconfig.json`, if you edited it. Add `"scripts"` to `include` and `"types": ["node"]` to `compilerOptions`.

`packages/env/src/services.ts`, if `saasaloy update` could not add the row. Add it by hand:

```ts
{
  name: "email-react",
  file: "packages/email-react/.env",
  environment: "dev",
  omit: [],
  devPort: 3003,
},
```

## What you do

1. Run `pnpm install`, so `packages/email-react` links `@repo/env`.
2. Run `pnpm env:setup`. It writes `packages/email-react/.env` and runs `pnpm dev:ports`, which writes the `DEV_PORT` block into `packages/email-react/.env.local`.

## Verify

```sh
pnpm --filter @repo/email-react typecheck
pnpm --filter @repo/email-react dev
```

The typecheck passes. The second command starts the preview on `http://localhost:3003` in the main checkout, or on the port `.devports.json` records in a linked worktree. Stop it with Ctrl-C when it is up.
