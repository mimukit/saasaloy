---
title: Auth trusts the app origin on port 3002 in development
---

This note is one half of a pair. `api/0001-app-origin` makes the same change in `apps/api/src/index.ts`.

## What update does

`http://localhost:3002` joins the development origin list in `packages/auth/src/auth.ts`, which Better Auth reads as `trustedOrigins`. The `app` module serves `apps/app` on that port. The list now reads:

```ts
const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
];
```

Auth reads the same `CORS_ORIGINS` variable as the api, and a set value replaces this list. Until this update lands, a sign-in from `:3002` fails in development.

## What the merge plan gets

`packages/auth/src/auth.ts`, if you edited it. Keep your edits and add `"http://localhost:3002"` to `DEV_ORIGINS`.

## What you do

1. Run `saasaloy update` with no module name, so `api` and `auth` both change in one run:

   ```sh
   saasaloy update
   ```

2. Check `CORS_ORIGINS` in each deployed environment. A set value replaces the localhost list, so it has to name every deployed frontend origin: web, admin and app, as each is installed.

## Verify

```sh
grep -n "localhost:3002" packages/auth/src/auth.ts
```

The command prints the `DEV_ORIGINS` entry.
