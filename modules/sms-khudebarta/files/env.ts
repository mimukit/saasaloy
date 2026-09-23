import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Khudebarta provider reads. `saasaloy add sms-khudebarta`
// appends this preset to `packages/sms/src/env-preset.ts`, so installing the provider is
// what makes its keys required.

export const khudebartaEnvPreset = definePreset({
  module: "sms-khudebarta",
  server: {
    KHUDEBARTA_API_KEY: z
      .string()
      .min(1)
      .describe(
        "Khudebarta API key, from the portal's API settings, issued together with the secret key."
      ),
    KHUDEBARTA_SECRET_KEY: z
      .string()
      .min(1)
      .describe("Khudebarta secret key, issued alongside KHUDEBARTA_API_KEY."),
    KHUDEBARTA_API_URL: z
      .url()
      .default("https://portal.khudebarta.com:3770")
      .describe(
        "Base URL of the Khudebarta gateway, without a trailing path. Only a reassigned host or port needs it."
      ),
  },
});

export function khudebartaEnv() {
  return khudebartaEnvPreset;
}
