import { insertChainedRoute, removeChainedRoute, type ChainedRoute } from "./chained-route.js";
import { toDiff } from "./diff.js";
import { upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
import { upsertPackageJsonDependency, type PackageJsonDependency } from "./pkg-json.js";
import { upsertPackageJsonScript, type PackageJsonScript } from "./pkg-json-script.js";
import { insertIntoPluginArray, type PluginArrayInsert } from "./ts-module.js";

// The config-patch engine (build spec §3.4): the ~10% of module application that isn't
// a pure file-drop. Small, well-tested AST codemods the applier (#6) invokes for
// structural edits — `jsonc-parser` for `wrangler.jsonc` bindings/routes and package.json
// dependency merges, `magicast` for TS/JS module edits (Better Auth plugin arrays). Every
// patch is pure and `--dry-run`/`--diff`-able: `applyPatch` never writes, it returns the
// would-be content plus a unified diff, and re-running an already-applied patch is a no-op.

export {
  insertChainedRoute,
  removeChainedRoute,
  type ChainedRoute,
} from "./chained-route.js";
export { toDiff } from "./diff.js";
export { upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
export { upsertPackageJsonDependency, type PackageJsonDependency } from "./pkg-json.js";
export { upsertPackageJsonScript, type PackageJsonScript } from "./pkg-json-script.js";
export { insertIntoPluginArray, type PluginArrayInsert } from "./ts-module.js";

/** A single structural patch, tagged by the codemod that applies it. */
export type Patch =
  | ({ kind: "wrangler-binding" } & WranglerBinding)
  | ({ kind: "package-json-dependency" } & PackageJsonDependency)
  | ({ kind: "package-json-script" } & PackageJsonScript)
  | ({ kind: "plugin-array" } & PluginArrayInsert)
  | ({ kind: "chained-route" } & ChainedRoute);

export type PatchKind = Patch["kind"];

export interface PatchResult {
  /** The would-be file content after the patch (equal to the input on a no-op). */
  content: string;
  /** `false` when the patch was already applied — the applier skips the write. */
  changed: boolean;
  /** Unified diff of the change; `""` when nothing changed. */
  diff: string;
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
  return { content, changed: content !== source, diff };
}

function applyCodemod(source: string, patch: Patch): string {
  switch (patch.kind) {
    case "wrangler-binding":
      return upsertWranglerBinding(source, patch);
    case "package-json-dependency":
      return upsertPackageJsonDependency(source, patch);
    case "package-json-script":
      return upsertPackageJsonScript(source, patch);
    case "plugin-array":
      return insertIntoPluginArray(source, patch);
    case "chained-route":
      return insertChainedRoute(source, patch);
    default: {
      const exhaustive: never = patch;
      throw new Error(`unknown patch kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// Patch kinds that ship an inverse today. `chained-route` is the only one: issue #83
// scoped its reversal deliberately, and the general mechanism across every kind is
// issue #36's. `remove` still drops-and-warns for everything not listed here.
const REVERSIBLE_KINDS: ReadonlySet<string> = new Set<PatchKind>(["chained-route"]);

/** Whether `reversePatch` can undo a patch of this kind. */
export function isReversibleKind(kind: string): boolean {
  return REVERSIBLE_KINDS.has(kind);
}

/**
 * Undo one structural `patch`, the mirror of `applyPatch`. Returns `undefined` for a
 * kind with no inverse yet, so the caller can tell "nothing to reverse here" from "the
 * reversal ran and changed nothing". Pure and idempotent, like the forward direction:
 * a patch already reversed yields `changed: false` and an empty diff, which is what
 * keeps a hand-reverted file from being force-edited.
 */
export function reversePatch(source: string, patch: Patch, filename: string): PatchResult | undefined {
  if (patch.kind !== "chained-route") return undefined;
  const content = removeChainedRoute(source, patch);
  return { content, changed: content !== source, diff: toDiff(source, content, filename) };
}
