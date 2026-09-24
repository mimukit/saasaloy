import { defineConfig } from "./define";
import { project } from "./project";
import { sections } from "./sections";

// `@repo/config` — the values this project checks into its repo and ships identically to
// every environment (ADR 0039).
//
// Read it with a plain import, from an app, a capability or a React island alike:
//
// ```ts
// import { config } from "@repo/config";
// config.app.name;
// ```
//
// There is no factory over `env` and no async: the values are literals in the repo, so the
// object is built once at module load and frozen. A bundler can inline it.
//
// This package has zero runtime dependencies and imports nothing, `@repo/env` included. A
// value derived from both channels is derived at the call site.

/** The composed, frozen config: the base's sections plus every installed module's. */
export const config = defineConfig({ sections, overrides: project });

/** The shape of `config`, inferred from the registered sections. */
export type Config = typeof config;

export { defineConfig, defineSection, defineSections } from "./define";
export type {
  AnySection,
  Composed,
  ConfigOverride,
  ConfigSection,
} from "./define";
export type { ProjectOverride } from "./sections";
