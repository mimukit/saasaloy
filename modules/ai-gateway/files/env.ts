import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The keys the gateway provider reads. `saasaloy add ai-gateway` adds this preset as an
// `ai.envPresets` row. The URL and the key are required only while `AI_PROVIDER` is
// `gateway`, so a project keeps the provider installed and develops on `mock` with both
// blank.

/** True for a JSON object whose every value is a string. */
function isHeaderObject(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === "string")
    );
  } catch {
    return false;
  }
}

export const gatewayEnvPreset = definePreset({
  module: "ai-gateway",
  server: {
    AI_GATEWAY_URL: z
      .url()
      .optional()
      .describe(
        "Base URL of an OpenAI-compatible gateway, such as https://openrouter.ai/api/v1."
      ),
    AI_GATEWAY_API_KEY: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The gateway's API key or token, sent as Authorization: Bearer <key>."
      ),
    AI_GATEWAY_HEADERS: z
      .string()
      .refine(isHeaderObject, {
        message:
          'Must be a JSON object of strings, such as {"cf-aig-gateway-id":"main"}.',
      })
      .optional()
      .describe("Extra request headers as a JSON object of strings. Optional."),
  },
  requiredWhen: {
    AI_GATEWAY_URL: { key: "AI_PROVIDER", is: "gateway" },
    AI_GATEWAY_API_KEY: { key: "AI_PROVIDER", is: "gateway" },
  },
});

export function gatewayEnv() {
  return gatewayEnvPreset;
}
