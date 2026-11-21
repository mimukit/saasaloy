---
title: The cms api routes state whether agents may call them
---

This note needs `api/0005-route-contract`, which adds `apps/api/src/contract.ts`. Apply it first, or `pnpm typecheck` fails on the `../contract` import.

## What update does

Each of the 13 routes in `apps/api/src/routes/cms.ts` gets one `declare({...})` link first after its path: a name, a description and the agent statement. `GET /cms/:collection/entries` as `cms_entries_list` and `GET /cms/:collection/entries/:slug` as `cms_entry_read` are callable by agents, read only. The other 11 routes state that agents may not call them. The `zValidator` import moves from `@hono/zod-validator` to `../contract`, and every call and every failure hook stays as it was.

The link only calls `next()`. Every response, every status and `AppType` stay as they were, and nothing reads the statements until the `agent` module is installed.

`packages/validators/src/cms.ts` gets the output schemas of the callable routes: `cmsPublicList` and `cmsPublicEntry`. They describe the bodies the routes already answer.

## What update merges

- `apps/api/src/routes/cms.ts`, if you edited it. Keep your edits and take the `declare(...)` link on each route and the `../contract` import. A route you added yourself needs a link of its own.
- `packages/validators/src/cms.ts`, if you edited it. Keep your edits and take the new output schemas at the end of the file.

## What you do

Nothing beyond the merge. To open a route to agents, set `agent: { callable: true, readOnly, confirm }` and give its `output` schema, as the `saasaloy-api` skill describes. Keep admin, auth and payment callback routes closed.

## Verify

```sh
pnpm typecheck
grep -c 'declare(' apps/api/src/routes/cms.ts
```

The typecheck passes, and each count matches the number of routes in that file.
