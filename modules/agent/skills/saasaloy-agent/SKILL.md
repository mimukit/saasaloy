---
name: saasaloy-agent
description: Runbook for the agent module, which makes the product usable by AI agents with a key. It serves /openapi.json, /llms.txt, the MCP endpoint /mcp and its Server Card, all built from the declare(...) statement on each api route. Use when making an entity callable by agents, adding a scope word, gating a route for a key caller with requireUser or requirePermission, connecting Cursor, Claude Code or Codex to a product, reading a 401, 403 or 429 from /mcp, changing the product description agents see, or rate limiting /mcp before a launch.
---

# agent

`agent` gives a built product an agent surface. An agent that holds an API key lists the product's tools and calls them, and every tool is an api route that already exists. Plan 0110 and ADR 0063 record the design.

| Address on the api origin | What it answers |
| --- | --- |
| `GET /openapi.json` | The OpenAPI 3.1 document of every route an agent may call, with its input and output schemas and its `x-agent` statement. No key needed. |
| `GET /llms.txt` | Plain text: the product, the addresses below, how to send a key, and one line per tool with its scope. No key needed. |
| `POST /mcp` | The MCP server (Streamable HTTP, stateless). One tool per callable route. Needs `Authorization: Bearer <key>`. |
| `GET /mcp/server-card` | The MCP Server Card (SEP-2127): where and how to connect, no tool list. `application/mcp-server-card+json`, open to any origin. No key needed. |

## One code path

A tool call is an in-process request to the route the tool came from, with the caller's own `Authorization` header: `app.fetch(new Request(...), c.env, c.executionCtx)`. The route's validator, its gate, its scope check and its error envelope answer, exactly as over HTTP. So:

- A wrong argument gets the route's `400 invalid_input` envelope. The MCP server passes every object argument through to the route and checks nothing of its own.
- A key without the scope gets the route's `403 forbidden`, `permission required: notes:write`, as the tool result with `isError: true`.
- A key that fails gets the route's `401 unauthorized`, `invalid api key`.
- `/mcp` with no bearer header at all answers `401` before it reads the body or builds a server.

The tool never decides who may do what. If a route is reachable over HTTP with a key, the tool is too, and the other way round.

## Make an entity callable: the four parts

Each entity action an agent may call needs four things, written in the same change:

1. **The screen** in `apps/app`, so a person can do the same thing.
2. **The route with its statement.** `declare({...})` from `../contract` first after the path, callable, with `output`, `readOnly`, `confirm` and `scope`. A delete or anything that moves money is `confirm: true`. See the `saasaloy-api` skill for the statement.
3. **The scope words in the key vocabulary**, one per action, written `resource:action`: `books:read`, `books:write`, and a separate `books:delete`. Where they live depends on the key owner module (below).
4. **The entry in the agent documents.** There is nothing to write by hand: `/openapi.json`, `/llms.txt` and the MCP tool list are built from the statement. Read `/llms.txt` once to check the tool's line reads well; its `description` is what an agent picks the tool by.

```ts
.post(
  "/",
  declare({
    name: "books_create",
    description: "Add one book to the caller's shelf and return it.",
    output: book,
    status: 201,
    agent: { callable: true, readOnly: false, confirm: false, scope: "books:write" },
  }),
  validBook,
  async (c) => {
    const { userId } = await requireUser(c, { books: ["write"] });
    // ...
  }
)
```

The scope in the statement and the demand in the gate must name the same pair. The statement only names it, for the tool list and `llms.txt`; the gate enforces it.

## The gate a callable route opens with

Which gate depends on whose data the route touches.

| The route acts for | Gate | A key it accepts | The vocabulary |
| --- | --- | --- | --- |
| one signed-in user | `requireUser(c, { books: ["read"] })` from `@repo/auth/user-caller` | a user's key, with `api-keys-user` | `API_KEY_SCOPES` in `packages/auth/src/api-key-scopes.ts` |
| one organization | `requirePermission(c, { books: ["read"] })` from `@repo/auth/permissions` | an organization's key, with `api-keys-organization` | the statements in `packages/auth/src/access.ts` |
| nobody (a public read) | none; `scope: null` in the statement | any key, and no key | none |

`requireUser` is `requireSession` for a person: with no key module it reads the session and nothing else, and a person passes every demand. `api-keys-user` registers its key as a caller kind in `userResolvers` (`packages/auth/src/user-caller.ts`), so a user's key then acts as that user, limited to its scope. An organization's key acts for no user, so `requireUser` refuses it with the same 401 a signed-out caller gets. A later caller kind, such as an OAuth grant, registers one more resolver and changes no route.

Add the scope words to the vocabulary before you issue a key that holds them:

```ts
// packages/auth/src/api-key-scopes.ts (api-keys-user)
export const API_KEY_SCOPES: Readonly<Record<string, readonly string[]>> = {
  books: ["read", "write", "delete"],
  notifications: ["read"],
  files: ["read"],
};
```

Under `api-keys-organization` the words go into `statements` in `packages/auth/src/access.ts` and into each role that may hand them to a key; a key can never hold more than the member who issued it.

## The shipped reads an agent may call

| Tool | Route | Scope |
| --- | --- | --- |
| `notifications_list`, `notifications_unread_count`, `notification_preferences_read` | `GET /notifications`, `/notifications/unread-count`, `/notifications/preferences` | `notifications:read` |
| `files_list` | `GET /files` | `files:read` |
| `projects_list` | `GET /projects` | `project:read` |
| `cms_entries_list`, `cms_entry_read` | `GET /cms/:collection/entries[/:slug]` | public |
| `shop_products_list`, `shop_product_read`, `shop_categories_list` | `GET /shop/...` | public |

`API_KEY_SCOPES` ships empty, so a user's key reads notifications or files only after you add `notifications: ["read"]` or `files: ["read"]` to it. Every shipped write stays closed.

## Connect an agent

Give the agent the MCP address and a key. The key is made by a person in the product, and its plaintext shows one time.

- Claude Code: `claude mcp add --transport http <name> https://api.example.com/mcp --header "Authorization: Bearer sk_..."`
- Cursor, `.cursor/mcp.json`: `{ "mcpServers": { "<name>": { "url": "https://api.example.com/mcp", "headers": { "Authorization": "Bearer sk_..." } } } }`
- Codex, `~/.codex/config.toml`: `[mcp_servers.<name>]` with `url = "https://api.example.com/mcp"` and `bearer_token_env_var = "<NAME>_KEY"`.

The server answers the 2026-07-28 revision and the older `initialize` handshake. The older leg answers over SSE.

## What the product says about itself

The `agent` config section, in `packages/config/src/sections/agent.ts`. Override it in `packages/config/src/project.ts`:

```ts
export const project: ProjectOverride = {
  agent: {
    description: "Ledgerly keeps a small team's invoices and reminds late payers.",
    version: "1.2.0",
  },
};
```

`description` is the OpenAPI `info.description`, the MCP server's instructions, the first line of `llms.txt` and the Server Card's description (first 100 characters). `version` goes on all of them; raise it when a tool changes its input or its output. The product name comes from `app.name`.

## Before a public launch

- **Add `ratelimit`.** `saasaloy add ratelimit` puts one budget on `/mcp`: the `default` policy, counted per client address, answered with api's `429 rate_limited` envelope and `Retry-After` before the body is read. `agent` ships `apps/api/src/agent/ratelimit.ts` and appends `mcpRateLimit()` to `agentGuards` in `apps/api/src/agent/guards.ts` only while `ratelimit` is installed; without it `/mcp` has no limit.
- **Set `BETTER_AUTH_URL`** to the api's public origin. `/mcp` answers only on that hostname and on the loopback names, and refuses any other `Host` with `403 Invalid Host`. A browser `Origin` must be the api or one of `CORS_ORIGINS`. An MCP client sends no `Origin`, so it always passes that check.
- **Give each delete its own scope**, off by default on the key form.

## Tests

With testing on, `agent` ships two route tests into `apps/api`:

- `src/routes/agent.test.ts` adds a sample entity to the app and calls `/openapi.json`, `/llms.txt`, `/mcp/server-card` and `/mcp` (no key, a foreign host, a malformed body, `tools/list`, a create then a list, a missing scope, a failed key, a wrong argument).
- `src/agent/statements.test.ts` fails `pnpm test` when any api route has no `declare(...)` statement, names one twice, writes a scope that is not `resource:action`, or opens an admin route. It also builds the tool list, so a tool whose path, query and body share a field name fails here.

## Troubleshooting

| Answer | Cause |
| --- | --- |
| `401` `A key is required` from `/mcp` | No `Authorization: Bearer` header. |
| A tool result `401 invalid api key` | The key is unknown, revoked, disabled or expired, or its owner is banned. |
| A tool result `401 sign in first` | The route gates on `requireSession`, or on `requireUser` with no resolver that claims the key: an organization's key on a user route, or `api-keys-user` missing. |
| A tool result `403 permission required: x:y` | The key lacks the scope. Issue a new key; a key's scope is fixed when it is made. |
| `403 Invalid Host` from `/mcp` | `BETTER_AUTH_URL` does not name the host the request used. |
| A tool missing from `tools/list` | Its statement is `callable: false`, or it registers with `.all()`, which the surfaces skip. |
| A 500 on every `/mcp` call naming a tool that "takes a field twice" | A path, query or body field shares a name with another; rename one. `statements.test.ts` catches it. |

## What `remove` leaves behind

`saasaloy remove agent` takes the mount, the files and the config section out. It leaves `@modelcontextprotocol/server` and `@modelcontextprotocol/hono` in `apps/api/package.json`; drop both by hand and run `pnpm install`. Statements on your routes stay and do nothing. The api-keys tables and every issued key stay until you remove the key owner module.

## Next

Run `saasaloy-api-keys` to issue the key an agent connects with, and `saasaloy-ratelimit` before a public launch.
