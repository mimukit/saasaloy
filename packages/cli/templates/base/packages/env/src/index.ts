// The runtime half of `@repo/env`. A service workspace imports `createEnv` and a set of
// capability presets; the node half (`./services`, `./setup`, `./example`) is imported by
// `pnpm env:setup` and never by a Worker.
//
// Nothing this file reaches reads `process.env`. A Worker gets its values as an `env`
// object, a Vite or Astro build gets them inlined from `import.meta.env`, and both hand
// that object to `createEnv`.

export { createEnv, EnvValidationError } from "./define.ts";
export type { CreateEnvOptions, EnvPreset } from "./define.ts";
export { definePreset } from "./define.ts";
export type { StandardSchema } from "./schema.ts";
export { z } from "./zod.ts";
export { EnvError } from "./error.ts";
export type { EnvErrorCode } from "./error.ts";
