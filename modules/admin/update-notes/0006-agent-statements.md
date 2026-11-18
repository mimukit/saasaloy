---
title: The admin api routes state whether agents may call them
---

This note needs `api/0005-route-contract`, which adds `apps/api/src/contract.ts`. Apply it first, or `pnpm typecheck` fails on the `../contract` import.

## What update does

Each of the 9 routes in `apps/api/src/routes/admin-users.ts`, `apps/api/src/routes/admin-members.ts` and `apps/api/src/routes/admin-audit.ts` gets one `declare({...})` link first after its path: a name, a description and the agent statement. Each one states that agents may not call it. Admin routes are never callable. The `zValidator` imports move from `@hono/zod-validator` to `../contract`, and every call and every failure hook stays as it was.

The link only calls `next()`. Every response, every status and `AppType` stay as they were, and nothing reads the statements until the `agent` module is installed.

## What the merge plan gets

- `apps/api/src/routes/admin-users.ts`, `apps/api/src/routes/admin-members.ts` and `apps/api/src/routes/admin-audit.ts`, if you edited them. Keep your edits and take the `declare(...)` link on each route and the `../contract` import. A route you added yourself needs a link of its own.

## What you do

Nothing beyond the merge. To open a route to agents, set `agent: { callable: true, readOnly, confirm }` and give its `output` schema, as the `saasaloy-api` skill describes. Keep admin, auth and payment callback routes closed.

## Verify

```sh
pnpm typecheck
grep -c 'declare(' apps/api/src/routes/admin-users.ts apps/api/src/routes/admin-members.ts apps/api/src/routes/admin-audit.ts
```

The typecheck passes, and each count matches the number of routes in that file.
