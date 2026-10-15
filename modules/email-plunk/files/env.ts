import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Plunk provider reads. `saasaloy add email-plunk` appends this
// preset to `packages/email/src/env-preset.ts`, beside the patch that appends the provider
// itself, so installing the provider is what makes its keys required.

export const plunkEnvPreset = definePreset({
  module: "email-plunk",
  server: {
    PLUNK_API_KEY: z
      .string()
      .min(1)
      .describe(
        "Plunk secret key, the sk_... one from Project settings → API keys. The public pk_... key cannot send."
      ),
    PLUNK_API_URL: z
      .url()
      .default("https://next-api.useplunk.com")
      .describe(
        "Base URL of the Plunk API, without a trailing path. Only a self-hosted instance needs to set it."
      ),
  },
});

export function plunkEnv() {
  return plunkEnvPreset;
}
