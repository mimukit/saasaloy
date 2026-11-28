/**
 * The token use of one AI turn, as one structured log line. No message text goes in it.
 * The `ai-sdk` driver fills it when a turn ends.
 */
export interface AiUsageFields {
  /** The model calls of the turn: one, plus one after each round of tool calls. */
  steps: number;
  /** The tools the model called, in order, such as `get_order, propose_action`. */
  tools: string;
  inputTokens: number;
  /** The input tokens the prompt cache served, which a vendor bills at a discount. */
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  /** The part of the output the model spent on reasoning, which the user never sees. */
  reasoningTokens: number;
  totalTokens: number;
  /** The share of the input the cache served, 0 to 100. */
  cachePercent: number;
}
