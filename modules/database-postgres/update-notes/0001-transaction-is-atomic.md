---
title: TRANSACTION_IS_ATOMIC is gone from @repo/db/client
---

`@repo/db/client` exported `TRANSACTION_IS_ATOMIC`, a constant that was always `true` once Postgres became the only database. Code read it to choose between a rollback and a fallback for a database with no interactive transaction. That fallback can no longer run, so the constant is removed.

## What update does

`packages/db/src/client.ts` no longer exports `TRANSACTION_IS_ATOMIC`. `apps/api/src/lib/admin-write.ts` (the `admin` module) no longer reads it: a failed audit insert always rolls the change back and rethrows.

## What update merges

`packages/db/src/client.ts`, if you edited it. Keep your edits and drop the `TRANSACTION_IS_ATOMIC` export and its doc comment.

## What you do

Find every reader of the constant in your own code:

```sh
git grep -n TRANSACTION_IS_ATOMIC -- apps packages
```

For each one, keep the branch the `true` value took and delete the other branch and the import. `transaction(db, body)` from `@repo/db/client` always rolls back on a throw.

## Verify

```sh
git grep -n TRANSACTION_IS_ATOMIC -- apps packages
pnpm typecheck
```

The first command prints nothing. `pnpm typecheck` passes.
