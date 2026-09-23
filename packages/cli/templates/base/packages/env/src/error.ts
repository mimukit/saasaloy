// The one error shape every value source throws, so one `catch` handles them all.
//
// It lives in its own file, with no imports at all, because `src/index.ts` re-exports it
// and `src/index.ts` is what a Worker and an Astro build import. `src/sources.ts` reaches
// `node:fs` and `node:path`; a bundle that pulled those in for one error class fails at
// build time with "No such module node:path", which is exactly what this split prevents.

export type EnvErrorCode =
  /** The source did not answer: no CLI, no network, no route to the host. */
  | "unreachable"
  /** The source answered and refused: bad credentials, no access to the folder. */
  | "denied"
  /** The source is installed but not set up in this project. */
  | "not_configured"
  /** The source answered with something this package cannot read. */
  | "invalid_response";

export interface EnvErrorOptions {
  code: EnvErrorCode;
  /** The vendor's own code or exit status, kept verbatim. */
  providerCode?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class EnvError extends Error {
  override name = "EnvError";
  readonly code: EnvErrorCode;
  readonly providerCode: string | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: EnvErrorOptions) {
    super(message, { cause: options.cause });
    this.code = options.code;
    this.providerCode = options.providerCode;
    this.retryable = options.retryable ?? options.code === "unreachable";
  }
}
