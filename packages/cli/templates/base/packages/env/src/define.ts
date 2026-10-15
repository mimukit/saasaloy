import { describeSchema, validateSync } from "./schema.ts";
import type { InferOutput, StandardSchema } from "./schema.ts";

// `createEnv` — the gate every capability sits behind.
//
// A capability package exports a preset saying which keys it needs and what they look
// like. A service workspace composes the presets it installed with `extends` and gets one
// typed object back. Three rules make that worth doing:
//
//   1. Validation aggregates. One throw names every failing key, the module that declared
//      it and that module's own wording, so a deploy with three unset keys takes one round
//      trip to fix instead of three.
//   2. A `client` key must carry the client prefix, and the type system says so. A preset
//      that puts a secret in `client` does not compile.
//   3. A `server` key read while `isServer` is false throws through a Proxy, so a bundle
//      that never should have carried the value fails loudly when it reaches for it.
//
// Nothing here reads `process.env`. The caller passes the object: a Worker's `env` on the
// server, an inlined `runtimeEnvStrict` map in a frontend build.

/** The prefix a client key must carry. A key without it is a server key by definition. */
export const DEFAULT_CLIENT_PREFIX = "PUBLIC_";

export type SchemaRecord = Record<string, StandardSchema>;

/** The message a mis-prefixed client key reports instead of a type. */
export type PrefixError<
  Key extends string,
  Prefix extends string,
> = `${Key} is declared as a client key but does not start with ${Prefix}. Move it to server, or rename it.`;

/** Every key of `Shape` must start with `Prefix`; the ones that do not become a message. */
export type ClientShape<Shape extends SchemaRecord, Prefix extends string> = {
  [Key in keyof Shape]: Key extends `${Prefix}${string}`
    ? Shape[Key]
    : Key extends string
      ? PrefixError<Key, Prefix>
      : never;
};

export interface EnvPreset<
  Server extends SchemaRecord = SchemaRecord,
  Client extends SchemaRecord = SchemaRecord,
  Shared extends SchemaRecord = SchemaRecord,
> {
  /** The package that declared these keys, named in the aggregate error. */
  module: string;
  /** Presets this one folds in — how a provider module adds its own keys. */
  extends: EnvPreset[];
  server: Server;
  client: Client;
  shared: Shared;
}

/**
 * Declare one capability's keys. `server` is read only where `isServer` is true, `client`
 * is inlined into a public bundle and must carry the prefix, and `shared` is read in both.
 */
export function definePreset<
  const Server extends SchemaRecord,
  const Client extends SchemaRecord,
  const Shared extends SchemaRecord,
>(preset: {
  module: string;
  /**
   * Keep this an array literal. A provider module appends its own preset here with a
   * `plugin-array` patch, beside the one that appends its provider.
   */
  extends?: EnvPreset[];
  server?: Server;
  client?: ClientShape<Client, typeof DEFAULT_CLIENT_PREFIX>;
  shared?: Shared;
}): EnvPreset<Server, Client, Shared> {
  return {
    module: preset.module,
    extends: preset.extends ?? [],
    server: (preset.server ?? {}) as Server,
    client: (preset.client ?? {}) as unknown as Client,
    shared: (preset.shared ?? {}) as Shared,
  };
}

export interface EnvIssue {
  key: string;
  /** The package that declared the key. */
  module: string;
  /** Why it failed: unset, or the validator's own message. */
  reason: string;
  /** The declaring module's own wording for what the key is for. */
  description: string | undefined;
}

/** One throw naming every failing key at once. */
export class EnvValidationError extends Error {
  override name = "EnvValidationError";
  readonly issues: EnvIssue[];

  constructor(issues: EnvIssue[]) {
    super(formatIssues(issues));
    this.issues = issues;
  }
}

function formatIssues(issues: EnvIssue[]): string {
  // ASCII only. An Astro prerender failure travels back as an HTTP header, and a non-ASCII
  // byte there gets an encoding warning printed over the message a reader needs.
  const lines = issues.map((issue) => {
    const what =
      issue.description === undefined ? "" : ` - ${issue.description}`;
    return `  ${issue.key} (${issue.module}): ${issue.reason}${what}`;
  });
  return `${issues.length} environment ${
    issues.length === 1 ? "key is" : "keys are"
  } missing or invalid:\n${lines.join("\n")}`;
}

export interface CreateEnvOptions<
  Server extends SchemaRecord,
  Client extends SchemaRecord,
  Shared extends SchemaRecord,
> {
  /**
   * The capability presets this service installed. Keep this an array literal: the
   * codemod behind the `plugin-array` patch kind has nothing to push into otherwise, and
   * `saasaloy add` fails silently.
   */
  extends?: EnvPreset[];
  server?: Server;
  client?: ClientShape<Client, typeof DEFAULT_CLIENT_PREFIX>;
  shared?: Shared;
  clientPrefix?: string;
  /**
   * The inlined values a frontend build supplies, one literal
   * `import.meta.env.PUBLIC_X` per client and shared key. Vite inlines a literal member
   * expression and nothing else, so this map is hand-written and cannot be derived.
   */
  runtimeEnvStrict?: Record<string, unknown>;
  /** True on a server. A build-time constant, because a Worker is a server too. */
  isServer?: boolean;
  /** Treat `KEY=` as unset. True by default: the CLI writes `KEY=` as a placeholder. */
  emptyStringAsUndefined?: boolean;
  /** A build-time flag only. Never read this from a runtime key. */
  skipValidation?: boolean;
  onValidationError?: (issues: EnvIssue[]) => never;
  onInvalidAccess?: (key: string) => never;
}

export type EnvOutput<
  Server extends SchemaRecord,
  Client extends SchemaRecord,
  Shared extends SchemaRecord,
> = { [Key in keyof Server]: InferOutput<Server[Key]> } & {
  [Key in keyof Client]: Client[Key] extends StandardSchema
    ? InferOutput<Client[Key]>
    : never;
} & { [Key in keyof Shared]: InferOutput<Shared[Key]> } & Record<
    string,
    unknown
  >;

/** What `createEnv` returns: call it with the runtime env to get the typed values. */
export type EnvAccessor<Values> = (source?: Record<string, unknown>) => Values;

/**
 * Compose the presets and return the accessor a service's code calls.
 *
 * The accessor validates on its first call for a given source object and memoizes the
 * result in a `WeakMap`. A Worker cannot see its `env` at module scope, so the first
 * request is the earliest honest point to check; every later request in the same isolate
 * pays a map lookup.
 */
export function createEnv<
  const Server extends SchemaRecord = Record<never, never>,
  const Client extends SchemaRecord = Record<never, never>,
  const Shared extends SchemaRecord = Record<never, never>,
>(
  options: CreateEnvOptions<Server, Client, Shared>
): EnvAccessor<EnvOutput<Server, Client, Shared>> {
  const prefix = options.clientPrefix ?? DEFAULT_CLIENT_PREFIX;
  const isServer = options.isServer ?? true;
  const emptyIsUnset = options.emptyStringAsUndefined ?? true;

  const own: EnvPreset = {
    module: "this workspace",
    extends: [],
    server: (options.server ?? {}) as SchemaRecord,
    client: (options.client ?? {}) as unknown as SchemaRecord,
    shared: (options.shared ?? {}) as SchemaRecord,
  };
  const presets = [...(options.extends ?? []), own];

  const server = collect(presets, "server");
  const client = collect(presets, "client");
  const shared = collect(presets, "shared");

  for (const key of client.keys()) {
    if (!key.startsWith(prefix)) {
      throw new Error(
        `${key} is declared as a client key but does not start with ${prefix}. Move it to server, or rename it.`
      );
    }
  }

  // A server key is unreadable on the client. Listing them by name keeps the Proxy's
  // refusal specific: an unknown key is a plain `undefined`, not a throw.
  const serverOnly = new Set(server.keys());
  const cache = new WeakMap<object, EnvOutput<Server, Client, Shared>>();

  return (source) => {
    const raw: Record<string, unknown> =
      source ?? options.runtimeEnvStrict ?? {};
    const cached = cache.get(raw);
    if (cached) {
      return cached;
    }
    const values =
      options.skipValidation === true
        ? { ...raw }
        : validate({
            raw,
            emptyIsUnset,
            fields: [...(isServer ? server : new Map()), ...client, ...shared],
            onValidationError: options.onValidationError,
          });

    const guarded = guard(
      values,
      serverOnly,
      isServer,
      options.onInvalidAccess
    ) as EnvOutput<Server, Client, Shared>;
    cache.set(raw, guarded);
    return guarded;
  };
}

function collect(
  presets: EnvPreset[],
  part: "server" | "client" | "shared"
): Map<string, { schema: StandardSchema; module: string }> {
  const fields = new Map<string, { schema: StandardSchema; module: string }>();
  for (const preset of flatten(presets)) {
    for (const [key, schema] of Object.entries(preset[part])) {
      fields.set(key, { schema, module: preset.module });
    }
  }
  return fields;
}

/** Every preset a composition reaches, each one's own `extends` first. */
export function flatten(presets: EnvPreset[]): EnvPreset[] {
  return presets.flatMap((preset) => [...flatten(preset.extends), preset]);
}

function validate(options: {
  raw: Record<string, unknown>;
  emptyIsUnset: boolean;
  fields: [string, { schema: StandardSchema; module: string }][];
  onValidationError?: (issues: EnvIssue[]) => never;
}): Record<string, unknown> {
  const { raw, emptyIsUnset, fields } = options;
  const parsed: Record<string, unknown> = { ...raw };
  const issues: EnvIssue[] = [];

  for (const [key, field] of fields) {
    const given = raw[key];
    const input = emptyIsUnset && given === "" ? undefined : given;
    const result = validateSync(field.schema, input);
    if (result.issues) {
      issues.push({
        key,
        module: field.module,
        reason:
          input === undefined
            ? "unset"
            : result.issues.map((issue) => issue.message).join("; "),
        description: describeSchema(field.schema),
      });
      continue;
    }
    parsed[key] = result.value;
  }

  if (issues.length > 0) {
    if (options.onValidationError) {
      options.onValidationError(issues);
    }
    throw new EnvValidationError(issues);
  }
  return parsed;
}

function guard(
  values: Record<string, unknown>,
  serverOnly: Set<string>,
  isServer: boolean,
  onInvalidAccess?: (key: string) => never
): Record<string, unknown> {
  if (isServer) {
    return values;
  }
  return new Proxy(values, {
    get(target, property, receiver) {
      if (typeof property === "string" && serverOnly.has(property)) {
        if (onInvalidAccess) {
          onInvalidAccess(property);
        }
        throw new Error(
          `${property} is a server environment key and this code runs on the client. It is not in this bundle, and it must not be.`
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
