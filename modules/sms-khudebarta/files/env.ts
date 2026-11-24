import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Khudebarta provider reads. `saasaloy add sms-khudebarta`
// adds this preset as a row of `packages/sms/src/env-preset.generated.ts`, so installing
// the provider adds its keys. The two credentials are required only while `SMS_PROVIDER`
// is `khudebarta`.

export const khudebartaEnvPreset = definePreset({
  module: "sms-khudebarta",
  server: {
    KHUDEBARTA_API_KEY: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Khudebarta API key, from the portal's API settings, issued together with the secret key."
      ),
    KHUDEBARTA_SECRET_KEY: z
      .string()
      .min(1)
      .optional()
      .describe("Khudebarta secret key, issued alongside KHUDEBARTA_API_KEY."),
    KHUDEBARTA_API_URL: z
      .url()
      .default("https://portal.khudebarta.com:3770")
      .describe(
        "Base URL of the Khudebarta gateway, without a trailing path. Only a reassigned host or port needs it."
      ),
  },
  // Required only while SMS_PROVIDER is khudebarta, so a project can keep this provider
  // installed and run on another one with these keys blank.
  requiredWhen: {
    KHUDEBARTA_API_KEY: { key: "SMS_PROVIDER", is: "khudebarta" },
    KHUDEBARTA_SECRET_KEY: { key: "SMS_PROVIDER", is: "khudebarta" },
  },
});

export function khudebartaEnv() {
  return khudebartaEnvPreset;
}
