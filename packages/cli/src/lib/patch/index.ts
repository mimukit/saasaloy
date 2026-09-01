import {
  chainedRouteInsertRefusal,
  chainedRouteRemoveRefusal,
  insertChainedRoute,
  removeChainedRoute,
} from "./chained-route.js";
import type { ChainedRoute } from "./chained-route.js";
import {
  constArrayInsertRefusal,
  insertIntoConstArray,
  removeFromConstArray,
} from "./const-array.js";
import type { ConstArrayInsert } from "./const-array.js";
import { toDiff } from "./diff.js";
import {
  matchWranglerBinding,
  removeWranglerBinding,
  upsertWranglerBinding,
  wranglerBindingRemoveRefusal,
} from "./jsonc.js";
import type { WranglerBinding } from "./jsonc.js";
import {
  matchPackageJsonDependency,
  upsertPackageJsonDependency,
} from "./pkg-json.js";
import type { PackageJsonDependency } from "./pkg-json.js";
import {
  packageJsonScriptRefusal,
  upsertPackageJsonScript,
} from "./pkg-json-script.js";
import type { PackageJsonScript } from "./pkg-json-script.js";
import {
  insertIntoPluginArray,
  pluginArrayRemoveRefusal,
  removeFromPluginArray,
} from "./ts-module.js";
import type { PluginArrayInsert } from "./ts-module.js";

// The config-patch engine (build spec §3.4): the ~10% of module application that isn't
// a pure file-drop. Small, well-tested AST codemods the applier (#6) invokes for
// structural edits — `jsonc-parser` for `wrangler.jsonc` bindings/routes and package.json
// dependency merges, `magicast` for TS/JS module edits (Better Auth plugin arrays). Every
// patch is pure and `--dry-run`/`--diff`-able: `applyPatch` never writes, it returns the
// would-be content plus a unified diff, and re-running an already-applied patch is a no-op.

export {
  chainedRouteInsertRefusal,
  chainedRouteRemoveRefusal,
  insertChainedRoute,
  removeChainedRoute,
  type ChainedRoute,
} from "./chained-route.js";
export {
  constArrayInsertRefusal,
  insertIntoConstArray,
  removeFromConstArray,
  type ConstArrayInsert,
} from "./const-array.js";
export { toDiff } from "./diff.js";
export {
  type BindingMatch,
  matchWranglerBinding,
  removeWranglerBinding,
  upsertWranglerBinding,
  type WranglerBinding,
  wranglerBindingRemoveRefusal,
} from "./jsonc.js";
export {
  matchPackageJsonDependency,
  upsertPackageJsonDependency,
  type PackageJsonDependency,
} from "./pkg-json.js";
export {
  packageJsonScriptRefusal,
  upsertPackageJsonScript,
  type PackageJsonScript,
} from "./pkg-json-script.js";
export {
  insertIntoPluginArray,
  type PluginArrayInsert,
  pluginArrayRemoveRefusal,
  removeFromPluginArray,
} from "./ts-module.js";

/** A single structural patch, tagged by the codemod that applies it. */
export type Patch =
  | ({ kind: "const-array" } & ConstArrayInsert)
  | ({ kind: "wrangler-binding" } & WranglerBinding)
  | ({ kind: "package-json-dependency" } & PackageJsonDependency)
  | ({ kind: "package-json-script" } & PackageJsonScript)
  | ({ kind: "plugin-array" } & PluginArrayInsert)
  | ({ kind: "chained-route" } & ChainedRoute);

export type PatchKind = Patch["kind"];

// The `Patch` union at runtime. `Record<PatchKind, true>` is exhaustive in both
// directions: a kind added to the union without a key here fails typecheck, and a key
// that names no kind is an excess property. `PATCH_KINDS` is what `schema.test.ts`
// holds both JSON Schemas to, so the enums can't drift apart again (#98).
const PATCH_KIND_KEYS: Record<PatchKind, true> = {
  "chained-route": true,
  "const-array": true,
  "package-json-dependency": true,
  "package-json-script": true,
  "plugin-array": true,
  "wrangler-binding": true,
};

/** Every patch kind the engine applies, sorted. */
export const PATCH_KINDS: readonly PatchKind[] = (
  Object.keys(PATCH_KIND_KEYS) as PatchKind[]
).toSorted();

/**
 * An entry the codemod found under the identity it matches on, holding a value other
 * than the one the descriptor declares — i.e. the user edited what we would have
 * written. Distinct from a plain `changed: false`, which also covers a clean
 * already-applied re-run (issue #48, decision 1).
 */
export interface PatchMatch {
  /** Where the collision is, as `<container>[<identity>]` (e.g. `d1_databases[binding=DB]`). */
  key: string;
  /** The value on disk today. */
  current: unknown;
  /** The value the descriptor declares. */
  wanted: unknown;
}

export interface PatchResult {
  /** The would-be file content after the patch (equal to the input on a no-op). */
  content: string;
  /** `false` when the patch was already applied — the applier skips the write. */
  changed: boolean;
  /** Unified diff of the change; `""` when nothing changed. */
  diff: string;
  /**
   * Why an unchanged result was *refused* rather than already-applied — a binding the
   * patch would have wired wrongly, a route the user repointed. `undefined` for a plain
   * idempotent no-op, which is the common case and says nothing worth reporting.
   */
  reason?: string;
  /**
   * Set when the patch was a no-op *because* something already occupies its identity
   * at a different value. `saasaloy update` reports these into the merge plan; `add`
   * ignores it, so its behaviour is unchanged.
   */
  matched?: PatchMatch;
}

/**
 * Apply one structural `patch` to `source` and report the result. Pure: it computes
 * the new content and a diff but writes nothing, so the caller can preview
 * (`--dry-run`/`--diff`) or commit as it sees fit. Idempotent — a patch already
 * present yields `changed: false` and an empty diff.
 */
export function applyPatch(
  source: string,
  patch: Patch,
  filename: string
): PatchResult {
  const content = applyCodemod(source, patch);
  const changed = content !== source;
  const matched = matchExisting(source, patch);
  return {
    content,
    changed,
    diff: toDiff(source, content, filename),
    reason: changed ? undefined : refusalReason(REFUSALS, source, patch),
    ...(matched ? { matched } : {}),
  };
}

// Only the two jsonc codemods have an identity to collide on. A `plugin-array` insert
// is matched by the call expression itself, so a match is always an exact re-run.
function matchExisting(source: string, patch: Patch): PatchMatch | undefined {
  switch (patch.kind) {
    case "wrangler-binding": {
      return matchWranglerBinding(source, patch);
    }
    case "package-json-dependency": {
      return matchPackageJsonDependency(source, patch);
    }
    default: {
      return undefined;
    }
  }
}

function applyCodemod(source: string, patch: Patch): string {
  switch (patch.kind) {
    case "const-array": {
      return insertIntoConstArray(source, patch);
    }
    case "wrangler-binding": {
      return upsertWranglerBinding(source, patch);
    }
    case "package-json-dependency": {
      return upsertPackageJsonDependency(source, patch);
    }
    case "package-json-script": {
      return upsertPackageJsonScript(source, patch);
    }
    case "plugin-array": {
      return insertIntoPluginArray(source, patch);
    }
    case "chained-route": {
      return insertChainedRoute(source, patch);
    }
    default: {
      const exhaustive: never = patch;
      throw new Error(`unknown patch kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// The one table of kind → inverse codemod. The four kinds that edit a *config* file
// reverse: `chained-route` (#83), then `wrangler-binding`, `plugin-array` and
// `const-array` (#36). The two `package.json` kinds deliberately do not — uninstalling an
// npm dependency isn't derivable offline and other code may already use it, and nothing
// asks for a script back (plan-remove-command-2026-07-25.md, non-goals). `remove`
// drops-and-warns for every kind absent from this table, and both `isReversibleKind` and
// `reversePatch` read it, so adding an inverse stays one edit.
type Inverse<K extends PatchKind> = (
  source: string,
  patch: Extract<Patch, { kind: K }>
) => string;

const INVERSES: { [K in PatchKind]?: Inverse<K> } = {
  "chained-route": removeChainedRoute,
  "const-array": removeFromConstArray,
  "plugin-array": removeFromPluginArray,
  "wrangler-binding": removeWranglerBinding,
};

/** Whether `reversePatch` can undo a patch of this kind. */
export function isReversibleKind(kind: string): boolean {
  return Object.hasOwn(INVERSES, kind);
}

/**
 * Undo one structural `patch`, the mirror of `applyPatch`. Returns `undefined` for a
 * kind with no inverse yet, so the caller can tell "nothing to reverse here" from "the
 * reversal ran and changed nothing". Pure and idempotent, like the forward direction:
 * a patch already reversed yields `changed: false` and an empty diff, which is what
 * keeps a hand-reverted file from being force-edited.
 */
export function reversePatch(
  source: string,
  patch: Patch,
  filename: string
): PatchResult | undefined {
  const inverse = INVERSES[patch.kind] as
    ((source: string, patch: Patch) => string) | undefined;
  if (!inverse) {
    return undefined;
  }
  const content = inverse(source, patch);
  const changed = content !== source;
  return {
    content,
    changed,
    diff: toDiff(source, content, filename),
    reason: changed
      ? undefined
      : refusalReason(REVERSAL_REFUSALS, source, patch),
  };
}

// The tables of kind → "why did nothing change?", one per direction. A codemod is pure
// `string → string`, so a refusal to touch the file looks exactly like an idempotent
// no-op at the call site; these tell the two apart, so `add` and `remove` can warn by
// name instead of skipping in silence. Asking costs a second parse, so both callers ask
// only when nothing changed. The forward table is short because most kinds only ever
// no-op on an edit that is already present; `package-json-script` joined it in #98,
// because it refuses an install-lifecycle key outright and a refusal a user never sees is
// a security hole that reads as a typo. The reversal table follows `INVERSES`, minus
// `const-array`, whose removal only ever no-ops on an entry that is already gone.
type Refusal<K extends PatchKind> = (
  source: string,
  patch: Extract<Patch, { kind: K }>
) => string | undefined;

const REFUSALS: { [K in PatchKind]?: Refusal<K> } = {
  "chained-route": chainedRouteInsertRefusal,
  "const-array": constArrayInsertRefusal,
  "package-json-script": packageJsonScriptRefusal,
};

const REVERSAL_REFUSALS: { [K in PatchKind]?: Refusal<K> } = {
  "chained-route": chainedRouteRemoveRefusal,
  "plugin-array": pluginArrayRemoveRefusal,
  "wrangler-binding": wranglerBindingRemoveRefusal,
};

function refusalReason(
  table: { [K in PatchKind]?: Refusal<K> },
  source: string,
  patch: Patch
): string | undefined {
  const ask = table[patch.kind] as
    ((source: string, patch: Patch) => string | undefined) | undefined;
  return ask?.(source, patch);
}
