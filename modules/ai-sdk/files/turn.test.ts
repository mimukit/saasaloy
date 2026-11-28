// Tests for the usage reader, ported from PrimeShopr's `usage.test.ts`. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { turnUsage, usageFields } from "./turn.ts";

describe("usageFields", () => {
  it("splits the input into cached and uncached tokens", () => {
    assert.deepEqual(
      usageFields(
        {
          inputTokens: 8000,
          inputTokenDetails: {
            noCacheTokens: 2000,
            cacheReadTokens: 6000,
            cacheWriteTokens: 0,
          },
          outputTokens: 300,
          outputTokenDetails: { textTokens: 100, reasoningTokens: 200 },
          totalTokens: 8300,
        },
        ["get_order", "propose_action"],
        3
      ),
      {
        steps: 3,
        tools: "get_order, propose_action",
        inputTokens: 8000,
        cachedInputTokens: 6000,
        uncachedInputTokens: 2000,
        outputTokens: 300,
        reasoningTokens: 200,
        totalTokens: 8300,
        cachePercent: 75,
      }
    );
  });

  it("counts a missing number as 0", () => {
    const fields = usageFields(
      {
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: undefined,
      },
      [],
      1
    );
    assert.equal(fields.inputTokens, 0);
    assert.equal(fields.totalTokens, 0);
    assert.equal(fields.cachePercent, 0);
  });
});

describe("turnUsage", () => {
  it("reads the usage, the tools of every step in order, and the step count", () => {
    const usage = {
      inputTokens: 1000,
      inputTokenDetails: {
        noCacheTokens: 100,
        cacheReadTokens: 900,
        cacheWriteTokens: 0,
      },
      outputTokens: 50,
      outputTokenDetails: { textTokens: 40, reasoningTokens: 10 },
      totalTokens: 1050,
    };
    assert.deepEqual(
      turnUsage({
        usage,
        steps: [
          { toolCalls: [{ toolName: "get_order" }, { toolName: "run_sql" }] },
          { toolCalls: [{ toolName: "propose_action" }] },
          { toolCalls: [] },
        ],
      }),
      {
        steps: 3,
        tools: "get_order, run_sql, propose_action",
        inputTokens: 1000,
        cachedInputTokens: 900,
        uncachedInputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 10,
        totalTokens: 1050,
        cachePercent: 90,
      }
    );
  });
});
