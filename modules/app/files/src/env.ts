import { createEnv } from "@repo/env";
import { z } from "@repo/env/zod";

// The customer app's typed environment. Every value the browser bundle carries passes
// through here, and nothing else does.
//
// `runtimeEnvStrict` is hand-written, one literal `import.meta.env.PUBLIC_X` per key.
// Vite inlines a literal member expression and nothing else, so a spread, a loop or a
// computed key compiles to `undefined` in the built bundle and fails only in production.
//
// `isServer: false` arms the Proxy: a server key that somehow reached this bundle throws
// when something reads it, rather than shipping the value to a browser.

export const appEnv = createEnv({
  /** No module adds a preset here, so a preset of your own goes in this array by hand. */
  extends: [],
  client: {
    PUBLIC_API_URL: z
      .url()
      .describe(
        "Origin the customer app calls for api and auth requests, e.g. https://api.x.com. http://localhost:4000 in dev."
      ),
  },
  runtimeEnvStrict: {
    PUBLIC_API_URL: import.meta.env.PUBLIC_API_URL,
  },
  isServer: false,
});
