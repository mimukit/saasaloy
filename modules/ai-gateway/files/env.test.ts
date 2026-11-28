// Gate tests for the gateway keys: the ai core's preset and this provider's preset,
// composed through the real `createEnv`. Repo-only: the descriptor ships `gateway.ts` and
// `env.ts` and nothing else.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { aiPreset } from "../../ai/files/src/env-preset.ts";
import { gatewayEnvPreset } from "./env.ts";

const env = createEnv({ extends: [aiPreset, gatewayEnvPreset] });

const FILLED = {
  AI_GATEWAY_API_KEY: "sk-test",
  AI_GATEWAY_HEADERS: "",
  AI_GATEWAY_URL: "https://openrouter.ai/api/v1",
  AI_PROVIDER: "gateway",
};

/** The `KEY (module)` labels a failed gate names, sorted. */
function failures(source: Record<string, string>): string[] {
  try {
    env(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.issues
      .map((issue) => `${issue.key} (${issue.module})`)
      .toSorted();
  }
  return [];
}

describe("ai-gateway preset", () => {
  it("passes with the URL and the key set under gateway", () => {
    assert.deepEqual(failures(FILLED), []);
  });

  it("refuses a blank AI_GATEWAY_API_KEY while AI_PROVIDER=gateway", () => {
    assert.deepEqual(failures({ ...FILLED, AI_GATEWAY_API_KEY: "" }), [
      "AI_GATEWAY_API_KEY (ai-gateway)",
    ]);
  });

  it("accepts a blank URL and key while AI_PROVIDER=mock", () => {
    assert.deepEqual(
      failures({
        ...FILLED,
        AI_GATEWAY_API_KEY: "",
        AI_GATEWAY_URL: "",
        AI_PROVIDER: "mock",
      }),
      []
    );
  });

  it("accepts AI_GATEWAY_HEADERS as a JSON object of strings", () => {
    assert.deepEqual(
      failures({
        ...FILLED,
        AI_GATEWAY_HEADERS: '{"cf-aig-gateway-id":"main"}',
      }),
      []
    );
  });

  it("refuses AI_GATEWAY_HEADERS that is not a JSON object of strings", () => {
    for (const headers of [
      "[1]",
      '["main"]',
      '{"x-count":1}',
      "not json",
      '"main"',
    ]) {
      assert.deepEqual(
        failures({ ...FILLED, AI_GATEWAY_HEADERS: headers }),
        ["AI_GATEWAY_HEADERS (ai-gateway)"],
        headers
      );
    }
  });
});
