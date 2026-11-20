---
title: The file list accepts a user's key with files:read
---

This note needs `auth/0005-user-caller` and `api/0006-agent-scope`. Apply both first.

## What update does

`GET /files` in `apps/api/src/routes/files.ts` opens with `requireUser(c, { files: ["read"] })` in place of `requireSession(c)`, and its statement names `scope: "files:read"`. A signed-in person gets the same list as before, scoped by the active organization as before. With `api-keys-user` installed, a user's key that holds `files:read` lists the files its user uploaded under the `default` tenant; a key has no active organization. Every other `/files` route stays on `requireSession`.

## What update merges

- `apps/api/src/routes/files.ts`, if you edited it. Keep your edits and take the `requireUser` import and the three lines that build the scope from the caller in `GET /`.

## What you do

With `api-keys-user`, add `files: ["read"]` to `API_KEY_SCOPES` before you issue a key that lists files.

## Verify

```sh
pnpm typecheck
grep -n 'requireUser(c, { files: \["read"\] })' apps/api/src/routes/files.ts
```
