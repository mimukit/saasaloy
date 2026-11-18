---
title: GET /projects asks an organization's key for project:read
---

This note needs `api/0005-route-contract` and `api/0006-agent-scope`. Apply both first.

## What update does

`GET /projects` in `apps/api/src/routes/projects.ts` still opens with `requireTenant(c)`, and its statement names `scope: "project:read"`. When the caller is an organization's key, the route then runs `can()` with `{ project: ["read"] }` and refuses a key without that scope with 403 `permission required: project:read`. A signed-in member gets exactly the answer `requireTenant` gave before, whatever their role holds: the scope limits a key and never a person.

With testing on, the project also gets `apps/api/src/routes/projects.test.ts`, which proves a member whose custom role has no `project:read` still lists the projects.

## What the merge plan gets

- `apps/api/src/routes/projects.ts`, if you edited it. Keep your edits and take the `can` and `requireTenant` imports, the key check in `GET /`, and the comment above the recipe.

## What you do

Reissue any organization key that should keep listing projects with `project:read` in its scope. A key issued before this update without it now gets 403 on `GET /projects`.

## Verify

```sh
pnpm typecheck
grep -n 'tenant.principal.kind === "apiKey"' apps/api/src/routes/projects.ts
```
