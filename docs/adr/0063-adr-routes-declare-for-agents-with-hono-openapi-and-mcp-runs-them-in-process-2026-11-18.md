# 0063: Routes declare themselves for agents with hono-openapi, and MCP runs them in process

Plan [0110](../plans/0110-plan-agent-usable-products-2026-11-17.md) gives every built product an agent surface: an OpenAPI document and an MCP server, both built from one declaration on each api route. Its phase 2 (issue [#348](https://github.com/mimukit/saasaloy/issues/348), phase 1) had to answer four questions before any module code: which library carries the declaration, whether `@modelcontextprotocol/server` 2.x runs on `workerd`, whether it serves a client on spec revision 2026-07-28 and a client on the older `initialize` handshake, and whether a tool call can run the route itself. Research [0012](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md) left the `workerd` and the old-handshake claims without a source. A throwaway prototype in `.dev/playground` measured all four on 2026-11-18, with `waitlist` and `database-d1` installed and one sample entity, `notes`, with a list and a create route.

**A route declares itself with one `declare({...})` middleware link from `hono-openapi`, placed in front of its own `zValidator`.** The link carries the tool name, a description, the input and output schemas and the agent statement, and it calls `next()` at request time. `generateSpecs` from `hono-openapi` walks the finished app, mounted sub-apps included, and writes an OpenAPI 3.1 document; the agent statement travels as the operation extension `x-agent`. A route with no link is not in the document. **The MCP server is `@modelcontextprotocol/server` 2.4.0 through its own `createMcpHandler`, mounted on `base` as an untyped sub-app.** It builds one tool for each operation whose `x-agent` says `callable: true`, and **a `tools/call` runs the route in process** with `app.fetch(new Request(...), c.env, c.executionCtx)` and the caller's `Authorization` header, so the route's validation, gate and error envelope answer the call.

## Status

Proposed. Phase 2 of issue #348 turns the prototype into the `api` declaration and phase 3 into the `agent` module; either may amend this record.

## Measured results

All runs used `wrangler dev` 4.145.0 on `workerd`, `compatibility_date` 2026-07-21, with no compatibility flag added. The bundle selects the SDK's `workerd` export condition: it carries `CfWorkerJsonSchemaValidator` and no Ajv, and it is 1.73 MB raw and 341 KB gzipped with hono-openapi, zod and the MCP server in it.

| Check | Result |
| --- | --- |
| `GET /openapi.json` | 200. Paths `/notes` (get `notes_list`, post `notes_create`) and `/waitlist` (post `waitlist_join`, `x-agent.callable: false`). `/health` has no declaration and is absent. |
| Client pinned to 2026-07-28 (`versionNegotiation: { mode: { pin: "2026-07-28" } }`) | Connected at 2026-07-28. `tools/list` returned `notes_list` (`readOnlyHint: true`) and `notes_create`. A create followed by a list returned the new row. |
| Client on the old `initialize` handshake (`mode: "legacy"`) | Connected at 2025-11-25 through the SDK's stateless legacy leg. Same tools, same create and list. A raw `initialize` at 2025-06-18 with curl answered `protocolVersion: "2025-06-18"`, and a raw `tools/list` with no session id answered the tools. |
| Key with `notes:read` only calls `notes_create` | `isError: true`, `structuredContent: { error: { code: "forbidden", message: "This key lacks the notes:write scope." } }`, which is the route's own envelope, on both revisions. |
| `/mcp` with no bearer key | 401 and `{ error: { code: "unauthorized", ... } }`, before a server is built. |
| `pnpm typecheck` in the playground | Exit 0 across 10 workspaces. `apps/web`'s existing `WaitlistForm` call is unchanged, and a new type-only file calls `api.notes.$post` and `$get` through `hc<AppType>`, reads `row.id` from the 201 body, and holds a `@ts-expect-error` on a wrong input type. |

Package versions, all exact: `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0 (test client only), `hono-openapi` 1.6.0, `hono` 4.13.12, `zod` 4.6.5, `@hono/zod-validator` 0.9.1, `wrangler` 4.145.0. `@hono/zod-openapi` 1.6.3 was installed only for the comparison below.

## Considered Options

- **`@hono/zod-openapi` for the declaration.** Rejected, because it changes the shape of every shipped route file. A route becomes a `createRoute({ method, path, request, responses })` object and a `.openapi(route, handler)` link, the `zValidator` failure hook moves to an `OpenAPIHono({ defaultHook })` constructor, and the document only comes from an `OpenAPIHono` parent. `base` in `modules/api/files/src/index.ts` is a typed plain `Hono`, so the spine would change too. The prototype rewrote the waitlist route this way, and it compiled and kept its `hc` type. The rewrite would touch 22 shipped route files, 11 of which make 44 `zValidator` calls, where `hono-openapi` adds one link to each route and leaves the rest of each file alone.
- **`hono-openapi`'s own `validator()` in place of `zValidator`.** Rejected for now. It would read the input schema from the validator and save the second mention in `declare`, but its hook receives a Standard Schema result whose `error` is an issue array, so every shipped failure hook that reads `result.error.issues` would change. `declare` takes the same schema object the route's `zValidator` takes, and the phase 2 guard test can check that the two match.
- **`@modelcontextprotocol/hono` 2.0.2 as the adapter.** Not needed. Its `createMcpHonoApp` makes a new Hono app with a body parser and host validation, and the api already has its own spine. `createMcpHandler(factory).fetch(c.req.raw)` inside one Hono route is the whole wiring. The adapter stays an option if phase 3 wants its `hostHeaderValidation`.
- **The 1.x SDK with `@hono/mcp`.** Not tried. The 2.x line ran on `workerd`, so the stop rule did not apply, and research 0012 already ruled out the 1.x line for its end date.
- **A tool handler that calls the route's logic as a function.** Rejected by the plan's "One code path" decision, and the prototype shows it is not needed: the in-process request costs one extra pass through CORS and the logger middleware, and nothing else.

## Consequences

- **The tool list comes from the OpenAPI document, not from the route modules.** `toolsFrom(doc)` reads each callable operation, merges its path and query parameters and its JSON body into one flat input object, and maps them back when it builds the request. The MCP layer imports no route and no zod schema; it hands the SDK a JSON Schema through `fromJsonSchema`. A parameter name that is also a body field name would collide, and phase 3 has to refuse that at build time.
- **The SDK checks a tool's input before the route does.** An empty `title` came back as the SDK's "Input validation error" text, not as the route's `invalid_input` envelope. A refused key, a missing row and any other route answer keep the envelope. Phase 3 decides whether to accept that, or to give the SDK a permissive schema so the route's 400 answers every case.
- **The confirm mark has no MCP field.** `ToolAnnotations` has `readOnlyHint` and `destructiveHint`. The prototype put the confirm flag in `_meta` as `saasaloy/confirm` and in `destructiveHint`; phase 3 settles the final form.
- **The handler is built per request.** `createMcpHandler` takes a factory, and the factory needs the request's `c` for the in-process call, so `/mcp` builds one handler and one `McpServer` on each request. The OpenAPI document is built once per isolate. Both measured at 3 to 24 ms per request in local dev.
- **A legacy request answers over SSE.** `responseMode: "json"` shapes only the 2026-07-28 leg; the stateless legacy leg answers `text/event-stream`, which both test clients read.
- **`zod`'s `.pipe()` loses the target format in the document.** The waitlist `email` schema documents as a plain `string`. A route whose input format matters to an agent declares it with a schema that `z.toJSONSchema` can describe.
- **`wrangler dev` builds once through the Vite plugin.** It writes `apps/api/dist/` and serves that, so a source change needs a restart. The playground's own `pnpm dev` runs `vite dev` and is not affected.

## References

Plan: [`0110-plan-agent-usable-products-2026-11-17.md`](../plans/0110-plan-agent-usable-products-2026-11-17.md), decisions "One definition for every surface", "One code path", "MCP SDK", "The declaration library". Research: [`0012-research-mcp-oauth-for-built-products-2026-11-17.md`](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md). Prior: [ADR 0028](0028-adr-routes-register-by-chained-route-patch-2026-08-28.md), the chained-route registration that `AppType` depends on. Issue [#348](https://github.com/mimukit/saasaloy/issues/348), phase 1.
