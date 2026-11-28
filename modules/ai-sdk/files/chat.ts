import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type {
  ModelMessage,
  ToolSet,
  UIMessage,
  UIMessageStreamOnEndCallback,
} from "ai";
import type { Logger } from "@repo/logger";
import type { AiClient } from "../define";
import type { AiError, AiErrorCode } from "../provider";
import { turnUsage } from "./turn";
import type { TurnEnd } from "./turn";

/** The model calls one turn may make: one, plus one after each round of tool calls. */
export const DEFAULT_MAX_STEPS = 5;

/** What `generate` and `streamChat` share. */
export interface AiTurnOptions<TOOLS extends ToolSet> {
  /** The client from `createAi(env)`. */
  ai: AiClient;
  /** The request logger, such as `c.get("log")`. It gets the error line and the usage line. */
  log: Pick<Logger, "error" | "info">;
  /** The feature name, which picks the model id: `copilot` reads `COPILOT_MODEL` first. */
  feature: string;
  /** The system instructions. */
  instructions?: string;
  tools?: TOOLS;
  /** The tools that wait for the user's approve or deny answer before they run. */
  approve?: readonly (keyof TOOLS & string)[];
  /**
   * A secret of at least 32 random bytes that signs each approval request, so a client
   * cannot send back an approval the server never issued. Set it whenever `approve` names
   * a tool that changes data or spends money.
   */
  approvalSecret?: string;
  /** Defaults to `DEFAULT_MAX_STEPS`. */
  maxSteps?: number;
  /** Retries after the first model call. The AI SDK default is 2, so 3 calls in all. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

export type GenerateOptions<TOOLS extends ToolSet> = AiTurnOptions<TOOLS> &
  (
    | { prompt: string; messages?: never }
    | { messages: ModelMessage[]; prompt?: never }
  );

export interface StreamChatOptions<
  TOOLS extends ToolSet,
> extends AiTurnOptions<TOOLS> {
  /** The chat so far, as `useChat` sends it in the request body. */
  messages: UIMessage[];
  /** Runs when the reply is complete, with the full chat: store the turn here. */
  onEnd?: UIMessageStreamOnEndCallback<UIMessage>;
}

/** The JSON a failed chat stream sends as its error text. It holds no vendor detail. */
export interface ChatErrorBody {
  code: AiErrorCode;
  retryable: boolean;
  message: string;
}

const CHAT_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  auth: "The AI service refused the server's key.",
  content_filtered: "The AI service blocked this message.",
  context_length: "The chat is too long for the model. Start a new chat.",
  invalid_request: "The AI service refused the request.",
  not_configured: "The AI feature is not configured.",
  not_found: "The AI model is not available.",
  quota: "The AI service is out of credit.",
  rate_limited: "The AI service is busy. Try again in a moment.",
  timeout: "The AI service took too long to answer. Try again.",
  unavailable: "The AI service is not available. Try again in a moment.",
  unknown: "The AI reply failed.",
};

/** The error text a chat stream sends for an `AiError`: a `ChatErrorBody` as JSON. */
export function chatErrorText(error: AiError): string {
  const body: ChatErrorBody = {
    code: error.code,
    message: CHAT_ERROR_MESSAGES[error.code],
    retryable: error.retryable,
  };
  return JSON.stringify(body);
}

/**
 * One model turn that returns when the reply is complete. A failure, after the AI SDK's
 * retries, is thrown as `AiError` and logged once, without a stack.
 *
 * ```ts
 * const { text } = await generate({ ai: createAi(c.env), log: c.get("log"), feature: "summary", prompt });
 * ```
 */
export async function generate<TOOLS extends ToolSet = ToolSet>(
  options: GenerateOptions<TOOLS>
) {
  const turn = describe(options);
  try {
    const model = options.ai.model(options.feature);
    const shared = {
      abortSignal: options.abortSignal,
      experimental_toolApprovalSecret: options.approvalSecret,
      instructions: options.instructions,
      maxRetries: options.maxRetries,
      model,
      onEnd: (event: TurnEnd & { finishReason: string }) => {
        logUsage(options, turn, event);
      },
      stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
      toolApproval: approvals(options.approve),
      tools: options.tools,
    };
    return await (options.messages === undefined
      ? generateText({ ...shared, prompt: options.prompt })
      : generateText({ ...shared, messages: options.messages }));
  } catch (error) {
    throw logError(options, turn, error);
  }
}

/**
 * Stream one chat turn to `useChat` as a UI message stream `Response`. A failure ends the
 * stream with an error chunk whose text is a `ChatErrorBody`, and is logged once, without
 * a stack. A model id that does not resolve throws `AiError` before the stream starts.
 *
 * ```ts
 * app.post("/api/copilot/chat", async (c) => {
 *   const { messages } = await c.req.json<{ messages: UIMessage[] }>();
 *   return streamChat({ ai: createAi(c.env), log: c.get("log"), feature: "copilot", messages });
 * });
 * ```
 */
export async function streamChat<TOOLS extends ToolSet = ToolSet>(
  options: StreamChatOptions<TOOLS>
): Promise<Response> {
  const turn = describe(options);
  let model;
  try {
    model = options.ai.model(options.feature);
  } catch (error) {
    throw logError(options, turn, error);
  }
  const result = streamText({
    abortSignal: options.abortSignal,
    experimental_toolApprovalSecret: options.approvalSecret,
    instructions: options.instructions,
    maxRetries: options.maxRetries,
    messages: await convertToModelMessages(options.messages, {
      tools: options.tools,
    }),
    model,
    // Without its own handler `streamText` prints the raw error and its stack.
    onEnd: (event) => {
      logUsage(options, turn, event);
    },
    onError: ({ error }) => {
      logError(options, turn, error);
    },
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
    toolApproval: approvals(options.approve),
    tools: options.tools,
  });
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      onEnd: options.onEnd,
      onError: (error) => chatErrorText(options.ai.normalizeError(error)),
      originalMessages: options.messages,
      stream: result.stream,
      tools: options.tools,
    }),
  });
}

interface TurnFields {
  feature: string;
  provider: string;
  model?: string;
}

function describe(options: AiTurnOptions<ToolSet>): TurnFields {
  let model: string | undefined;
  try {
    model = options.ai.modelId(options.feature);
  } catch {
    // `ai.model()` throws the same error a moment later, and that one is logged.
  }
  return { feature: options.feature, model, provider: options.ai.provider };
}

function approvals(
  names: readonly string[] | undefined
): Record<string, "user-approval"> | undefined {
  if (names === undefined || names.length === 0) {
    return undefined;
  }
  return Object.fromEntries(names.map((name) => [name, "user-approval"]));
}

/** The fields only: a log sink that prints an `Error` prints its stack too. */
function logError(
  options: AiTurnOptions<ToolSet>,
  turn: TurnFields,
  error: unknown
): AiError {
  const normalized = options.ai.normalizeError(error);
  options.log.error("ai error", {
    ...turn,
    code: normalized.code,
    message: normalized.message,
    providerCode: normalized.providerCode,
    retryable: normalized.retryable,
    status: normalized.status,
  });
  return normalized;
}

function logUsage(
  options: AiTurnOptions<ToolSet>,
  turn: TurnFields,
  event: TurnEnd & { finishReason: string }
): void {
  options.log.info("ai usage", {
    ...turn,
    finishReason: event.finishReason,
    ...turnUsage(event),
  });
}
