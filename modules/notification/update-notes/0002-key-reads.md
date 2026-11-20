---
title: The notification reads accept a user's key with notifications:read
---

This note needs `auth/0005-user-caller` and `api/0006-agent-scope`. Apply both first.

## What update does

The three callable reads in `apps/api/src/routes/notifications.ts`, `GET /notifications`, `GET /notifications/unread-count` and `GET /notifications/preferences`, open with `requireUser(c, { notifications: ["read"] })` in place of `requireSession(c)`, and their statements name `scope: "notifications:read"`. A signed-in person gets the same answers as before. With `api-keys-user` installed, a user's key that holds `notifications:read` reads that user's notifications; a key without it gets 403. The three writes stay on `requireSession`, so no key reaches them. With no key module installed nothing changes.

## What update merges

- `apps/api/src/routes/notifications.ts`, if you edited it. Keep your edits and take the `requireUser` import, the `READ` demand and the gate line in each of the three reads.

## What you do

With `api-keys-user`, add `notifications: ["read"]` to `API_KEY_SCOPES` before you issue a key that reads notifications.

## Verify

```sh
pnpm typecheck
grep -c 'requireUser(c, READ)' apps/api/src/routes/notifications.ts
```

The count is 3.
