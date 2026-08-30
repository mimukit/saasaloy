import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
} from "jsonc-parser";
import { inferFormatting } from "./jsonc.js";

// `jsonc-parser` edits for package.json `scripts` entries — the sibling of
// upsertPackageJsonDependency, for the case where a module needs a command runnable in a
// workspace ANOTHER module scaffolded (e.g. `database` adding `db:generate` to the app it
// wires itself into). Rewrites only the touched region, preserving the rest of the
// document's formatting.

export interface PackageJsonScript {
  /** Script key to upsert (e.g. "db:generate"). */
  name: string;
  /** Command the script runs (e.g. "drizzle-kit generate"). */
  value: string;
}

/**
 * Insert `name: value` into a package.json's `scripts` map, idempotently and
 * formatting-safe:
 *
 * - `scripts` missing (or holding a non-object) → create it holding `{ [name]: value }`;
 * - `scripts` present, name absent → add the entry;
 * - name already present (any command, including `""`) → return `source` **unchanged**
 *   (never clobber a command the user may have edited, matching
 *   `upsertPackageJsonDependency`).
 */
export function upsertPackageJsonScript(
  source: string,
  patch: PackageJsonScript
): string {
  const root = parseTree(source);
  if (!root) {
    return source;
  } // unparseable — leave it to the caller/validator to surface

  const formattingOptions = inferFormatting(source);
  const scriptsNode = findNodeAtLocation(root, ["scripts"]);

  if (scriptsNode?.type === "object") {
    const existing = getNodeValue(scriptsNode) as Record<string, unknown>;
    if (Object.hasOwn(existing, patch.name)) {
      return source;
    }

    const edits = modify(source, ["scripts", patch.name], patch.value, {
      formattingOptions,
    });
    return applyEdits(source, edits);
  }

  // No `scripts` (or a non-object value) at that key — create it fresh.
  const edits = modify(
    source,
    ["scripts"],
    { [patch.name]: patch.value },
    { formattingOptions }
  );
  return applyEdits(source, edits);
}
