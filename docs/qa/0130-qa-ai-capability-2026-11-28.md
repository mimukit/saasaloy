# QA Plan: AI capability (ai, ai-mock, ai-gateway, ai-sdk) and the chat block

_Generated 2026-11-28 · against `092d25fd57b7d3c5e05c02ac9ca0362b11682710` (clean, `.afkkit/` is ignored) · covers `main...HEAD` for issue 403 and plan `docs/plans/0128-plan-ai-capability-2026-11-28.md`_

## Summary
- The `ai` capability gives a project a model through a provider (`ai-mock`, `ai-gateway`), streams chat through the `ai-sdk` driver, and renders it in the chat block.
- Working means each block state renders from a real stream, tool approval runs or skips the tool, and each live gateway streams, calls a tool, logs usage and maps a wrong key to `auth`.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-403-add-an-ai-capability-with-an-ai-sdk-driver` at `092d25fd`.
- Project under test: `.dev/p403e` in the worktree. It holds `ai`, `ai-mock`, `ai-sdk`, `app`, `auth` and `database-postgres`, with `AI_PROVIDER=mock`.
- Test wiring in `.dev/p403e`: the route `apps/api/src/routes/chat.ts` (tool `rename_workspace`, in `approve`) and the island page `apps/app/src/routes/chat.tsx`.
- App: http://localhost:3002, chat page http://localhost:3002/chat. API: http://localhost:4000, chat route `POST http://localhost:4000/chat`.
- Credentials: `member@example.test` with password `saasaloy-dev-password`.
- API log: `.afkkit/logs/G5-api-vite.log`. The `ai usage` and `ai error` lines land there.
- Mockup round r1 (picked by the unattended run, not yet approved): `/home/dev/mockups/saasaloy/0128/0128-r1-*.png`.
- Screenshots: local to this run at `092d25fd` and not committed. The `mockup-*` names are copies of the round r1 images, for side-by-side review. The names under each case match the labels in the gallery.

The dev stack runs already. If it is down, start the database, the API and the app from the worktree root.

```sh
cd .dev/p403e && docker compose up -d
```

```sh
cd .dev/p403e/apps/api && setsid nohup pnpm dev > ../../../../.afkkit/logs/G5-api-vite.log 2>&1 < /dev/null & echo $! > ../../../../.afkkit/pids/G5-api-vite.pid
```

```sh
cd .dev/p403e/apps/app && setsid nohup pnpm dev > ../../../../.afkkit/logs/G5-app-vite.log 2>&1 < /dev/null & echo $! > ../../../../.afkkit/pids/G5-app-vite.pid
```

Get a session cookie for the `curl` calls. Run it from the worktree root.

```sh
curl -c /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"email":"member@example.test","password":"saasaloy-dev-password"}' http://localhost:4000/auth/sign-in/email
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Mockup round r1 on disk, plan row "Mockup (unattended pick)" | The round covers every state, both layouts and is published | 🔴 Critical |
| TC-2.1 | 2: Signed-in member on `/chat`, `AI_PROVIDER=mock` | The rendered block matches round r1 in light and dark | 🔴 Critical |
| TC-3.1 | 3: `ai-gateway` installed, `AI_PROVIDER=gateway` on Cloudflare AI Gateway | Streamed reply, one tool call and the usage line | 🔴 Critical |
| TC-3.2 | 3: same | A wrong key gives `code: "auth"` | 🟡 Normal |
| TC-4.1 | 4: `AI_PROVIDER=gateway` on OpenRouter | Streamed reply, one tool call and the usage line | 🔴 Critical |
| TC-4.2 | 4: same | A wrong key gives `code: "auth"` | 🟡 Normal |
| TC-5.1 | 5: `AI_PROVIDER=gateway` on Vercel AI Gateway | Streamed reply, one tool call and the usage line | 🔴 Critical |
| TC-5.2 | 5: same | A wrong key gives `code: "auth"` | 🟡 Normal |

## Scenario 1: Mockup round r1 on disk, plan row "Mockup (unattended pick)"

**Setup.** Run once, for every case in this scenario.

1. Open the folder `/home/dev/mockups/saasaloy/0128/`.
2. Open `docs/plans/0128-plan-ai-capability-2026-11-28.md` at the Design decisions table.

- [ ] Setup complete

### TC-1.1: The round covers every state, both layouts and is published  ·  🔴 Critical

**Goal.** Round r1 is a complete, approvable reference for the chat block (C1, C2, C3).

**Steps**

1. Look at the five images of round r1.
   - [ ] The round shows every state of the block (C1)
     - empty state with suggestions; streamed reply with reasoning; tool call running and finished
     - approval card with Approve and Deny; sources; error with Retry; Stop while streaming
     - light and dark; desktop and mobile
     - screenshots: `mockup-fullpage-light-1440` · `mockup-fullpage-dark-1440` · `mockup-empty-dark-375` · `mockup-chat-light-375`
   - [ ] The round shows a full page and a side panel inside the `apps/app` shell (C2)
     - screenshots: `mockup-sidepanel-light-1440`
2. Find the `mockups: mimukit/saasaloy` gist. Read the plan row "Mockup (unattended pick)".
   - [ ] The round is in the gist, and the plan has a mockup row with the date and the files (C3)
     - at `092d25fd` the plan row says "The images are not yet in the `mockups: mimukit/saasaloy` gist"
     - the owner approves r1 in the PR review, or asks for a new round
3. Approve round r1, or ask for a new round.
   - [ ] The owner approves round r1

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset. This scenario changes nothing.

## Scenario 2: Signed-in member on `/chat`, `AI_PROVIDER=mock`

**Setup.** Run once, for every case in this scenario.

1. Open http://localhost:3002/sign-in and sign in as `member@example.test`.
2. Open http://localhost:3002/chat.

- [ ] Setup complete

### TC-2.1: The rendered block matches round r1 in light and dark  ·  🔴 Critical

**Goal.** The chat block that ships looks like the picked round in both themes and at both widths (C29).

**Steps**

1. Put the theme to light. Set the window to 1440 px. Look at the empty page.
   - [ ] The empty state matches the round: icon, heading and suggestion rows, composer at the foot
     - screenshots: `empty-light-1440` · `empty-dark-1440` · `empty-light-375` · `empty-dark-375`
2. Type each mock line below in the composer and send it. Reload the page between lines.
   - plain text, `/mock reasoning`, `/mock source`, `/mock tool rename_workspace slow` with a second line `{"name":"Acme"}`
   - [ ] The conversation states match the round: user bubble, assistant avatar, reasoning disclosure, numbered source chips
     - screenshots: `text-light-1440` · `text-dark-1440` · `text-light-375` · `text-dark-375`
     - screenshots: `reasoning-light-1440` · `reasoning-dark-1440` · `reasoning-light-375` · `reasoning-dark-375`
     - screenshots: `source-light-1440` · `source-dark-1440` · `source-light-375` · `source-dark-375`
   - [ ] The tool card matches the round in each state: running, approval, finished, denied
     - running shows a spinner row; approval shows the badge and the Approve and Deny buttons in two columns
     - finished shows the check, the badge and the Input and Output disclosures; the check is `text-foreground`, not green, because the base theme has no success token
     - screenshots: `tool-running-light-1440` · `tool-running-dark-1440` · `tool-running-light-375` · `tool-running-dark-375`
     - screenshots: `approval-light-1440` · `approval-dark-1440` · `approval-light-375` · `approval-dark-375`
     - screenshots: `tool-finished-light-1440` · `tool-finished-dark-1440` · `tool-finished-light-375` · `tool-finished-dark-375`
     - screenshots: `tool-denied-light-1440` · `tool-denied-dark-1440` · `tool-denied-light-375` · `tool-denied-dark-375`
3. Send `/mock error 429`. Reload the page. Send `/mock slow` with a long line, and look while it streams.
   - [ ] The error banner and the streaming composer match the round
     - the banner is red with a Retry button; the composer shows Stop while the reply streams
     - screenshots: `error-light-1440` · `error-dark-1440` · `error-light-375` · `error-dark-375`
     - screenshots: `streaming-light-1440` · `streaming-dark-1440` · `streaming-light-375` · `streaming-dark-375`
4. Put the theme to dark. Do the sweep again.
   - [ ] The same sweep is clean in dark
   - [ ] The differences from the round are acceptable
     - the composer is narrower than the round's full-width composer
     - the `.dev` test page leaves an empty band under the chat (`h-[calc(100dvh-8rem)]` in `apps/app/src/routes/chat.tsx`); the band belongs to the test page, not to the block
     - the side-panel layout (`title` and `description` props) has no test page in `.dev`, so no screenshot shows it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Reload http://localhost:3002/chat. The chat keeps no history, so a reload clears it.

## Scenario 3: `ai-gateway` installed, `AI_PROVIDER=gateway` on Cloudflare AI Gateway

**Setup.** Run once, for every case in this scenario. Run the commands from the worktree root. You need a Cloudflare account with an AI Gateway named `main` and an API token with Workers AI Read.

1. Add the `ai-gateway` provider to `.dev/p403e`.

```sh
cd .dev/p403e && SAASALOY_REGISTRY_DIR="$(pwd)/../../modules" node ../../packages/cli/dist/index.js add ai-gateway --yes && pnpm install
```

2. Edit `.dev/p403e/packages/env/.env`. Set these keys, with your account ID and token:

```sh
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AI_GATEWAY_API_KEY=<cloudflare-api-token>
AI_GATEWAY_HEADERS={"cf-aig-gateway-id":"main"}
AI_MODEL=openai/gpt-6-luna
```

3. Write each service's `.env`.

```sh
cd .dev/p403e && pnpm env:setup
```

4. Stop the API.

```sh
pkill -s "$(cat .afkkit/pids/G5-api-vite.pid)"
```

5. Start the API again.

```sh
cd .dev/p403e/apps/api && setsid nohup pnpm dev > ../../../../.afkkit/logs/G5-api-vite.log 2>&1 < /dev/null & echo $! > ../../../../.afkkit/pids/G5-api-vite.pid
```

6. Get a new session cookie with the sign-in `curl` from Environment.

- [ ] Setup complete

### TC-3.1: Streamed reply, one tool call and the usage line  ·  🔴 Critical

**Goal.** A real model on Cloudflare AI Gateway streams, calls a tool through approval and logs its usage.

**Steps**

1. Send one plain message.

   ```sh
   curl -N -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Say hello in five words."}]}]}' http://localhost:4000/chat
   ```

   - [ ] The reply arrives in several `text-delta` chunks and ends in `finish` and `data: [DONE]`
2. Open http://localhost:3002/chat. Send "Rename my workspace to Acme." Click Approve on the approval card.
   - [ ] The model calls `rename_workspace`, and after Approve the tool card shows Finished with the output `{"renamed":"Acme"}`
   - [ ] The tool call works on Cloudflare, or the saasaloy-ai-gateway skill states the limit
3. Read the API log.

   ```sh
   grep -A 20 "'ai usage'" .afkkit/logs/G5-api-vite.log | tail -n 22
   ```

   - [ ] The last `ai usage` line has `provider: 'gateway'`, `model: 'openai/gpt-6-luna'`, and token counts that are not 0
     - if the counts are 0, check that the saasaloy-ai-gateway skill states the limit for streamed usage on Cloudflare

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: A wrong key gives `code: "auth"`  ·  🟡 Normal

**Goal.** A wrong Cloudflare token reaches the client as a normalized `auth` error, not as a stack.

**Steps**

1. Edit `.dev/p403e/packages/env/.env`. Set `AI_GATEWAY_API_KEY=wrong-key`. Run `pnpm env:setup` and restart the API as in Setup steps 3 to 5.
2. Send one plain message.

   ```sh
   curl -N -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Hello"}]}]}' http://localhost:4000/chat
   ```

   - [ ] The stream holds an `error` chunk whose `errorText` has `"code":"auth"` and `"retryable":false`
3. Read the API log.

   ```sh
   grep -A 12 "'ai error'" .afkkit/logs/G5-api-vite.log | tail -n 14
   ```

   - [ ] The `ai error` line has `code: 'auth'`, and the log holds no stack

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Put the correct key back, or go to Scenario 4. Scenario 5's reset puts the project back on the mock provider.

## Scenario 4: `AI_PROVIDER=gateway` on OpenRouter

**Setup.** Run once, for every case in this scenario. Scenario 3 Setup step 1 must be done. You need an OpenRouter key with credit.

1. Edit `.dev/p403e/packages/env/.env`. Set these keys:

```sh
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://openrouter.ai/api/v1
AI_GATEWAY_API_KEY=sk-or-v1-<key>
AI_GATEWAY_HEADERS={"HTTP-Referer":"https://example.com","X-OpenRouter-Title":"My app"}
AI_MODEL=openai/gpt-6-luna
```

2. Run `pnpm env:setup` in `.dev/p403e`, then stop and start the API as in Scenario 3 Setup steps 3 to 5.

- [ ] Setup complete

### TC-4.1: Streamed reply, one tool call and the usage line  ·  🔴 Critical

**Goal.** A real model on OpenRouter streams, calls a tool through approval and logs its usage.

**Steps**

1. Send one plain message.

   ```sh
   curl -N -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Say hello in five words."}]}]}' http://localhost:4000/chat
   ```

   - [ ] The reply arrives in several `text-delta` chunks and ends in `finish` and `data: [DONE]`
2. Open http://localhost:3002/chat. Send "Rename my workspace to Acme." Click Approve on the approval card.
   - [ ] The model calls `rename_workspace`, and after Approve the tool card shows Finished with the output `{"renamed":"Acme"}`
3. Read the API log.

   ```sh
   grep -A 20 "'ai usage'" .afkkit/logs/G5-api-vite.log | tail -n 22
   ```

   - [ ] The last `ai usage` line has `provider: 'gateway'` and token counts that are not 0

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.2: A wrong key gives `code: "auth"`  ·  🟡 Normal

**Goal.** A wrong OpenRouter key reaches the client as a normalized `auth` error.

**Steps**

1. Set `AI_GATEWAY_API_KEY=sk-or-v1-wrong` in `.dev/p403e/packages/env/.env`. Run `pnpm env:setup` and restart the API.
2. Send one plain message.

   ```sh
   curl -N -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Hello"}]}]}' http://localhost:4000/chat
   ```

   - [ ] The stream holds an `error` chunk whose `errorText` has `"code":"auth"`, and the `ai error` log line has `code: 'auth'` with no stack

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Go to Scenario 5. Scenario 5's reset puts the project back on the mock provider.

## Scenario 5: `AI_PROVIDER=gateway` on Vercel AI Gateway

**Setup.** Run once, for every case in this scenario. Scenario 3 Setup step 1 must be done. You need a Vercel AI Gateway API key.

1. Edit `.dev/p403e/packages/env/.env`. Set these keys:

```sh
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://ai-gateway.vercel.sh/v1
AI_GATEWAY_API_KEY=<vercel-ai-gateway-key>
AI_GATEWAY_HEADERS=
AI_MODEL=openai/gpt-6-luna
```

2. Run `pnpm env:setup` in `.dev/p403e`, then stop and start the API as in Scenario 3 Setup steps 3 to 5.

- [ ] Setup complete

### TC-5.1: Streamed reply, one tool call and the usage line  ·  🔴 Critical

**Goal.** A real model on Vercel AI Gateway streams, calls a tool through approval and logs its usage.

**Steps**

1. Send one plain message.

   ```sh
   curl -N -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Say hello in five words."}]}]}' http://localhost:4000/chat
   ```

   - [ ] The reply arrives in several `text-delta` chunks and ends in `finish` and `data: [DONE]`
2. Open http://localhost:3002/chat. Send "Rename my workspace to Acme." Click Approve on the approval card.
   - [ ] The model calls `rename_workspace`, and after Approve the tool card shows Finished with the output `{"renamed":"Acme"}`
3. Read the API log.

   ```sh
   grep -A 20 "'ai usage'" .afkkit/logs/G5-api-vite.log | tail -n 22
   ```

   - [ ] The last `ai usage` line has `provider: 'gateway'` and token counts that are not 0
     - the skill says Vercel does not document usage in a streamed reply; record what the line shows

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-5.2: A wrong key gives `code: "auth"`  ·  🟡 Normal

**Goal.** A wrong Vercel key reaches the client as a normalized `auth` error.

**Steps**

1. Set `AI_GATEWAY_API_KEY=wrong-key` in `.dev/p403e/packages/env/.env`. Run `pnpm env:setup` and restart the API.
2. Send one plain message.

   ```sh
   curl -N -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Hello"}]}]}' http://localhost:4000/chat
   ```

   - [ ] The stream holds an `error` chunk whose `errorText` has `"code":"auth"`, and the `ai error` log line has `code: 'auth'` with no stack

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Put the project back on the mock provider. Edit `.dev/p403e/packages/env/.env`. Set `AI_PROVIDER=mock` and clear the three `AI_GATEWAY_*` keys. Then run `pnpm env:setup` and restart the API.

```sh
cd .dev/p403e && pnpm env:setup
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Revision: `092d25fd57b7d3c5e05c02ac9ca0362b11682710`, clean tree. Every gate below ran on this revision during this QA run. Logs are in `.afkkit/logs/qa/`.

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm docs:check
```

```sh
cd .dev/p403e && pnpm --filter @repo/ui --filter @repo/app --filter @repo/api --filter @repo/ai typecheck
```

```sh
cd .dev/p403e && cmp packages/ui/src/blocks/ai-chat.tsx ../../modules/ai/files/ui/blocks/ai-chat.tsx && cmp packages/ai/src/sdk/chat.ts ../../modules/ai-sdk/files/chat.ts && cmp apps/app/src/components/ai-chat.tsx ../../modules/ai-sdk/files/app/ai-chat.tsx && cmp apps/app/src/lib/ai-chat-messages.ts ../../modules/ai-sdk/files/app/ai-chat-messages.ts
```

```sh
cd .dev/p403e && grep -rln 'from "ai"' packages/ai/src | grep -v /sdk/
```

- ✅ `pnpm test` → exit 0; node suites 1098 pass, 0 fail; CLI vitest 75 files pass; tooling 471 tests pass (`.afkkit/logs/qa/test.log`)
- ✅ `pnpm lint` → exit 0; oxlint type-aware, oxlint plain, Stylelint and Prettier all clean (`.afkkit/logs/qa/lint.log`)
- ✅ `pnpm docs:check` → exit 0, "64 generated pages are current" (`.afkkit/logs/qa/docs-check.log`)
- ✅ `.dev/p403e` typecheck of `@repo/ui`, `@repo/app`, `@repo/api`, `@repo/ai` → exit 0 (`.afkkit/logs/qa/dev-typecheck.log`)
- ✅ `.dev/p403e` rendered block, driver and island files → byte-identical to the module files at HEAD

Acceptance checks, one line per `agent` C-id in `.afkkit/checks.md`:

- ✅ C4 → define.test "throws when AI_PROVIDER is unset, and names the registered providers" and "throws when AI_PROVIDER names a provider that is not registered" pass; scripts/provider-selection "ai (AI_PROVIDER, required)" passes
- ✅ C5 → define.test "takes the feature's own env key first", "takes config.ai.models next", "takes AI_MODEL next", "takes config.ai.defaultModel last", "throws not_configured when no id resolves" pass
- ✅ C6 → define.test "gives unknown when the provider's normalizer throws" passes
- ✅ C7 → the `ai` core tests pass (19); in `.dev/p403e`, `grep -rln 'from "ai"' packages/ai/src | grep -v /sdk/` prints nothing (exit 1); only the driver-owned `src/sdk/` imports `ai`
- ✅ C8 → scripts/env-presets "ai ships a preset for its envVars" and "ai's preset names exactly its envVars" pass; scripts/ai-spec-imports "holds no value import of @ai-sdk/provider" and "holds no import of ai or @ai-sdk/react outside modules/ai-sdk" pass
- ✅ C9 → mock.test "generate returns the last user message as text" and "stream sends the echo as text-start, several text-delta parts, text-end, then finish" pass
- ✅ C10 → mock.test "/mock reasoning…", "/mock tool…", "/mock source…", "/mock error 429 throws an AI SDK APICallError that is retryable", "a failure takes the status rule unless the line sets retryable or final" pass
- ✅ C11 → mock.test "createAi({ AI_PROVIDER: "mock" }).model("default") is a v4 model" passes
- ✅ C12 → gateway.test "normalizeError on recorded bodies": 13 recorded bodies plus RetryError, StreamProviderError, raw mid-stream body, refused connection and plain error, all with a stubbed `fetch`; "wrong key: HTTP 401 is auth" passes
- ✅ C13 → env.test "refuses a blank AI_GATEWAY_API_KEY while AI_PROVIDER=gateway" and "accepts a blank URL and key while AI_PROVIDER=mock" pass
- ✅ C14 → env.test "refuses AI_GATEWAY_HEADERS that is not a JSON object of strings" passes (cases include `[1]`)
- ✅ C15 → `modules/ai-gateway/skills/saasaloy-ai-gateway/SKILL.md` has `## Cloudflare AI Gateway` (line 26, URL `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`), then `## OpenRouter` (line 44), then `## Vercel AI Gateway` (line 58)
- ✅ C16 → chat.test "streams the reply and ends in a finish chunk and [DONE]" passes; live `curl` below shows `finish` then `data: [DONE]`
- ✅ C17 → chat.test "retries a 429 three times, then ends the stream with a rate_limited error and logs it" and generate "throws a 429 as AiError rate_limited, retryable, after 3 model calls" pass
- ✅ C18 → chat.test asserts no stack reaches `console.error` (lines 232 and 359) and exactly one `ai error` line; G5's api log holds 0 lines that match `    at ` (`.afkkit/e2e/api-log-after-run.txt`)
- ✅ C19 → chat.test "runs an approved tool on the next request" and "skips a denied tool on the next request" pass; the browser check below confirms both in the app
- ✅ C20 → chat.test "logs one usage line per turn with every usage field" passes; the `.dev` log line has the 9 PrimeShopr fields plus `feature`, `provider`, `model`, `finishReason`
- ✅ C21 → every block state renders in the browser from the island's neutral props (10 screens, 4 variants each, below); scripts/ai-spec-imports "holds no import of ai or @ai-sdk/react outside modules/ai-sdk" passes for the block
- ✅ C22 → ai-chat-messages.test `toBlockMessages`, `approvalIdFor` and `toBlockError` suites pass; in the browser, Approve and Deny send the answer and the turn resumes
- ✅ C23 → scripts/block-semantic-tokens "reads only semantic tokens in every block file" passes; `.dev/p403e` typecheck of `@repo/ui` and `apps/app` exits 0
- ✅ C24 → `## Wire-up` at `modules/ai/skills/saasaloy-ai/SKILL.md:44` and `modules/ai-sdk/skills/saasaloy-ai-sdk/SKILL.md:106`; scripts/skills "each skill of a module that writes a UI block has a Wire-up section" passes
- ✅ C25 → in `.dev/p403e` (`add ai ai-mock` pulled `ai-sdk` in), the test route streams with `x-vercel-ai-ui-message-stream: v1` and every block state renders in the browser. The API runs under the project's `vite dev` on workerd, because bare `wrangler dev` fails at startup on `@repo/db`'s `import.meta.glob` (base template, `.afkkit/logs/G5-api-wrangler-failed.log`)
- ✅ C26 → `docs/adr/0072-adr-ai-frameworks-are-drivers-model-vendors-are-providers-2026-11-28.md` exists; `CONTEXT.md` `## AI` has `LanguageModelV4` contract, AI provider, AI driver, Model id resolution, Chat block, Chat island, Tool approval, Usage line
- ✅ C27 → `pnpm lint`, `pnpm test` and `pnpm docs:check` exit 0 at `092d25fd` (above)
- ✅ C28 → this plan lists the live checks for Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway (Scenarios 3, 4 and 5)

Endpoint checks against the running API:

```sh
curl -s -c /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"email":"member@example.test","password":"saasaloy-dev-password"}' http://localhost:4000/auth/sign-in/email
```

```sh
curl -s -w '\n%{http_code}\n' -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Hello there friend"}]}]}' http://localhost:4000/chat
```

```sh
curl -s -i -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Hello there friend"}]}]}' http://localhost:4000/chat
```

```sh
curl -s -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"/mock error 429\nBusy?"}]}]}' http://localhost:4000/chat
```

```sh
curl -s -b /tmp/qa403-cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3002' -d '{"id":"c1","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"/mock source\nWhere?"}]}]}' http://localhost:4000/chat
```

- ✅ sign-in → 200
- ✅ `POST /chat` with no session → 401 `{"error":{"code":"unauthorized","message":"sign in first"}}`
- ✅ `POST /chat` plain text → 200, `x-vercel-ai-ui-message-stream: v1`, `text-delta` "Hello ", "there ", "friend", then `{"type":"finish","finishReason":"stop"}` and `data: [DONE]`
- ✅ `POST /chat` `/mock error 429` → `{"type":"error","errorText":"{\"code\":\"rate_limited\",\"message\":\"The AI service is busy. Try again in a moment.\",\"retryable\":true}"}`, then `data: [DONE]`
- ✅ `POST /chat` `/mock source` → `{"type":"source-url","sourceId":"mock-source-1","url":"https://example.com/mock-source","title":"Mock source"}`

### Browser checks
_Driven with `playwright-cli` (Playwright 1.66 Chromium) against `http://localhost:3002/chat` at `092d25fd`, signed in as `member@example.test`. Each check ran in 4 variants: light and dark, at 1440 px and 375 px; 100 of 100 passed. 40 screenshots, local to this run and not committed._

- ✅ `/chat` · `html` class follows the stored theme → `light` and `dark` in their variants
- ✅ empty state · heading "Ask anything about your workspace" and 3 suggestion buttons; Send disabled on a blank draft → `suggestions=3`, `disabled=true`
- ✅ suggestion click · "Find a recent record" is sent and echoed; the empty state goes → 2 occurrences, 0 suggestions left
- ✅ `/mock reasoning` · the Reasoning toggle opens → `aria-expanded` `false -> true`
- ✅ `/mock source` · the source is a link in the "Sources" list → `href=https://example.com/mock-source target=_blank rel=noopener noreferrer`
- ✅ `/mock tool rename_workspace slow` · the running row shows while the input streams → "Running rename_workspace…", Stop visible
- ✅ approval card · badge "Approval required", one Approve and one Deny button → `badge=1 deny=1`
- ✅ Approve · the tool runs → Finished badge, Output `{"renamed": "Acme"}`, no Approve button left, reply "Tool result: rename_workspace returned {"renamed":"Acme"}."
- ✅ Deny · the tool is skipped → Denied badge, no Output disclosure, no output, reply "rename_workspace was denied."
- ✅ `/mock error 429` · `role="alert"` banner with Retry → "The AI service is busy. Try again in a moment."; Retry sends 1 new `POST /chat`
- ✅ `/mock slow` · Stop shows while streaming; Stop ends the stream and Send comes back → text stable 1.5 s after Stop
- ✅ every screen · no horizontal overflow → `scrollWidth - clientWidth` = 0 at 1440 px and at 375 px
- ✅ every run · console errors → none

## Not covered / needs human judgment
- The side-panel layout of the block (`title` and `description`) has no `.dev` page, so no screenshot or browser check covers it. TC-2.1 names it.
- The "Thinking" skeleton row before the first token shows for a short time only. The browser checks did not capture it.
- Keyboard focus order and screen reader announcements of a streamed reply are not checked.
- The 429 retry count is not visible in the `.dev` stream; the unit test proves 3 model calls (C17).
- Forged approvals: the route passes `approvalSecret`. G5's `curl` with a wrong signature gave no tool output and an `unknown` error (`.afkkit/e2e/06-tool-forged.txt`). A required env key for the secret is a follow-up, not part of this plan.
- Live gateway behavior needs real keys and money. Scenarios 3 to 5 stay manual.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
