---
title: The ecommerce api routes state whether agents may call them
---

This note needs `api/0005-route-contract`, which adds `apps/api/src/contract.ts`. Apply it first, or `pnpm typecheck` fails on the `../contract` import.

## What update does

Each of the 42 routes in `apps/api/src/routes/ecommerce.ts` and `apps/api/src/routes/admin-ecommerce.ts` gets one `declare({...})` link first after its path: a name, a description and the agent statement. `GET /shop/products` as `shop_products_list`, `GET /shop/products/:slug` as `shop_product_read` and `GET /shop/categories` as `shop_categories_list` are callable by agents, read only. The other 39 routes state that agents may not call them. The `zValidator` imports move from `@hono/zod-validator` to `../contract`, and every call and every failure hook stays as it was.

The link only calls `next()`. Every response, every status and `AppType` stay as they were, and nothing reads the statements until the `agent` module is installed.

`packages/validators/src/ecommerce.ts` gets the output schemas of the callable routes: `shopProductList`, `shopProduct` and `shopCategoryList`. They describe the bodies the routes already answer.

## What update merges

- `apps/api/src/routes/ecommerce.ts` and `apps/api/src/routes/admin-ecommerce.ts`, if you edited them. Keep your edits and take the `declare(...)` link on each route and the `../contract` import. A route you added yourself needs a link of its own.
- `packages/validators/src/ecommerce.ts`, if you edited it. Keep your edits and take the new output schemas at the end of the file.

## What you do

Nothing beyond the merge. To open a route to agents, set `agent: { callable: true, readOnly, confirm }` and give its `output` schema, as the `saasaloy-api` skill describes. Keep admin, auth and payment callback routes closed.

## Verify

```sh
pnpm typecheck
grep -c 'declare(' apps/api/src/routes/ecommerce.ts apps/api/src/routes/admin-ecommerce.ts
```

The typecheck passes, and each count matches the number of routes in that file.
