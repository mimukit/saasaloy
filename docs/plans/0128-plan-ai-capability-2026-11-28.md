# Plan: an `ai` capability with an AI SDK driver, a gateway provider and a chat block

Grilled: 2026-11-28

## Context

PrimeShopr shipped an admin co-pilot on `ai` 7.0.179 and `@ai-sdk/openai`, then moved its generic AI code into a `@repo/ai` package (PrimeShopr `docs/plans/0062-plan-shared-ai-package-2026-11-24.md`). Saasaloy has no AI capability, so the next project that adds an AI feature copies that code again, picks its own vendor wiring and drifts on error handling and usage logging.

Saasaloy's existing `agent` module goes the other way: it exposes the product to outside agents through OpenAPI, MCP and llms.txt. The new `ai` capability lets the product call a model. The two names do not collide.

The research is in `docs/research/0017-research-ai-capability-adapters-2026-11-27.md`. Its main findings:

- `ai` 7.0.183 (2026-11-26) owns the `LanguageModelV4` spec in `@ai-sdk/provider` 4.0.39. Mastra 1.86.0, Vercel `eve` 1.5.0 and Cloudflare `agents` 0.34.1 all take a V4 model.
- TanStack AI 1.8.0 uses its own adapters and AG-UI events, and it does not take a V4 model.
- Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway all expose the OpenAI chat completions API with `vendor/model` ids. Cloudflare's docs do not cover tool calls or streamed usage on that API.

Two spikes ran on 2026-11-28. Their verdicts are in Design decisions, and the throwaway code is deleted.

**Goal:** a Saasaloy project adds an AI feature with one model call site, one error shape and one usage record, and it changes the gateway or the model with an env change and no code change.

**Target:** no number fits a new capability. These observables show that it worked:

- In a fresh `.dev` project, `saasaloy add ai ai-sdk ai-mock` gives an app page whose chat block streams a reply, shows a tool call with approve and deny, and shows a source, all from the mock provider under `wrangler dev`, with no vendor account.
- A 429 reaches the caller as `AiError` with `code: "rate_limited"` and `retryable: true`, after the AI SDK retries.
- Measured after the build, in the QA plan: `AI_PROVIDER=gateway` streams a real reply from Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway with no code change.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Core contract | The `ai` core types its models as `LanguageModelV4` from `@ai-sdk/provider`, with a type import only. Mastra, eve and Cloudflare `agents` take the same type, so a later Mastra module reuses the same providers. Research 0017. |
| Spec lock-in | Accepted. Vercel controls `LanguageModelV4`, and a V5 spec means a coordinated bump of the core and every provider. Owner, 2026-11-28. |
| Spec package | `@ai-sdk/provider` is an exact-pinned `dependencies` entry of `packages/ai`, imported with `import type` only. A test in `scripts/` fails when `packages/ai/src` or `modules/ai*/files` holds a value import from it. AGENTS.md's "The core is vendor-blind" rule gains one line: a type-only import of a shared spec package is allowed. Grill Q10. |
| Vendor layer | Model vendors and gateways are **providers** (ADR 0033, ADR 0037). `AI_PROVIDER` selects one at runtime. It holds one value, not a list, because each gateway does its own fallback. An unset or unknown value throws at construction, and nothing falls back to a default. Grill Q4, defaulted. |
| Framework layer | An AI framework is a **driver** (ADR 0026): it owns the runtime files, so a change of framework replaces files. v1 ships `ai-sdk` only. A later `ai-tanstack` declares `conflictsWith: ["ai-sdk"]`. A later Mastra module adds on top of `ai-sdk`, because it takes the same V4 models. |
| Driver location | The `ai-sdk` driver is its own module. The `ai` core keeps zero runtime dependencies. The driver adds `ai` to `packages/ai`. Owner, 2026-11-28. |
| v1 providers | `ai-gateway` and `ai-mock`. No direct vendor provider (OpenAI, Anthropic, Workers AI binding) ships in v1. |
| Gateway provider | One `ai-gateway` provider file on `@ai-sdk/openai-compatible`. It reads `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY` and `AI_GATEWAY_HEADERS`, and each model id uses the gateway's own `vendor/model` form. Vendor-only features that the compatible API drops are a known limit. Owner, 2026-11-28. |
| Supported gateways | Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway are first-class: the skill documents each one, in that order, with its base URL, key and header example. Cloudflare uses `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` with a Cloudflare API token, not the deprecated `/compat` URL. LiteLLM works through the same file but is not documented in v1. Grill Q14, Q18. |
| Gateway headers | `AI_GATEWAY_HEADERS` is optional: a JSON object of string header names and values, such as `{"cf-aig-gateway-id":"main"}`. The env gate parses it and refuses anything that is not an object of strings. Grill Q15. |
| Gateway key rule | `AI_GATEWAY_URL` and `AI_GATEWAY_API_KEY` are required only while `AI_PROVIDER=gateway` (ADR 0070, `envRequiredWhen`). |
| Local provider | `ai-mock` is a scripted `LanguageModelV4` written in the provider file with no imports. By default it echoes the last user message in streamed chunks. A script can make it send reasoning, a tool call, a source part, or a failure with a set status code and retryable flag. It does not import `ai/test`, because a provider must not need the driver. Grill Q17, defaulted. |
| `mock` in production | No guard, the same as `kv-memory`. The skill warns against it. Grill Q8, defaulted. |
| Model id | `model(feature)` reads, in order: the feature's `<FEATURE>_MODEL` env key, `config.ai.models.<feature>`, the core's `AI_MODEL` env key, then `config.ai.defaultModel`. The core declares `AI_MODEL`. Each feature module declares its own `<FEATURE>_MODEL`, such as `COPILOT_MODEL`. No id found throws `AiError` `not_configured`. Grill Q9. |
| Config section | The `ai` section holds `defaultModel` and `models` (a record of feature to model id, empty by default). `defaultModel` ships as one low-cost `vendor/model` id that Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway all list. The build picks it from their model lists and names the date in the section's JSDoc. |
| Embeddings | Not in v1. The contract has no `embeddingModel`. An optional method later breaks nothing. Grill Q2, defaulted. |
| Error normalization (spike 1) | Each provider exports a pure `normalizeError(err): AiError` with no imports. It finds AI SDK errors through the global `Symbol.for("vercel.ai.error.AI_RetryError")`, `AI_APICallError` and `AI_StreamProviderError` markers and maps the vendor code. The driver calls it at the edge: in a `catch` around `generateText`, and in `onError` of `streamText` and `toUIMessageStreamResponse`. **A provider never wraps the model**: a rethrow inside `doGenerate` stopped the AI SDK retries (1 model call instead of 3). |
| Normalizer failure | When a provider's `normalizeError` throws or returns something other than `AiError`, the core wraps the original error as `AiError` `unknown`, as `kv`'s `run()` does. Grill Q7, defaulted. |
| Error codes | `AiError` carries `code`, `providerCode`, `retryable` and `status`. The codes: `auth`, `rate_limited`, `quota`, `context_length`, `invalid_request`, `not_found`, `timeout`, `unavailable`, `content_filtered`, `not_configured`, `unknown`. |
| Workers runtime (spike 2) | `ai` 7.0.183 `streamText` and `toUIMessageStreamResponse` run under workerd 1.20260930.2 (wrangler 4.145.0) with `compatibility_date` 2026-07-21 and no `nodejs_compat` flag. The base `api` module's `wrangler.jsonc` needs no change. |
| Node and ESM | AI SDK v7 needs Node 22+ and ships ESM only. The template requires Node >=24.15.0, and all 7 template workspaces are ESM, so nothing changes. |
| Driver error log | `streamText` logs a full stack to the console by default. The driver always passes its own `onError`, which sends the normalized `AiError` to `@repo/logger`. The driver needs no new `dependsOn`, because `api` already depends on `logger`. Grill Q1, defaulted. |
| Usage record | One structured log line per turn through `@repo/logger`, with PrimeShopr's fields (`steps`, `tools`, `inputTokens`, `cachedInputTokens`, `uncachedInputTokens`, `outputTokens`, `reasoningTokens`, `totalTokens`, `cachePercent`). No table. Grill Q5, defaulted. |
| Tool approval | End to end. `streamChat` passes AI SDK v7's `toolApproval` for each tool that asks for it. The island sends the approve or deny answer through `useChat`, and the next request runs or skips the tool. Grill Q16. |
| Chat route | v1 mounts no route. The driver ships the `streamChat` helper, and the skill's Wire-up section shows a feature route that uses it. Phase 7 mounts a test route only in the `.dev` project. Grill Q11. |
| PrimeShopr port | v1 ports only the helpers that need no database: `untrusted()`, the usage fields, the date line (`dayLine`) and the stream tool-call reader (`toolCallsOf`). `toolReply` masking, the read-only SQL tool, the table describer and the proposal tools go to a follow-up issue, because they need a mask helper and a read-only query helper in `database` first. Owner, 2026-11-28. |
| Where the ported code goes | `untrusted`, the usage field type and `dayLine` go in the core, because they import nothing. `toolCallsOf` and the usage reader for the `onEnd` event go in the `ai-sdk` driver, because they read AI SDK message shapes. |
| Chat block | The `ai` core ships the presentational block `@ui/blocks/ai-chat.tsx` with neutral props and no AI SDK import (ADR 0030). It renders text, reasoning, tool calls with their state, sources, approve and deny buttons, an error with a retry action, and a stop button while it streams. Its function props are `onSend`, `onStop`, `onRetry` and `onApprove(toolCallId, approved)`. Grill Q13. |
| Chat island | The `ai-sdk` driver ships the island `@app/components/ai-chat.tsx` in `apps/app`, the signed-in SPA, so token spend stays behind sign-in. It calls `useChat` from `@ai-sdk/react` and maps each `UIMessage` to the block's props. A later `ai-tanstack` driver reuses the block with its own island. Grill Q12. |
| UI house rules | The block uses semantic tokens only, so `scripts/block-tokens.test.ts` passes. It uses the Base UI (`base-nova`) primitives in `packages/ui`, carries `"use client"`, and keeps its copy as prop defaults. It follows `apps/web/DESIGN.md` where it applies. |
| Public registry | The block joins the public registry as a presentational block once plan 0121's registry build lands. Grill Q6, defaulted. |
| Visual reference | None exists yet. Phase 1 is a mockup round, and the owner approves it before any build. The images go to the `mockups: mimukit/saasaloy` gist, named `0128-r<round>-<screen>-<theme>-<width>.png`. |
| Tests | Vitest in Node, beside the source (`src/<name>.test.ts`), the same as `packages/kv`. The core and provider tests need no network and no `ai` package. The driver tests use the `ai-mock` provider. `scripts/env-presets.test.ts` covers the new presets. The Phase 7 `.dev` run is the workerd check. |
| Live gateway check | Not a plan phase. After Phase 7, `qakit` writes a QA plan whose manual list checks Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway: a streamed reply, one tool call, the usage line, and a wrong key that gives `code: "auth"`. If Cloudflare fails the tool call or the usage line, the skill states that limit. Grill Q19, Q21. |
| Attended phases | Phase 1 only. Phases 2 to 7 can run unattended. Grill Q21. |
| Outward actions | Approved: commit and push this plan and research 0017 to `main`, and file one follow-up issue for the `toolReply` masking, SQL tool, table describer and proposals port. Grill Q20. |
| Module names | `ai`, `ai-sdk`, `ai-gateway`, `ai-mock`. Every module name is singular (AGENTS.md). |

## Approach

Recommended: **a provider-shaped core with one driver.** The core holds the contract, the selection and the neutral helpers. The providers hold the vendor wiring. The driver holds every line that imports `ai`. This is the `kv` shape plus the `database` driver split, applied to one capability.

It reuses:

- The `kv` core as the template for `provider.ts`, `define.ts`, `index.ts`, `env-preset.ts`, the generated `providers` and `envPresets` tables, and the `run()` wrapping pattern (`modules/kv/files/src/`).
- `kv-upstash` as the template for a provider with an npm dependency and keys required only while it is selected (`modules/kv-upstash/registry-item.json`).
- The `storage` config section as the template for `ai`'s section (`modules/storage/files/config/storage.ts`, the `config.sections` table).
- The `api.envPresets` table and `scripts/env-presets.test.ts`.
- `@repo/logger` for the error log and the usage line.
- ADR 0030's block-plus-island split, as `waitlist` uses it, with the island in `apps/app` as the `agent` module places `@app/routes/agents.tsx`.
- PrimeShopr `packages/ai/src/{prompt,usage,stream}.ts` and the `untrusted` part of `tool-reply.ts`, with their tests.

Rejected alternatives:

- **A Saasaloy-owned model interface with adapters to V4 and TanStack.** It invents a third spec, duplicates what V4 already covers, and needs maintenance on every AI SDK release.
- **One runtime interface over every framework.** It keeps only what all frameworks share, so it loses tool approval, structured output and agents.
- **AI SDK folded into the core.** It breaks the zero-dependency core rule. The owner chose the separate driver.

### Phase 1: chat block mockup

Attended: the owner approves a mockup round for the chat block.

1. Use `uikit` mockup mode with `codex-images` to make one round for the chat block. Show it in light and dark at desktop and mobile widths.
2. Cover these states: empty with a prompt hint, a streamed reply with reasoning, a tool call in progress and finished, a tool call that waits for approve or deny, a reply with sources, an error with a retry action, and the stop button while it streams.
3. Show the block in two placements inside the `apps/app` shell: a full page and a side panel next to a table screen, as the PrimeShopr co-pilot uses it.
4. Publish the round to the `mockups: mimukit/saasaloy` gist and post the links where the owner reviews them.
5. Record the approved round as a "Mockup approved" row in Design decisions, with the date and the gist links.

Done when: Design decisions holds a "Mockup approved" row that names the round and the gist files.

### Phase 2: the `ai` core module

1. Create `modules/ai` with `registry-item.json`, `files/` and `skills/saasaloy-ai/SKILL.md`, using the `create-module` skill.
2. Scaffold `packages/ai` (`@repo/ai`) with `package.json` (a `clean` script on `rimraf`, the exact-pinned `@ai-sdk/provider`), `tsconfig.json` and `src/providers/.gitkeep`.
3. Write `src/provider.ts`: the `AiEnv` type, the `AiProvider` contract (`name`, `languageModel(env, modelId)`, `normalizeError(err)`), `AiError` and its codes.
4. Write `src/define.ts`: `defineAi({ providers })`, provider selection from `AI_PROVIDER` with the `kv` throw rules, `model(feature)` with the four-step resolution, and the wrap of a failed `normalizeError`.
5. Write `src/index.ts`: `createAi(env)` over the generated `ai.providers` table.
6. Write `src/env-preset.ts` with `AI_PROVIDER` (required) and `AI_MODEL` (optional), and the generated `ai.envPresets` table. Add the `api.envPresets` entry.
7. Write the `ai` config section in `files/config/ai.ts`, registered in `config.sections`.
8. Port `untrusted()`, the usage field type and `dayLine` from PrimeShopr with their tests.
9. Add the `scripts/` test for type-only imports of `@ai-sdk/provider`, and the one line in AGENTS.md.
10. Write `define.test.ts`: an unset provider throws, an unknown provider throws, each of the four model steps wins in turn, a missing model throws `not_configured`, and a throwing `normalizeError` gives `unknown`.

Done when: `pnpm --filter @repo/ai test` passes in a `.dev` project with `ai` added, `scripts/env-presets.test.ts` and the type-import test pass, and `grep -rn "from \"ai\"" packages/ai/src` in that project prints nothing.

### Phase 3: the `ai-mock` provider

1. Create `modules/ai-mock` with the provider file and its entry in `ai.providers`.
2. Implement a `LanguageModelV4` with no imports. `doGenerate` returns the echo. `doStream` sends the echo as `text-start`, `text-delta` and `text-end` parts, then `finish` with usage.
3. Add the script options: reasoning parts, one tool call, one source part, and a failure with a set status code and retryable flag. Write `normalizeError` for the failure.
4. Write tests for the echo, each script option and the error mapping.

Done when: the `ai-mock` tests pass, and `createAi({ AI_PROVIDER: "mock" }).model("default")` returns a model whose `specificationVersion` is `"v4"`.

### Phase 4: the `ai-gateway` provider

1. Create `modules/ai-gateway` with an exact-pinned `@ai-sdk/openai-compatible` patch into `packages/ai/package.json`.
2. Write the provider file. It builds the model from `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY`, the parsed `AI_GATEWAY_HEADERS` and the model id.
3. Write `normalizeError` for OpenAI-style error bodies: `rate_limit_exceeded`, `insufficient_quota`, `context_length_exceeded`, `invalid_api_key`, `content_filter`, 401, 402, 403 and 5xx statuses.
4. Write the env preset: the URL and key required while `AI_PROVIDER=gateway`, and the headers optional and parsed as a JSON object of strings. Add the descriptor's `envRequiredWhen` and `removeWarnings`.
5. Write the skill's gateway section: Cloudflare, OpenRouter and Vercel, each with its base URL, key, model id and header example.
6. Write tests that feed recorded error shapes to `normalizeError`, using no network, and env tests for the header parse.

Done when: the `ai-gateway` tests pass, the env gate refuses a blank `AI_GATEWAY_API_KEY` while `AI_PROVIDER=gateway` and accepts it under `AI_PROVIDER=mock`, and the gate refuses `AI_GATEWAY_HEADERS=[1]`.

### Phase 5: the `ai-sdk` driver

1. Create `modules/ai-sdk` with exact-pinned `ai` in `packages/ai` and `@ai-sdk/react` in `apps/app`.
2. Write the server helpers: a `generate` wrapper that turns a thrown error into `AiError`, and a `streamChat` helper that calls `streamText`, passes `toolApproval` for each tool that asks for it, and returns `toUIMessageStreamResponse`. Both pass an `onError` that normalizes the error and logs it, and both log the usage line at the end of the turn.
3. Port `toolCallsOf` and the `onEnd` usage reader from PrimeShopr with their tests.
4. Write driver tests on `ai-mock`: a streamed reply ends in `finish` and `[DONE]`; a retryable failure retries and then reaches the caller as `AiError`; no stack reaches `console.error`; an approved tool call runs and a denied one does not; the usage line has every field.

Done when: the `ai-sdk` tests pass, and a 429 from `ai-mock` reaches the test as `AiError` with `code: "rate_limited"` and `retryable: true` after 3 model calls.

### Phase 6: the chat block and its island

1. Build `@ui/blocks/ai-chat.tsx` in the `ai` core module from the approved Phase 1 round.
2. Build the island `@app/components/ai-chat.tsx` in the `ai-sdk` driver. It calls `useChat`, maps each `UIMessage` to the block's props, and sends approve and deny answers.
3. Write the `## Wire-up` sections in the `saasaloy-ai` and `saasaloy-ai-sdk` skills, with the example feature route that uses `streamChat`.
4. Add the block to the public registry list if plan 0121's registry build has landed. Otherwise record the step on the 0121 tracking issue.

Done when: `scripts/block-tokens.test.ts` passes, `@repo/ui` and `apps/app` typecheck in a `.dev` project, and the rendered block matches the approved round in light and dark.

### Phase 7: end to end in `.dev`, docs and the ADR

1. In `.dev`, init a project and run `saasaloy add ai ai-sdk ai-mock`. Mount a test route that calls `streamChat` with one tool that asks for approval, and place the island on an app page.
2. Run the app with `wrangler dev` and send messages that drive each mock script: text, reasoning, the tool call with approve and with deny, a source, and a 429 failure. Check the `x-vercel-ai-ui-message-stream: v1` header.
3. Record an ADR for the split: frameworks are drivers, model vendors are providers, and the core contract is `LanguageModelV4`. Add the new terms to `CONTEXT.md`.
4. Run `pnpm docs:generate`, check the pages that `docs/wiki/.wikimap.yaml` maps to the touched paths, and run `pnpm docs:stale`.
5. Run `pnpm lint`, `pnpm test` and `pnpm docs:check`.
6. Run `qakit` to write the QA plan, with the live gateway check as its manual list.

Done when: the `.dev` page shows every block state from the mock under `wrangler dev`, the 429 shows the error state, `pnpm lint`, `pnpm test` and `pnpm docs:check` pass, and the QA plan in `docs/qa/` lists the three live gateway checks.

## Open questions

None. The grill on 2026-11-28 settled every question. The answers are in Design decisions.

## Non-goals

- No `ai-tanstack`, Mastra, eve, LangChain or OpenAI Agents module. Each one is its own plan.
- No direct vendor provider (`ai-openai`, `ai-anthropic`, `ai-workers-ai`). The gateways reach those vendors in v1.
- No documented LiteLLM setup in v1.
- No mounted chat route in `apps/api`, and no chat island in `apps/web`.
- No port of `toolReply` masking, the read-only SQL tool, the table describer or the proposal tools. A follow-up issue holds them.
- No embeddings, MCP client, agents, workflows, RAG or stored chat history.
- No token budget or spend cap beyond what the gateways and the existing `ratelimit` module give.
- No change to the `agent` module.
