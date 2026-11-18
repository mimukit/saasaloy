---
title: A user route can accept a key caller through requireUser
---

## What update does

`packages/auth` gets two files and one export:

- `src/user-caller.ts` exports `requireUser(c, demand)` and the `userResolvers` table. `requireUser` returns `{ userId, principal, activeOrganizationId }` for the user a request acts for. A signed-in session decides first, exactly as `requireSession` does, and a person passes every demand, so every caller `requireSession` admitted is still admitted. Only a request with no session goes to a resolver, and its credential gets 403 `permission required: <resource>:<action>` when it lacks a demanded pair. With an empty table it is `requireSession`.
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
