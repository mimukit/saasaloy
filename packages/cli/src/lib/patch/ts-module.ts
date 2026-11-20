import { builders, generateCode, parseModule } from "magicast";
import { keepTerminator } from "./ts-ast.js";

// `magicast` codemods for TS/JS module edits (build spec §3.4): the canonical case is
// pushing `stripe()` into Better Auth's `plugins` array. magicast is built on recast,
// so untouched lines keep their exact original formatting — the edit is surgical.
//
// The insert is pure string→string, so the render applies it in memory (plan 0116).

export interface PluginArrayInsert {
  /** Exported binding whose first call-argument object holds the array, e.g. "auth". */
  exportName: string;
  /** Property on that object which is the array, e.g. "plugins". */
  arrayProp: string;
  /** Factory to call and append, e.g. "stripe" → produces `stripe()`. */
  call: string;
  /** Named import to ensure is present for `call`. */
  import: { name: string; from: string };
}

/**
 * Append `call()` to `export const <exportName> = <fn>({ <arrayProp>: [...] })`,
 * adding the named import if missing. Idempotent and formatting-safe:
 *
 * - `call` already in the array → return `source` **unchanged** (never clobber);
 * - array property absent → create it as `[call()]`;
 * - import already present → not duplicated.
 */
export function insertIntoPluginArray(
  source: string,
  patch: PluginArrayInsert
): string {
  const mod = parseModule(source);

  const exported = mod.exports[patch.exportName];
  const callArg = exported?.$args?.[0];
  if (!callArg) {
    return source;
  } // not the shape we expected — leave it be

  const array: unknown = callArg[patch.arrayProp];

  // Already present? Detect by the callee name of each function-call element.
  if (Array.isArray(array) && findCallIndex(array, patch.call) !== -1) {
    return source;
  }

  // Ensure the named import exists (magicast keys imports by local name).
  if (!(patch.import.name in mod.imports)) {
    mod.imports.$prepend({
      from: patch.import.from,
      imported: patch.import.name,
      local: patch.import.name,
    });
  }

  const newCall = builders.functionCall(patch.call);
  if (Array.isArray(array)) {
    array.push(newCall);
  } else {
    // No array yet — create the property holding a single call.
    callArg[patch.arrayProp] = [newCall];
  }

  return print(source, mod);
}

/**
 * Why `insertIntoPluginArray` declined to change `source`, or `undefined` when it had no
 * objection (it added the call, or the call was already there).
 *
 * The one refusal is a missing export. The forward direction leaves a file alone when
 * `<exportName>` is not a call holding an options object, which is right, and used to be
 * silent, which was not: a module that patches `adminAuth` before the project's
 * `auth.ts` has that export reported nothing, and the plugin was simply never added. That
 * is the exact state of a project made before the client/admin split, mid-upgrade, until
 * its new `auth.ts` is merged. Naming the export turns that into a warning `add` and
 * `update` print, and `update` keeps the module's lock entry where it was, so the next
 * run applies the patch.
 */
export function pluginArrayInsertRefusal(
  source: string,
  patch: PluginArrayInsert
): string | undefined {
  const mod = parseModule(source);
  if (mod.exports[patch.exportName]?.$args?.[0]) {
    return undefined;
  }
  return (
    `\`export const ${patch.exportName} = <fn>({ ${patch.arrayProp}: [...] })\` is not ` +
    `in this file, so \`${patch.call}()\` was not added. Merge the new version of the ` +
    `file first, then run \`saasaloy update\` again for the module that ships the plugin`
  );
}

// The generated project ships Prettier and runs it as part of its own `pnpm lint`, so what
// the codemod writes has to survive `prettier --check`. Two recast defaults do not: it
// prints new named imports as `{foo}`, and it drops the file's final newline. Both are
// ours to correct, not the user's to re-fix after every `saasaloy add` or `remove`.
function print(source: string, mod: ReturnType<typeof parseModule>): string {
  return keepTerminator(
    source,
    generateCode(mod, { format: { objectCurlySpacing: true } }).code
  );
}

/** Where the call the forward direction would call "already present" sits, or -1. */
function findCallIndex(array: unknown[], call: string): number {
  // NB: magicast's array proxy hands raw AST nodes to `.some`/`.findIndex` callbacks
  // (no `$type`/`$callee`), so this indexes each element to get the wrapped proxy.
  // for-of is not equivalent: it would hand back the same raw nodes the callback form
  // does, which is the whole reason this indexes.
  // oxlint-disable-next-line typescript/prefer-for-of
  for (let i = 0; i < array.length; i++) {
    const el: unknown = array[i];
    if (isFunctionCall(el) && el.$callee === call) {
      return i;
    }
  }
  return -1;
}

function isFunctionCall(
  value: unknown
): value is { $type: string; $callee: string; $args?: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $type?: unknown }).$type === "function-call"
  );
}
