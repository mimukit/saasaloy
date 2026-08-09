import { builders, generateCode, parseModule } from "magicast";

// `magicast` codemods for TS/JS module edits (build spec §3.4): the canonical case is
// pushing `stripe()` into Better Auth's `plugins` array. magicast is built on recast,
// so untouched lines keep their exact original formatting — the edit is surgical.

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

  const array = callArg[patch.arrayProp];

  // Already present? Detect by the callee name of each function-call element.
  // NB: magicast's array proxy hands raw AST nodes to `.some`/`.forEach` callbacks
  // (no `$type`/`$callee`), so we index each element to get the wrapped proxy.
  if (Array.isArray(array)) {
    // for-of is not equivalent here: it would hand back the same raw AST nodes the
    // callback form does, which is the whole reason this indexes.
    // oxlint-disable-next-line typescript/prefer-for-of
    for (let i = 0; i < array.length; i++) {
      const el: unknown = array[i];
      if (isFunctionCall(el) && el.$callee === patch.call) {
        return source;
      }
    }
  }

  // Ensure the named import exists (magicast keys imports by local name).
  if (!(patch.import.name in mod.imports)) {
    mod.imports.$add({
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

  // The generated project ships Prettier and runs it as part of its own `pnpm lint`,
  // so what the codemod writes has to survive `prettier --check`. Two recast defaults
  // do not: it prints new named imports as `{foo}`, and it drops the file's final
  // newline. Both are ours to correct, not the user's to re-fix after every
  // `saasaloy add`.
  const code = generateCode(mod, { format: { objectCurlySpacing: true } }).code;
  return source.endsWith("\n") && !code.endsWith("\n") ? `${code}\n` : code;
}

function isFunctionCall(
  value: unknown
): value is { $type: string; $callee: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $type?: unknown }).$type === "function-call"
  );
}
