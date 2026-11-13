---
title: Auth trusts CORS_ORIGINS only and takes a cookie prefix per worktree
---

This note is one half of a pair. `api/0002-cors-origins-required` makes the same change in `apps/api/src/index.ts`.

## What update does

The `DEV_ORIGINS` list in `packages/auth/src/auth.ts` is gone. Better Auth's `trustedOrigins` is the `CORS_ORIGINS` list and nothing else, the same list the api's CORS spine reads. In dev, `pnpm dev:ports` writes it into `apps/api/.env.local`.

A new optional key, `AUTH_COOKIE_PREFIX`, goes in front of both session cookie names. With `AUTH_COOKIE_PREFIX=wt5ddad8` and an `http:` `BETTER_AUTH_URL`, the cookies are `wt5ddad8-client.session_token` and `wt5ddad8-admin.session_token`. Two linked worktrees on one host then keep separate sessions, because a browser scopes cookies by host and not by port. `pnpm dev:ports` writes the key in a linked worktree and leaves it out in the main checkout. An `https:` `BETTER_AUTH_URL` ignores the key, so production cookie names do not change. A value that does not match `^[a-z0-9-]+$` throws when the Worker starts.

`cookiePrefixes(env)` in `packages/auth/src/env.ts` holds the rule, and `sharedOptions` in `packages/auth/src/auth.ts` reads it. `AUTH_COOKIE_PREFIX` joins `packages/auth/src/env-preset.ts` and `packages/env/.env.example`, marked blank on purpose.

## What the merge plan gets

`packages/auth/src/auth.ts`, if you edited it. Keep your edits, delete `DEV_ORIGINS`, make `trustedOrigins()` return the `CORS_ORIGINS` list alone, and set `cookiePrefix: cookiePrefix[group]` from `const cookiePrefix = cookiePrefixes(authEnv)`. If you added an origin to `DEV_ORIGINS` by hand, put it in `CORS_ORIGINS` instead.

`packages/auth/src/env.ts` and `packages/auth/src/env-preset.ts`, if you edited them. Keep your edits and add `AUTH_COOKIE_PREFIX`.

## What you do

1. Run `saasaloy update` with no module name, so `api` and `auth` both change in one run:

   ```sh
   saasaloy update
   ```

2. Run `pnpm env:setup` once, so `apps/api/.env.local` gets `CORS_ORIGINS` and, in a linked worktree, `AUTH_COOKIE_PREFIX`.

3. Restart `pnpm dev`. In a linked worktree, sign in again: the session cookie has a new name there.

## Verify

```sh
grep -c "DEV_ORIGINS" packages/auth/src/auth.ts
grep -n "cookiePrefixes" packages/auth/src/auth.ts
```

The first command prints `0`. The second prints the import and the module-scope call.
