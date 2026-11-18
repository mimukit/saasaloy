# QA Plan: Every built product is usable by agents

_Generated 2026-11-18 · against `11f3e3d2e96959c74614bdad3d540de4a2026e7e` (clean apart from this plan) · covers issue #348, diff `origin/main...HEAD` (merge base `3ef0f7e9`): the route statement in `api`, the `agent` module (OpenAPI, MCP, Server Card, api `llms.txt`), the public agent files on `web`, `pnpm agent:audit`, the MVP skills and the benchmark scorer lines_

_Updated 2026-11-18: the branch was rebased onto `origin/main` (`3ef0f7e9`) and now sits at `11f3e3d2`. Every result below was run again at `11f3e3d2`, except the document reads whose files the rebase did not change (each says so). The first run at `26721094` no longer counts._

## Summary
- Each api route states whether an agent may call it, and the `agent` module builds an OpenAPI document, an MCP server and `llms.txt` files from those statements.
- An agent with a scoped key lists the tools, creates and reads a row through MCP, gets the shared error envelope on a refusal, and the web app serves `/llms.txt` and Markdown copies.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-348-make-every-built-product-usable-by-agents` at `11f3e3d2`, clean tree apart from this plan (untracked).
- Repository: `/home/dev/worktrees/saasaloy/issue-348-make-every-built-product-usable-by-agents` (WT below).
- Disposable targets: throwaway projects under `WT/.dev/qa-*`, which the repo names as the place to run `saasaloy` CLI commands (`AGENTS.md`). The reset for each target deletes its folder.
- Ports: api 4013 (user keys) and 4014 (organization keys), web preview 3013. Port 4000 can belong to another worktree.
- Seeded sign-in: `member@example.test` and `admin@example.test`, password `saasaloy-dev-password`.
- Screenshots: none. No human checkpoint judges a screen, so the gallery step is skipped.

Build the CLI once, so the scaffolds use the templates at this revision:

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Repository at `11f3e3d2`, read only | The README section reads well and is correct | 🟡 Normal |
| TC-1.2 | 1: Repository at `11f3e3d2`, read only | The `saasaloy-agent` skill reads well and is correct | 🟡 Normal |
| TC-1.3 | 1: Repository at `11f3e3d2`, read only | The four-part rule in `saasaloy-feature` reads well | 🟡 Normal |
| TC-2.1 | 2: Fresh d1 project with user keys and a sample `notes` route | Two MCP client revisions create and list a note | 🔴 Critical |
| TC-2.2 | 2: Fresh d1 project with user keys and a sample `notes` route | Key scopes, no key and a bad host get refused | 🔴 Critical |
| TC-2.3 | 2: Fresh d1 project with user keys and a sample `notes` route | Discovery files on the api and the web app | 🔴 Critical |
| TC-2.4 | 2: Fresh d1 project with user keys and a sample `notes` route | The audit passes, then fails with no `llms.txt` | 🔴 Critical |
| TC-2.5 | 2: Fresh d1 project with user keys and a sample `notes` route | `ratelimit` answers 429 on `/mcp` | 🟡 Normal |
| TC-2.6 | 2: Fresh d1 project with user keys and a sample `notes` route | `pnpm test` fails on a route with no statement | 🔴 Critical |
| TC-3.1 | 3: Fresh d1 project with organization keys | An organization key lists projects through MCP | 🔴 Critical |
| TC-4.1 | 4: Fresh base project with no modules | `llms.txt` names no MCP address | 🟡 Normal |

## Scenario 1: Repository at `11f3e3d2`, read only

**Setup.** Run once, for every case in this scenario.

1. Open WT at the revision under test.

```sh
git -C /home/dev/worktrees/saasaloy/issue-348-make-every-built-product-usable-by-agents rev-parse HEAD
```

- [ ] Setup complete

### TC-1.1: The README section reads well and is correct  ·  🟡 Normal

**Goal.** A reader of the README learns, correctly and in plain words, what a built product gives to agents (C36).

**Steps**

1. Read `README.md`, section "What a built product gives to agents", and the "Build the MVP" row of the stage table.
   - [ ] The section is correct and reads well to a person
     - two short paragraphs: OpenAPI, MCP, `llms.txt`, key sign-in, scopes with a separate delete scope
     - the stage row names `agent` + `api-keys-user`
     - no claim that the code does not support (OAuth is a later plan)

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The `saasaloy-agent` skill reads well and is correct  ·  🟡 Normal

**Goal.** A project agent can follow `saasaloy-agent` to make an entity callable and to check the result (C36).

**Steps**

1. Read `modules/agent/skills/saasaloy-agent/SKILL.md` from top to bottom.
   - [ ] The skill is correct and reads well to a person
     - "Make an entity callable: the four parts" matches the four parts the feature skill names
     - the `ratelimit` advice before a public launch is clear
     - "Check it end to end" gives commands a person can run

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The four-part rule in `saasaloy-feature` reads well  ·  🟡 Normal

**Goal.** The feature skill's four-part rule and scope table are clear to a person (C36).

**Steps**

1. Read `packages/cli/templates/base/_agents/skills/saasaloy-feature/SKILL.md`, "Every action is callable by agents" and "The four parts an agent needs".
   - [ ] The rule is correct and reads well to a person
     - the screen, the route with its statement, the words in `API_KEY_SCOPES`, the agent-document entry
     - `books:delete` is its own word with `confirm: true`
     - it points at `saasaloy-agent` and copies none of its text
2. Read the read-back part 3 in `packages/cli/templates/base/_agents/skills/saasaloy-setup/SKILL.md`.
   - [ ] The sentence on agents reads naturally to an owner who hears it in the interview

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The scenario reads files only.

## Scenario 2: Fresh d1 project with user keys and a sample `notes` route · run by the agent on `WT/.dev/qa-user` at `11f3e3d2`

Target: `WT/.dev/qa-user`. Reset: delete the folder (last block of this scenario).

**Setup.** Run once, for every case in this scenario. Run each command from `WT/.dev` unless the step names another folder.

1. Make the project with the `full` preset modules, `api-keys-user` in place of `api-keys-organization`, plus `agent` and `database-d1`. The agent ran these steps from the script `qa-scaffold.sh user 4013 3013` in its session folder.

```sh
SAASALOY_REGISTRY_DIR=../modules node ../packages/cli/dist/index.js init qa-user --yes --testing=tests-after
```

```sh
cd qa-user && SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js add admin api-keys-user app auth-phone cms command e2e email-console email-react feature-flags file-uploads kv-memory logger-console multitenant notification payment-console payment-manual queue-memory ratelimit sms-console storage-memory subscription-console teams waitlist agent database-d1 --yes
```

```sh
pnpm install --no-frozen-lockfile
```

2. Write `packages/env/.env` from the `full` preset env in `scripts/play-presets.json`, with `BETTER_AUTH_URL`, `PUBLIC_API_URL` and `STORAGE_PUBLIC_URL` set to `http://localhost:4013` and `PUBLIC_SITE_URL` set to `http://localhost:3013`. Then write each service's env.

```sh
pnpm env:setup
```

3. Change `4000` to `4013` and `3000` to `3013` in `apps/api/.env.local` and `apps/web/.env.local`. `pnpm env:setup` writes the main-checkout ports there.
4. Add the sample entity. Copy a `notes` route (in memory; `notes_list`, `notes_create`, `notes_delete`; gate `requireUser` with `notes:read`, `notes:write`, `notes:delete`) to `apps/api/src/routes/notes.ts`. Add `.route("/notes", notes)` to the typed chain in `apps/api/src/index.ts`.
5. Set `API_KEY_SCOPES` in `packages/auth/src/api-key-scopes.ts` to `{ notes: ["read", "write", "delete"], notifications: ["read"] }`.
6. Install the test client, migrate, seed and typecheck.

```sh
pnpm -C apps/api add -D -E @modelcontextprotocol/client@2.4.0
```

```sh
pnpm --filter @repo/db db:generate
```

```sh
pnpm db:setup && pnpm db:seed
```

```sh
pnpm typecheck
```

7. Start the api on `workerd`.

```sh
cd apps/api && ./node_modules/.bin/wrangler dev --port 4013 --ip 127.0.0.1
```

8. Sign in as the member and make two keys. Run these from the project root.

```sh
curl -s -c /tmp/qa-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3013' -d '{"email":"member@example.test","password":"saasaloy-dev-password"}' http://localhost:4013/auth/sign-in/email
```

```sh
export KEY_RW=$(curl -s -b /tmp/qa-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3013' -d '{"name":"qa rw","metadata":{"scope":{"notes":["read","write"],"notifications":["read"]}}}' http://localhost:4013/auth/api-key/create | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).key')
```

```sh
export KEY_RO=$(curl -s -b /tmp/qa-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3013' -d '{"name":"qa ro","metadata":{"scope":{"notes":["read"]}}}' http://localhost:4013/auth/api-key/create | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).key')
```

Set the database client once. Every query below runs through it, from `packages/db`, against the local D1 file.

```sh
export DB_CMD='pnpm exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --json --command'
```

- [x] Setup complete

**Notes.** Run at `11f3e3d2`. Scaffold `typecheck` exit 0, `Tasks: 25 successful, 25 total` (log `qa2-scaffold-user.log`), and again after the `notes` route: 25 of 25 (log `qa2-user-prep.log`). `db:setup` applied `0000_funny_ego.sql`, `db:seed` wrote `api_keys 2 rows`. Sign-in answered 200. Both keys were made. A key scoped `{"invoices":["read"]}` got `{"message":"permission required: invoices:read"} HTTP 403` (log `qa2-user-keys.log`).

### TC-2.1: Two MCP client revisions create and list a note  ·  🔴 Critical

**Goal.** An MCP client on 2026-07-28 and one on the older `initialize` handshake each list the tools, create a row in process on `workerd`, and read it back (C1, C3, C4, C14, C21).

**Steps**

1. Run the two-revision client from `apps/api`. The script is `qa-mcp.mjs` (written for this run; it uses `@modelcontextprotocol/client` 2.4.0, pins `2026-07-28` for one client and `legacy` for the other).

   ```sh
   node qa-mcp.mjs http://localhost:4013/mcp "$KEY_RW" "$KEY_RO"
   ```

   - [x] Each client negotiates its revision and lists one tool per callable route
   - [x] `notes_create` returns the new row, and `notes_list` then returns it

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Log `qa2-user-mcp.log`, exit 0.
```
[2026-07-28] negotiated: 2026-07-28
[2026-07-28] tool notes_create readOnly=false destructive=false meta={"saasaloy/confirm":false,"saasaloy/scope":"notes:write"} required=["title"] desc="Create one note and return it."
[2026-07-28] tool notes_delete readOnly=false destructive=true meta={"saasaloy/confirm":true,"saasaloy/scope":"notes:delete"} required=["id"]
[2026-07-28] notes_create: {"isError":false,"structuredContent":{"id":"2eb5d404-…","title":"qa from 2026-07-28",…}}
[2026-07-28] notes_list: isError=false count=1 rows=["qa from 2026-07-28"]
[legacy-initialize] negotiated: 2025-11-25
[legacy-initialize] notes_list: isError=false count=2 rows=["qa from legacy-initialize","qa from 2026-07-28"]
```
Both revisions listed 10 tools: `files_list`, `cms_entries_list`, `cms_entry_read`, `projects_list`, `notifications_list`, `notifications_unread_count`, `notification_preferences_read`, `notes_list`, `notes_create`, `notes_delete`. Each tool carries its description, `inputSchema.required`, `readOnlyHint`, `destructiveHint` and `_meta` with `saasaloy/scope` and `saasaloy/confirm`.

### TC-2.2: Key scopes, no key and a bad host get refused  ·  🔴 Critical

**Goal.** A key holds only its scopes, delete is its own scope, and every refusal is the shared envelope (C3, C15, C21).

**Steps**

1. Read the refusal lines of the client run in TC-2.1.
   - [x] A key without `notes:delete` and a read-only key on `notes_create` get `isError: true` with the `forbidden` envelope
2. Call `/mcp` with no key.

   ```sh
   curl -s -w ' HTTP %{http_code}\n' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:4013/mcp
   ```

   - [x] 401 with the `unauthorized` envelope
3. Call a tool with a bearer that is not a key.

   ```sh
   curl -s -w ' HTTP %{http_code}\n' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' -H 'authorization: Bearer sk_not_a_key' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_list","arguments":{}}}' http://localhost:4013/mcp
   ```

   - [x] The tool result is `isError: true` with `invalid api key`
4. Call `/mcp` with a foreign Host header.

   ```sh
   curl -s -w ' HTTP %{http_code}\n' -H 'host: evil.example' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "authorization: Bearer $KEY_RW" -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}' http://localhost:4013/mcp
   ```

   - [x] 403 with the `forbidden` envelope
5. Read the two key rows from `packages/db`.

   ```sh
   $DB_CMD "select k.name, u.email, k.enabled, k.permissions from api_keys k join users u on u.id = k.user_id where k.name like 'qa %';"
   ```

   - [x] Two rows for `member@example.test`, enabled, with the scopes the create asked for

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Logs `qa2-user-mcp.log`, `qa2-user-curl.log`, `qa2-db-keys.log`.
```
[2026-07-28] notes_delete with no delete scope: {"isError":true,"structuredContent":{"error":{"code":"forbidden","message":"permission required: notes:delete"}}}
[2026-07-28 ro] notes_create: {"isError":true,"structuredContent":{"error":{"code":"forbidden","message":"permission required: notes:write"}}}
[legacy-initialize ro] notes_create: {"isError":true,"structuredContent":{"error":{"code":"forbidden","message":"permission required: notes:write"}}}
{"error":{"code":"unauthorized","message":"A key is required: send Authorization: Bearer <key>."}} HTTP 401
data: {"result":{…"structuredContent":{"error":{"code":"unauthorized","message":"invalid api key"}},"isError":true},…} HTTP 200
{"error":{"code":"forbidden","message":"Invalid Host: evil.example"}} HTTP 403
[{"name":"qa rw","email":"member@example.test","enabled":1,"permissions":"{\"notes\":[\"read\",\"write\"],\"notifications\":[\"read\"]}"},{"name":"qa ro","email":"member@example.test","enabled":1,"permissions":"{\"notes\":[\"read\"]}"}]
```

### TC-2.3: Discovery files on the api and the web app  ·  🔴 Critical

**Goal.** The api serves OpenAPI, its own `llms.txt` and a Server Card from the statements, and the built web app serves the public agent files (C13, C17, C18, C19, C23, C24, C25, C27, C28).

**Steps**

1. Fetch the OpenAPI document.

   ```sh
   curl -s -D - http://localhost:4013/openapi.json
   ```

   - [x] OpenAPI 3.1.0 with bearer `securitySchemes.key`, the callable routes only, each with `operationId`, `x-agent` and its inputs
2. Fetch the api `llms.txt`.

   ```sh
   curl -s -D - http://localhost:4013/llms.txt
   ```

   - [x] 200 `text/plain`, with the MCP address, the OpenAPI link, "Sign in with a key", and one line per tool
3. Fetch the Server Card.

   ```sh
   curl -s -D - http://localhost:4013/mcp/server-card
   ```

   - [x] 200 `application/mcp-server-card+json` whose `remotes[0].url` is `http://localhost:4013/mcp`
4. Build the web app and start its preview, from the project root.

   ```sh
   pnpm --filter @repo/web build
   ```

   ```sh
   cd apps/web && ./node_modules/.bin/astro preview --port 3013 --host 127.0.0.1
   ```

5. Fetch the web files.

   ```sh
   curl -s -D - http://localhost:3013/llms.txt
   ```

   ```sh
   curl -s -D - http://localhost:3013/llms-full.txt
   ```

   ```sh
   curl -s -D - http://localhost:3013/index.md
   ```

   ```sh
   curl -s -D - http://localhost:3013/privacy.md
   ```

   ```sh
   curl -s -D - http://localhost:3013/terms.md
   ```

   ```sh
   curl -s http://localhost:3013/
   ```

   ```sh
   curl -s -D - http://localhost:3013/robots.txt
   ```

   - [x] `/llms.txt` is 200 `text/plain` and has a "Blog" section (`cms`) and an "API for agents" section with `http://localhost:4013/mcp` (`agent`)
   - [x] `/index.md` starts with the landing headline, and each Markdown copy answers 200
   - [x] The home page carries JSON-LD with the name from `@repo/config`, and `robots.txt` equals the template on `main`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Logs `qa2-user-curl.log`, `qa2-user-web-build.log` (exit 0), `qa2-user-web-curl.log`. Local `main` and `origin/main` are both `3ef0f7e9`.
```
3.1.0 {"title":"Saasaloy","description":"This product's api for agents: call its tools over MCP or HTTP with a key.","version":"1.0.0"} [{"url":"http://localhost:4013"}]
  POST /notes notes_create {"callable":true,"readOnly":false,"confirm":false,"scope":"notes:write"} body=title
  DELETE /notes/{id} notes_delete {"callable":true,"readOnly":false,"confirm":true,"scope":"notes:delete"} params=["path:id"]
  GET /cms/{collection}/entries cms_entries_list {…"scope":null} params=["query:page","path:collection"]
api /llms.txt: HTTP/1.1 200 OK, Content-Type: text/plain; charset=UTF-8; "## Connect", "## Sign in with a key", "## Tools" with 10 lines
- `notes_delete` (DELETE /notes/{id}): Delete one of the caller's notes. (needs scope `notes:delete`; writes; ask the user to confirm first)
server card: HTTP/1.1 200 OK, Content-Type: application/mcp-server-card+json, "url":"http://localhost:4013/mcp"
web /llms.txt: 200 content-type: text/plain; charset=utf-8; "## Blog", "## API for agents", "- [MCP server](http://localhost:4013/mcp)"
web /llms-full.txt: 200 text/plain; 216 lines
web /index.md: 200 text/markdown; first line "# Ship the SaaS, not the scaffolding."; landing.ts:109 title "Ship the SaaS, not the scaffolding."; home page h1 the same
web /privacy.md, /terms.md: 200 text/markdown, "# Privacy Policy", "# Terms of Service"
JSON-LD: {"@context":"https://schema.org","@graph":[{"@type":"Organization",…"name":"Saasaloy",…"logo":"http://localhost:3013/favicon.svg"},{"@type":"WebSite",…
robots.txt: no commit on main..HEAD touches the template file; the served file equals `git show main:…/robots.txt`
agent-entries.ts in the project: entries: [cmsAgentEntry(), agentApiEntry()]
```
The config section `packages/config/src/sections/agent.ts` holds `description` and `version`, `sections.ts` registers `agentConfig()`, and the OpenAPI `info.description` shows the value.

### TC-2.4: The audit passes, then fails with no `llms.txt`  ·  🔴 Critical

**Goal.** `pnpm agent:audit` exits 0 on the full product and exits non-zero after `llms.txt` is gone (C26, C29).

**Steps**

1. Run the audit with the read-write key, from the project root.

   ```sh
   AGENT_AUDIT_KEY="$KEY_RW" pnpm agent:audit --site http://localhost:3013 --api http://localhost:4013 --require-key
   ```

   - [x] Exit 0, 11 passed
2. Stop the preview. Delete `apps/web/dist/client/llms.txt`, start the preview again (step 4 of TC-2.3), and run step 1 again.
   - [x] Exit 1, and `web/llms.txt` fails with 404

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Logs `qa2-audit-green.log`, `qa2-audit-removed.log`.
```
PASS api/tools-list: 10 tools: files_list, …, notes_list, notes_create, notes_delete
11 passed, 0 failed, 0 skipped.            (exit 0)
llms.txt HTTP 404
FAIL web/llms.txt: http://localhost:3013/llms.txt answered 404
FAIL web/llms.txt-mcp: http://localhost:3013/llms.txt does not name http://localhost:4013/mcp
FAIL web/markdown: http://localhost:3013/llms.txt links no Markdown copy on http://localhost:3013
8 passed, 3 failed, 0 skipped.             (exit 1)
```

### TC-2.5: `ratelimit` answers 429 on `/mcp`  ·  🟡 Normal

**Goal.** With `ratelimit` installed, `/mcp` runs its `default` policy (C20).

**Steps**

1. Send 105 `tools/list` calls with one key, then one more.

   ```sh
   for i in $(seq 1 105); do curl -s -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' -H "authorization: Bearer $KEY_RW" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:4013/mcp; done | sort | uniq -c
   ```

   ```sh
   curl -s -i -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' -H "authorization: Bearer $KEY_RW" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:4013/mcp
   ```

   - [x] The calls past the budget get 429 with `Retry-After` and the `rate_limited` envelope

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Log `qa2-ratelimit.log`: `100 200`, `5 429`, then `HTTP/1.1 429 Too Many Requests`, `Retry-After: 55`, `{"error":{"code":"rate_limited","message":"Too many requests. Retry in 55 seconds."}}`. The project's `apps/api/src/agent/guards.ts` holds `guards: [mcpRateLimit()]`.

### TC-2.6: `pnpm test` fails on a route with no statement  ·  🔴 Critical

**Goal.** A project route with no `declare(...)` turns the project's own `pnpm test` red (C22).

**Steps**

1. Stop the api. Add `.get("/undeclared", (c) => c.json({ ok: true }, 200))` as the first link of the `notes` chain. Run the project tests.

   ```sh
   pnpm test
   ```

   - [x] Exit 1, and `statements.test.ts` names `GET /notes/undeclared`
2. Remove the `/undeclared` link. Run `pnpm test` again.
   - [x] Exit 0

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Logs `qa2-user-test-red.log` and `qa2-user-test-green.log` (`Test Files 41 passed`, `Tests 526 passed`):
```
FAIL |@repo/api| src/agent/statements.test.ts > every api route states whether an agent may call it > gives every route a declare(...) statement
AssertionError: expected [ 'GET /notes/undeclared' ] to strictly equal []
Test Files 1 failed | 40 passed (41)
Tests 1 failed | 525 passed (526)
```

**Reset.** Stop the api and the preview, then delete the project. Run from `WT/.dev`.

```sh
rm -rf qa-user
```

Done by the agent: wrangler and the preview were stopped, `qa-user` was deleted, and ports 3013 and 4013 are free.

## Scenario 3: Fresh d1 project with organization keys · run by the agent on `WT/.dev/qa-org` at `11f3e3d2`

Target: `WT/.dev/qa-org`. Reset: delete the folder.

**Setup.** Run once, for every case in this scenario.

1. Make the project with the `full` preset as it is (it holds `api-keys-organization`), plus `agent` and `database-d1`, as in Scenario 2 step 1, with the name `qa-org` and the ports 4014 and 3014. Do not add the `notes` route.
2. Change `4000` to `4014` and `3000` to `3014` in `apps/api/.env.local`. Then prepare and start the api.

```sh
pnpm -C apps/api add -D -E @modelcontextprotocol/client@2.4.0
```

```sh
pnpm db:setup && pnpm db:seed && pnpm --filter @repo/api build
```

```sh
cd apps/api && ./node_modules/.bin/wrangler dev --port 4014 --ip 127.0.0.1
```

3. Sign in as the organization admin, make Acme active, and make two organization keys.

```sh
curl -s -c /tmp/qa-org-jar.txt -b /tmp/qa-org-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3014' -d '{"email":"admin@example.test","password":"saasaloy-dev-password"}' http://localhost:4014/auth/sign-in/email
```

```sh
export ORG_ID=$(curl -s -c /tmp/qa-org-jar.txt -b /tmp/qa-org-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3014' -d '{"organizationSlug":"acme"}' http://localhost:4014/auth/organization/set-active | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
```

```sh
export OKEY_RW=$(curl -s -b /tmp/qa-org-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3014' -d "{\"name\":\"qa org rw\",\"organizationId\":\"$ORG_ID\",\"metadata\":{\"scope\":{\"project\":[\"read\"]}}}" http://localhost:4014/auth/api-key/create | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).key')
```

```sh
export OKEY_NONE=$(curl -s -b /tmp/qa-org-jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3014' -d "{\"name\":\"qa org none\",\"organizationId\":\"$ORG_ID\",\"metadata\":{\"scope\":{\"ac\":[\"read\"]}}}" http://localhost:4014/auth/api-key/create | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).key')
```

- [x] Setup complete

**Notes.** Run at `11f3e3d2`. Scaffold `typecheck` exit 0, 25 of 25 (log `qa2-scaffold-org.log`). Prep exit 0 (log `qa2-org-prep.log`). Sign-in 200, Acme active, both keys made (log `qa2-org-keys.log`).

### TC-3.1: An organization key lists projects through MCP  ·  🔴 Critical

**Goal.** `/mcp` works with `api-keys-organization`, and the key's organization statements limit it (C16).

**Steps**

1. Run the two-revision client with `projects_list` and no create tool, from `apps/api`.

   ```sh
   node qa-mcp.mjs http://localhost:4014/mcp "$OKEY_RW" "$OKEY_NONE" - projects_list projects
   ```

   - [x] Both revisions list `projects_list` and read the two Acme projects with the `project:read` key
   - [x] The key without `project:read` gets the `forbidden` envelope
2. Call `/mcp` with no key.

   ```sh
   curl -s -w ' HTTP %{http_code}\n' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:4014/mcp
   ```

   - [x] 401 with the `unauthorized` envelope

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Log `qa2-org-mcp.log`, exit 0.
```
[2026-07-28] negotiated: 2026-07-28
[2026-07-28] projects_list: isError=false count=2 rows=["Mobile app","Website"]
[2026-07-28 ro] projects_list: {"isError":true,"structuredContent":{"error":{"code":"forbidden","message":"permission required: project:read"}}}
[legacy-initialize] negotiated: 2025-11-25
[legacy-initialize] projects_list: isError=false count=2 rows=["Mobile app","Website"]
[legacy-initialize ro] projects_list: {"isError":true,"structuredContent":{"error":{"code":"forbidden","message":"permission required: project:read"}}}
{"error":{"code":"unauthorized","message":"A key is required: send Authorization: Bearer <key>."}} HTTP 401
```
Tools listed (7): `projects_list`, `files_list`, `cms_entries_list`, `cms_entry_read`, `notifications_list`, `notifications_unread_count`, `notification_preferences_read`.

**Reset.** Stop the api, then delete the project. Run from `WT/.dev`.

```sh
rm -rf qa-org
```

Done by the agent: wrangler was stopped, `qa-org` was deleted, and port 4014 is free.

## Scenario 4: Fresh base project with no modules · run by the agent on `WT/.dev/qa-bare` at `11f3e3d2`

Target: `WT/.dev/qa-bare`. Reset: delete the folder.

**Setup.** Run once, for every case in this scenario.

1. Make a base project with no `add`, install it, and write its env as in Scenario 2 step 2 with the ports 4016 and 3016. Change `4000` and `3000` in `apps/web/.env.local` to `4016` and `3016`.

```sh
SAASALOY_REGISTRY_DIR=../modules node ../packages/cli/dist/index.js init qa-bare --yes --testing=tests-after
```

- [x] Setup complete

**Notes.** Run at `11f3e3d2`. `typecheck` exit 0, 5 of 5 (log `qa2-scaffold-bare.log`).

### TC-4.1: `llms.txt` names no MCP address  ·  🟡 Normal

**Goal.** Without `agent`, the web `llms.txt` has no API section and no MCP address (C28).

**Steps**

1. Build the web app, from the project root.

   ```sh
   pnpm --filter @repo/web build
   ```

2. Count the MCP lines in the built file.

   ```sh
   grep -c '/mcp' apps/web/dist/client/llms.txt
   ```

   - [x] The count is 0, and the file has only "Pages" and "Optional"

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Run at `11f3e3d2`. Logs `qa2-bare-web-build.log` (exit 0) and `qa2-bare-web.log`: `grep -c /mcp` = 0; headings `# Saasaloy`, `## Pages`, `## Optional`. The built `robots.txt` equals the template on `origin/main`.

**Reset.** Delete the project. Run from `WT/.dev`.

```sh
rm -rf qa-bare
```

Done by the agent: `qa-bare` was deleted.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Gates reused, not run again. The coordinator ran them on the rebased tree at `11f3e3d2` (logs written 08:53 UTC on 2026-11-18; the renumber commit `11f3e3d2` is stamped 08:54):

- ✅ `pnpm typecheck` → exit 0 (`.afkkit/logs/rebase-tc.log`)
- ✅ `pnpm lint` → exit 0, "All matched files use Prettier code style!" (`.afkkit/logs/rebase-lint.log`)
- ✅ `pnpm test --concurrency=4` → 942 pass, 0 fail (`.afkkit/logs/rebase-test.log`)

Commands run at `11f3e3d2` (one per block; logs under `.afkkit/logs/qa2-*.log`):

```sh
pnpm --filter saasaloy build
```

```sh
node --test scripts/route-declarations.test.ts
```

```sh
node --test "$SCRATCH/qa-guard/scripts/route-declarations.test.ts"
```

```sh
bash qa-scaffold.sh postgres 4015 3015
```

```sh
node --test 'scripts/agent-bench/*.test.ts'
```

```sh
$DB_CMD "select name, type, \"notnull\" from pragma_table_info('api_keys');"
```

```sh
$DB_CMD "select name, \"unique\" from pragma_index_list('api_keys');"
```

```sh
$DB_CMD "select \"table\", \"from\", \"to\", on_delete from pragma_foreign_key_list('api_keys');"
```

```sh
$DB_CMD "select id, name from d1_migrations;"
```

`$SCRATCH/qa-guard` is a scratch copy of `scripts/route-declarations.{ts,test.ts}` and `modules/`, with the `declare({...})` of `GET /notifications/unread-count` removed. No tracked file changed (`git status --porcelain` empty after the run).

Revision of each result. Every runtime result ran at `11f3e3d2`. These document reads ran at `26721094`, and `git diff --stat 26721094 11f3e3d2` shows no change to their files (`qa2-read-checks.log`): C5 (ADR 0063), C7 (`contract.ts`), C12 (`modules/agent`), C30 to C32 (the build, feature and setup skills; only `saasaloy-deploy` changed in that folder), C33 (`README.md`, `docs/wiki/modules.md`) and C34 (`scripts/agent-bench`). `modules/README.md` (C33) and the update notes (C10) changed, so I read them again at `11f3e3d2`.

### Phase 1 (prototype; ADR 0063 is its committed output)

- ✅ C1 · a declared route is in `/openapi.json` and in MCP `tools/list` → on the shipped `agent` module: `notes_create` is `POST /notes` with `operationId` and `x-agent`, and the same name is a tool on both revisions (TC-2.1, TC-2.3)
- ✅ C2 · the typed `hc` client compiles with no change at the call site → project `pnpm typecheck` 25 of 25 with the `notes` route on the chain, at `11f3e3d2` (`qa2-user-prep.log`); the diff changes no `hc` call site in `apps/app`, `apps/admin` or `apps/web` (`qa-diff-noncore.log`; the rebase changed only route files and tests among the branch files, `qa2-rebase-diff.log`)
- ✅ C3 · `tools/call` with a key runs the route in process on `workerd`; a refusal is `{ error: { code, message } }` → `notes_create` returned the row from `wrangler dev`, refusals returned `forbidden` envelopes (TC-2.1, TC-2.2)
- ✅ C4 · `@modelcontextprotocol/server` 2.x answers a 2026-07-28 client and an `initialize` client → negotiated `2026-07-28` and `2025-11-25` (TC-2.1, TC-3.1)
- ✅ C5 · the ADR names the library and the reason → `docs/adr/0063-adr-routes-declare-for-agents-in-api-and-mcp-runs-them-in-process-2026-11-18.md` names `hono-openapi` 1.6.0 and rejects `@hono/zod-openapi` "because it changes the shape of every shipped route file"; status accepted
- ✅ C6 · the run stops if the SDK cannot run on `workerd` → not triggered: the SDK runs on `workerd` (C4), so there was nothing to stop

### Phase 2 (route contract in api)

- ✅ C7 · `api` holds the declaration and it is inert without `agent` → `modules/api/files/src/contract.ts` exports `declare` and `AgentStatement` (`callable`, `reason`, `readOnly`, `confirm`, `scope`, `output`); `declare` is `hono-openapi`'s `describeRoute`, a pass-through middleware; the bare project has no `/openapi.json` route to read it
- ✅ C8 · every shipped route has a statement; product reads callable; auth, admin, payment callback not → `node --test scripts/route-declarations.test.ts` exit 0, 11 of 11, including "never opens an admin, auth or payment callback route" and "opens the product reads the plan names" (`qa2-guard-green.log`, at `11f3e3d2`)
- ✅ C9 · the guard fails on a route file with no statement and passes with it → scratch copy exit 1, 3 of 11 fail: `modules/notification/files/api/routes/notifications.ts:172 (GET /notifications/unread-count): 0 statements` (`qa2-guard-red.log`, at `11f3e3d2`); the real tree passes (C8)
- ✅ C10 · ADR written and an update note exists → ADR 0063 above; 26 update notes in the diff, for `api` (`0005-route-contract`, `0006-agent-scope`), `auth`, `api-keys-user`, `multitenant`, every route module (after the rebase: `feature-flags/0003`, `storage/0002`, `subscription/0002` `agent-statements`), `cms` (`0003-agent-entry`) and the base (`packages/cli/update-notes/0006-agent-files.md`, listed as `base/0006-agent-files` in `update.test.ts`); read at `11f3e3d2` (`qa2-read-checks.log`)
- ✅ C11 · a full scaffold on d1 and on postgres passes `pnpm typecheck` → at `11f3e3d2`: d1 (`full` + `agent`): 25 of 25 (`qa2-scaffold-org.log`); d1 with `api-keys-user`: 25 of 25 (`qa2-scaffold-user.log`); postgres (`full` with `api-keys-user`, plus `agent` and `ecommerce`): 26 of 26, no server needed (`qa2-scaffold-postgres.log`)

### Phase 3 (agent module)

- ✅ C12 · module `agent` → `registry-item.json`: `saasaloy:capability`, stage `mvp`, skill folder `saasaloy-agent`, `dependsOn` `api, validators, auth, app, api-keys` (`qa-read-checks.log`, read at `26721094`; unchanged at `11f3e3d2`)
- ✅ C13 · `GET /openapi.json` from the declarations → 200, OpenAPI 3.1.0, 10 operations, each with `x-agent` (TC-2.3)
- ✅ C14 · one tool per callable route with description, input schema, read-only and confirm marks → 10 tools for 10 operations; `notes_delete` `destructiveHint: true`, `saasaloy/confirm: true` (TC-2.1)
- ✅ C15 · a call needs a bearer key; scopes limit it; `resource:action` with a separate delete scope → 401 with no key, `permission required: notes:delete` for a read-write key, `notes:write` refused for a read key (TC-2.2)
- ✅ C16 · `/mcp` works with `api-keys-user` and with `api-keys-organization` → TC-2.1 and TC-3.1
- ✅ C17 · Server Card at `/mcp/server-card` → 200 `application/mcp-server-card+json`, `remotes[0].url` `http://localhost:4013/mcp` (TC-2.3)
- ✅ C18 · api `llms.txt` names the OpenAPI document, the MCP address, key sign-in and each tool → TC-2.3
- ✅ C19 · config section `agent` holds the description → `packages/config/src/sections/agent.ts` (`description`, `version`), registered in `sections.ts`, read into OpenAPI `info.description` (TC-2.3)
- ✅ C20 · with `ratelimit` the endpoint uses it; the skill says to add it before a public launch → 429 `rate_limited` with `Retry-After` (TC-2.5); the two `ratelimit` entries carry `when.installed: ["ratelimit"]`; `SKILL.md:160` "`saasaloy-ratelimit` before a public launch"
- ✅ C21 · seeded key: tools list, create then list, envelope refusal, 401 → TC-2.1, TC-2.2
- ✅ C22 · `pnpm test` fails in a project that adds a route with no statement → exit 0, then exit 1 on `GET /notes/undeclared` (TC-2.6)

Database static facts, at `11f3e3d2`. Diff check: the diff adds no table and no migration; `agent` depends on `api-keys`, which brings `api_keys`. Host: the local D1 file under `.dev/qa-user/apps/api/.wrangler/state`, on this machine. Queries ran read only (`qa2-db-static.log`).

- ✅ `api_keys` columns → 22 columns, including `user_id TEXT NOT NULL`, `key TEXT NOT NULL`, `permissions TEXT`, `enabled INTEGER NOT NULL`
- ✅ indexes → `api_keys_config_id_idx`, `api_keys_user_id_idx`, `api_keys_key_idx`, primary key autoindex (unique)
- ✅ constraints → foreign key `user_id` → `users.id`, `ON DELETE CASCADE`
- ✅ migrations → `d1_migrations` holds `0000_funny_ego.sql` (main's rebase regenerated the initial migration name)
- Note: the first run at `26721094` had one query with a wrong column name (`reference_id`). The error was in the query. The run at `11f3e3d2` used only the corrected queries.

### Phase 4 (public files on web)

- ✅ C23 · `/llms.txt`, `/llms-full.txt`, Markdown copies at build time; `robots.txt` unchanged → all 200 from the built output; `robots.txt` has no commit on `main..HEAD` and equals `main` (TC-2.3, TC-4.1)
- ✅ C24 · a registration table; `agent` adds the api and MCP address; `cms` adds its pages → `entries: [cmsAgentEntry(), agentApiEntry()]`; "API for agents" and "Blog" sections (TC-2.3)
- ✅ C25 · JSON-LD from `@repo/config` → `Layout.astro` imports `config` from `@repo/config` and renders `siteJsonLd`; the page carries `Organization` and `WebSite` named `Saasaloy`, equal to `config.app.name` (TC-2.3)
- ✅ C26 · the audit checks the public files, OpenAPI and MCP `tools/list` → 11 checks, `web/*` and `api/*`, including `api/tools-list` (TC-2.4)
- ✅ C27 · `/llms.txt` 200 `text/plain`; `/index.md` holds the landing headline → `text/plain; charset=utf-8`; `# Ship the SaaS, not the scaffolding.` (TC-2.3)
- ✅ C28 · `llms.txt` names the MCP address with `agent` and not without it → `http://localhost:4013/mcp` present (TC-2.3); 0 matches in the bare project (TC-4.1)
- ✅ C29 · the audit exits 0 on a full product and non-zero after `llms.txt` is removed → exit 0, then exit 1 (TC-2.4)

### Phase 5 (on by default)

- ✅ C30 · `saasaloy-build` adds `agent`, `api-keys`, `api-keys-user` in the MVP stage → rule 5 of the build skill, line 92, and the line 96 module list; `scripts/scaffold-check.ts` `MVP_MODULES` holds the three
- ✅ C31 · `saasaloy-feature` has the four-part rule → "The four parts an agent needs" (line 82), scope table with `books:delete` and `confirm: true` (line 62), `API_KEY_SCOPES` (line 88)
- ✅ C32 · the read-back says each entity action is callable by agents → `saasaloy-setup/SKILL.md:246`
- ✅ C33 · catalogue and wiki list `agent`; README says what a product gives to agents → `modules/README.md:41` (re-read at `11f3e3d2`; the rebase changed this file), `docs/wiki/modules.md:45`, `README.md:82` "What a built product gives to agents", `README.md:93` and `:122`
- ✅ C34 · two new scorer lines → `scripts/agent-bench/score.ts` `MVP_BAR` ids `agent-audit` (line 75) and `agent-use` (line 77)
- ✅ C35 · the scorer's tests pass → `node --test 'scripts/agent-bench/*.test.ts'` exit 0, 112 tests, 112 pass (`qa2-agent-bench.log`, at `11f3e3d2`)

### Browser checks
_No browser driver ran. The change adds no screen, and curl read every page fact (status, content type, JSON-LD, headline)._

## Not covered / needs human judgment
- The wording of the README, the `saasaloy-agent` skill and the feature-skill rule (C36): Scenario 1.
- The scored benchmark runs with a real second agent: the release issue owns them, not this issue (`.afkkit/p5-notes.md`, "Not proven here").
- A Postgres project at run time: the postgres scaffold passed `pnpm typecheck` only. No Postgres server ran, because C11 asks for typecheck.
- A deploy to Cloudflare: every run used `wrangler dev` and `astro preview` locally.
- `/mcp` lists tools for any bearer string; only a `tools/call` checks the key (P4 pitfall 2). This is the design in ADR 0063 and is not a fail.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
