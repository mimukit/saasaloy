import type { LanguageModelUsage } from "ai";
import type { AiUsageFields } from "../usage";

/** The usage fields of one AI SDK usage total, the tools called in order, and the step count. */
export function usageFields(
  usage: LanguageModelUsage,
  toolNames: readonly string[],
  steps: number
): AiUsageFields {
  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    steps,
    tools: toolNames.join(", "),
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: Math.max(inputTokens - cachedInputTokens, 0),
    outputTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    cachePercent:
      inputTokens === 0
        ? 0
        : Math.round((cachedInputTokens / inputTokens) * 100),
  };
}

/** The parts of a finished turn's `onEnd` event that the usage fields read. */
export interface TurnEnd {
  /** The usage of every step of the turn added up. */
  usage: LanguageModelUsage;
  steps: readonly { toolCalls: readonly { toolName: string }[] }[];
}

/**
 * The usage fields of one finished turn, from the `onEnd` event of `generateText` or
 * `streamText`: the total usage, the tools every step called, in order, and the step count.
 */
export function turnUsage(event: TurnEnd): AiUsageFields {
  return usageFields(
    event.usage,
    event.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
    event.steps.length
  );
}
