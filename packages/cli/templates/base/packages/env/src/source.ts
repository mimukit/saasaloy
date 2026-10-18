import type { Environment, Service } from "./services.ts";

// The contract every env source implements. It sits in its own file so a source module
// imports the contract and the error type without importing `sources.ts`, which imports
// the sources back to register them. `sources.ts` re-exports both types.

export interface LoadRequest {
  /** The repository root, so a source finds its own config file. */
  root: string;
  service: Service;
  environment: Environment;
  /** The process environment, passed in so no source reads `process.env` itself. */
  processEnv: Record<string, string | undefined>;
}

export interface EnvSource {
  /** The value `ENV_SOURCE` selects. */
  name: string;
  load(request: LoadRequest): Promise<Map<string, string>>;
}
