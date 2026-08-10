import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from "jsonc-parser";
import { inferFormatting } from "./jsonc.js";

// `jsonc-parser` edits for package.json dependency merges — the counterpart to
// upsertWranglerBinding, for the one case a module's config lives outside its own
// scaffold: adding a dependency to a package.json ANOTHER module already wrote (e.g.
// `database` making itself importable from `api`). Rewrites only the touched region,
// preserving the rest of the document's formatting.

export interface PackageJsonDependency {
  /** Which dependency map to upsert into. */
  section: "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
  /** npm or workspace package name. */
  name: string;
  /** Version range to write (e.g. "workspace:*", "^1.2.3"). */
  range: string;
}

/**
 * Insert `name: range` into a package.json's `section` map, idempotently and
 * formatting-safe:
 *
 * - section missing → create it holding `{ [name]: range }`;
 * - section present, name absent → add the entry;
 * - name already present (any range) → return `source` **unchanged** (never clobber
 *   a value the user may have edited, matching `upsertWranglerBinding`).
 */
export function upsertPackageJsonDependency(source: string, patch: PackageJsonDependency): string {
  const root = parseTree(source);
  if (!root) return source; // unparseable — leave it to the caller/validator to surface

  const formattingOptions = inferFormatting(source);
  const sectionNode = findNodeAtLocation(root, [patch.section]);

  if (sectionNode?.type === "object") {
    const existing = getNodeValue(sectionNode) as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(existing, patch.name)) return source;

    const edits = modify(source, [patch.section, patch.name], patch.range, { formattingOptions });
    return applyEdits(source, edits);
  }

  // No section (or a non-object value) at that key — create it fresh.
  const edits = modify(source, [patch.section], { [patch.name]: patch.range }, {
    formattingOptions,
  });
  return applyEdits(source, edits);
}

/**
 * Report the dependency this patch would have added when it is already declared at a
 * *different* range — the same "already present, but not what we wanted" signal
 * `matchWranglerBinding` gives for bindings (issue #48, decision 1). `undefined` when
 * the name is absent (the patch applies) or already pinned to `patch.range`.
 */
export function matchPackageJsonDependency(
  source: string,
  patch: PackageJsonDependency,
): { key: string; current: unknown; wanted: unknown } | undefined {
  const root = parseTree(source);
  if (!root) return undefined;
  const sectionNode = findNodeAtLocation(root, [patch.section]);
  if (sectionNode?.type !== "object") return undefined;

  const existing = getNodeValue(sectionNode) as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(existing, patch.name)) return undefined;
  const current = existing[patch.name];
  if (current === patch.range) return undefined;
  return { key: `${patch.section}[${patch.name}]`, current, wanted: patch.range };
}
