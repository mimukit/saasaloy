---
title: Give each worktree its own dev ports with pnpm dev:ports
version: 0.9.0
---

Apply this note before you run `saasaloy add` or `saasaloy update` for `api`, `admin`, `app` or `email-react` from the new registry. Those modules now add a `SERVICES` row with a `devPort` field, and `packages/env/src/services.ts` must declare that field first. Without it, the new row fails `pnpm typecheck` with an unknown-property error.

## What update does

- `packages/env/src/services.ts`: the `Service` type gets an optional `devPort` field, the port the service's dev server listens on in the main checkout. The `web` row gets `devPort: 3000`. A new file-less row, `dev-ports`, holds the `DEV_HOST` key.
- `packages/env/src/dev-port.ts` exports `devPort(value, fallback, file)`. A dev config passes it `DEV_PORT` and its pinned port. An unset value gives the pinned port, and a bad value throws and names the file. `packages/env/package.json` exports it as `@repo/env/dev-port`.
- `packages/env/src/dev-ports.ts` and `packages/env/scripts/dev-ports.ts` add `pnpm dev:ports`. The main checkout keeps the pinned ports. A linked worktree takes a block of ten ports from 10000 up, hashed from its root path and moved past a block that is in use. The command writes `DEV_PORT`, the origin keys (`PUBLIC_API_URL`, `PUBLIC_SITE_URL`, `BETTER_AUTH_URL`, `CORS_ORIGINS`) and, in a linked worktree, `AUTH_COOKIE_PREFIX` into a `# >>> dev:ports` block in each service's `.env.local`. It records the result in `.devports.json` at the root. `--host <name>` sets the host for one run, and `--clean` removes every block and the record. Tests sit beside both files.
- `packages/env/scripts/env-setup.ts` runs `dev:ports` at the end of every dev run. A `dev:ports` failure makes `env:setup` exit 1.
- `packages/env/.env.example` gets a "Dev ports" section with `DEV_HOST=localhost`.
- The root `package.json` gets `"dev:ports": "node packages/env/scripts/dev-ports.ts"`. Its `test` and `typecheck` scripts gain `--concurrency=4`, so turbo runs at most four workspaces at a time.
- `.gitignore` lists `.devports.json`.
- `apps/web/astro.config.mjs` reads `DEV_PORT` with Vite's `loadEnv` and `devPort()`, with 3000 as the fallback, and keeps `strictPort`. `apps/web/package.json` gets `vite` 8.3.1 as a devDependency, because `apps/web` could not resolve `vite` for the `loadEnv` import before.
- `AGENTS.md`: the "Dev Port Map" section now covers `DEV_PORT`, `pnpm dev:ports`, `DEV_HOST` and `.devports.json`, and its rules ask for `devPort` on a new `SERVICES` row in place of the hard-coded allow-lists. A new `## Worktree setup` section declares the worktree `setup:`, `update:`, `teardown:` and `watch:` blocks. New rules cover testing on the real origin, one session per worktree, a restart after an install, and `pnpm dev:stop`. `packages/ui/AGENTS.md` and the `saasaloy-env` and `saasaloy-config` skills follow.

The api and auth halves of this change are in `api/0002-cors-origins-required` and `auth/0002-origins-and-cookie-prefix`. The dev configs of the modules are in `admin/0002-dev-port`, `app/0002-dev-port`, `api/0004-dev-port`, `email-react/0002-dev-wrapper` and `e2e/0001-devports-record`.

## What the merge plan gets

- `packages/env/src/services.ts`, if you edited it. Keep your rows, add the `devPort?: number` field to `Service`, add `devPort: 3000` to the `web` row, and add `{ name: "dev-ports", environment: "dev", omit: [] }` to `SERVICES`.
- `packages/env/package.json`, if you edited it. Take the `./dev-port` and `./dev-ports` entries in `exports`.
- `packages/env/scripts/env-setup.ts`, if you edited it. Take the block that starts `dev-ports.ts` after a dev run.
- The root `package.json`, if you edited it. Keep your scripts, add the `dev:ports` script, and add `--concurrency=4` to `turbo run test` and `turbo run typecheck`.
- `.gitignore`, if you edited it. Add the `.devports.json` line.
- `apps/web/astro.config.mjs` and `apps/web/package.json`, if you edited them. Take the `loadEnv` and `devPort` imports, the `PORT` constant, `server.port: PORT`, and the `vite` devDependency.
- `AGENTS.md`, if you edited it. Take the new "Dev Port Map" text, the `## Worktree setup` section and the new rules. Delete the old "Update both allow-lists" rule.

## What you do

1. Run `pnpm install`, so `apps/web` gets `vite`.
2. Run `pnpm env:setup`. It writes each service's `.env` and then runs `pnpm dev:ports`. In the main checkout the ports stay as they were.
3. On a remote dev box, set `DEV_HOST` in `packages/env/.env` to the name the browser uses, such as `DEV_HOST=devaloy`, and run `pnpm dev:ports`. With `auth` installed, also give `BETTER_AUTH_SECRET` a value, because a non-loopback `BETTER_AUTH_URL` refuses the development default.
4. In each linked worktree, run `pnpm env:setup`, then restart `pnpm dev` there. A dev server does not watch `.env.local`.
5. If you added a dev server of your own, add `devPort` to its `SERVICES` row (3000 to 3004 for a frontend, 4000 to 4004 for a backend) and read `DEV_PORT` in its dev config with `loadEnv` and `devPort()`. `pnpm dev:ports` fails on a `devPort` outside those ranges.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm dev:ports
cat .devports.json
```

`pnpm dev:ports` prints each service's port and URL. In the main checkout `.devports.json` shows `"block": null` and the pinned ports. In a linked worktree it shows a block number and ports from 10000 up, and `grep -A8 ">>> dev:ports" apps/web/.env.local` shows the same `DEV_PORT`.
