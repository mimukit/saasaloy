import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  type FormattingOptions,
} from "jsonc-parser";

// `jsonc-parser` edits for `wrangler.jsonc` binding/route changes (build spec §3.4).
// It rewrites only the touched region and leaves comments + surrounding formatting
// intact — the reason we don't just `JSON.parse` → stringify, which would strip the
// comments Cloudflare configs rely on.

export interface WranglerBinding {
  /** Top-level array to upsert into, e.g. "d1_databases", "kv_namespaces", "routes". */
  bindingType: string;
  /**
   * The value to insert: an object (a binding or a route, matched by `matchOn`) or a
   * bare string (a flag, e.g. `compatibility_flags: ["nodejs_compat"]`, matched by
   * plain equality).
   */
  entry: Record<string, unknown> | string;
  /**
   * Property that identifies an object `entry` for idempotency. Defaults to "binding"
   * (bindings); pass "pattern" for routes, etc. Ignored for a string `entry`.
   */
  matchOn?: string;
}

/**
 * Insert `entry` into the top-level `bindingType` array of a `wrangler.jsonc`
 * document, idempotently and formatting-safe:
 *
 * - array missing → create it holding `entry`;
 * - array present, no entry matches (`matchOn` for an object, equality for a string)
 *   → append `entry`;
 * - a matching entry already exists → return `source` **unchanged** (never clobber a
 *   value the user may have edited).
 */
export function upsertWranglerBinding(source: string, patch: WranglerBinding): string {
  const matchOn = patch.matchOn ?? "binding";
  const root = parseTree(source);
  if (!root) return source; // unparseable — leave it to the caller/validator to surface

  const arrayNode = findNodeAtLocation(root, [patch.bindingType]);
  const formattingOptions = inferFormatting(source);

  if (arrayNode?.type === "array") {
    const existing = (arrayNode.children ?? []).map((child) => getNodeValue(child) as unknown);
    const entry = patch.entry;
    // A local `const` (not the `patch.entry` property access) so the `typeof` guard's
    // narrowing survives into the closure below — TS doesn't narrow property accesses
    // across a nested function boundary the way it does a plain variable.
    const alreadyPresent =
      typeof entry === "string"
        ? existing.includes(entry)
        : existing.some((value) => isRecord(value) && value[matchOn] === entry[matchOn]);
    if (alreadyPresent) return source;

    const edits = modify(source, [patch.bindingType, existing.length], patch.entry, {
      isArrayInsertion: true,
      formattingOptions,
    });
    return applyEdits(source, edits);
  }

  // No array (or a non-array value) at that key — create the array fresh.
  const edits = modify(source, [patch.bindingType], [patch.entry], { formattingOptions });
  return applyEdits(source, edits);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Match the document's own indentation so inserted lines don't stand out. wrangler
// configs are conventionally 2-space, but respect tabs if that's what the file uses.
// Exported for pkg-json.ts, the other jsonc-parser codemod — same document-formatting
// concern, different top-level shape (package.json dependency maps vs. binding arrays).
export function inferFormatting(source: string): FormattingOptions {
  const usesTabs = /^\t/m.test(source);
  const spaceIndent = source.match(/^( +)\S/m)?.[1];
  return {
    tabSize: spaceIndent ? spaceIndent.length : 2,
    insertSpaces: !usesTabs,
    eol: source.includes("\r\n") ? "\r\n" : "\n",
  };
}
