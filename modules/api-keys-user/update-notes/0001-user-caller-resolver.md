---
title: A user's key acts as its user on requireUser routes
---

This note needs `auth/0005-user-caller`, which adds `packages/auth/src/user-caller.ts`. Apply it first, or the row below has no table to go into.

## What update does

`packages/auth/src/caller.ts` exports `apiKeyUser()`, a resolver for `requireUser` that runs the same key check `requireCaller` runs: the same hash lookup, the same banned-owner refusal and the same 401 `invalid api key`. The module's new row of the `userCaller.resolvers` table puts `apiKeyUser()` into `packages/auth/src/user-caller.generated.ts`, which `userResolvers` in `packages/auth/src/user-caller.ts` spreads.

From then on a route that opens with `requireUser` accepts a bearer key its user owns, limited to the key's scope. The shipped `GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/preferences` and `GET /files` open that way. `requireCaller` and `requireScope` are unchanged.

## What update merges

- `packages/auth/src/caller.ts`, if you edited it. Keep your edits and take the `apiKeyUser` export and its `UserResolver` type import.

## What you do

Add the scope words a key may hold to `API_KEY_SCOPES` in `packages/auth/src/api-key-scopes.ts` before you issue one: `notifications: ["read"]` and `files: ["read"]` for the shipped reads. A key issued earlier keeps the scope it was issued with.

## Verify

```sh
pnpm typecheck
grep -n "apiKeyUser" packages/auth/src/user-caller.generated.ts
```

Then `curl -H "Authorization: Bearer <key>" <api>/notifications` answers 200 with a key that holds `notifications:read`, and 403 `permission required: notifications:read` with one that does not.
