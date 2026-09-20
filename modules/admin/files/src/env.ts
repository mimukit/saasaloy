import { createEnv } from "@repo/env";
import { z } from "@repo/env/zod";

// The admin SPA's typed environment. Every value the browser bundle carries passes
// through here, and nothing else does.
//
// `runtimeEnvStrict` is hand-written, one literal `import.meta.env.PUBLIC_X` per key.
// Vite inlines a literal member expression and nothing else, so a spread, a loop or a
// computed key compiles to `undefined` in the built bundle and fails only in production.
//
// `isServer: false` arms the Proxy: a server key that somehow reached this bundle throws
// when something reads it, rather than shipping the value to a browser.

export const adminEnv = createEnv({
  /** Keep this an array literal — `saasaloy add` patches into it. */
  extends: [],
  client: {
    PUBLIC_API_URL: z
      .url()
      .describe(
        "Origin the admin SPA calls for api and auth requests, e.g. https://api.x.com. http://localhost:4000 in dev."
      ),
  },
  runtimeEnvStrict: {
    PUBLIC_API_URL: import.meta.env.PUBLIC_API_URL,
  },
  isServer: false,
});
