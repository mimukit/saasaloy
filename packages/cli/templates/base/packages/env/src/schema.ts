// The validator surface. `packages/env` types against Standard Schema and nothing else,
// so a project swaps zod for valibot or arktype by changing what its presets import. This
// file names no vendor; `./zod` re-exports the one that ships by default.
//
// The interface is written out rather than taken from `@standard-schema/spec`, because a
// type-only dependency would still be a dependency in `package.json`, and the contract is
// twenty lines.

export interface StandardIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] };

export interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

/** What a schema produces, for the type `createEnv` infers. */
export type InferOutput<Schema extends StandardSchema> = NonNullable<
  Schema["~standard"]["types"]
>["output"];

/**
 * Validate one value, refusing an async validator.
 *
 * A Worker validates on the first request, inside a synchronous `createEnv` call, so an
 * async schema has nowhere to be awaited. Saying so here is clearer than a promise
 * silently passing every check.
 */
export function validateSync<Output>(
  schema: StandardSchema<unknown, Output>,
  value: unknown
): StandardResult<Output> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError(
      "An env schema validated asynchronously. createEnv runs on the first request and cannot await one."
    );
  }
  return result;
}

/** The `.describe()` text a schema carries, when its vendor exposes one. */
export function describeSchema(schema: StandardSchema): string | undefined {
  // A vendor-blind read of an optional property. Standard Schema does not carry a
  // description, and every validator that has one exposes it here; nothing is assumed
  // about its type, which is what the guard below is for.
  const described: unknown = Reflect.get(schema, "description");
  return typeof described === "string" && described !== ""
    ? described
    : undefined;
}
