---
title: GET /projects demands project:read
---

This note needs `api/0006-agent-scope`. Apply it first.

## What update does

`GET /projects` in `apps/api/src/routes/projects.ts` opens with `requirePermission(c, { project: ["read"] })` in place of `requireTenant(c)`, and its statement names `scope: "project:read"`. The `owner`, `admin` and `member` roles in `access.ts` all hold `project: ["read"]`, so every member who read the list before still reads it. An organization's key now needs `project:read` in its scope to list projects; before, any key of the organization could.

## What the merge plan gets

- `apps/api/src/routes/projects.ts`, if you edited it. Keep your edits and take the gate line in `GET /` and the comment above the recipe.

## What you do

If you gave a custom role no `project: ["read"]`, its members now get 403 on `GET /projects`; add the statement to the role if they should read the list. Reissue any key that should keep listing projects with `project:read` in its scope.

## Verify

```sh
pnpm typecheck
grep -n 'requirePermission(c, { project: \["read"\] })' apps/api/src/routes/projects.ts
```
