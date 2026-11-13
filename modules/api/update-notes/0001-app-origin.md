---
title: The api allows the app origin on port 3002 in development
---

This note is one half of a pair. `auth/0001-app-origin` makes the same change in `packages/auth/src/auth.ts`.

## What update does

`http://localhost:3002` joins the development origin list in `apps/api/src/index.ts`, ready for the `app` module, which serves `apps/app` on that port. The list now reads:

```ts
const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
];
```

The `CORS_ORIGINS` description now says that a set value replaces the localhost list rather than adding to it. Until this update lands, a request from `:3002` fails CORS in development.

## What the merge plan gets

`apps/api/src/index.ts`, if you edited it. Keep your edits and add `"http://localhost:3002"` to `DEV_ORIGINS`.

## What you do

1. Run `saasaloy update` with no module name, so `api` and `auth` both change in one run:

   ```sh
   saasaloy update
   ```

2. Check `CORS_ORIGINS` in each deployed environment. A set value replaces the localhost list, so it has to name every deployed frontend origin: web, admin and app, as each is installed. Add the app's origin when you deploy `apps/app`.

## Verify

```sh
grep -n "localhost:3002" apps/api/src/index.ts
```

The command prints the `DEV_ORIGINS` entry.
