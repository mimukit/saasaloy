# Plan: every built product is usable by AI agents

Grilled: 2026-11-17

Created on 2026-11-17. Sister plan: [0109](0109-plan-agent-native-build-workflow-2026-11-17.md), which covers how an agent builds the product. This plan covers how outside agents use the product after it is built. Background: [research 0011](../research/0011-research-agent-native-readiness-2026-11-17.md), [research 0012](../research/0012-research-mcp-oauth-for-built-products-2026-11-17.md), and the checks of UI SDK and BuilderIO/agent-native on the same day.

## Context

The owner expects that most people will soon have a personal AI agent and will tell it to do work in web apps. A SaaS product that an agent cannot use will lose those users. So every product built with Saasaloy must be usable by an agent by default, with no extra work from the project owner.

A built product has none of this today. Its api has typed Hono routes with zod schemas and a shared error envelope, and nothing describes those routes to an outside caller. There is no OpenAPI document, no MCP server and no `llms.txt`. The `api-keys-user` module gives a bearer key, and no screen in `app` lets a user make one (issue #231).

Version 1 serves an agent that can hold a key: a coding agent such as Cursor, Claude Code or Codex, or a script. Research 0012 found that ChatGPT accepts no key, and that Claude accepts one only in a beta. Those two need an OAuth sign-in. The owner moved OAuth to a later plan on 2026-11-17, so the personal assistants of the vision are not served by this plan.

The users are the customer of a built product, the agent that works for that customer, and the project owner who gets all of it without a decision.

Target: every agent benchmark line passes on 3 briefs, with new lines where a second agent uses the built product through its agent surface (the owner's number, 2026-11-17; baseline 1 of 7 lines on one brief, 2026-10-24, `docs/research/0005-research-agent-bench-baseline-2026-10-24.md`; no agent-use line exists today).

## Design decisions (settled)

Each row says how it was settled on 2026-11-17: by the owner before the grill, asked in the grill, or taken as a grill default that the owner did not change.

| Decision | Resolution |
|----------|-----------|
| Version 1 surface | An OpenAPI document, an `llms.txt` and an MCP server with key sign-in. OAuth sign-in leaves this plan and gets one `needs-planning` issue that links research 0012. Asked, and it replaces the owner's earlier pick of OAuth as the last phase. |
| Home | One new module, `agent`, at the `mvp` stage. The unattended build installs it, so every built product has it, and an owner can remove it. The base only gets the public files for the landing site. Owner. |
| Plan shape | Two plans. This one does not wait for plan 0109, except in its last phase. Owner. |
| UI SDK (`vercel-labs/ui`) | Not adopted. It is a beta from 2026-11-12, and its agent bridge needs every component rebuilt on its primitives. Check it again at a 1.0 release, or when WebMCP is on by default in a stable browser. Owner informed. |
| BuilderIO/agent-native | Not adopted as a framework. It owns the app and conflicts with Hono, TanStack Router, D1 and the two auth instances. Five ideas are taken, and each row below that uses one says so. Owner informed. |
| One definition for every surface | A route declares its description, its input and output schemas and its agent flags one time. The OpenAPI entry and the MCP tool both come from that declaration. Idea from agent-native's `defineAction`. Default. |
| Where the route contract lives | In the `api` module, because every route module already depends on it. The declaration does nothing in a project without `agent`. The `agent` module reads it. A route module never depends on `agent`. Default. |
| One code path | An MCP tool call runs the same Hono route in process, with the caller's key. Validation, the auth gate, the scope check and the error envelope are the route's own. Default. |
| MCP SDK | `@modelcontextprotocol/server` 2.x with `@modelcontextprotocol/hono`. It is the stable line and implements spec revision 2026-07-28. `@hono/mcp` needs the 1.x line, which has an end date. Default, from research 0012. |
| The declaration library | Phase 2 picks between `hono-openapi` and `@hono/zod-openapi`. The one that keeps the shipped route files in their present shape wins. Default. |
| The prototype fails on Workers | Phase 2 stops and returns the design to the owner. Default. |
| Exposure is a decision on every route | A route states that agents may call it, or that they may not. It also states if it only reads and if a person must confirm it. A shipped guard test fails on a route with no statement. Admin routes are never callable. Ideas from agent-native's exposure flags and its parity guard. Default. |
| Shipped module routes | Not callable, except product reads such as the notification list and public CMS pages. Auth, admin and payment callback routes stay closed. Default. |
| Entity actions | Each action that the Feature stage builds is callable, and each has its own scope, such as `books:read`, `books:write` and `books:delete`. The key form selects the read and write scopes and leaves each delete scope off until the user ticks it. Asked. |
| Scope words | One vocabulary, `API_KEY_SCOPES`, written as `resource:action`. A later OAuth plan uses the same words. Default. |
| Who the caller is | The present caller gate of the key owner module. Key sign-in works with `api-keys-user` and with `api-keys-organization`, because a tool call runs the route's own gate. The gate keeps room for a third kind of caller. Default. |
| The default build | The unattended build names `agent`, `api-keys` and `api-keys-user` in its `add` call, as it names `database-d1`. `api-keys` stays a `scale` module. Default. |
| A tool that needs a person | The tool carries the confirm mark, and the MCP client asks its user. The server holds no approval queue. Default. |
| Rate limits | `agent` uses `ratelimit` when it is installed, and has none by default. `/mcp` refuses a call with no key before it does work. The skill tells the owner to add `ratelimit` before a public launch. Asked. |
| Discovery | A Server Card at `<mcp address>/server-card` (SEP-2127, optional). No OAuth metadata, because this plan has no OAuth. Default. |
| Public files | The base web app serves `llms.txt`, `llms-full.txt` and a Markdown copy of each public page, made at build time from `landing.ts` and the legal pages. A registration table lets `agent` and `cms` add entries. Idea from agent-native's public agent web. Default. |
| Robots policy | Unchanged: every crawler may read every page. The file already says how to refuse training crawlers. Asked. |
| Human reference page | None in version 1. Agents need the JSON document and the Markdown text. Default. |
| The audit command | One command checks the agent surface of a running product and exits non-zero on a gap. The benchmark calls it. The benchmark does not call agent-native's own audit command. Idea from agent-native's `audit-agent-web`. Default. |
| Audit rows | A present audit row records the key that made the change. No new audit system. Default. |
| WebMCP | Not in this plan. It waits for a stable browser that has it on by default. Default. |
| A check with Claude and ChatGPT | Not in this plan. Both need OAuth. The benchmark's second agent covers the key path. Default. |
| UI house rules | The new page uses the `shell` set from `@repo/ui/{components,blocks,containers}/shell/*`. A block takes its data and callbacks as props, with no IO in `@repo/ui`. Words live in `packages/ui/src/content/`. A field with more than 7 options is a combobox. Module UI ships as a `ui` package block (ADR 0030). `apps/app` has no `DESIGN.md`, so `modules/admin/files/DESIGN.md` is the nearest written rule set. |
| Visual reference | None yet. The nearest existing screen is the organization key workspace, `modules/api-keys-organization/files/admin/components/api-key-workspace.tsx`. Phase 1 makes the mockup and the owner approves it. |
| Mockup approved | Open. Phase 1 records the date, the round, the gist URL with the file prefix, and the issue comment URL. |
| Outward actions a builder may take | File GitHub issues, the OAuth issue included. Post each mockup round to the mockup gist and the tracking issue. Default, and the owner approved the OAuth issue in the grill. |
| Attended parts | The mockup approval of phase 1, and the scored benchmark runs of phase 7. Default. |
| Tests | No new kind of test. Route tests on the present vitest Workers pool cover the OpenAPI document and the MCP endpoint. The guard test is a unit test. |

## Approach

Add one declaration to each route, and build every agent surface from it. The plan reuses the chained route registration of ADR 0028, the zod schemas of `validators`, the error envelope, the caller gate and scope vocabulary of the `api-keys` modules, the `shell` set, the sitemap and robots files of the base, and the benchmark of plan 0109.

Rejected, one line each:

- An api description and `llms.txt` with no MCP server: an agent then reads documents and writes HTTP calls for each task, when one tool list does the same job.
- OAuth sign-in in this plan: research 0012 found three unknowns on Workers, and the owner moved it to a later plan.
- Three small modules (`openapi`, `mcp-server`, `mcp-auth`), as plan 0048 lists them: the owner chose one module, and three would share one declaration anyway.
- A hand-written MCP server beside the routes: two implementations of each action, which then differ.
- UI SDK's in-page bridge as the agent surface: it needs a browser with WebMCP and a rewrite of the design layer.
- A chat agent inside the product: a different product, and a possible later module.

### Phase 1: mockup of the "Agents" page (#231)

Attended: the owner approves the screenshots before any build.

- The "Agents" page in `app`: the MCP address with the setup text for Cursor, Claude Code and Codex, the user's keys (list, create with scopes, plaintext shown one time, revoke), and the empty states.
- The scope picker in the create form: read and write scopes selected, each delete scope off.
- Light and dark, at a narrow and a wide width. The images go to the mockup gist, never to the repo.

Done when: the "Mockup approved" row above holds the date, the round, the gist URL with the file prefix and the issue comment URL.

### Phase 2: prove the route declaration and MCP on Workers (#348)

A throwaway prototype in the playground, on one sample entity.

- One declared route appears in an OpenAPI document and as an MCP tool.
- The typed `hc` client of the apps still compiles with no change at the call site.
- A tool call with a key runs the route in process on `workerd`, and a refused call returns the shared error envelope.
- `@modelcontextprotocol/server` 2.x runs on `workerd`, and it answers one client on spec revision 2026-07-28 and one client that still sends the older `initialize` handshake.
- The prototype picks the declaration library.

Done when: `curl /openapi.json` lists the sample route, an MCP `tools/list` call returns its tool for both client revisions, `pnpm typecheck` passes with the client call unchanged, and an ADR draft records the library picks and the reason. If the SDK cannot run on `workerd`, the phase stops and the owner decides.

### Phase 3: the route contract in `api` (#348)

- Add the declaration to the `api` module: description, output schema, and the agent flags (callable or not, read only, needs a person).
- Declare every api route that the modules ship today: 21 `chained-route` patches in 15 modules. A product read is callable. Each other route states that agents may not call it.
- Add a guard test in `scripts/` that fails when a shipped route file has no statement.
- Write the ADR, and an update note for projects that already have these modules (ADR 0058).

Done when: the guard test fails on a module route file with the statement removed and passes with it, and a full scaffold of both drivers passes `pnpm typecheck`.

### Phase 4: the `agent` module with key sign-in (#348)

- A new module `agent` (capability, stage `mvp`), with the skill `saasaloy-agent`. It depends on `api`, `validators`, `auth`, `app` and `api-keys`.
- `GET /openapi.json` on the api, built from the declarations.
- An MCP endpoint at `/mcp`, with one tool for each callable route. The tool carries the route's description, its input schema and its read-only and confirm marks. A call needs a bearer key, and the key's scopes limit it. The endpoint works with both key owner modules.
- A Server Card at `/mcp/server-card`.
- An `llms.txt` on the api origin that names the OpenAPI document, the MCP address, how to sign in with a key, and each tool.
- A config section `agent` in `packages/config` (ADR 0052), for the product's description for agents.
- When `ratelimit` is installed, the endpoint uses it. The skill says to add it before a public launch.
- The guard test of phase 3 ships into the project, under the testing mode.

Done when: in the playground with a seeded key, `tools/list` on `/mcp` returns the sample entity's tools, a `tools/call` create followed by a list returns the new row, a key without the scope gets the refusal in the shared envelope, a request with no key gets 401, and `pnpm test` fails in a project that adds a route with no statement.

### Phase 5: public files for agents on the web app (#348)

- The base web app serves `/llms.txt`, `/llms-full.txt` and a Markdown copy of each public page (`/index.md`, `/privacy.md`, `/terms.md`), made at build time. `robots.txt` stays as it is.
- A registration table lets a module add entries. `agent` adds the api description and the MCP address. `cms` adds its published pages.
- JSON-LD for the organization and the site, from `@repo/config`.
- The audit command, in `packages/tooling`: it checks the public files, the OpenAPI document and an MCP `tools/list` call against a running product.

Done when: the built site returns 200 and `text/plain` for `/llms.txt`, `/index.md` holds the headline from `landing.ts`, the file names the MCP address when `agent` is installed and does not when it is absent, and the audit command exits 0 on a full product and non-zero after `llms.txt` is removed.

### Phase 6: the "Agents" page in `app` (#231)

- Build the page from the approved mockup: the connect text, and the key list with create, show one time, and revoke. This closes issue #231.
- The scope picker reads the vocabulary without a server import in the browser bundle, which #231 lists as open.

Done when: a signed-in user creates a key in `app` with the default scopes, sees the plaintext one time, calls a read tool and a write tool on `/mcp` with it, gets a refusal on a delete tool, and gets 401 after a revoke. The screenshots in the pull request match the approved mockup.

### Phase 7: on by default, and measured (#348) (#350)

Attended: the owner starts each scored benchmark run on this box. This phase needs phases 2 and 8 of plan 0109: a path that runs, and a benchmark with three briefs.

- `saasaloy-build` adds `agent`, `api-keys` and `api-keys-user` in the MVP stage.
- `saasaloy-feature` gets a four-part rule for each entity: the screen, the route with its agent statement, the scope words in `API_KEY_SCOPES`, and the entry in the agent documents. Idea from agent-native's `adding-a-feature` skill. The read-back of plan 0109's interview says that each entity action is callable by agents.
- The module catalogue and the wiki get the new module, and the README says what a built product gives to agents.
- File one `needs-planning` issue: OAuth sign-in for MCP clients, with a link to research 0012 and the two decisions it left open (the registration method, and products with organizations). Filed as #351.
- New benchmark lines: the audit command exits 0, and a second agent that gets only the product's address and a seeded key creates one entity and reads it back through MCP.

Done when: `node scripts/agent-bench.ts` prints PASS on every bar line, the new agent-use lines included, for each of the three briefs, and the OAuth issue exists.

## Migration and rollback

Phase 4 adds the `api-keys` tables to a project that did not have them. The change is additive: no existing table changes and no existing row moves.

- A project gets the tables through `saasaloy add agent` and the driver's migration command.
- Rollback before a production deploy is `saasaloy remove agent` and a delete of the new migration files. After a deploy the empty tables can stay, or a later migration drops them. Each key is lost on a drop.
- The route declarations of phase 3 change shipped route files in 15 modules. An existing project takes them through `saasaloy update`, with the update note.

## Open questions

None. The grill of 2026-11-17 settled each one, and no decision of this plan is deferred.

Two results are still unknown, and phase 2 measures both:

- Whether `@modelcontextprotocol/server` 2.x runs on `workerd`.
- Whether it answers a client on an older spec revision.

Two decisions moved to the OAuth plan with the feature: the client registration method, and OAuth in a product with organizations.

## Non-goals

- OAuth sign-in for MCP clients, the consent screen, a list of connected agents, and a check with Claude and ChatGPT. A later plan covers them.
- UI SDK, WebMCP, and any rebuild of the design layer on other primitives.
- The agent-native framework, a chat agent inside the product, shared screen state between an agent and the UI, the A2A protocol and a gateway across apps.
- A generated client SDK, outbound webhooks, and a reference page for people.
- A dependency on `ratelimit`, and usage metering or billing for agent calls.
- Agent access to the admin app.
- The build workflow, the interview and the preview deploy. Plan 0109 covers them.
- The other account screens in `app`: password reset (#230), email verification and settings.
