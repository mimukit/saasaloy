import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Plunk provider reads. `saasaloy add email-plunk` adds this
// preset as an `email.envPresets` row, beside the `email.providers` row for the provider
// itself. `PLUNK_API_KEY` is required only while `EMAIL_PROVIDER` is `plunk`, so a project
// can keep the provider installed and develop on `console` with the key blank.

export const plunkEnvPreset = definePreset({
  module: "email-plunk",
  server: {
    PLUNK_API_KEY: z
      .string()
      .min(1)
      .optional()
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
  requiredWhen: { PLUNK_API_KEY: { key: "EMAIL_PROVIDER", is: "plunk" } },
});

export function plunkEnv() {
  return plunkEnvPreset;
}
