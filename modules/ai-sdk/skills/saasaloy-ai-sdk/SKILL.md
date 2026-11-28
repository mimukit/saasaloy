---
name: saasaloy-ai-sdk
description: Runbook for the ai-sdk driver — the `generate` and `streamChat` helpers in @repo/ai/sdk on the Vercel AI SDK, which retry, turn every failure into AiError, log it without a stack, log one usage line per turn and run a tool only after the user approves; plus `toolCallsOf` and `turnUsage`. Use when writing an AI route, streaming a chat to useChat, adding a tool that needs approval, reading the usage line, or storing a finished chat turn.
---

# ai-sdk: the AI SDK driver for the `ai` capability

`saasaloy add ai-sdk` puts the server helpers into `packages/ai/src/sdk/` and exports them as `@repo/ai/sdk`. It also ships the chat island into `apps/app`. It adds `ai` 7.0.181 to `packages/ai`, and `ai` 7.0.181 and `@ai-sdk/react` 4.0.186 to `apps/app`. It is the only module that imports `ai`. The core and the providers import only the `LanguageModelV4` types. `@repo/ai/sdk` also exports `tool`, `jsonSchema` and the `UIMessage` and `ToolSet` types, so a route in `apps/api` needs no `ai` dependency of its own.

Read `modules/ai/skills/saasaloy-ai/` first. This file covers only what the driver adds.

## What it installs

| File | Lands at |
| --- | --- |
| `files/index.ts` | `packages/ai/src/sdk/index.ts`: the `@repo/ai/sdk` exports |
| `files/chat.ts` | `packages/ai/src/sdk/chat.ts`: `generate`, `streamChat`, `chatErrorText` |
| `files/stream.ts` | `packages/ai/src/sdk/stream.ts`: `toolCallsOf`, `isFinishedCall`, `asRecord` |
| `files/turn.ts` | `packages/ai/src/sdk/turn.ts`: `turnUsage`, `usageFields` |
| `files/app/ai-chat.tsx` | `apps/app/src/components/ai-chat.tsx`: `AiChatIsland`, the chat block on `useChat` |
| `files/app/ai-chat-messages.ts` | `apps/app/src/lib/ai-chat-messages.ts`: maps `UIMessage` parts and errors to the block's props |

It also adds `@repo/logger` to `packages/ai/package.json`, because both helpers take a `Logger`. It depends on `ai` and on `app`, because the chat island lives in the signed-in `apps/app`.

## The shared options

Both helpers take these fields:

| Field | Meaning |
| --- | --- |
| `ai` | The client from `createAi(c.env)`. |
| `log` | The request logger, `c.get("log")`. It gets the error line and the usage line. |
| `feature` | The feature name. It picks the model id: `copilot` reads `COPILOT_MODEL` first. |
| `instructions` | The system instructions. |
| `tools` | The AI SDK tools, made with `tool()` from `@repo/ai/sdk`. |
| `approve` | The names of the tools that wait for the user's answer before they run. |
| `approvalSecret` | A secret that signs each approval request. See "Tool approval". |
| `maxSteps` | The model calls one turn may make. The default is `DEFAULT_MAX_STEPS`, 5. |
| `maxRetries` | The retries after the first call. The AI SDK default is 2, so a 429 makes 3 calls. |
| `abortSignal` | Stops the turn. |

## generate: one turn, one answer

```ts
import { createAi } from "@repo/ai";
import { generate } from "@repo/ai/sdk";

const { text } = await generate({ ai: createAi(c.env), log: c.get("log"), feature: "summary", prompt: body });
```

`generate` calls `generateText` and returns its result. It takes `prompt` (a string) or `messages` (model messages). A failure after the retries is thrown as `AiError`, so a route's `catch` reads `error.code` and `error.retryable`.

## streamChat: a chat turn for useChat

```ts
import { createAi } from "@repo/ai";
import { streamChat } from "@repo/ai/sdk";
import type { UIMessage } from "@repo/ai/sdk";

const { messages } = await c.req.json<{ messages: UIMessage[] }>();
return streamChat({ ai: createAi(c.env), log: c.get("log"), feature: "copilot", messages, tools, approve: ["delete_note"] });
```

`streamChat` converts the UI messages, calls `streamText`, and returns a UI message stream `Response` that `useChat` reads. The stream ends with a `finish` chunk and `data: [DONE]`. Pass `onEnd` to store the finished chat. It receives the full message list.

A model id that does not resolve throws `AiError("not_configured")` before the stream starts. Every later failure ends the stream with one `error` chunk. Its text is a `ChatErrorBody` as JSON: `{"code":"rate_limited","retryable":true,"message":"The AI service is busy. Try again in a moment."}`. The message is a fixed text for each code and holds no vendor detail. The chat island parses it to choose its retry action.

## Errors and the error line

The AI SDK retries a retryable failure (408, 409, 429, 5xx) before it gives up. A provider never wraps the model, so the retries happen. Then the driver turns the error into `AiError` through `ai.normalizeError` and logs one `ai error` line: `feature`, `provider`, `model`, `code`, `message`, `providerCode`, `retryable`, `status`. The line holds no stack. `streamText` prints the raw error and its stack to the console when no handler is set, so the driver always sets its own.

## The usage line

At the end of each turn, the driver logs one `ai usage` line with `feature`, `provider`, `model`, `finishReason` and these fields:

| Field | Meaning |
| --- | --- |
| `steps` | The model calls of the turn. |
| `tools` | The tools the model called, in order, joined with `, `. |
| `inputTokens`, `cachedInputTokens`, `uncachedInputTokens` | The input, and the part the prompt cache served. |
| `outputTokens`, `reasoningTokens` | The output, and the part spent on reasoning. |
| `totalTokens` | The input and the output. |
| `cachePercent` | The share of the input the cache served, 0 to 100. |

The line holds no message text. A gateway that sends no usage gives zeros.

## Tool approval

A tool named in `approve` does not run on the first request. The stream sends a `tool-approval-request` chunk, and the tool part in `useChat` has the state `approval-requested`. The island calls `addToolApprovalResponse({ id, approved })`, and `useChat` sends the chat again. On that request, an approved tool runs and the model answers its result. A denied tool does not run, its part has the state `output-denied`, and the model reads the denial.

Set `approvalSecret` whenever an approved tool changes data or spends money. Without it, a client can send back an approval that the server never issued. Use at least 32 random bytes (`openssl rand -base64 32`), keep it in a Workers secret, and use the same value on every Worker. The helpers take the value, so the route reads it from its own env key.

## Store a finished turn

```ts
import { isFinishedCall, toolCallsOf } from "@repo/ai/sdk";

onEnd: async ({ messages, isAborted }) => {
  const calls = toolCallsOf(messages.at(-1)).filter((call) => !isAborted || isFinishedCall(call));
},
```

`toolCallsOf(message)` gives each tool call of a message in order, with `name`, `state`, `input`, `output` and `errorText`. `asRecord(value)` wraps a value that is not an object, so a JSON column always holds an object. `turnUsage(event)` reads the usage fields from an `onEnd` event when you call `generateText` or `streamText` yourself.

## Wire-up

v1 mounts no chat route and places no chat page. Add both yourself: a route in `apps/api` that calls `streamChat`, and a page in `apps/app` that renders the island.

**1. Write the route** at `apps/api/src/routes/chat.ts`:

```ts
import { createAi } from "@repo/ai";
import type { AiEnv } from "@repo/ai";
import { jsonSchema, streamChat, tool } from "@repo/ai/sdk";
import type { UIMessage } from "@repo/ai/sdk";
import { requireSession } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import type { LoggerVariables } from "@repo/logger";
import { Hono } from "hono";
import { declare } from "../contract";

const tools = {
  rename_workspace: tool({
    description: "Rename the user's workspace.",
    inputSchema: jsonSchema<{ name: string }>({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    }),
    execute: async ({ name }) => ({ renamed: name }),
  }),
};

export const chat = new Hono<{ Bindings: AuthDbBindings & AiEnv; Variables: LoggerVariables }>().post(
  "/",
  declare({
    name: "chat_send",
    description: "Stream one chat turn for the signed-in user.",
    agent: { callable: false, reason: "Spends model tokens for a person in the app." },
  }),
  async (c) => {
    await requireSession(c);
    const { messages } = await c.req.json<{ messages: UIMessage[] }>();
    return streamChat({
      ai: createAi(c.env),
      log: c.get("log"),
      feature: "chat",
      messages,
      tools,
      approve: ["rename_workspace"],
      abortSignal: c.req.raw.signal,
    });
  }
);
```

`requireSession` keeps token spend behind sign-in. `approve` makes `rename_workspace` wait for the user's answer. Add `approvalSecret` before a tool changes real data (see "Tool approval").

**2. Mount it** in `apps/api/src/index.ts`, after the generated routes:

```ts
import { chat } from "./routes/chat";

const app = apiRoutes(base).route("/chat", chat);
```

**3. Place the island** on a page, such as `apps/app/src/routes/chat.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { AiChatIsland } from "@app/components/ai-chat";

export const Route = createFileRoute("/chat")({ component: ChatPage });

function ChatPage() {
  return (
    <div className="h-[calc(100dvh-8rem)]">
      <AiChatIsland api="/chat" />
    </div>
  );
}
```

The block fills its parent, so give the parent a height. In a side panel, pass `title` and `description` for the header. `api` is the route path on the api, and it defaults to `/chat`. The island joins it to `PUBLIC_API_URL` and sends the session cookie with `credentials: "include"`, so the app's origin must be in `CORS_ORIGINS`. Pass `copy` to change the empty-state heading, the suggestions and the labels.

The island maps each `UIMessage` part to the block: text, reasoning, each tool state, and `source-url` and `source-document` parts. Approve and Deny call `useChat`'s `addToolApprovalResponse({ id, approved })`, and `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` sends the chat back once every approval has an answer. Retry calls `regenerate()`. Stop calls `stop()`. An error shows the driver's `ChatErrorBody` message. A 401 from the route shows a sign-in line, and a network failure shows a fixed line.

Add a sidebar link through your own `app.nav` entry if you want one. `saasaloy remove ai-sdk` deletes the island files, but not the route, the mount or the page you added. Take those out yourself.

## Removal

`saasaloy remove ai-sdk` deletes `packages/ai/src/sdk/` and the two island files in `apps/app`, and takes `ai`, `@repo/logger` and `@ai-sdk/react` out of the two `package.json` files. Run `pnpm install` afterwards. Every route that imports `@repo/ai/sdk` or `ai` stops compiling. The `@repo/ai/sdk` export stays in `packages/ai/package.json` and resolves to nothing until a driver is installed again.

## Failure modes

- `Cannot find module '@repo/ai/sdk'`: the driver is not installed. Run `saasaloy add ai-sdk`.
- `AiError("not_configured")` thrown by `streamChat` or `generate`: no model id resolves for the feature. Set `<FEATURE>_MODEL` or `AI_MODEL`.
- An `ai error` line with `code: "rate_limited"` after 3 calls: the gateway refused the requests. Wait, or raise the gateway's limit.
- A tool runs with no approval: its name is not in `approve`.
- An `ai error` line with `code: "unknown"` on the request after an approval: the approval signature did not verify. `approvalSecret` changed between the two requests, or a client forged the approval.
- The chat shows "The chat request failed. Try again." on every send: the route is not mounted at the island's `api` path, or the app's origin is missing from `CORS_ORIGINS`. Read the browser's network tab.
- The usage line shows `0` input tokens: the gateway sends no streamed usage. See `saasaloy-ai-gateway`.

## Next

Run `saasaloy-ai-mock` to drive each chat state locally with a `/mock` line.
