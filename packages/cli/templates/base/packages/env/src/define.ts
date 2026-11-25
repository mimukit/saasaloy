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

/**
 * When a conditional key is required: the controlling `key` holds `is`, or does not hold
 * `isNot`. The controlling value is a comma list, so `manual,bkash` holds `bkash`.
 */
export type EnvCondition =
  { key: string; is: string } | { key: string; isNot: string };

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
  /**
   * Keys this preset requires only while a condition holds. The key's own schema accepts
   * `undefined`; the gate reports it unset only while the condition is true.
   */
  requiredWhen?: Record<string, EnvCondition>;
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
   * A capability spreads its `<cap>.envPresets` table here, which the CLI generates from
   * the row each provider module adds beside its provider row.
   */
  extends?: EnvPreset[];
  server?: Server;
  client?: ClientShape<Client, typeof DEFAULT_CLIENT_PREFIX>;
  shared?: Shared;
  /** Keys required only while a condition holds, such as a vendor's API key. */
  requiredWhen?: Record<string, EnvCondition>;
}): EnvPreset<Server, Client, Shared> {
  return {
    module: preset.module,
    extends: preset.extends ?? [],
    server: (preset.server ?? {}) as Server,
    client: (preset.client ?? {}) as unknown as Client,
    shared: (preset.shared ?? {}) as Shared,
    requiredWhen: preset.requiredWhen ?? {},
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
   * The capability presets this service installed. A service spreads its generated
   * presets table here, and a preset of your own goes after the spread.
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
    requiredWhen: {},
  };
  const presets = [...(options.extends ?? []), own];

  const server = collect(presets, "server");
  const client = collect(presets, "client");
  const shared = collect(presets, "shared");
  const conditions = collectConditions(presets);

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
            // On the client a server key is not in the bundle, so a condition on one, or
            // read from one, cannot be checked here. The server checks it.
            conditions: conditions.flatMap((rule) =>
              isServer ||
              !(
                serverOnly.has(rule.key) ||
                (rule.condition !== undefined &&
                  serverOnly.has(rule.condition.key))
              )
                ? [rule]
                : []
            ),
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

/**
 * One conditional key's rule, with the preset that declared it. A rule with no
 * `condition` always holds: another preset requires the key outright.
 */
interface ConditionRule {
  key: string;
  condition: EnvCondition | undefined;
  module: string;
}

/**
 * Every preset's conditions, unioned: two presets that make one key conditional make it
 * required when either condition holds (#390).
 *
 * The strictest rule wins, as it does in the CLI's key list. A preset that declares a
 * conditional key with a schema that refuses `undefined`, and no condition of its own,
 * requires the key outright. That preset adds a rule with no condition, so the key stays
 * required whatever order the presets come in.
 */
function collectConditions(presets: EnvPreset[]): ConditionRule[] {
  const all = flatten(presets);
  const rules: ConditionRule[] = all.flatMap((preset) =>
    Object.entries(preset.requiredWhen ?? {}).map(([key, condition]) => ({
      key,
      condition,
      module: preset.module,
    }))
  );
  const conditional = new Set(rules.map((rule) => rule.key));
  for (const preset of all) {
    const own = preset.requiredWhen ?? {};
    for (const part of [preset.server, preset.client, preset.shared]) {
      for (const [key, schema] of Object.entries(part)) {
        if (
          conditional.has(key) &&
          !(key in own) &&
          // The schema is asked about an unset key, which is `undefined` by definition.
          // oxlint-disable-next-line unicorn/no-useless-undefined
          validateSync(schema, undefined).issues
        ) {
          rules.push({ key, condition: undefined, module: preset.module });
        }
      }
    }
  }
  return rules;
}

/**
 * Whether `condition` holds against `value`. The value is a comma list of names. `is`
 * holds when the list names the value, and `isNot` when it does not, so a blank value
 * makes `isNot` true. `check.ts` keeps the same rule for `.env.example`; it is repeated
 * here because that file reads the dotenv parser and this one runs in a browser bundle.
 */
function conditionHolds(condition: EnvCondition, value: unknown): boolean {
  const text =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? String(value)
      : "";
  const names = new Set(
    text
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "")
  );
  return "is" in condition
    ? names.has(condition.is)
    : !names.has(condition.isNot);
}

function describeCondition(condition: EnvCondition): string {
  return "is" in condition
    ? `${condition.key}=${condition.is}`
    : `${condition.key}!=${condition.isNot}`;
}

/** Every preset a composition reaches, each one's own `extends` first. */
export function flatten(presets: EnvPreset[]): EnvPreset[] {
  return presets.flatMap((preset) => [...flatten(preset.extends), preset]);
}

function validate(options: {
  raw: Record<string, unknown>;
  emptyIsUnset: boolean;
  fields: [string, { schema: StandardSchema; module: string }][];
  conditions: ConditionRule[];
  onValidationError?: (issues: EnvIssue[]) => never;
}): Record<string, unknown> {
  const { raw, emptyIsUnset, fields, conditions } = options;
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

  // A conditional key is checked after every key has parsed, so the condition reads the
  // controlling key's final value, a default or a transform included. Its issue joins the
  // same aggregate as a key that failed its own schema.
  const failed = new Set(issues.map((issue) => issue.key));
  const schemas = new Map(fields);
  for (const { key, condition, module } of conditions) {
    const given = raw[key];
    const input = emptyIsUnset && given === "" ? undefined : given;
    if (
      input !== undefined ||
      failed.has(key) ||
      (condition !== undefined &&
        !conditionHolds(condition, parsed[condition.key]))
    ) {
      continue;
    }
    failed.add(key);
    const schema = schemas.get(key)?.schema;
    issues.push({
      key,
      module,
      reason:
        condition === undefined
          ? "unset"
          : `unset; required when ${describeCondition(condition)}`,
      description: schema === undefined ? undefined : describeSchema(schema),
    });
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
