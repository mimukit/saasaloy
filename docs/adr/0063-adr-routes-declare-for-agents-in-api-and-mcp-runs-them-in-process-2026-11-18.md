# 0063: Routes declare themselves for agents in api, and MCP runs them in process

Plan [0110](../plans/0110-plan-agent-usable-products-2026-11-17.md) gives every built product an agent surface: an OpenAPI document and an MCP server, both built from one declaration on each api route. Issue [#348](https://github.com/mimukit/saasaloy/issues/348) first proved the parts in a throwaway prototype (its phase 1, on 2026-11-18, with `waitlist`, `database-d1` and a sample `notes` entity), then put the declaration into the `api` module and onto every shipped route (its phase 2). Research [0012](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md) left two claims without a source, that `@modelcontextprotocol/server` 2.x runs on `workerd` and that it serves a client on the old `initialize` handshake; the prototype measured both.

**A route declares itself with one `declare({...})` link from `apps/api/src/contract.ts`, the `api` module's own file, placed first after the path and in front of the route's gate and validators.** The link carries the route's name, a description, its output schema and the agent statement: `{ callable: false, reason }`, or `{ callable: true, readOnly, confirm }`. It is a middleware that only calls `next()`; the statement rides on the function as a property. **The input schema is written once, in the route's validator:** `contract.ts` exports a `zValidator` that is `@hono/zod-validator`'s with the same overloads, hook and failure response, and that records its target and schema on the middleware it returns. A route file swaps one import and keeps every call. `routeContracts(app)` walks a finished app, mounts included, and returns each route's method, full path, statement and validator schemas; the `agent` module reads the statements through it, and a route module never imports `agent`. Every one of the 108 routes that 16 modules ship carries a statement, and `scripts/route-declarations.test.ts` fails on a route without one.

**The MCP server is `@modelcontextprotocol/server` 2.4.0 with `@modelcontextprotocol/hono` 2.0.2, as the plan's "MCP SDK" decision settled.** The adapter's `createMcpHonoApp({ allowedHosts })` makes the `/mcp` sub-app with Host and Origin validation and a JSON body parser, one route on it hands the request to the server's `createMcpHandler` with the parsed body, and the sub-app mounts on `base` after the typed chain, so it stays out of `AppType`. A key check registered in front of the mount answers 401 before the adapter parses the body. It builds one tool for each route whose statement says `callable: true`, and **a `tools/call` runs the route in process** with `app.fetch(new Request(...), c.env, c.executionCtx)` and the caller's `Authorization` header, so the route's validation, gate and error envelope answer the call.

## Status

accepted. The route contract and its shape are final. The MCP wiring records the phase 1 prototype, and the `agent` module (issue #348, phase 3) may amend that part.

## The route contract

```ts
// apps/api/src/contract.ts
export type AgentStatement =
  | { callable: false; reason: string }
  | { callable: true; readOnly: boolean; confirm: boolean };

export type RouteDeclaration = {
  name: string;          // snake_case, unique across the api: the tool name and operationId
  description: string;
  status?: 200 | 201 | 202 | 204;   // the status `output` describes; 200 when absent
} & (
  | { agent: { callable: true; readOnly: boolean; confirm: boolean }; output: ZodType }
  | { agent: { callable: false; reason: string }; output?: ZodType }
);

export function declare(declaration: RouteDeclaration): MiddlewareHandler;
export const zValidator: typeof import("@hono/zod-validator").zValidator;
export function routeContracts(app): RouteContract[];  // { method, path, declaration, input }
export function declarationOf(handler: unknown): RouteDeclaration | undefined;
export function inputOf(handler: unknown): RouteInput | undefined;  // { target, schema }
```

A route reads:

```ts
.get(
  "/",
  declare({
    name: "notifications_list",
    description: "List one page of the caller's notifications, newest first. ...",
    output: notificationList,
    agent: { callable: true, readOnly: true, confirm: false },
  }),
  validateList,   // zValidator("query", notificationListQuery, hook), imported from ../contract
  (c) => ...
)
```

The statements of the shipped routes follow plan 0110's "Shipped module routes" decision. Ten product reads are callable and read only: the notification list, its unread count and the notification preferences, the public CMS list and entry, the storefront's product list, product page and categories, the caller's file list, and the worked example's `GET /projects`. Each other route states that agents may not call it, with a reason: every admin route, both auth catch-alls, the payment callbacks, the probes, the shipped writes, checkout and billing, and the routes that answer bytes or a redirect in place of JSON. The output schemas of the callable reads live in `@repo/validators/<feature>` beside the input schemas, except `projectList`, which sits beside the worked example because `multitenant` ships no validators file.

## Measured results

### The route contract (phase 2)

| Check | Result |
| --- | --- |
| `scripts/route-declarations.test.ts` before any statement | Red: 108 routes in 22 mounted chains, each with 0 statements. |
| The same test with every statement | Green, 9 tests. With the `declare(...)` of `GET /notifications/unread-count` removed it went red and named `notifications.ts:160`; restored, green. |
| `AppType` before and after | Identical. In a full scaffold on each driver, a type-only file compared `AppType` against the same app built from the route files without `declare` (`(<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)`), and `tsc` passed; the same helper reports a changed type as not equal. |
| `pnpm typecheck`, full preset on `database-d1` | Exit 0, 25 tasks. |
| `pnpm typecheck`, full preset plus `ecommerce` on `database-postgres` | Exit 0, 26 tasks. `ecommerce` requires Postgres, so it is only in this scaffold. |
| The api's route tests, full preset on `database-d1` | 20 files, 210 tests passed, `contract.test.ts` included. Every shipped route test ran with the statements in place. |
| Output schemas against the bodies | `hc` response types matched the notification and CMS schemas both ways. `fileList` is narrower than the route's type on `status` and `visibility` (enums where the row type says `string`), on purpose. The shop schemas were checked against the return types of `productCard` and `productPage`, because the shop routes' `hc` body type is loose. |

### MCP on `workerd` (phase 1)

All runs used `wrangler dev` 4.145.0 on `workerd`, serving the Vite build of the api, `compatibility_date` 2026-07-21, with no compatibility flag added. The bundle selects the SDK's `workerd` export condition: it carries `CfWorkerJsonSchemaValidator` and no Ajv, and its worker entry is 1.61 MB raw and 346 KB gzipped with hono-openapi, zod, the MCP server and the adapter in it.

| Check | Result |
| --- | --- |
| `GET /openapi.json` | 200. Paths `/notes` (get `notes_list`, post `notes_create`) and `/waitlist` (post `waitlist_join`, `x-agent.callable: false`). `/health` has no declaration and is absent. |
| Client pinned to 2026-07-28 (`versionNegotiation: { mode: { pin: "2026-07-28" } }`) | Connected at 2026-07-28. `tools/list` returned `notes_list` (`readOnlyHint: true`) and `notes_create`. A create followed by a list returned the new row. |
| Client on the old `initialize` handshake (`mode: "legacy"`) | Connected at 2025-11-25 through the SDK's stateless legacy leg. Same tools, same create and list. A raw `initialize` at 2025-06-18 with curl answered `protocolVersion: "2025-06-18"`, and a raw `tools/list` with no session id answered the tools. |
| Key with `notes:read` only calls `notes_create` | `isError: true`, `structuredContent: { error: { code: "forbidden", message: "This key lacks the notes:write scope." } }`, which is the route's own envelope, on both revisions. |
| `/mcp` with no bearer key | 401 and `{ error: { code: "unauthorized", ... } }`, before the adapter parses the body or a server is built. |
| The adapter's own checks, with a key | A `Host: evil.example` header got 403 `Invalid Host`, an `Origin: https://evil.example` header got 403 `Invalid Origin`, and a malformed body got 400 `Invalid JSON`. This proves the requests ran through `createMcpHonoApp` on `workerd`. |
| `pnpm typecheck` in the playground | Exit 0 across 10 workspaces, with a type-only file that calls `api.notes.$post` and `$get` through `hc<AppType>` and holds a `@ts-expect-error` on a wrong input type. |

The prototype declared its routes with `hono-openapi`'s `describeRoute` and built the document with its `generateSpecs`; phase 2 replaced the first, as the options below say.

Package versions, all exact: `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/hono` 2.0.2, `@modelcontextprotocol/client` 2.4.0 (test client only), `hono-openapi` 1.6.0, `hono` 4.13.12, `zod` 4.6.5, `@hono/zod-validator` 0.9.1, `wrangler` 4.145.0. `@hono/zod-openapi` 1.6.3 was installed only for the comparison below.

## Considered Options

- **`hono-openapi`'s `describeRoute` as the declaration, in `api`.** The phase 1 prototype did this, and it worked. Rejected for the shipped contract, for three reasons. Every project would carry `hono-openapi` in `apps/api` whether it installs `agent` or not, against the plan's "does nothing in a project without `agent`" and ADR 0020's rule that a capability owns its vendor packages. `describeRoute` takes query and path parameters as finished OpenAPI objects, so the prototype ran `z.toJSONSchema` at import time on every route, in every project. And it needed the input schema a second time. `contract.ts` imports no runtime code but `@hono/zod-validator`, which `api` already ships, and every schema conversion waits for the `agent` module.
- **`@hono/zod-openapi` for the declaration.** Rejected, because it changes the shape of every shipped route file. A route becomes a `createRoute({ method, path, request, responses })` object and a `.openapi(route, handler)` link, the `zValidator` failure hook moves to an `OpenAPIHono({ defaultHook })` constructor, and the document only comes from an `OpenAPIHono` parent. `base` in `modules/api/files/src/index.ts` is a typed plain `Hono`, so the spine would change too. The prototype rewrote the waitlist route this way, and it compiled and kept its `hc` type. The rewrite would touch 22 shipped route files.
- **The input schema in `declare` as well as in `zValidator`.** The prototype did this. Rejected, because two copies drift, and the plan says a route declares its schemas one time. A guard test could compare the two by identifier, but a recording `zValidator` removes the second copy instead.
- **`hono-openapi`'s own `validator()` in place of `zValidator`.** Rejected. It would record the input schema too, but its hook receives a Standard Schema result whose `error` is an issue array, so every shipped failure hook that reads `result.error.issues` would change.
- **One statement per route file, or a `.use()` link per sub-app.** Rejected. A tool is one route, and the plan makes exposure "a decision on every route". A file-wide default would also let a new route inherit `callable: true` without anyone deciding it.
- **`createMcpHandler` alone, without `@modelcontextprotocol/hono`.** Rejected. The first prototype run wired it this way and it passed the same checks, but the plan settled the adapter, and the adapter adds DNS rebinding protection (Host and Origin validation) and a bounded JSON body parser that the api spine does not have. It fits the spine: it is a plain `Hono` sub-app, so `.route("/mcp", mcp)` puts it under api's CORS, logger, `onError` and `notFound`.
- **The 1.x SDK with `@hono/mcp`.** Not tried. The 2.x line ran on `workerd`, so the stop rule did not apply, and research 0012 already ruled out the 1.x line for its end date.
- **A tool handler that calls the route's logic as a function.** Rejected by the plan's "One code path" decision, and the prototype shows it is not needed: the in-process request costs one extra pass through CORS and the logger middleware, and nothing else.

## Consequences

- **The declaration costs a project without `agent` one no-op middleware call per route.** The link is in the handler chain, so Hono composes it with the route's own handlers. No response, status or type changes, which the route tests and the `AppType` comparison above show.
- **A route file imports `zValidator` from `../contract`, not from `@hono/zod-validator`.** A route that imports the library directly still works and still typechecks, but its input is invisible to the agent surfaces. A route that reads its input by hand (`c.req.param`, `c.req.json()`) has the same gap; the `agent` module types an unvalidated path parameter as a string from the path.
- **`agent` builds the document from `routeContracts(app)`.** It converts each schema with `z.toJSONSchema` (`io: "input"` for inputs), turns `:id` into `{id}`, and writes the statement as the operation extension `x-agent`. It may hand the result to `hono-openapi` or write the OpenAPI JSON itself; the route contract does not depend on either. A route registered with `.all()` is skipped by the reader, because app-wide middleware registers as `ALL` too.
- **The output schema is written beside the route's body, not derived from it.** Nothing at compile time ties `output` to what the handler returns. The `hc` comparison above is a one-time check, and a change to a callable route's body must change its schema in the same commit.
- **Admin, auth and payment callback routes are closed by test.** `scripts/route-declarations.test.ts` holds them at `callable: false`, holds the plan's named product reads at `callable: true, readOnly: true`, and requires a unique snake_case name, a reason on a closed route, and `output`, `readOnly` and `confirm` on a callable one. It reads the files as text, because the repo's root `node_modules` cannot load a route file. A project gets its own check through `routeContracts` (phase 3).
- **A shipped callable route still opens with its own gate.** The notification and file reads call `requireSession`, which does not read a bearer key, so an MCP call with a key gets the route's 401 until phase 3 gives those routes a gate that does.
- **The SDK checks a tool's input before the route does.** An empty `title` came back as the SDK's "Input validation error" text, not as the route's `invalid_input` envelope. A refused key, a missing row and any other route answer keep the envelope. Phase 3 decides whether to accept that, or to give the SDK a permissive schema so the route's 400 answers every case.
- **The confirm mark has no MCP field.** `ToolAnnotations` has `readOnlyHint` and `destructiveHint`. The prototype put the confirm flag in `_meta` as `saasaloy/confirm` and in `destructiveHint`; phase 3 settles the final form.
- **The adapter's refusals are not the shared envelope.** A bad Host or Origin answers a JSON-RPC error body with 403, and a malformed body answers plain text `Invalid JSON` with 400. These come from the transport layer before any route runs.
- **`allowedHosts` and `allowedOrigins` need the deployed hostnames.** Without `allowedHosts`, the adapter only admits localhost-class Host headers, and without `allowedOrigins` it only admits localhost-class Origin headers (a request with no Origin, as every MCP client sends, passes). The module must build the list from the api's own origin, and the options are fixed when the sub-app is built.
- **The handler is built per request.** `createMcpHandler` takes a factory, and the factory needs the request's `c` for the in-process call, so `/mcp` builds one handler and one `McpServer` on each request. The OpenAPI document is built once per isolate. Both measured at 3 to 24 ms per request in local dev.
- **A legacy request answers over SSE.** `responseMode: "json"` shapes only the 2026-07-28 leg; the stateless legacy leg answers `text/event-stream`, which both test clients read.
- **`zod`'s `.pipe()` loses the target format in the document.** The waitlist `email` schema documents as a plain `string`. A route whose input format matters to an agent declares it with a schema that `z.toJSONSchema` can describe.
- **`wrangler dev` serves the Vite build, not the source.** `vite build` writes `apps/api/dist/` and `.wrangler/deploy/config.json`, which redirects `wrangler dev` to the built config. A source change needs `pnpm --filter @repo/api build` and a wrangler restart. With `dist/` deleted and the redirect file left, `wrangler dev` refuses to start.

## References

Plan: [`0110-plan-agent-usable-products-2026-11-17.md`](../plans/0110-plan-agent-usable-products-2026-11-17.md), decisions "One definition for every surface", "Where the route contract lives", "One code path", "MCP SDK", "The declaration library", "Exposure is a decision on every route" and "Shipped module routes". Research: [`0012-research-mcp-oauth-for-built-products-2026-11-17.md`](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md). Prior: [ADR 0028](0028-adr-routes-register-by-chained-route-patch-2026-08-28.md), the chained-route registration that `AppType` depends on; ADR 0020, a capability owns its vendor packages; [ADR 0058](0058-adr-update-notes-ship-beside-their-code-and-ride-the-merge-plan-2026-10-30.md), the update notes that carry the route changes to existing projects (`api/0005-route-contract` and one `agent-statements` note in each route module). Issue [#348](https://github.com/mimukit/saasaloy/issues/348), phases 1 and 2.
