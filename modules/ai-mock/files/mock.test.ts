// Tests for the mock provider: the echo in generate and stream, each script, and the
// error mapping. Repo-only: the descriptor ships `mock.ts` and nothing else. `../index`
// and `../provider` resolve through the shims beside this module to the real `ai` core.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { defineAi } from "../index.ts";
import { AiError } from "../provider.ts";
import { mock, normalizeError, parseDirective } from "./mock.ts";
import type { MockScript } from "./mock.ts";

function call(text: string, extra: Partial<LanguageModelV4CallOptions> = {}) {
  const prompt: LanguageModelV4Prompt = [
    { content: "You are a test.", role: "system" },
    { content: [{ text, type: "text" }], role: "user" },
  ];
  return { prompt, ...extra };
}

function model(script?: MockScript) {
  return mock(script ? { script } : {}).languageModel({}, "mock/test");
}

async function parts(text: string, script?: MockScript) {
  const { stream } = await model(script).doStream(call(text));
  const out: LanguageModelV4StreamPart[] = [];
  for await (const part of stream as unknown as AsyncIterable<LanguageModelV4StreamPart>) {
    out.push(part);
  }
  return out;
}

/** What a call rejected with. Fails the test when it resolves. */
async function rejection(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail("the call should fail");
}

function deltas(out: LanguageModelV4StreamPart[], type: string): string {
  return out
    .flatMap((part) =>
      part.type === type && "delta" in part ? [part.delta] : []
    )
    .join("");
}

describe("ai-mock echo", () => {
  it("generate returns the last user message as text", async () => {
    const result = await model().doGenerate(call("hello there friend"));
    assert.deepEqual(result.content, [
      { text: "hello there friend", type: "text" },
    ]);
    assert.equal(result.finishReason.unified, "stop");
    assert.equal(result.usage.outputTokens.total, 3);
  });

  it("stream sends the echo as text-start, several text-delta parts, text-end, then finish", async () => {
    const out = await parts("hello there friend");
    const types = out.map((part) => part.type);
    assert.deepEqual(types, [
      "stream-start",
      "response-metadata",
      "text-start",
      "text-delta",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
    assert.equal(deltas(out, "text-delta"), "hello there friend");
    const finish = out.at(-1);
    assert.ok(finish?.type === "finish");
    assert.equal(finish.usage.outputTokens.total, 3);
    assert.equal(finish.usage.inputTokens.total, 7);
  });

  it("takes the /mock line out of the echo", async () => {
    const result = await model().doGenerate(call("/mock source\nwhat is new"));
    assert.deepEqual(result.content[0], { text: "what is new", type: "text" });
  });
});

describe("ai-mock scripts", () => {
  it("/mock reasoning sends reasoning parts before the text", async () => {
    const out = await parts("/mock reasoning\nthink about this");
    const types = out.map((part) => part.type);
    assert.ok(types.indexOf("reasoning-start") < types.indexOf("text-start"));
    assert.ok(types.includes("reasoning-end"));
    assert.match(deltas(out, "reasoning-delta"), /3 words/);
    const generated = await model().doGenerate(call("/mock reasoning\nhi"));
    assert.equal(generated.content[0]?.type, "reasoning");
  });

  it("/mock tool calls the first offered tool with the JSON body as input", async () => {
    const options = call('/mock tool\n{"city":"Dhaka"}', {
      tools: [
        { inputSchema: { type: "object" }, name: "weather", type: "function" },
      ],
    });
    const result = await model().doGenerate(options);
    assert.equal(result.finishReason.unified, "tool-calls");
    assert.deepEqual(result.content, [
      {
        input: '{"city":"Dhaka"}',
        toolCallId: "mock-call-2",
        toolName: "weather",
        type: "tool-call",
      },
    ]);
    const { stream } = await model().doStream(options);
    const out: LanguageModelV4StreamPart[] = [];
    for await (const part of stream as unknown as AsyncIterable<LanguageModelV4StreamPart>) {
      out.push(part);
    }
    assert.deepEqual(out.map((part) => part.type).slice(2), [
      "tool-input-start",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
      "finish",
    ]);
  });

  it("answers a tool result with text instead of calling the tool again", async () => {
    const prompt: LanguageModelV4Prompt = [
      { content: [{ text: "/mock tool weather", type: "text" }], role: "user" },
      {
        content: [
          {
            input: {},
            toolCallId: "c1",
            toolName: "weather",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            output: { type: "json", value: { temp: 31 } },
            toolCallId: "c1",
            toolName: "weather",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];
    const result = await model().doGenerate({ prompt });
    assert.equal(result.finishReason.unified, "stop");
    assert.deepEqual(result.content, [
      { text: 'Tool result: weather returned {"temp":31}.', type: "text" },
    ]);
  });

  it("/mock source sends one URL source after the text", async () => {
    const out = await parts("/mock source\nread this");
    const types = out.map((part) => part.type);
    assert.ok(types.indexOf("source") > types.indexOf("text-end"));
    const source = out.find((part) => part.type === "source");
    assert.ok(source?.type === "source" && source.sourceType === "url");
    assert.equal(source.url, "https://example.com/mock-source");
  });

  it("/mock error 429 throws an AI SDK APICallError that is retryable", async () => {
    for (const run of ["doGenerate", "doStream"] as const) {
      const error = await rejection(model()[run](call("/mock error 429")));
      assert.ok(error instanceof Error);
      const fields = error as unknown as Record<string | symbol, unknown>;
      assert.equal(fields[Symbol.for("vercel.ai.error")], true);
      assert.equal(fields[Symbol.for("vercel.ai.error.AI_APICallError")], true);
      assert.equal(fields.statusCode, 429);
      assert.equal(fields.isRetryable, true);
    }
  });

  it("a failure takes the status rule unless the line sets retryable or final", () => {
    assert.deepEqual(parseDirective("error 400"), { error: 400 });
    assert.deepEqual(parseDirective("error 500 final"), {
      error: 500,
      retryable: false,
    });
    assert.deepEqual(parseDirective("error 400 retryable"), {
      error: 400,
      retryable: true,
    });
    assert.deepEqual(parseDirective("tool lookup slow"), {
      delayMs: 150,
      tool: "lookup",
    });
  });

  it("a programmatic script fails every call with the set retryable flag", async () => {
    const error = await rejection(
      model({ error: 503, retryable: false }).doGenerate(call("hi"))
    );
    const fields = error as Record<string, unknown>;
    assert.equal(fields.statusCode, 503);
    assert.equal(fields.isRetryable, false);
  });
});

function failure(text: string): Promise<unknown> {
  return rejection(model().doGenerate(call(text)));
}

describe("ai-mock normalizeError", () => {
  it("maps a 429 onto rate_limited, retryable, with the vendor code", async () => {
    const mapped = normalizeError(await failure("/mock error 429"));
    assert.ok(mapped instanceof AiError);
    assert.equal(mapped.code, "rate_limited");
    assert.equal(mapped.retryable, true);
    assert.equal(mapped.status, 429);
    assert.equal(mapped.providerCode, "rate_limit_exceeded");
  });

  it("reads the last error of the AI SDK's RetryError", async () => {
    const last = await failure("/mock error 503");
    const retry = Object.assign(new Error("Failed after 3 attempts"), {
      [Symbol.for("vercel.ai.error")]: true,
      [Symbol.for("vercel.ai.error.AI_RetryError")]: true,
      errors: [last, last, last],
      lastError: last,
      reason: "maxRetriesExceeded",
    });
    const mapped = normalizeError(retry);
    assert.equal(mapped.code, "unavailable");
    assert.equal(mapped.retryable, true);
    assert.equal(mapped.cause, retry);
  });

  it("maps each status onto its code", async () => {
    const expected: [number, string, boolean][] = [
      [400, "invalid_request", false],
      [401, "auth", false],
      [402, "quota", false],
      [403, "auth", false],
      [404, "not_found", false],
      [408, "timeout", true],
      [500, "unavailable", true],
      [504, "timeout", true],
    ];
    for (const [status, code, retryable] of expected) {
      const mapped = normalizeError(await failure(`/mock error ${status}`));
      assert.deepEqual(
        [status, mapped.code, mapped.retryable],
        [status, code, retryable]
      );
    }
  });

  it("gives unknown for anything else", () => {
    const mapped = normalizeError(new TypeError("boom"));
    assert.equal(mapped.code, "unknown");
    assert.equal(mapped.retryable, false);
  });
});

describe("ai-mock through the core", () => {
  it('createAi({ AI_PROVIDER: "mock" }).model("default") is a v4 model', () => {
    const ai = defineAi({ providers: [mock()] }).create({
      AI_PROVIDER: "mock",
    });
    const built = ai.model("default");
    assert.equal(built.specificationVersion, "v4");
    assert.equal(built.provider, "mock");
    assert.equal(built.modelId, ai.modelId("default"));
  });
});
