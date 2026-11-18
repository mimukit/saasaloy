---
title: The public ecommerce reads state that they need no key scope
---

This note needs `api/0006-agent-scope`. Apply it first, or `pnpm typecheck` fails on the statements.

## What update does

The callable public reads in `apps/api/src/routes/ecommerce.ts`, `GET /shop/products`, `GET /shop/products/:slug` and `GET /shop/categories`, add `scope: null` to their agent statement: they are public and demand no key. No gate, response or type changes.

## What the merge plan gets

- `apps/api/src/routes/ecommerce.ts`, if you edited it. Keep your edits and take `scope: null` in each callable statement.

## What you do

Nothing.

## Verify

```sh
pnpm typecheck
```
