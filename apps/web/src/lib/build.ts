// The build info `astro.config.mjs` inlines as `__BUILD_INFO__` (src/lib/build-info.ts). A
// module that runs outside Vite, such as a node:test file, has no such constant, so it gets
// undefined here instead of a ReferenceError.

import type { BuildInfo } from "./build-info.ts";

export const build: BuildInfo | undefined =
  typeof __BUILD_INFO__ === "undefined" ? undefined : __BUILD_INFO__;
