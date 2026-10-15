import { createEnv } from "@repo/env";
import { z } from "@repo/env/zod";

// This app's typed environment. Every value the browser bundle carries passes through
// here, and nothing else does.
//
// Two rules make the file worth reading before you edit it.
//
// `runtimeEnvStrict` is hand-written, one literal `import.meta.env.PUBLIC_X` per key.
// Vite inlines a literal member expression and nothing else, so a derived or generated
// form — a spread, a loop, a computed key — compiles to `undefined` in the built bundle
// and fails only in production. A module that ships a page into this app patches one line
// into that map.
//
// `isServer: false` is what arms the Proxy. A server key that somehow reaches this bundle
// throws when something reads it, rather than shipping the value to a browser.

export const webEnv = createEnv({
  /**
   * Keep this an array literal. `saasaloy add` appends a capability's preset here with a
   * `plugin-array` patch, and it fails silently otherwise.
   */
  extends: [],
  client: {
    PUBLIC_SITE_URL: z
      .url()
      .describe(
        "The public origin this site is served from, e.g. https://example.com. Used for canonical URLs."
      ),
    PUBLIC_API_URL: z
      .url()
      .describe(
        "Origin this site calls for api and auth requests, e.g. https://api.x.com. http://localhost:4000 in dev. Seeded here so a module shipping a form into this app has a typed key to read."
      ),
  },
  runtimeEnvStrict: {
    PUBLIC_SITE_URL: import.meta.env.PUBLIC_SITE_URL,
    PUBLIC_API_URL: import.meta.env.PUBLIC_API_URL,
  },
  isServer: false,
});
