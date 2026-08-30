import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
} from "jsonc-parser";
import type { FormattingOptions } from "jsonc-parser";

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
export function upsertWranglerBinding(
  source: string,
  patch: WranglerBinding
): string {
  const matchOn = patch.matchOn ?? "binding";
  const root = parseTree(source);
  if (!root) {
    return source;
  } // unparseable — leave it to the caller/validator to surface

  const arrayNode = findNodeAtLocation(root, [patch.bindingType]);
  const formattingOptions = inferFormatting(source);

  if (arrayNode?.type === "array") {
    const existing = (arrayNode.children ?? []).map(
      (child) => getNodeValue(child) as unknown
    );
    const { entry } = patch;
    // A local `const` (not the `patch.entry` property access) so the `typeof` guard's
    // narrowing survives into the closure below — TS doesn't narrow property accesses
    // across a nested function boundary the way it does a plain variable.
    const alreadyPresent =
      typeof entry === "string"
        ? existing.includes(entry)
        : existing.some(
            (value) => isRecord(value) && value[matchOn] === entry[matchOn]
          );
    if (alreadyPresent) {
      return source;
    }

    const edits = modify(
      source,
      [patch.bindingType, existing.length],
      patch.entry,
      {
        formattingOptions,
        isArrayInsertion: true,
      }
    );
    return applyEdits(source, edits);
  }

  // No array (or a non-array value) at that key — create the array fresh.
  const edits = modify(source, [patch.bindingType], [patch.entry], {
    formattingOptions,
  });
  return applyEdits(source, edits);
}

/**
 * What an already-present entry looks like when it *isn't* the one the descriptor
 * wants — the signal `saasaloy update` needs to tell "already applied" apart from
 * "the user edited the value we would have written" (issue #48, decision 1).
 */
export interface BindingMatch {
  /** Which entry matched, as `<bindingType>[<matchOn>=<value>]`. */
  key: string;
  /** The entry as the document holds it today. */
  current: unknown;
  /** The entry the descriptor declares. */
  wanted: unknown;
}

/**
 * Find the entry `upsertWranglerBinding` would consider "already present" and report
 * it when it differs from `patch.entry`. Returns `undefined` when nothing matches
 * (the patch will apply) or when the match is byte-equal (a true idempotent re-run).
 *
 * A string `entry` is matched by plain equality, so a match is always identical —
 * there is nothing to report.
 */
export function matchWranglerBinding(
  source: string,
  patch: WranglerBinding
): BindingMatch | undefined {
  const entry = patch.entry;
  if (typeof entry === "string") {
    return undefined;
  }

  const root = parseTree(source);
  if (!root) {
    return undefined;
  }
  const arrayNode = findNodeAtLocation(root, [patch.bindingType]);
  if (arrayNode?.type !== "array") {
    return undefined;
  }

  const matchOn = patch.matchOn ?? "binding";
  const wantedId = entry[matchOn];
  for (const child of arrayNode.children ?? []) {
    const value = getNodeValue(child) as unknown;
    if (!isRecord(value) || value[matchOn] !== wantedId) {
      continue;
    }
    if (sameValue(value, entry)) {
      return undefined;
    }
    return {
      key: `${patch.bindingType}[${matchOn}=${String(wantedId)}]`,
      current: value,
      wanted: entry,
    };
  }
  return undefined;
}

// Order-insensitive structural equality. Both sides come from JSON, so a canonical
// re-serialization with sorted keys is enough — and cheaper than a deep walk.
function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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
    eol: source.includes("\r\n") ? "\r\n" : "\n",
    insertSpaces: !usesTabs,
    tabSize: spaceIndent ? spaceIndent.length : 2,
  };
}
