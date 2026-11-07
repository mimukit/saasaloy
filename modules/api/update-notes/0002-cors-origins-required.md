---
title: The api reads CORS origins from CORS_ORIGINS only
---

This note is one half of a pair. `auth/0002-origins-and-cookie-prefix` makes the same change in `packages/auth/src/auth.ts`.

## What update does

The `DEV_ORIGINS` list in `apps/api/src/index.ts` is gone. The CORS spine allows exactly the origins in `CORS_ORIGINS`, and an origin outside that list gets no CORS headers. There is no localhost fallback any more.

`CORS_ORIGINS` is now required. `apps/api/src/env.ts` refuses an empty value, `packages/env/.env.example` no longer marks it blank on purpose, and `pnpm deploy:production` stops when the production value is empty. The dev default in `packages/env/.env.example` is `http://localhost:3000,http://localhost:3001,http://localhost:3002`, and `pnpm dev:ports` writes this checkout's real list (the localhost and `DEV_HOST` origin of web, admin and app) into `apps/api/.env.local`, which wins over `apps/api/.env`.

## What the merge plan gets

`apps/api/src/index.ts`, if you edited it. Keep your edits, delete `DEV_ORIGINS`, and make the `origin` callback check the `CORS_ORIGINS` list alone. If you added an origin to `DEV_ORIGINS` by hand, put it in `CORS_ORIGINS` instead.

`apps/api/src/env.ts`, if you edited it. `CORS_ORIGINS` takes `.min(1)` in place of `.default("")`.

## What you do

1. Run `saasaloy update` with no module name, so `api` and `auth` both change in one run:

   ```sh
   saasaloy update
   ```

2. Run `pnpm env:setup` once. It fills `CORS_ORIGINS` in `apps/api/.env` and runs `pnpm dev:ports`, which writes the dev list into `apps/api/.env.local`. If `env:setup` reports that the api has no value for `CORS_ORIGINS`, set it in `packages/env/.env` first, for example with `saasaloy env`.

3. Restart `pnpm dev`, so the api reads the new `.env.local`.

4. Check `CORS_ORIGINS` in each deployed environment. It has to name every deployed frontend origin: web, admin and app, as each is installed. An empty value now fails the deploy check rather than falling back to localhost.

## Verify

```sh
grep -n "CORS_ORIGINS" apps/api/.env.local
grep -c "DEV_ORIGINS" apps/api/src/index.ts
```

The first command prints the line `pnpm dev:ports` wrote. The second prints `0`.
