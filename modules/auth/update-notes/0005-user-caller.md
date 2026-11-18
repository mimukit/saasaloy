---
title: A user route can accept a key caller through requireUser
---

## What update does

`packages/auth` gets two files and one export:

- `src/user-caller.ts` exports `requireUser(c, demand)` and the `userResolvers` table. `requireUser` returns `{ userId, principal, activeOrganizationId }` for the user a request acts for, then refuses with 403 `permission required: <resource>:<action>` when the caller's credential lacks a demanded pair. With an empty table it reads the session and nothing else, exactly as `requireSession` does, and a person passes every demand.
- `src/user-caller-rules.ts` holds the import-free rule `demandDenial`, the same rule and refusal text as `api-keys-user`'s `keyAllows` and `teams`' `can()`.
- `package.json` exports `./user-caller`.

A credential module adds a caller kind by appending a resolver to `userResolvers` with a `plugin-array` patch. `api-keys-user` appends its key; `api-keys-organization` appends nothing, because an organization's key acts for no user.

## What the merge plan gets

- `packages/auth/package.json`, if you edited it. Keep your edits and take the `./user-caller` export.

## What you do

Nothing. A route you wrote keeps `requireSession` until you choose to let an agent call it; then open it with `requireUser(c, { <resource>: ["<action>"] })` and name the same scope in its statement. The `saasaloy-agent` skill has the recipe.

## Verify

```sh
pnpm typecheck
grep -n "export const userResolvers" packages/auth/src/user-caller.ts
```

The typecheck passes and the table is there.
