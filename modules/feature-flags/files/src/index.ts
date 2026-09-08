import { defineFlags } from "./define";
import {
  killAi,
  killEmail,
  killPayments,
  maintenanceFlag,
} from "./flags/system";
import type { FlagsEnv } from "./define";
import type { FlagSource } from "./source";

export { DEFAULT_ISOLATE_TTL_SECONDS, forgetCache } from "./cache";
export {
  defineFlag,
  defineFlags,
  KILL_PREFIX,
  KillSwitchError,
  MAINTENANCE_KEY,
} from "./define";
export type {
  FlagContext,
  FlagDefinition,
  FlagsClient,
  FlagsConfig,
  FlagsEnv,
  FlagsRegistry,
  FlagType,
  KillSwitchName,
} from "./define";
export { bucket, fnv1a32 } from "./hash";
export {
  DOCUMENT_VERSION,
  documentKeyParts,
  emptyDocument,
  evaluate,
  FLAGS_NAMESPACE,
  publishedDocument,
  tenantScope,
} from "./document";
export type { FlagDocument, FlagScope, FlagValue } from "./document";
export type { FlagSource } from "./source";

// The registry, and the patch point every later flag lands in. `saasaloy add feature-flags`
// seeds the four reserved keys below; a project adds its own by appending a factory call.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and an
// install fails silently.
//
// The literal is also what types `flag()`. Its key set is inferred from these entries, so a
// call with a key nobody registered fails `pnpm typecheck` rather than resolving to a
// default at runtime — which is why a new key needs a deploy and a new *value* does not.
export const flags = defineFlags({
  flags: [maintenanceFlag(), killPayments(), killAi(), killEmail()],
});

/** Every registered key, as a type. Handy for a function that takes a flag key. */
export type FlagKey = (typeof flags.flags)[number]["key"];

/**
 * Get a flag client for this request.
 *
 * ```ts
 * const client = createFlags(c.env, source);
 * if (await client.flag("billing.new-checkout", { subjectId: user.id, tenantId })) {
 *   // ...
 * }
 * ```
 *
 * `env` goes in whole, the same way `createKv(env)` takes it: which binding the store reads
 * is the `kv` capability's business, not this one's. `source` is how the resolver reaches
 * the database — `apps/api/src/lib/flags.ts` builds it, so this package imports no driver
 * and no Drizzle.
 */
export function createFlags(env: FlagsEnv, source: FlagSource) {
  return flags.create(env, source);
}
