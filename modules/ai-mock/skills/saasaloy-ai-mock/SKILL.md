---
name: saasaloy-ai-mock
description: Runbook for the ai-mock provider — a LanguageModelV4 that echoes the last user message and, on a `/mock` line, sends reasoning, a tool call, a source or a set failure, with no vendor account and no network. Use when developing or testing an AI feature locally, driving a chat UI state by hand, proving a 429 retry, or choosing AI_PROVIDER=mock.
---

# ai-mock: a scripted model for local development and tests

`saasaloy add ai-mock` puts `packages/ai/src/providers/mock.ts` into the project and adds `mock()` to the `ai.providers` table. Set `AI_PROVIDER=mock` and `createAi(env).model(feature)` returns the mock model. It needs no key, no account and no network. It imports only the `LanguageModelV4` types and the `ai` core, so it works with any driver.

Read `modules/ai/skills/saasaloy-ai/` first. This file covers only what differs.

## What it answers

By default the model echoes the text of the last user message. `doGenerate` returns it as one text part. `doStream` sends `stream-start`, `response-metadata`, `text-start`, one `text-delta` per word, `text-end`, and `finish`. The usage counts words as tokens, so a usage log line has real numbers.

When the last prompt message is a tool result, the model answers it in text, such as `Tool result: weather returned {"temp":31}.`, or `weather was denied` for a denied call. It does not call the tool again.

## Script a turn with a `/mock` line

Put a line that starts with `/mock` in the user message. The model takes the line out of the echo and reads its words:

| Words | What the model sends |
| --- | --- |
| `/mock reasoning` | A reasoning part before the text. |
| `/mock tool` | One call to the first tool the request offers, then `finish` with `tool-calls`. No text. |
| `/mock tool lookup` | One call to the tool named `lookup`. |
| `/mock source` | One URL source, `https://example.com/mock-source`, after the text. |
| `/mock slow` | A 150 ms wait before each streamed delta, so a UI shows its stop button. |
| `/mock error 429` | A failure with HTTP status 429. Any status from 400 to 599 works. |
| `/mock error 500 final` | A failure that is not retryable. |
| `/mock error 400 retryable` | A failure that is retryable. |

Words combine: `/mock reasoning source slow`. An unknown word is ignored. For a tool call, the rest of the message is the tool input when it is a JSON object, and `{}` when it is not:

```text
/mock tool weather
{"city":"Dhaka"}
```

## Failures

A failure is thrown from `doGenerate` or `doStream` before any part is sent. It carries the AI SDK's global `APICallError` markers, `statusCode`, `isRetryable` and an OpenAI-style body, so the AI SDK retries it the way it retries a real gateway's failure. Without `final` or `retryable`, the AI SDK's rule decides: 408, 409, 429 and 5xx are retryable. The failure sends `retry-after-ms: 0`, so the retries run with no wait.

`normalizeError` maps the failure, bare or inside the AI SDK's `RetryError`, onto `AiError`:

| Status | `code` |
| --- | --- |
| 401, 403 | `auth` |
| 402 | `quota` |
| 404 | `not_found` |
| 408, 504 | `timeout` |
| 429 | `rate_limited` |
| 409, other 5xx | `unavailable` |
| other 4xx | `invalid_request` |

`providerCode` holds the body's code, such as `rate_limit_exceeded`. `retryable` copies the failure's flag.

## In a test

`mock({ script })` sets a script for every call, under the one a `/mock` line asks for:

```ts
import { defineAi } from "@repo/ai";
import { mock } from "@repo/ai/providers/mock";

const ai = defineAi({ providers: [mock({ script: { error: 429 } })] }).create({ AI_PROVIDER: "mock" });
```

The script fields are `reasoning`, `tool` (`true` or a tool name), `source`, `error` (a status), `retryable` and `delayMs`.

## Do not use it in production

Nothing stops `AI_PROVIDER=mock` in a deployed Worker, the same as `kv-memory`. A deploy with it answers every user with an echo of their own message. Set `AI_PROVIDER=gateway` in production, and keep `mock` for local development, tests and preview environments. Check the value with `wrangler secret list` or the Worker's variables before a release.

## Removal

`saasaloy remove ai-mock` deletes `packages/ai/src/providers/mock.ts` and drops the `mock()` row from `ai.providers`. A test that imports `@repo/ai/providers/mock` stops compiling, and `AI_PROVIDER=mock` throws `AI_PROVIDER is "mock", which is not registered.` at the first `createAi(env)` call.

## Next

Run `saasaloy-ai-gateway` to set up a real gateway for production.
