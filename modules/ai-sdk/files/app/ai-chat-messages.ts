import { getToolName, isToolUIPart } from "ai";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";

import type {
  AiChatError,
  AiChatMessage,
  AiChatPart,
  AiChatToolState,
} from "@repo/ui/blocks/ai-chat";

// The AI SDK half of the chat: it turns `useChat`'s messages and errors into the props of
// `@repo/ui/blocks/ai-chat`, which knows no AI framework.

type ToolPart = ToolUIPart | DynamicToolUIPart;

/** The block's state for an AI SDK tool part. */
export function toolState(part: ToolPart): AiChatToolState {
  switch (part.state) {
    case "approval-requested": {
      return "approval";
    }
    case "approval-responded": {
      // An approved call runs on the request `useChat` sends next.
      return part.approval.approved ? "running" : "denied";
    }
    case "output-available": {
      return "finished";
    }
    case "output-error": {
      return "error";
    }
    case "output-denied": {
      return "denied";
    }
    default: {
      return "running";
    }
  }
}

function toBlockPart(part: UIMessage["parts"][number]): AiChatPart | null {
  if (isToolUIPart(part)) {
    return {
      errorText: part.state === "output-error" ? part.errorText : undefined,
      input: part.input,
      name: getToolName(part),
      output: part.state === "output-available" ? part.output : undefined,
      state: toolState(part),
      toolCallId: part.toolCallId,
      type: "tool",
    };
  }
  switch (part.type) {
    case "text": {
      return { text: part.text, type: "text" };
    }
    case "reasoning": {
      return {
        streaming: part.state === "streaming",
        text: part.text,
        type: "reasoning",
      };
    }
    case "source-url": {
      return {
        id: part.sourceId,
        title: part.title,
        type: "source",
        url: part.url,
      };
    }
    case "source-document": {
      return { id: part.sourceId, title: part.title, type: "source" };
    }
    default: {
      return null;
    }
  }
}

/** The block's messages: system messages and parts the block cannot show are left out. */
export function toBlockMessages(messages: UIMessage[]): AiChatMessage[] {
  return messages.flatMap((message) =>
    message.role === "system"
      ? []
      : [
          {
            id: message.id,
            parts: message.parts
              .map(toBlockPart)
              .filter((part): part is AiChatPart => part !== null),
            role: message.role,
          },
        ]
  );
}

/** The approval id `addToolApprovalResponse` takes for the tool call the user answered. */
export function approvalIdFor(
  messages: UIMessage[],
  toolCallId: string
): string | undefined {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        isToolUIPart(part) &&
        part.toolCallId === toolCallId &&
        part.state === "approval-requested"
      ) {
        return part.approval.id;
      }
    }
  }
  return undefined;
}

export const CHAT_ERRORS = {
  failed: "The chat request failed. Try again.",
  rateLimited: "Too many requests. Try again in a moment.",
  signedOut: "Your session ended. Sign in again to use the chat.",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The block's error for `useChat`'s error. A failed stream carries the driver's
 * `{ code, retryable, message }` as its message, a refused request carries the api's
 * `{ error: { code, message } }` envelope, and a network failure carries plain text.
 */
export function toBlockError(error?: Error): AiChatError | null {
  if (error === undefined) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    return { message: CHAT_ERRORS.failed, retryable: true };
  }
  if (
    isRecord(body) &&
    typeof body.message === "string" &&
    typeof body.retryable === "boolean"
  ) {
    return { message: body.message, retryable: body.retryable };
  }
  const code =
    isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  if (code === "unauthorized") {
    return { message: CHAT_ERRORS.signedOut, retryable: false };
  }
  if (code === "rate_limited") {
    return { message: CHAT_ERRORS.rateLimited, retryable: true };
  }
  return { message: CHAT_ERRORS.failed, retryable: true };
}
