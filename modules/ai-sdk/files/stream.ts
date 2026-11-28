import { isToolUIPart } from "ai";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";

/** One tool call of a finished UI message. */
export interface ToolCall {
  /** The model's id for the call, which links it to its step. */
  id: string;
  /** The tool's name: the part type `tool-get_order` is `get_order`. */
  name: string;
  /** `output-available` when the tool answered, `output-error` when it threw. */
  state: (ToolUIPart | DynamicToolUIPart)["state"];
  input: unknown;
  /** The tool's answer, only when `state` is `output-available`. */
  output: unknown;
  /** What the tool threw, only when `state` is `output-error`. */
  errorText?: string;
}

/** An object as it is, and any other value as `{ value }`, so a stored JSON column holds an object. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

/**
 * Every tool call of a finished message, in order, as a route's `onEnd` stores them. Text,
 * reasoning and step parts are skipped. No message gives no calls.
 */
export function toolCallsOf(message?: UIMessage): ToolCall[] {
  return (message?.parts ?? [])
    .filter((part) => isToolUIPart(part))
    .map((part) => ({
      id: part.toolCallId,
      name:
        part.type === "dynamic-tool"
          ? part.toolName
          : part.type.replace(/^tool-/, ""),
      state: part.state,
      input: part.input,
      output: part.state === "output-available" ? part.output : undefined,
      ...(part.state === "output-error" ? { errorText: part.errorText } : {}),
    }));
}

/** True when a tool call finished: it answered or it threw. */
export function isFinishedCall(call: ToolCall): boolean {
  return call.state === "output-available" || call.state === "output-error";
}
