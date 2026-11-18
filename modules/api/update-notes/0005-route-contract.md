---
title: Every api route can state whether agents may call it
---

## What update does

`saasaloy update` adds `apps/api/src/contract.ts`, the route contract of plan 0110 and ADR 0063. It exports:

- `declare({ name, description, output?, status?, agent })`, a middleware link that holds a route's agent statement. It is `hono-openapi`'s `describeRoute`: the name becomes the `operationId`, the output schema the success response, the statement the `x-agent` extension, and a closed route is hidden from the document. It only calls `next()`, and it adds no input and no response type to the chain, so `AppType` and every response stay as they were.
- `zValidator`, which is `@hono/zod-validator`'s `zValidator` with the same overloads, hook and failure response. It also records its target and schema on the middleware it returns, in the shape `hono-openapi`'s own `validator()` uses, so `generateSpecs` reads the input and a route writes its input schema one time.
- `routeContracts(app)`, `declarationOf(handler)` and `inputOf(handler)`, which read the statements back from a finished app. Nothing calls them until the `agent` module is installed.

A project with the testing mode on also gets `apps/api/src/contract.test.ts`, which proves the link changes no response and that the reader finds each statement through a `.route()` mount.

The `saasaloy-api` and `saasaloy-validators` skills now show a route with its `declare(...)` link and with `zValidator` imported from `../contract`.

`apps/api/package.json` gets one new dependency, `hono-openapi` pinned at `1.6.0`. Nothing converts a schema until a document is built: `describeRoute` and `resolver()` only keep the schema, and nothing calls `generateSpecs` until the `agent` module is installed.

## What the merge plan gets

`apps/api/package.json`, if you edited it. Keep your edits and add `"hono-openapi": "1.6.0"` to `dependencies`. `contract.ts` is a new file. Each module that ships api routes has its own note for its route files, such as `notification/0001-agent-statements`.

## What you do

1. Run the update for `api` before, or with, the modules that ship routes. Their new route files import `../contract`, and `pnpm typecheck` fails until it exists:

   ```sh
   saasaloy update
   pnpm install
   ```

2. Give each route you wrote yourself a statement. Add one `declare({...})` link first after the path, and swap the `zValidator` import in that file from `@hono/zod-validator` to `../contract`. A route that agents may not call reads:

   ```ts
   declare({
     name: "widgets_list",
     description: "List the caller's widgets, newest first.",
     agent: { callable: false, reason: "Not opened to agents yet." },
   }),
   ```

   A callable route gives `agent: { callable: true, readOnly, confirm }` and its `output` schema. The `saasaloy-api` skill, "Every route states whether agents may call it", has the rules.

## Verify

```sh
pnpm typecheck
grep -rLn 'declare(' apps/api/src/routes --include='*.ts' --exclude='*.test.ts'
```

The typecheck passes. The `grep` prints only route helper files that hold no route chain, such as a test fixture.
