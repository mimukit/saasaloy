import { toDiff } from "./diff.js";
import { matchWranglerBinding, upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
import {
  matchPackageJsonDependency,
  type PackageJsonDependency,
  upsertPackageJsonDependency,
} from "./pkg-json.js";
import { insertIntoPluginArray, type PluginArrayInsert } from "./ts-module.js";

// The config-patch engine (build spec §3.4): the ~10% of module application that isn't
// a pure file-drop. Small, well-tested AST codemods the applier (#6) invokes for
// structural edits — `jsonc-parser` for `wrangler.jsonc` bindings/routes and package.json
// dependency merges, `magicast` for TS/JS module edits (Better Auth plugin arrays). Every
// patch is pure and `--dry-run`/`--diff`-able: `applyPatch` never writes, it returns the
// would-be content plus a unified diff, and re-running an already-applied patch is a no-op.

export { toDiff } from "./diff.js";
export { type BindingMatch, matchWranglerBinding, upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
export {
  matchPackageJsonDependency,
  type PackageJsonDependency,
  upsertPackageJsonDependency,
} from "./pkg-json.js";
export { insertIntoPluginArray, type PluginArrayInsert } from "./ts-module.js";

/** A single structural patch, tagged by the codemod that applies it. */
export type Patch =
  | ({ kind: "wrangler-binding" } & WranglerBinding)
  | ({ kind: "package-json-dependency" } & PackageJsonDependency)
  | ({ kind: "plugin-array" } & PluginArrayInsert);

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
export function applyPatch(source: string, patch: Patch, filename: string): PatchResult {
  const content = applyCodemod(source, patch);
  const diff = toDiff(source, content, filename);
  const matched = matchExisting(source, patch);
  return { content, changed: content !== source, diff, ...(matched ? { matched } : {}) };
}

// Only the two jsonc codemods have an identity to collide on. A `plugin-array` insert
// is matched by the call expression itself, so a match is always an exact re-run.
function matchExisting(source: string, patch: Patch): PatchMatch | undefined {
  switch (patch.kind) {
    case "wrangler-binding":
      return matchWranglerBinding(source, patch);
    case "package-json-dependency":
      return matchPackageJsonDependency(source, patch);
    default:
      return undefined;
  }
}

function applyCodemod(source: string, patch: Patch): string {
  switch (patch.kind) {
    case "wrangler-binding":
      return upsertWranglerBinding(source, patch);
    case "package-json-dependency":
      return upsertPackageJsonDependency(source, patch);
    case "plugin-array":
      return insertIntoPluginArray(source, patch);
    default: {
      const exhaustive: never = patch;
      throw new Error(`unknown patch kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
