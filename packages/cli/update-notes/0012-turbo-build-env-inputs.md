---
title: The turbo build hash includes the env files and PUBLIC_* variables
version: 0.13.0
---

Before this change, `turbo run build` did not include `.env`, `.env.local` or a `PUBLIC_*` process variable in the build hash. The `.env` files are gitignored, so turbo does not hash them by default. A build reads its `PUBLIC_*` origins from those files, and Vite gives a `PUBLIC_*` process variable priority over them. So a change to an origin could still give a cache hit, and turbo restored a `dist` with the old origins. The e2e suite's built mode (issue #399) builds through turbo, and it needs a hash that sees these changes.

## What update does

`turbo.json` gets two keys on the `build` task:

```json
"inputs": ["$TURBO_DEFAULT$", ".env", ".env.local"],
"env": ["PUBLIC_*"],
```

`$TURBO_DEFAULT$` keeps every file turbo hashed before. `.env` and `.env.local` are read from each workspace, so a changed value in `apps/<app>/.env` or a new `DEV_PORT` in `apps/<app>/.env.local` causes a cache miss for that app. `env` adds every `PUBLIC_*` process variable to the hash and passes it to the build.

`pnpm deploy:production` is not affected, because `env-deploy` runs each app's `build` script directly, not through turbo.

## What update merges

`turbo.json`, if you edited the `build` task. Keep your edits, and add the two keys above. If your `build` task already has `inputs`, add `".env"` and `".env.local"` to it, and keep `"$TURBO_DEFAULT$"` as the first entry.

## What you do

Nothing. The next `pnpm build` gets a cache miss for each app once, because the hash changed.

## Verify

```sh
pnpm turbo run build --filter=@repo/web --dry | grep -A3 '^@repo/web#build' | grep Hash
echo "PUBLIC_UPDATE_PROBE=1" >> apps/web/.env
pnpm turbo run build --filter=@repo/web --dry | grep -A3 '^@repo/web#build' | grep Hash
```

Compare the two `Hash` lines. The second one is different after the new line in `apps/web/.env`. Remove the `PUBLIC_UPDATE_PROBE` line afterward.
