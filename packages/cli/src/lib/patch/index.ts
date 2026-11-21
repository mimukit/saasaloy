import { constPropertyRefusal, setConstProperty } from "./const-property.js";
import type { ConstProperty } from "./const-property.js";
import { toDiff } from "./diff.js";
import {
  drizzleColumnInsertRefusal,
  insertDrizzleColumn,
} from "./drizzle-column.js";
import type { DrizzleColumn } from "./drizzle-column.js";
import { upsertWranglerBinding } from "./jsonc.js";
import type { WranglerBinding } from "./jsonc.js";
import { upsertPackageJsonDependency } from "./pkg-json.js";
import type { PackageJsonDependency } from "./pkg-json.js";
import {
  packageJsonScriptRefusal,
  upsertPackageJsonScript,
} from "./pkg-json-script.js";
import type { PackageJsonScript } from "./pkg-json-script.js";

// The config-patch engine (build spec §3.4): the small part of module application that
// is neither a file drop nor a registration table. Small, well-tested AST codemods for
// structural edits: `jsonc-parser` for `wrangler.jsonc` bindings and package.json merges,
// `magicast` for a Drizzle column and one const property. A registration table is not a
// patch: the render writes it as a generated file (`engine/tables.ts`, plan 0116 Phase 7).
// The render applies each patch in memory as a transform, so only the insert side exists:
// a remove is a render without the module. `applyPatch` never writes, and re-running an
// applied patch is a no-op.

export {
  type ConstProperty,
  constPropertyRefusal,
  setConstProperty,
} from "./const-property.js";
export { toDiff } from "./diff.js";
export {
  type DrizzleColumn,
  drizzleColumnInsertRefusal,
  insertDrizzleColumn,
} from "./drizzle-column.js";
export { upsertWranglerBinding, type WranglerBinding } from "./jsonc.js";
export {
  upsertPackageJsonDependency,
  type PackageJsonDependency,
} from "./pkg-json.js";
export {
  packageJsonScriptRefusal,
  upsertPackageJsonScript,
  type PackageJsonScript,
} from "./pkg-json-script.js";

/** A single structural patch, tagged by the codemod that applies it. */
export type Patch =
  | ({ kind: "const-property" } & ConstProperty)
  | ({ kind: "drizzle-column" } & DrizzleColumn)
  | ({ kind: "wrangler-binding" } & WranglerBinding)
  | ({ kind: "package-json-dependency" } & PackageJsonDependency)
  | ({ kind: "package-json-script" } & PackageJsonScript);

export type PatchKind = Patch["kind"];

// The `Patch` union at runtime. `Record<PatchKind, true>` is exhaustive in both
// directions: a kind added to the union without a key here fails typecheck, and a key
// that names no kind is an excess property. `PATCH_KINDS` is what `schema.test.ts`
// holds both JSON Schemas to, so the enums can't drift apart again (#98).
const PATCH_KIND_KEYS: Record<PatchKind, true> = {
  "const-property": true,
  "drizzle-column": true,
  "package-json-dependency": true,
  "package-json-script": true,
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
  return {
    content,
    changed,
    diff: toDiff(source, content, filename),
    reason: changed ? undefined : refusalReason(source, patch),
  };
}

function applyCodemod(source: string, patch: Patch): string {
  switch (patch.kind) {
    case "const-property": {
      return setConstProperty(source, patch);
    }
    case "drizzle-column": {
      return insertDrizzleColumn(source, patch);
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
    default: {
      const exhaustive: never = patch;
      throw new Error(`unknown patch kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// The table of kind → "why did nothing change?". A codemod is pure `string → string`, so a
// refusal to touch the file looks exactly like an idempotent no-op at the call site; this
// tells the two apart, so the render can warn by name instead of skipping in silence.
// Asking costs a second parse, so `applyPatch` asks only when nothing changed. Most kinds
// only ever no-op on an edit that is already present; `package-json-script` is here
// because it refuses an install-lifecycle key outright (#98).
type Refusal<K extends PatchKind> = (
  source: string,
  patch: Extract<Patch, { kind: K }>
) => string | undefined;

const REFUSALS: { [K in PatchKind]?: Refusal<K> } = {
  "const-property": constPropertyRefusal,
  "drizzle-column": drizzleColumnInsertRefusal,
  "package-json-script": packageJsonScriptRefusal,
};

function refusalReason(source: string, patch: Patch): string | undefined {
  const ask = REFUSALS[patch.kind] as
    ((source: string, patch: Patch) => string | undefined) | undefined;
  return ask?.(source, patch);
}
