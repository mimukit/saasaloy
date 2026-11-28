// No imports beyond the spec types and the core: a local provider must not need the
// driver, so `ai/test` and `@ai-sdk/provider-utils` stay out of this file.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { AiError } from "../provider";
import type { AiEnv, AiErrorCode, AiProvider } from "../provider";

/** What one mock turn sends besides the echo. Every field is optional. */
export interface MockScript {
  /** Send a reasoning part before the text. */
  reasoning?: boolean;
  /** Call one tool instead of answering. `true` picks the first tool the call offers. */
  tool?: boolean | string;
  /** Send one URL source after the text. */
  source?: boolean;
  /** Fail the call with this HTTP status, such as 429 or 500. */
  error?: number;
  /** Override whether the failure is retryable. Defaults to the AI SDK's rule: 408, 409, 429 and 5xx. */
  retryable?: boolean;
  /** Wait this many milliseconds between streamed chunks, so a UI shows the stop button. */
  delayMs?: number;
}

export interface MockOptions {
  /** A script for every call, merged under the one a `/mock` line asks for. For tests. */
  script?: MockScript;
}

const DIRECTIVE = /^\s*\/mock\b(.*)$/m;
const SLOW_DELAY_MS = 150;
const SOURCE_URL = "https://example.com/mock-source";

const STATUS_CODES: Record<number, string> = {
  400: "invalid_request_error",
  401: "invalid_api_key",
  402: "insufficient_quota",
  403: "permission_denied",
  404: "model_not_found",
  408: "request_timeout",
  409: "conflict",
  429: "rate_limit_exceeded",
  500: "server_error",
  502: "bad_gateway",
  503: "service_unavailable",
  504: "gateway_timeout",
};

/**
 * A `LanguageModelV4` that echoes the last user message, for local development and tests.
 * A first line such as `/mock reasoning source` or `/mock error 429` scripts the turn.
 */
export function mock(options: MockOptions = {}): AiProvider {
  return {
    languageModel(_env: AiEnv, modelId: string): LanguageModelV4 {
      return mockModel(modelId, options.script ?? {});
    },
    name: "mock",
    normalizeError,
  };
}

function mockModel(modelId: string, base: MockScript): LanguageModelV4 {
  return {
    async doGenerate(
      options: LanguageModelV4CallOptions
    ): Promise<LanguageModelV4GenerateResult> {
      const turn = plan(options, base);
      if (turn.script.error !== undefined) {
        throw apiCallError(turn.script.error, turn.script.retryable);
      }
      return {
        content: turn.content,
        finishReason: turn.finishReason,
        usage: turn.usage,
        warnings: [],
      };
    },
    async doStream(
      options: LanguageModelV4CallOptions
    ): Promise<LanguageModelV4StreamResult> {
      const turn = plan(options, base);
      if (turn.script.error !== undefined) {
        throw apiCallError(turn.script.error, turn.script.retryable);
      }
      const parts = streamParts(turn, modelId);
      const delayMs = turn.script.delayMs ?? 0;
      const signal = options.abortSignal;
      let index = 0;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async pull(controller) {
          if (signal?.aborted === true) {
            controller.close();
            return;
          }
          const part = parts[index];
          index += 1;
          if (part === undefined) {
            controller.close();
            return;
          }
          if (delayMs > 0 && part.type.endsWith("-delta")) {
            // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise form on Workers
            await new Promise((resolve) => {
              setTimeout(resolve, delayMs);
            });
          }
          controller.enqueue(part);
        },
      });
      return { stream };
    },
    modelId,
    provider: "mock",
    specificationVersion: "v4",
    supportedUrls: {},
  };
}

interface Turn {
  script: MockScript;
  content: LanguageModelV4Content[];
  finishReason: LanguageModelV4FinishReason;
  usage: LanguageModelV4Usage;
}

function plan(options: LanguageModelV4CallOptions, base: MockScript): Turn {
  const last = options.prompt.at(-1);
  const { script: asked, text } = lastUserText(options.prompt);
  const script = { ...base, ...asked };
  const content: LanguageModelV4Content[] = [];

  // A tool result is the model's turn to answer it, or a `/mock tool` line still in the
  // prompt would call the tool again on every step.
  if (last?.role === "tool") {
    content.push({ text: toolReplyText(last.content), type: "text" });
    return finish(script, content, "stop", options.prompt);
  }

  if (script.reasoning === true) {
    content.push({
      text: `The user wrote ${countWords(text)} words, so the reply echoes them.`,
      type: "reasoning",
    });
  }
  if (script.tool !== undefined && script.tool !== false) {
    const toolName =
      typeof script.tool === "string" ? script.tool : firstToolName(options);
    content.push({
      input: toolInput(text),
      toolCallId: `mock-call-${options.prompt.length}`,
      toolName,
      type: "tool-call",
    });
    return finish(script, content, "tool-calls", options.prompt);
  }
  content.push({ text: text === "" ? "(empty message)" : text, type: "text" });
  if (script.source === true) {
    content.push({
      id: "mock-source-1",
      sourceType: "url",
      title: "Mock source",
      type: "source",
      url: SOURCE_URL,
    });
  }
  return finish(script, content, "stop", options.prompt);
}

function finish(
  script: MockScript,
  content: LanguageModelV4Content[],
  reason: "stop" | "tool-calls",
  prompt: LanguageModelV4Prompt
): Turn {
  const outputText = content
    .map((part) =>
      part.type === "text" || part.type === "reasoning" ? part.text : ""
    )
    .join(" ");
  const reasoningText = content
    .map((part) => (part.type === "reasoning" ? part.text : ""))
    .join(" ");
  const input = countWords(promptText(prompt));
  const output = countWords(outputText);
  const reasoning = countWords(reasoningText);
  return {
    content,
    finishReason: {
      raw: reason === "stop" ? "stop" : "tool_calls",
      unified: reason,
    },
    script,
    usage: {
      inputTokens: {
        cacheRead: 0,
        cacheWrite: 0,
        noCache: input,
        total: input,
      },
      outputTokens: {
        reasoning,
        text: output - reasoning,
        total: output,
      },
    },
  };
}

/** The text of the last user message with its `/mock` line taken out, and that line's script. */
function lastUserText(prompt: LanguageModelV4Prompt): {
  script: MockScript;
  text: string;
} {
  const user = prompt.findLast((message) => message.role === "user");
  const raw =
    user?.role === "user"
      ? user.content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
      : "";
  const match = DIRECTIVE.exec(raw);
  if (!match) {
    return { script: {}, text: raw.trim() };
  }
  return {
    script: parseDirective(match[1] ?? ""),
    text: raw.replace(match[0], "").trim(),
  };
}

/**
 * `/mock reasoning tool source slow`, `/mock tool lookup`, `/mock error 429`,
 * `/mock error 500 final`. An unknown word is ignored, so a typo still echoes.
 */
export function parseDirective(words: string): MockScript {
  const script: MockScript = {};
  const tokens = words.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]?.toLowerCase();
    const next = tokens[i + 1];
    if (token === "reasoning") {
      script.reasoning = true;
    } else if (token === "source") {
      script.source = true;
    } else if (token === "slow") {
      script.delayMs = SLOW_DELAY_MS;
    } else if (token === "tool") {
      if (
        next !== undefined &&
        /^[A-Za-z_][\w-]*$/.test(next) &&
        !isWord(next)
      ) {
        script.tool = next;
        i += 1;
      } else {
        script.tool = true;
      }
    } else if (token === "error") {
      const status = Number(next);
      if (Number.isInteger(status) && status >= 400 && status <= 599) {
        script.error = status;
        i += 1;
      } else {
        script.error = 500;
      }
    } else if (token === "retryable") {
      script.retryable = true;
    } else if (token === "final") {
      script.retryable = false;
    }
  }
  return script;
}

function isWord(token: string): boolean {
  return [
    "reasoning",
    "source",
    "slow",
    "tool",
    "error",
    "retryable",
    "final",
  ].includes(token.toLowerCase());
}

function firstToolName(options: LanguageModelV4CallOptions): string {
  const tool = options.tools?.find(
    (candidate) => candidate.type === "function"
  );
  return tool?.name ?? "mock_tool";
}

/** The rest of the message as the tool input when it is a JSON object, else `{}`. */
function toolInput(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return JSON.stringify(parsed);
    }
  } catch {
    // Plain text is not a tool input.
  }
  return "{}";
}

function toolReplyText(
  content: Extract<LanguageModelV4Prompt[number], { role: "tool" }>["content"]
): string {
  const results = content.flatMap((part) => {
    if (part.type !== "tool-result") {
      return [];
    }
    const { output } = part;
    if (output.type === "execution-denied") {
      return [`${part.toolName} was denied`];
    }
    return [`${part.toolName} returned ${JSON.stringify(output.value)}`];
  });
  return results.length > 0
    ? `Tool result: ${results.join("; ")}.`
    : "The tool did not run.";
}

function promptText(prompt: LanguageModelV4Prompt): string {
  return prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => ("text" in part ? part.text : ""))
            .join(" ")
    )
    .join(" ");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Text in word-sized chunks, so a stream shows several deltas. */
function chunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function streamParts(turn: Turn, modelId: string): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    {
      id: "mock-response",
      modelId,
      timestamp: new Date(0),
      type: "response-metadata",
    },
  ];
  for (const [n, part] of turn.content.entries()) {
    const id = `mock-${n}`;
    if (part.type === "text" || part.type === "reasoning") {
      const kind = part.type;
      parts.push(
        { id, type: `${kind}-start` },
        ...chunks(part.text).map((delta): LanguageModelV4StreamPart => ({
          delta,
          id,
          type: `${kind}-delta`,
        })),
        { id, type: `${kind}-end` }
      );
    } else if (part.type === "tool-call") {
      parts.push(
        {
          id: part.toolCallId,
          toolName: part.toolName,
          type: "tool-input-start",
        },
        { delta: part.input, id: part.toolCallId, type: "tool-input-delta" },
        { id: part.toolCallId, type: "tool-input-end" },
        part
      );
    } else {
      parts.push(part);
    }
  }
  parts.push({
    finishReason: turn.finishReason,
    type: "finish",
    usage: turn.usage,
  });
  return parts;
}

/**
 * A failure the AI SDK reads as its own `APICallError`: it checks the global symbols and
 * `isRetryable`, not the class, so a 429 is retried the same way a real gateway's is.
 * `retry-after-ms: 0` keeps those retries instant.
 */
function apiCallError(status: number, retryable?: boolean): Error {
  const code = STATUS_CODES[status] ?? `http_${status}`;
  const message = `Mock failure: HTTP ${status} (${code})`;
  const data = { error: { code, message, type: code } };
  const error = new Error(message);
  Object.assign(error, {
    [Symbol.for("vercel.ai.error")]: true,
    [Symbol.for("vercel.ai.error.AI_APICallError")]: true,
    data,
    isRetryable:
      retryable ??
      (status === 408 || status === 409 || status === 429 || status >= 500),
    requestBodyValues: {},
    responseBody: JSON.stringify(data),
    responseHeaders: { "retry-after-ms": "0" },
    statusCode: status,
    url: "mock://ai/chat",
  });
  error.name = "AI_APICallError";
  return error;
}

function marked(
  error: unknown,
  name: string
): error is Record<string, unknown> {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as Record<symbol, unknown>)[
      Symbol.for(`vercel.ai.error.${name}`)
    ] === true
  );
}

const STATUS_TO_CODE: [(status: number) => boolean, AiErrorCode][] = [
  [(s) => s === 401 || s === 403, "auth"],
  [(s) => s === 402, "quota"],
  [(s) => s === 404, "not_found"],
  [(s) => s === 408 || s === 504, "timeout"],
  [(s) => s === 429, "rate_limited"],
  [(s) => s >= 500 || s === 409, "unavailable"],
  [(s) => s >= 400, "invalid_request"],
];

/** Map the mock's own failure, bare or inside the AI SDK's `RetryError`, onto `AiError`. */
export function normalizeError(error: unknown): AiError {
  const cause =
    marked(error, "AI_RetryError") && error.lastError !== undefined
      ? error.lastError
      : error;
  if (
    marked(cause, "AI_APICallError") ||
    marked(cause, "AI_StreamProviderError")
  ) {
    const status =
      typeof cause.statusCode === "number" ? cause.statusCode : undefined;
    const data = cause.data as { error?: { code?: unknown } } | undefined;
    const providerCode =
      typeof data?.error?.code === "string"
        ? data.error.code
        : status === undefined
          ? undefined
          : String(status);
    const code =
      status === undefined
        ? "unknown"
        : (STATUS_TO_CODE.find(([test]) => test(status))?.[1] ?? "unknown");
    return new AiError(code, `mock: ${String(cause.message)}`, {
      cause: error,
      providerCode,
      retryable: cause.isRetryable === true,
      status,
    });
  }
  return new AiError("unknown", "mock: the model call failed", {
    cause: error,
  });
}
