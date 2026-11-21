import { posix } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { FormattingOptions, ParseError } from "jsonc-parser";
import type { MergeInput, MergeOutput, TextMerger } from "./merge.js";

// The merge by key (plan 0116, "JSON merge"). Four kinds of file merge by key: a key one
// side changed takes that side's value, and only a key both sides changed to different
// values conflicts.
//
// The result keeps the project's layout. Every change that does not conflict lands in
// `mine` first. Then two copies of that result take the base's and upstream's values of
// each conflicting key, and the text merge runs over the three. They differ in those keys
// alone, so the markers sit around those keys and nothing else. A merge with no
// conflicting key needs no text merge, and so no git.

/** The file names that merge by key. */
export const JSON_MERGE_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "saasaloy.json",
  "tsconfig.json",
  "turbo.json",
  "wrangler.jsonc",
]);

/** True when `path` merges by key. */
export function mergesByKey(path: string): boolean {
  return JSON_MERGE_FILES.has(posix.basename(path));
}

type Json = unknown;
type KeyPath = (string | number)[];

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: Json, b: Json): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && same(a[key], b[key]))
    );
  }
  return false;
}

/** Parse JSON with comments; `undefined` when the text does not parse. */
function parseJsonc(text: string): Json {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as Json;
  return errors.length === 0 ? value : undefined;
}

interface KeyChange {
  path: KeyPath;
  /** `undefined` deletes the key. */
  value: Json;
}

interface KeyPlan {
  /** Changes upstream made that `mine` did not: applied to `mine`. */
  apply: KeyChange[];
  /** Keys both sides changed to different values. */
  conflicts: { path: KeyPath; base: Json; theirs: Json }[];
}

function planKeys(
  path: KeyPath,
  base: Json,
  mine: Json,
  theirs: Json,
  plan: KeyPlan
): void {
  // Walk into an object both sides still hold as an object; compare anything else whole.
  if (
    isObject(mine) &&
    isObject(theirs) &&
    (base === undefined || isObject(base))
  ) {
    const baseObject = base ?? {};
    const keys = new Set([
      ...Object.keys(baseObject),
      ...Object.keys(mine),
      ...Object.keys(theirs),
    ]);
    for (const key of keys) {
      planKeys([...path, key], baseObject[key], mine[key], theirs[key], plan);
    }
    return;
  }
  if (same(mine, theirs) || same(base, theirs)) {
    return;
  }
  if (same(base, mine)) {
    plan.apply.push({ path, value: theirs });
    return;
  }
  plan.conflicts.push({ base, path, theirs });
}

function formattingOf(text: string): FormattingOptions {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    insertSpaces: !indent.startsWith("\t"),
    tabSize: indent.startsWith("\t") ? 1 : indent.length,
  };
}

function edit(text: string, change: KeyChange): string {
  return applyEdits(
    text,
    modify(text, change.path, change.value, {
      formattingOptions: formattingOf(text),
    })
  );
}

/**
 * Merge a JSON file by key. Falls back to the plain text merge when a side does not
 * parse, when no base is known, or when the root is not an object.
 */
export async function mergeJson(
  input: MergeInput,
  text: TextMerger
): Promise<MergeOutput> {
  if (input.base === undefined) {
    return text.merge(input);
  }
  const base = parseJsonc(input.base);
  const mine = parseJsonc(input.mine);
  const theirs = parseJsonc(input.theirs);
  if (!isObject(base) || !isObject(mine) || !isObject(theirs)) {
    return text.merge(input);
  }
  const plan: KeyPlan = { apply: [], conflicts: [] };
  planKeys([], base, mine, theirs, plan);

  let merged = input.mine;
  for (const change of plan.apply) {
    merged = edit(merged, change);
  }
  if (plan.conflicts.length === 0) {
    return { conflicts: 0, content: merged };
  }
  let baseSide = merged;
  let theirsSide = merged;
  for (const conflict of plan.conflicts) {
    baseSide = edit(baseSide, { path: conflict.path, value: conflict.base });
    theirsSide = edit(theirsSide, {
      path: conflict.path,
      value: conflict.theirs,
    });
  }
  return text.merge({
    ...input,
    base: baseSide,
    mine: merged,
    theirs: theirsSide,
  });
}
