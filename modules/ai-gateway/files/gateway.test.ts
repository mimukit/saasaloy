// Tests for the gateway provider: the request it builds and the error table. Nothing here
// reaches a gateway: `fetch` is replaced for each call with one that records the request
// and answers a recorded body. The errors come from the real `@ai-sdk/openai-compatible`
// model, so `normalizeError` reads the same `APICallError` a deployed Worker sees.
// Repo-only: the descriptor ships `gateway.ts` and `env.ts` and nothing else.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { APICallError } from "@ai-sdk/provider";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { defineAi } from "../index.ts";
import { AiError } from "../provider.ts";
import { gateway, normalizeError, parseHeaders } from "./gateway.ts";

const ENV = {
  AI_GATEWAY_API_KEY: "sk-test",
  AI_GATEWAY_HEADERS: '{"cf-aig-gateway-id":"main"}',
  AI_GATEWAY_URL: "https://gateway.test/v1",
  AI_PROVIDER: "gateway",
};

const CALL: LanguageModelV4CallOptions = {
  prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** Answer every request with `status` and `body`, and record what was sent. */
function answer(status: number, body: unknown, seen: Seen[] = []): Seen[] {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      url: String(input),
    });
    return Response.json(body, { status });
  }) as typeof fetch;
  return seen;
}

/** What the real model throws for a recorded error response. */
async function thrown(status: number, body: unknown): Promise<unknown> {
  answer(status, body);
  const model = gateway().languageModel(ENV, "openai/gpt-6-luna");
  return model.doGenerate(CALL).then(
    () => assert.fail("the call should fail"),
    (error: unknown) => error
  );
}

const OK = {
  choices: [
    {
      finish_reason: "stop",
      index: 0,
      message: { content: "hello", role: "assistant" },
    },
  ],
  created: 0,
  id: "chatcmpl-1",
  model: "openai/gpt-6-luna",
  object: "chat.completion",
  usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
};

describe("ai-gateway model", () => {
  it("posts to <AI_GATEWAY_URL>/chat/completions with the key and the extra headers", async () => {
    const seen = answer(200, OK);
    const model = defineAi({ providers: [gateway()] })
      .create({ ...ENV, AI_MODEL: "openai/gpt-6-luna" })
      .model("copilot");
    assert.equal(model.specificationVersion, "v4");
    const result = await model.doGenerate(CALL);
    assert.deepEqual(result.content, [{ text: "hello", type: "text" }]);
    assert.equal(seen[0]?.url, "https://gateway.test/v1/chat/completions");
    assert.equal(seen[0]?.headers.get("authorization"), "Bearer sk-test");
    assert.equal(seen[0]?.headers.get("cf-aig-gateway-id"), "main");
    assert.equal(seen[0]?.body.model, "openai/gpt-6-luna");
  });

  it("throws not_configured when the URL or the key is blank", () => {
    for (const blank of ["AI_GATEWAY_URL", "AI_GATEWAY_API_KEY"]) {
      assert.throws(
        () =>
          gateway().languageModel(
            { ...ENV, [blank]: " " },
            "openai/gpt-6-luna"
          ),
        (error: unknown) =>
          error instanceof AiError && error.code === "not_configured"
      );
    }
  });

  it("parses AI_GATEWAY_HEADERS and refuses anything but an object of strings", () => {
    assert.deepEqual(parseHeaders(""), {});
    assert.deepEqual(parseHeaders('{"a":"b"}'), { a: "b" });
    for (const bad of ["[1]", '["main"]', '{"a":1}', "nope"]) {
      assert.throws(() => parseHeaders(bad), /JSON object of strings/);
    }
  });
});

// Error bodies as OpenAI, OpenRouter and the gateways return them.
const RECORDED: [string, number, unknown, string, boolean, string][] = [
  [
    "OpenAI rate limit",
    429,
    {
      error: {
        code: "rate_limit_exceeded",
        message: "Rate limit reached",
        type: "requests",
      },
    },
    "rate_limited",
    true,
    "rate_limit_exceeded",
  ],
  [
    "OpenAI out of quota on a 429",
    429,
    {
      error: {
        code: "insufficient_quota",
        message: "You exceeded your current quota",
        type: "insufficient_quota",
      },
    },
    "quota",
    false,
    "insufficient_quota",
  ],
  [
    "context too long",
    400,
    {
      error: {
        code: "context_length_exceeded",
        message: "This model's maximum context length is 128000 tokens",
        param: "messages",
        type: "invalid_request_error",
      },
    },
    "context_length",
    false,
    "context_length_exceeded",
  ],
  [
    "wrong key",
    401,
    {
      error: {
        code: "invalid_api_key",
        message: "Incorrect API key provided",
        type: "invalid_request_error",
      },
    },
    "auth",
    false,
    "invalid_api_key",
  ],
  [
    "content filter",
    400,
    {
      error: {
        code: "content_filter",
        message: "The response was filtered",
        type: null,
      },
    },
    "content_filtered",
    false,
    "content_filter",
  ],
  [
    "OpenRouter out of credits",
    402,
    { error: { code: 402, message: "Insufficient credits" } },
    "quota",
    false,
    "402",
  ],
  ["forbidden", 403, { error: { message: "Forbidden" } }, "auth", false, "403"],
  [
    "unknown model",
    404,
    { error: { code: "model_not_found", message: "The model does not exist" } },
    "not_found",
    false,
    "model_not_found",
  ],
  [
    "timeout",
    408,
    { error: { message: "Request timeout" } },
    "timeout",
    true,
    "408",
  ],
  [
    "bad request",
    400,
    { error: { message: "Invalid tool schema" } },
    "invalid_request",
    false,
    "400",
  ],
  [
    "server error",
    500,
    { error: { message: "Internal error", type: "server_error" } },
    "unavailable",
    true,
    "server_error",
  ],
  [
    "overloaded",
    503,
    { error: { message: "Service unavailable" } },
    "unavailable",
    true,
    "503",
  ],
  [
    "Cloudflare REST error list",
    429,
    { errors: [{ code: 2003, message: "Rate limited" }], success: false },
    "rate_limited",
    true,
    "2003",
  ],
];

describe("ai-gateway normalizeError on recorded bodies", () => {
  for (const [name, status, body, code, retryable, providerCode] of RECORDED) {
    it(`${name}: HTTP ${status} is ${code}`, async () => {
      const error = await thrown(status, body);
      assert.ok(
        APICallError.isInstance(error),
        "the real model throws an APICallError"
      );
      const mapped = normalizeError(error);
      assert.ok(mapped instanceof AiError);
      assert.deepEqual(
        {
          code: mapped.code,
          providerCode: mapped.providerCode,
          retryable: mapped.retryable,
          status: mapped.status,
        },
        { code, providerCode, retryable, status }
      );
      assert.equal(mapped.cause, error);
    });
  }

  it("reads the last error of the AI SDK's RetryError", async () => {
    const last = await thrown(429, {
      error: { code: "rate_limit_exceeded", message: "slow down" },
    });
    const retry = Object.assign(new Error("Failed after 3 attempts"), {
      [Symbol.for("vercel.ai.error")]: true,
      [Symbol.for("vercel.ai.error.AI_RetryError")]: true,
      errors: [last, last, last],
      lastError: last,
      reason: "maxRetriesExceeded",
    });
    const mapped = normalizeError(retry);
    assert.equal(mapped.code, "rate_limited");
    assert.equal(mapped.retryable, true);
    assert.equal(mapped.cause, retry);
  });

  it("reads a StreamProviderError the AI SDK raises mid-stream", () => {
    const streamed = Object.assign(new Error("Context too long"), {
      [Symbol.for("vercel.ai.error")]: true,
      [Symbol.for("vercel.ai.error.AI_StreamProviderError")]: true,
      code: "context_length_exceeded",
      data: { code: "context_length_exceeded", message: "Context too long" },
      isRetryable: false,
      statusCode: undefined,
      type: "invalid_request_error",
    });
    const mapped = normalizeError(streamed);
    assert.equal(mapped.code, "context_length");
    assert.equal(mapped.providerCode, "context_length_exceeded");
  });

  it("reads a raw mid-stream error body, flat or under `error`", () => {
    const flat = {
      code: "rate_limit_exceeded",
      message: "slow down",
      type: "requests",
    };
    for (const body of [flat, { error: flat }]) {
      const mapped = normalizeError(body);
      assert.equal(mapped.code, "rate_limited");
      assert.equal(mapped.retryable, true);
      assert.equal(mapped.providerCode, "rate_limit_exceeded");
    }
  });

  it("maps an SDK error with no status, a refused connection, onto unavailable", () => {
    const refused = new APICallError({
      isRetryable: true,
      message: "Cannot connect to API: connect ECONNREFUSED",
      requestBodyValues: {},
      url: "https://gateway.test/v1/chat/completions",
    });
    const mapped = normalizeError(refused);
    assert.equal(mapped.code, "unavailable");
    assert.equal(mapped.retryable, true);
  });

  it("gives unknown for a plain error", () => {
    const mapped = normalizeError(new TypeError("boom"));
    assert.equal(mapped.code, "unknown");
    assert.equal(mapped.retryable, false);
  });
});
