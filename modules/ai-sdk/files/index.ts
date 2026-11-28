export { chatErrorText, DEFAULT_MAX_STEPS, generate, streamChat } from "./chat";
export type {
  AiTurnOptions,
  ChatErrorBody,
  GenerateOptions,
  StreamChatOptions,
} from "./chat";
export { asRecord, isFinishedCall, toolCallsOf } from "./stream";
export type { ToolCall } from "./stream";
export { turnUsage, usageFields } from "./turn";
export type { TurnEnd } from "./turn";

// A route defines its tools and reads its request body through this package, so the
// `ai` dependency stays in `packages/ai` and a framework swap touches no route imports.
export { jsonSchema, tool } from "ai";
export type { ToolSet, UIMessage } from "ai";
