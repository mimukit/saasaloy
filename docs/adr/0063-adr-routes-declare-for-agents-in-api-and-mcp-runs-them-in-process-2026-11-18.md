# 0063: Routes declare themselves for agents in api with hono-openapi, and MCP runs them in process

Plan [0110](../plans/0110-plan-agent-usable-products-2026-11-17.md) gives every built product an agent surface: an OpenAPI document and an MCP server, both built from one declaration on each api route. Issue [#348](https://github.com/mimukit/saasaloy/issues/348) first proved the parts in a throwaway prototype (its phase 1, on 2026-11-18, with `waitlist`, `database-d1` and a sample `notes` entity), then put the declaration into the `api` module and onto every shipped route (its phase 2). Research [0012](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md) left two claims without a source, that `@modelcontextprotocol/server` 2.x runs on `workerd` and that it serves a client on the old `initialize` handshake; the prototype measured both.

**The declaration library is `hono-openapi` 1.6.0, pinned exactly in `apps/api/package.json`, as phase 1 picked it. A route declares itself with one `declare({...})` link from `apps/api/src/contract.ts`, placed first after the path and in front of the route's gate and validators.** The link carries the route's name, a description, its output schema and the agent statement: `{ callable: false, reason }`, or `{ callable: true, readOnly, confirm }`. `declare` is `hono-openapi`'s `describeRoute`, filled in from the statement: `operationId` is the name, the output schema is the success response through `resolver()`, the statement is the operation extension `x-agent`, and a closed route is `hide: true`. It is a middleware that only calls `next()`. **The input schema is written once, in the route's validator:** `contract.ts` exports a `zValidator` that is `@hono/zod-validator`'s with the same overloads, hook and failure response, and that puts on its middleware the same marker `hono-openapi`'s own `validator()` writes (`target` plus `resolver(schema)`). `generateSpecs(app)` therefore merges each route's query, path and body schemas into its operation. A route file swaps one import and keeps every call and failure hook. `routeContracts(app)` walks a finished app, mounts included, and returns each route's method, full path, statement and validator schemas, for the MCP tool list and for a project's guard test; a route module never imports `agent`. Every one of the 108 routes that 16 modules ship carries a statement, and `scripts/route-declarations.test.ts` fails on a route without one.

**The MCP server is `@modelcontextprotocol/server` 2.4.0 with `@modelcontextprotocol/hono` 2.0.2, as the plan's "MCP SDK" decision settled, and the `agent` module ships it (phase 3).** `apps/api/src/routes/agent.ts` is one chain mounted on `base` at `/` by a `chained-route` patch, so `/openapi.json`, `/llms.txt`, `/mcp/server-card` and `/mcp` stay out of `AppType`. On `/mcp` it runs, in order: a bearer check that answers 401 before any work, a Host and Origin check, the `agentGuards` table (the rate limit when `ratelimit` is installed), a bounded JSON body read, then the adapter's `createMcpHonoApp({ allowedHosts, allowedOrigins })` sub-app, then one handler that builds a server per request with `createMcpHandler(..., { legacy: "stateless", responseMode: "json" })`. It builds one tool for each route whose statement says `callable: true`, and **a `tools/call` runs the route in process** with `app.fetch(new Request(...), c.env, c.executionCtx)` and the caller's `Authorization` header, so the route's validation, gate and error envelope answer the call.

## Status

accepted. The route contract and its shape are final. Phase 3 amended the MCP part to the wiring the `agent` module ships; the section "The agent module (phase 3)" records it.

## The route contract

```ts
// apps/api/src/contract.ts
export type AgentStatement =
  | { callable: false; reason: string }
  | { callable: true; readOnly: boolean; confirm: boolean; scope: string | null };

export type RouteDeclaration = {
  name: string;          // snake_case, unique across the api: the tool name and operationId
  description: string;
  status?: 200 | 201 | 202 | 204;   // the status `output` describes; 200 when absent
} & (
  | { agent: { callable: true; readOnly: boolean; confirm: boolean; scope: string | null }; output: ZodType }
  | { agent: { callable: false; reason: string }; output?: ZodType }
);

export const AGENT_EXTENSION = "x-agent";
export function declare(declaration: RouteDeclaration): MiddlewareHandler;  // describeRoute({ operationId, description, responses, hide, "x-agent" })
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
    agent: { callable: true, readOnly: true, confirm: false, scope: "notifications:read" },
  }),
  validateList,   // zValidator("query", notificationListQuery, hook), imported from ../contract
  (c) => ...
)
```

The statements of the shipped routes follow plan 0110's "Shipped module routes" decision. Ten product reads are callable and read only: the notification list, its unread count and the notification preferences, the public CMS list and entry, the storefront's product list, product page and categories, the caller's file list, and the worked example's `GET /projects`. Each other route states that agents may not call it, with a reason: every admin route, both auth catch-alls, the payment callbacks, the probes, the shipped writes, checkout and billing, and the routes that answer bytes or a redirect in place of JSON. The output schemas of the callable reads live in `@repo/validators/<feature>` beside the input schemas, except `projectList`, which sits beside the worked example because `multitenant` ships no validators file.

## The agent module (phase 3)

These choices settled the parts phases 1 and 2 left open.

- **The statement names its scope.** The callable branch carries `scope: string | null`: the `resource:action` word the route's gate demands, or `null` for a public read. The tool's `_meta` and its `llms.txt` line show it. The gate enforces it, so the two are written together, and `scripts/route-declarations.test.ts` holds each shipped callable read to its word.
- **A user route accepts a key through `requireUser`.** The shipped callable reads used `requireSession`, which never reads a bearer key. `auth` now ships `requireUser(c, demand)` and a `userResolvers` table in `packages/auth/src/user-caller.ts`. With the table empty it is `requireSession`, so swapping it in opens a route to no new caller. `api-keys-user` appends its key as a resolver, so a user's key acts as its user, limited to its scope. `api-keys-organization` appends nothing: an organization's key acts for no user, and a user route refuses it with 401 as before. An organization route keeps `requirePermission`, and `GET /projects` now demands `project:read` there. A later caller kind, such as an OAuth grant, is one more resolver.
- **The route checks every argument.** The SDK validates a tool's input before the tool runs and answers a plain text error. The tool's input schema is a Standard Schema that advertises the route's JSON Schema and passes any object through, so a wrong argument gets the route's own `400 invalid_input` envelope.
- **Confirm rides in `destructiveHint` and `_meta`.** MCP `ToolAnnotations` has `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, and no field for "a person must agree". A tool sets `readOnlyHint` from the statement, `destructiveHint` to `confirm` on a write, and `_meta` to `{ "saasaloy/confirm", "saasaloy/scope" }`.
- **Every refusal is the shared envelope.** The bearer check, the Host and Origin check and the body read run before the adapter, with the SDK's own `validateHostHeader`, `validateOriginHeader` and `readRequestBody` and the same lists, and throw `HTTPException`, which api's `onError` renders. The adapter's JSON-RPC 403 and its plain text `Invalid JSON` never fire; it stays as the second line.
- **The host lists come from the api's own origin.** `allowedHosts` is the hostname of `BETTER_AUTH_URL` plus the loopback names; `allowedOrigins` adds the hostnames of `CORS_ORIGINS`. Both are read once from `cloudflare:workers`' `env` when the route module loads.
- **The surfaces read the finished app by a lazy import.** `routes/agent.ts` is imported by `index.ts`, so it loads `index.ts`'s default export with `await import("../index")` on the first request. The document is cached per app and rebuilt when the route count changes. Vite reports the import as `INEFFECTIVE_DYNAMIC_IMPORT`, which is expected: the module is already in the bundle.
- **Discovery.** `GET /mcp/server-card` answers a Server Card (SEP-2127, schema v1) as `application/mcp-server-card+json`, with `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600`, a reverse-DNS name from the api host, one `streamable-http` remote with a required secret `Authorization` header, the SDK's `SUPPORTED_PROTOCOL_VERSIONS`, and no tool list. `GET /llms.txt` names the document, the MCP address, the key sign-in and each tool with its scope and marks.
- **Rate limits through a guard table.** `apps/api/src/agent/guards.ts` holds `agentGuards`. When `ratelimit` is installed, `agent` ships `apps/api/src/agent/ratelimit.ts` and a `plugin-array` patch with `when: { installed: ["ratelimit"] }` appends `mcpRateLimit()` (the `default` policy). `saasaloy add ratelimit` later backfills both.
- **The project keeps the guard.** `apps/api/src/agent/statements.test.ts`, shipped under the testing mode, reads `routeContracts(app)` and fails `pnpm test` on a route with no statement, a repeated name, a scope that is not `resource:action`, an open admin route, or a tool list that cannot be built.

Phase 3 measured, on `wrangler dev` in the playground with `database-d1`: with `api-keys-user`, both client revisions (2026-07-28 and the `initialize` handshake at 2025-11-25) listed the sample `notes` tools and the shipped notification reads, created a note and listed it back, and got `forbidden` `permission required: notes:delete` and `notes:write` for keys without those scopes; a user key read `GET /notifications` over HTTP and through MCP. With `api-keys-organization`, the same calls ran with organization keys, and `projects_list` answered with `project:read` and refused without it. No key gave 401, a foreign Host or Origin 403, a malformed body 400, all in the envelope, and with `ratelimit` added the 101st `/mcp` request in a minute got 429 with `Retry-After`.

## Measured results

### The route contract (phase 2)

| Check | Result |
| --- | --- |
| `scripts/route-declarations.test.ts` before any statement | Red: 108 routes in 22 mounted chains, each with 0 statements. |
| The same test with every statement | Green, 9 tests. With the `declare(...)` of `GET /notifications/unread-count` removed it went red and named `notifications.ts:160`; restored, green. |
| `AppType` before and after | Identical. In a full scaffold on each driver, a type-only file compared `AppType` against the same app built from the route files without `declare` (`(<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)`), and `tsc` passed; the same helper reports a changed type as not equal. |
| `pnpm typecheck`, full preset on `database-d1` | Exit 0, 25 tasks. |
| `pnpm typecheck`, full preset plus `ecommerce` on `database-postgres` | Exit 0, 26 tasks. `ecommerce` requires Postgres, so it is only in this scaffold. |
| The api's route tests, full preset on `database-d1` | 20 files, 215 tests passed with `declare` on `describeRoute`, `contract.test.ts` included. Every shipped route test ran with the statements in place. `contract.test.ts` builds a document with `generateSpecs` and reads `operationId`, `x-agent` and the query parameter the recorded `zValidator` supplied, sees the closed and the undeclared routes absent, and serves a route whose output schema no converter knows, which proves nothing is converted until a document is built. |
| `AppType` with `hono-openapi` | Identical to the app built from the route files before phase 2 (commit 27d03d86), by the same `Equal` check, on `database-d1`. |
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

The prototype declared its routes with `hono-openapi`'s `describeRoute` and built the document with its `generateSpecs`. Phase 2 keeps both and moves `describeRoute` behind `declare`, so a route states its input schema one time.

Package versions, all exact: `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/hono` 2.0.2, `@modelcontextprotocol/client` 2.4.0 (test client only), `hono-openapi` 1.6.0, `hono` 4.13.12, `zod` 4.6.5, `@hono/zod-validator` 0.9.1, `wrangler` 4.145.0. `@hono/zod-openapi` 1.6.3 was installed only for the comparison below.

## Considered Options

- **A zero-dependency `declare` of Saasaloy's own, with the document library left to `agent`.** The first phase 2 draft did this. Rejected, because the plan's settled "The declaration library" row has phase 1 pick between `hono-openapi` and `@hono/zod-openapi`, and phase 1 picked `hono-openapi`. The draft's worries did not hold: `describeRoute` and `resolver()` convert nothing until `generateSpecs` runs, so no JSON Schema is built at import, and the validator marker carries the query and path parameters that the prototype converted by hand. The cost that stays is the package itself in every project's `apps/api`, with or without `agent`.
- **The prototype's `declare`, which built query and path parameters with `z.toJSONSchema` when the route module loaded.** Rejected: that is a schema conversion at import in every project, and it took the input schema a second time.
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
- **`agent` builds the document with `hono-openapi`'s `generateSpecs(app)`.** The library walks the app, mounts included, turns `:id` into `{id}`, resolves each `resolver()` lazily, and merges the recorded validator schemas into each operation. A closed route is hidden by default; `includeHiddenRoutes: true` lists every route. `defaultValidationErrorResponse: false` keeps the library's own 400 schema out, because the api's 400 is the shared envelope. The tool list reads the `x-agent` extension of each operation, or `routeContracts(app)`; both come from the same link. `routeContracts` skips a route registered with `.all()`, because app-wide middleware registers as `ALL` too.
- **Every project ships `hono-openapi` in `apps/api`.** It adds no runtime work without `agent`: the links only call `next()`, and the library's converters load on the first `generateSpecs` call. A d1 full scaffold's api bundle was 3,116.57 KB raw with it. An earlier phase 2 scaffold without it was 3,265.24 KB, but the two builds were not otherwise identical, so the package's own size is not isolated here.
- **The output schema is written beside the route's body, not derived from it.** Nothing at compile time ties `output` to what the handler returns. The `hc` comparison above is a one-time check, and a change to a callable route's body must change its schema in the same commit.
- **Admin, auth and payment callback routes are closed by test.** `scripts/route-declarations.test.ts` holds them at `callable: false`, holds the plan's named product reads at `callable: true, readOnly: true`, and requires a unique snake_case name, a reason on a closed route, and `output`, `readOnly` and `confirm` on a callable one. It reads the files as text, because the repo's root `node_modules` cannot load a route file. A project gets its own check through `routeContracts` (phase 3).
- **A shipped callable route still opens with its own gate.** Phase 3 moved the notification and file reads from `requireSession` to `requireUser`, which reads a user's key when `api-keys-user` is installed and is `requireSession` otherwise.
- **The route, not the SDK, checks a tool's input.** In phase 1 an empty `title` came back as the SDK's "Input validation error" text. Phase 3 passes every object argument through to the route, so the route's `invalid_input` envelope answers.
- **The confirm mark has no MCP field.** It rides in `destructiveHint` and in `_meta["saasaloy/confirm"]`; a client that reads neither does not ask its user.
- **The adapter's own refusals stay behind the module's checks.** Its JSON-RPC 403 and its plain text `Invalid JSON` only answer if the two lists ever differ, which they do not today.
- **`/mcp` answers only on the api's own hostname and the loopback names.** A deployment with no `BETTER_AUTH_URL`, or a second hostname such as the `workers.dev` one, gets 403 `Invalid Host`.
- **A key's validity is checked by the route, not by `/mcp`.** `/mcp` only checks that a bearer header is there. A public read answers through MCP whatever the key, as it does over HTTP, and every gated route verifies the key itself.
- **The handler is built per request.** `createMcpHandler` takes a factory, and the factory needs the request's `c` for the in-process call, so `/mcp` builds one handler and one `McpServer` on each request. The OpenAPI document is built once per isolate. Both measured at 3 to 24 ms per request in local dev.
- **A legacy request answers over SSE.** `responseMode: "json"` shapes only the 2026-07-28 leg; the stateless legacy leg answers `text/event-stream`, which both test clients read.
- **`zod`'s `.pipe()` loses the target format in the document.** The waitlist `email` schema documents as a plain `string`. A route whose input format matters to an agent declares it with a schema that `z.toJSONSchema` can describe.
- **`wrangler dev` serves the Vite build, not the source.** `vite build` writes `apps/api/dist/` and `.wrangler/deploy/config.json`, which redirects `wrangler dev` to the built config. A source change needs `pnpm --filter @repo/api build` and a wrangler restart. With `dist/` deleted and the redirect file left, `wrangler dev` refuses to start.

## References

Plan: [`0110-plan-agent-usable-products-2026-11-17.md`](../plans/0110-plan-agent-usable-products-2026-11-17.md), decisions "One definition for every surface", "Where the route contract lives", "One code path", "MCP SDK", "The declaration library", "Exposure is a decision on every route" and "Shipped module routes". Research: [`0012-research-mcp-oauth-for-built-products-2026-11-17.md`](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md). Prior: [ADR 0028](0028-adr-routes-register-by-chained-route-patch-2026-08-28.md), the chained-route registration that `AppType` depends on; ADR 0020, a capability owns its vendor packages; [ADR 0058](0058-adr-update-notes-ship-beside-their-code-and-ride-the-merge-plan-2026-10-30.md), the update notes that carry the route changes to existing projects (`api/0005-route-contract` and one `agent-statements` note in each route module). Issue [#348](https://github.com/mimukit/saasaloy/issues/348), phases 1, 2 and 3. SEP-2127, MCP Server Cards, with the wire format in `modelcontextprotocol/experimental-ext-server-card` (`schema.ts`, `docs/discovery.md`).
