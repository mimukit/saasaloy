import { createEnv } from "@repo/env";
import { z } from "@repo/env/zod";

// This Worker's typed environment, and the one gate in front of every capability.
//
// A Worker cannot see its `env` at module scope, so `apiEnv(c.env)` validates on the first
// request in an isolate and memoizes the result per `env` object. One throw then names
// every key that is missing or malformed, with the module that declared it and that
// module's own wording, so a deploy with three unset keys takes one round trip to fix.
//
// Nothing here reads `process.env`. The Worker's `env` is the only source.

export const apiEnv = createEnv({
  /**
   * Keep this an array literal. `saasaloy add` appends a capability's preset here with a
   * `plugin-array` patch, and it fails silently otherwise.
   */
  extends: [],
  server: {
    CORS_ORIGINS: z
      .string()
      .default("")
      .describe(
        "Comma-separated allowed origins for credentialed cross-origin requests, e.g. https://app.x.com. The localhost dev origins are always allowed."
      ),
  },
  // A Worker is a server, and `typeof window === "undefined"` is true in a browser bundle
  // too, so this is stated rather than sniffed.
  isServer: true,
});
