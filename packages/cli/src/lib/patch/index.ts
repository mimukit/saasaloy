import { toDiff } from "./diff.js";
import { upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
import { insertIntoPluginArray, type PluginArrayInsert } from "./ts-module.js";

// The config-patch engine (build spec §3.4): the ~10% of module application that isn't
// a pure file-drop. Small, well-tested AST codemods the applier (#6) invokes for
// structural edits — `jsonc-parser` for `wrangler.jsonc` bindings/routes, `magicast`
// for TS/JS module edits (Better Auth plugin arrays). Every patch is pure and
// `--dry-run`/`--diff`-able: `applyPatch` never writes, it returns the would-be
// content plus a unified diff, and re-running an already-applied patch is a no-op.

export { toDiff } from "./diff.js";
export { upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
export { insertIntoPluginArray, type PluginArrayInsert } from "./ts-module.js";

/** A single structural patch, tagged by the codemod that applies it. */
export type Patch =
  | ({ kind: "wrangler-binding" } & WranglerBinding)
  | ({ kind: "plugin-array" } & PluginArrayInsert);

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
    case "plugin-array":
      return insertIntoPluginArray(source, patch);
    default: {
      const exhaustive: never = patch;
      throw new Error(`unknown patch kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
