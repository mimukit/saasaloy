// Tests for `generate` and `streamChat` on the real AI SDK and the ai-mock provider: the
// streamed reply, the retries and the error edge, the error and usage log lines, and the
// tool approval round trip as `useChat` drives it. Repo-only: no test file ships.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { APICallError, jsonSchema, readUIMessageStream, tool } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { mock } from "../../ai-mock/files/mock.ts";
import type { MockScript } from "../../ai-mock/files/mock.ts";
import { defineAi } from "../index.ts";
import { AiError } from "../provider.ts";
import type { AiProvider } from "../provider.ts";
import { generate, streamChat } from "./chat.ts";
import type { ChatErrorBody } from "./chat.ts";

const ENV = { AI_PROVIDER: "mock" };

const USAGE_FIELDS = [
  "steps",
  "tools",
  "inputTokens",
  "cachedInputTokens",
  "uncachedInputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
  "cachePercent",
];

interface Calls {
  doGenerate: number;
  doStream: number;
}

/** The mock provider, counting each model call. It passes every result and error through. */
function counted(script?: MockScript): { provider: AiProvider; calls: Calls } {
  const inner = mock({ script });
  const calls: Calls = { doGenerate: 0, doStream: 0 };
  const provider: AiProvider = {
    languageModel(env, modelId): LanguageModelV4 {
      const model = inner.languageModel(env, modelId);
      return {
        ...model,
        doGenerate(options) {
          calls.doGenerate += 1;
          return model.doGenerate(options);
        },
        doStream(options) {
          calls.doStream += 1;
          return model.doStream(options);
        },
      };
    },
    name: inner.name,
    normalizeError: inner.normalizeError,
  };
  return { calls, provider };
}

function client(provider: AiProvider) {
  return defineAi({ defaultModel: "mock/echo", providers: [provider] }).create(
    ENV
  );
}

interface Line {
  level: "error" | "info";
  message: string;
  fields: Record<string, unknown>;
}

function recorder() {
  const lines: Line[] = [];
  return {
    lines,
    log: {
      error(message: string, fields: Record<string, unknown> = {}) {
        lines.push({ fields, level: "error", message });
      },
      info(message: string, fields: Record<string, unknown> = {}) {
        lines.push({ fields, level: "info", message });
      },
    },
  };
}

function user(text: string, id = "u1"): UIMessage {
  return { id, parts: [{ text, type: "text" }], role: "user" };
}

/** The `data:` payloads of a UI message stream response, in order. */
async function events(response: Response): Promise<string[]> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
}

function chunksOf(data: string[]): UIMessageChunk[] {
  return data
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as UIMessageChunk);
}

/** The assistant message the chunks build, as `useChat` builds it. */
async function assistantOf(chunks: UIMessageChunk[]): Promise<UIMessage> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream })) {
    last = message;
  }
  assert.ok(last, "the stream built no message");
  return last;
}

let printed: unknown[][] = [];
const realConsoleError = console.error;

beforeEach(() => {
  printed = [];
  console.error = (...args: unknown[]) => {
    printed.push(args);
  };
});

afterEach(() => {
  console.error = realConsoleError;
});

/** True when anything printed to `console.error` carries a stack. */
function printedStack(): boolean {
  return printed.some((args) =>
    args.some(
      (arg) =>
        (arg instanceof Error && typeof arg.stack === "string") ||
        (typeof arg === "string" && /\n\s+at /.test(arg))
    )
  );
}

describe("streamChat", () => {
  it("streams the reply and ends in a finish chunk and [DONE]", async () => {
    const { log } = recorder();
    const response = await streamChat({
      ai: client(counted().provider),
      feature: "chat",
      log,
      messages: [user("hello there friend")],
    });
    assert.equal(
      response.headers.get("x-vercel-ai-ui-message-stream"),
      "v1",
      "useChat reads the UI message stream header"
    );
    const data = await events(response);
    assert.equal(data.at(-1), "[DONE]");
    const chunks = chunksOf(data);
    assert.equal(chunks.at(-1)?.type, "finish");
    const text = chunks
      .map((chunk) => (chunk.type === "text-delta" ? chunk.delta : ""))
      .join("");
    assert.equal(text, "hello there friend");
  });

  it("logs one usage line per turn with every usage field", async () => {
    const { lines, log } = recorder();
    const response = await streamChat({
      ai: client(counted().provider),
      feature: "chat",
      log,
      messages: [user("one two three")],
    });
    await response.text();
    const usage = lines.filter((line) => line.message === "ai usage");
    assert.equal(usage.length, 1);
    const fields = usage[0]?.fields ?? {};
    for (const name of USAGE_FIELDS) {
      assert.ok(name in fields, `the usage line has no ${name}`);
    }
    assert.equal(fields.steps, 1);
    assert.equal(fields.outputTokens, 3);
    assert.equal(fields.feature, "chat");
    assert.equal(fields.provider, "mock");
    assert.equal(fields.model, "mock/echo");
  });

  it("retries a 429 three times, then ends the stream with a rate_limited error and logs it", async () => {
    const { calls, provider } = counted();
    const { lines, log } = recorder();
    const response = await streamChat({
      ai: client(provider),
      feature: "chat",
      log,
      messages: [user("/mock error 429\nhello")],
    });
    const chunks = chunksOf(await events(response));
    assert.equal(calls.doStream, 3);
    const error = chunks.find((chunk) => chunk.type === "error");
    assert.ok(error?.type === "error", "the stream sent no error chunk");
    const body = JSON.parse(error.errorText) as ChatErrorBody;
    assert.equal(body.code, "rate_limited");
    assert.equal(body.retryable, true);
    const errors = lines.filter((line) => line.level === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.fields.code, "rate_limited");
    assert.equal(errors[0]?.fields.retryable, true);
    assert.equal(printedStack(), false, "a stack reached console.error");
  });

  it("runs an approved tool on the next request", async () => {
    const { result, runs } = await approvalRoundTrip(true);
    assert.equal(runs.length, 1);
    const part = result.parts.find((p) => p.type === "tool-delete_note");
    assert.ok(part?.type === "tool-delete_note");
    assert.equal(part.state, "output-available");
  });

  it("skips a denied tool on the next request", async () => {
    const { result, runs } = await approvalRoundTrip(false);
    assert.equal(runs.length, 0);
    const part = result.parts.find((p) => p.type === "tool-delete_note");
    assert.ok(part?.type === "tool-delete_note");
    assert.equal(part.state, "output-denied");
  });
});

/**
 * Two requests, as `useChat` sends them: the first stops at an approval request, the
 * second carries the user's answer on that tool part and runs or skips the tool.
 */
async function approvalRoundTrip(approved: boolean) {
  const runs: unknown[] = [];
  const tools = {
    delete_note: tool({
      description: "Delete a note.",
      execute: (input: { id?: string }) => {
        runs.push(input);
        return { deleted: true };
      },
      inputSchema: jsonSchema<{ id?: string }>({
        properties: { id: { type: "string" } },
        type: "object",
      }),
    }),
  };
  const ai = client(counted().provider);
  const { log } = recorder();
  const ask = user('/mock tool delete_note\n{"id":"n1"}');

  const first = chunksOf(
    await events(
      await streamChat({
        ai,
        approve: ["delete_note"],
        feature: "chat",
        log,
        messages: [ask],
        tools,
      })
    )
  );
  assert.ok(
    first.some((chunk) => chunk.type === "tool-approval-request"),
    "the first request sent no approval request"
  );
  assert.equal(runs.length, 0, "the tool ran before the answer");

  const asked = await assistantOf(first);
  const answered: UIMessage = {
    ...asked,
    parts: asked.parts.map((part) =>
      part.type === "tool-delete_note" && part.state === "approval-requested"
        ? {
            ...part,
            approval: { approved, id: part.approval.id },
            state: "approval-responded" as const,
          }
        : part
    ),
  };

  const second = chunksOf(
    await events(
      await streamChat({
        ai,
        approve: ["delete_note"],
        feature: "chat",
        log,
        messages: [ask, answered],
        tools,
      })
    )
  );
  const result = await assistantOf([...first, ...second]);
  return { result, runs };
}

describe("generate", () => {
  it("returns the reply and logs the usage line", async () => {
    const { lines, log } = recorder();
    const { text } = await generate({
      ai: client(counted().provider),
      feature: "summary",
      log,
      prompt: "short answer",
    });
    assert.equal(text, "short answer");
    const usage = lines.filter((line) => line.message === "ai usage");
    assert.equal(usage.length, 1);
    for (const name of USAGE_FIELDS) {
      assert.ok(name in (usage[0]?.fields ?? {}), `no ${name}`);
    }
  });

  it("throws a 429 as AiError rate_limited, retryable, after 3 model calls", async () => {
    const { calls, provider } = counted();
    const { lines, log } = recorder();
    const failure = await generate({
      ai: client(provider),
      feature: "summary",
      log,
      prompt: "/mock error 429\nhello",
    }).then(
      () => assert.fail("generate should throw"),
      (error: unknown) => error
    );
    assert.ok(failure instanceof AiError);
    assert.equal(failure.code, "rate_limited");
    assert.equal(failure.retryable, true);
    assert.equal(calls.doGenerate, 3);
    const errors = lines.filter((line) => line.level === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.fields.code, "rate_limited");
    assert.equal(printedStack(), false, "a stack reached console.error");
  });

  it("throws a missing model id as AiError not_configured and logs it", async () => {
    const { lines, log } = recorder();
    const ai = defineAi({
      defaultModel: "",
      providers: [counted().provider],
    }).create(ENV);
    await assert.rejects(
      generate({ ai, feature: "summary", log, prompt: "hi" }),
      (error: unknown) =>
        error instanceof AiError && error.code === "not_configured"
    );
    assert.equal(lines.filter((line) => line.level === "error").length, 1);
  });
});

describe("the ai-mock failure", () => {
  it("is an APICallError to the real AI SDK class", async () => {
    const model = mock().languageModel(ENV, "mock/echo");
    const failure = await model
      .doGenerate({
        prompt: [
          {
            content: [{ text: "/mock error 429", type: "text" }],
            role: "user",
          },
        ],
      })
      .then(
        () => assert.fail("the call should fail"),
        (error: unknown) => error
      );
    assert.ok(APICallError.isInstance(failure));
  });
});
