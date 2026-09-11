// The flag registry, the three-level resolver behind it, and the client a route uses.
//
// The three levels, cheapest first:
//
//   1. an isolate-local `Map` with a short TTL (cache.ts),
//   2. the published `kv` document for the scope,
//   3. the database, through the `FlagSource` the caller supplied.
//
// Level 3 is the source of truth and the only writer of a real value. A **reader never
// writes on a hit**: the one write it can do is publishing a document that was missing
// entirely. That is bounded at once per scope per location — a colo reading inside the
// up-to-60-second window after a publish still sees null and republishes the same
// content — rather than once per colo per request. Write-back on every read would scale
// KV writes with traffic, and Workers KV's free plan allows 1,000 writes a day.

import { createKv } from "@repo/kv";
import { forgetCache, isolateTtlSeconds, readCache, writeCache } from "./cache";
import {
  evaluate,
  FLAGS_NAMESPACE,
  documentKeyParts,
  publishedDocument,
  tenantScope,
} from "./document";
import type { KvEnv } from "@repo/kv";
import type { FlagDocument, FlagScope, FlagValue } from "./document";
import type { FlagSource } from "./source";

/** A flag is either on or off, or on for a share of subjects. There is no third kind. */
export type FlagType = "boolean" | "percentage";

/** The prefix that makes a flag a kill switch, read by `assertEnabled`. */
export const KILL_PREFIX = "kill.";

/** The reserved key the maintenance middleware reads. */
export const MAINTENANCE_KEY = "system.maintenance";

export interface FlagDefinition<K extends string = string> {
  /** Dotted, lower-case, e.g. `billing.new-checkout`. Unique across the registry. */
  key: K;
  type: FlagType;
  /**
   * What `flag()` answers before anybody has touched the admin screen, and what it falls
   * back to when no row exists for this key in either scope. A fresh deploy therefore
   * behaves predictably rather than resolving everything to `false`.
   *
   * On a `percentage` flag the default is still a boolean: `true` means 100% until a row
   * sets a share, `false` means 0%.
   */
  default: boolean;
  description?: string;
}

/** What the caller knows about who is asking. Both parts are optional. */
export interface FlagContext {
  /**
   * Who the flag is being resolved for — a user id, a session id, a device id. Only a
   * `percentage` flag reads it, and one resolves `false` without it.
   */
  subjectId?: string;
  /**
   * Which tenant's overrides apply. Omitted resolves the global value, which is correct for
   * a single-tenant project. It is passed in rather than read off the request, because no
   * convention for "the current tenant" is settled across this repo's modules yet.
   */
  tenantId?: string;
}

/** `"kill.payments" | "billing.x"` narrows to `"payments"`. */
export type KillSwitchName<K extends string> =
  K extends `${typeof KILL_PREFIX}${infer N}` ? N : never;

export interface FlagsEnv extends KvEnv {
  /** Seconds the isolate cache serves a document. Default 10; `0` disables the layer. */
  FLAGS_ISOLATE_TTL_SECONDS?: string;
}

/** Thrown by `assertEnabled` when the switch is off. Carries a `code` for api's envelope. */
export class KillSwitchError extends Error {
  readonly code = "kill_switch";
  readonly integration: string;

  constructor(integration: string) {
    super(
      `The "${integration}" integration is switched off. Turn ${KILL_PREFIX}${integration} ` +
        `back on in the admin app's Flags screen — no deploy is needed.`
    );
    this.name = "KillSwitchError";
    this.integration = integration;
  }
}

export interface FlagsClient<K extends string> {
  /** Every registered definition, in registration order. What the admin screen lists. */
  definitions: readonly FlagDefinition<K>[];
  /** Resolve one flag: tenant override, then global row, then the code default. */
  flag(key: K, context?: FlagContext): Promise<boolean>;
  /** Resolve every registered flag at once. One document read per scope, not one per flag. */
  all(context?: FlagContext): Promise<Record<K, boolean>>;
  /** Throw `KillSwitchError` unless `kill.<name>` resolves true. */
  assertEnabled(name: KillSwitchName<K>, context?: FlagContext): Promise<void>;
  /**
   * Re-read a scope from the database and write its document. Called by the `/flags` write
   * routes, never by a read.
   */
  publish(tenantId?: string): Promise<FlagDocument>;
}

export interface FlagsConfig<F extends readonly FlagDefinition[]> {
  flags: F;
}

export interface FlagsRegistry<F extends readonly FlagDefinition[]> {
  flags: F;
  create(env: FlagsEnv, source: FlagSource): FlagsClient<F[number]["key"]>;
}

/**
 * Declare a flag.
 *
 * ```ts
 * defineFlag({ key: "billing.new-checkout", type: "percentage", default: false });
 * ```
 *
 * Adding a key needs a deploy, because `flag()`'s key set is this array. Changing any
 * flag's *value* does not — that is the whole point of the admin screen.
 */
export function defineFlag<K extends string>(
  definition: FlagDefinition<K>
): FlagDefinition<K> {
  const { default: fallback, description, key, type } = definition;

  if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(key)) {
    throw new Error(
      `Flag key ${JSON.stringify(key)} must be lower-case and dotted, e.g. ` +
        `"billing.new-checkout". The prefix is what groups a screen's flags together.`
    );
  }

  return { default: fallback, description, key, type };
}

/**
 * Build the registry. `flags` is a patch point: a project adds a key by appending its
 * factory call to the array in `src/index.ts`, the same `plugin-array` shape `packages/kv`
 * uses for providers and policies.
 */
export function defineFlags<F extends readonly FlagDefinition[]>(
  config: FlagsConfig<F>
): FlagsRegistry<F> {
  const { flags } = config;
  type Key = F[number]["key"];

  const byKey = new Map<string, FlagDefinition>();
  for (const definition of flags) {
    if (byKey.has(definition.key)) {
      throw new Error(
        `Flag ${JSON.stringify(definition.key)} is registered twice. Each key resolves to ` +
          `one definition, so the second registration would be silently ignored.`
      );
    }
    byKey.set(definition.key, definition);
  }

  return {
    create(env: FlagsEnv, source: FlagSource): FlagsClient<Key> {
      const store = createKv(env);
      const ttlSeconds = isolateTtlSeconds(env.FLAGS_ISOLATE_TTL_SECONDS);

      function documentKey(scope: FlagScope): string {
        return store.key({
          namespace: FLAGS_NAMESPACE,
          parts: documentKeyParts(scope),
        });
      }

      function loadScope(scope: FlagScope): Promise<Record<string, FlagValue>> {
        return scope === "global"
          ? source.loadGlobal()
          : source.loadTenant(scope.slice(2));
      }

      /** Level 3, plus the one write a reader is allowed: publishing a missing document. */
      async function publish(scope: FlagScope): Promise<FlagDocument> {
        const document = publishedDocument(await loadScope(scope));
        // No TTL. The admin routes republish on every change, so there is nothing an
        // expiry would fix, and an expired document would mean a database read from
        // whichever colo noticed first.
        await store.set(documentKey(scope), document);
        writeCache(scope, document, ttlSeconds);
        return document;
      }

      async function documentFor(scope: FlagScope): Promise<FlagDocument> {
        const cached = readCache(scope);
        if (cached) {
          return cached;
        }

        const stored = await store.get<FlagDocument>(documentKey(scope));
        if (stored) {
          writeCache(scope, stored, ttlSeconds);
          return stored;
        }

        return publish(scope);
      }

      /**
       * Tenant override, then global row, then the code default — the order the whole
       * feature exists to provide. The global document is read only when the tenant has no
       * override for this key, so a tenant-level answer costs one read rather than two.
       */
      async function resolve(
        definition: FlagDefinition,
        context: FlagContext
      ): Promise<boolean> {
        const { subjectId, tenantId } = context;

        if (tenantId !== undefined) {
          const tenant = await documentFor(tenantScope(tenantId));
          const override = tenant.flags[definition.key];
          if (override) {
            return evaluate(
              definition.key,
              definition.type,
              override,
              subjectId
            );
          }
        }

        const global = await documentFor("global");
        const value = global.flags[definition.key];
        if (!value) {
          return definition.default;
        }
        return evaluate(definition.key, definition.type, value, subjectId);
      }

      function definitionFor(key: string): FlagDefinition {
        const definition = byKey.get(key);
        if (!definition) {
          throw new Error(
            `Flag ${JSON.stringify(key)} is not registered. Add it to the flags array in ` +
              `packages/feature-flags/src/index.ts — a new key needs a deploy.`
          );
        }
        return definition;
      }

      return {
        async all(context: FlagContext = {}): Promise<Record<Key, boolean>> {
          const resolved = {} as Record<Key, boolean>;
          for (const definition of flags) {
            resolved[definition.key as Key] = await resolve(
              definition,
              context
            );
          }
          return resolved;
        },

        async assertEnabled(
          name: KillSwitchName<Key>,
          context: FlagContext = {}
        ): Promise<void> {
          const key = `${KILL_PREFIX}${String(name)}`;
          if (!(await resolve(definitionFor(key), context))) {
            throw new KillSwitchError(String(name));
          }
        },

        definitions: flags as readonly FlagDefinition<Key>[],

        async flag(key: Key, context: FlagContext = {}): Promise<boolean> {
          return resolve(definitionFor(key), context);
        },

        async publish(tenantId?: string): Promise<FlagDocument> {
          const scope: FlagScope =
            tenantId === undefined ? "global" : tenantScope(tenantId);
          forgetCache(scope);
          return publish(scope);
        },
      };
    },
    flags,
  };
}
