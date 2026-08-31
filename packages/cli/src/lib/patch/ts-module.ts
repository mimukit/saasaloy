import { builders, generateCode, parseModule } from "magicast";
import {
  describeBinding,
  foreignBinding,
  isReferenced,
  keepTerminator,
} from "./ts-ast.js";
import type { ModuleImports, ProgramLike } from "./ts-ast.js";

// `magicast` codemods for TS/JS module edits (build spec §3.4): the canonical case is
// pushing `stripe()` into Better Auth's `plugins` array. magicast is built on recast,
// so untouched lines keep their exact original formatting — the edit is surgical.
//
// Both directions ship: `saasaloy remove` takes the call and its import back out instead
// of only warning. They are pure string→string, so the applier and the remover can
// preview them.

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

  return print(source, mod);
}

/**
 * The inverse: take `call()` back out of the array, take the array with it when that
 * leaves it empty, and drop the named import it needed.
 *
 * Located by the callee name, since that is the key the forward direction is idempotent
 * on, then **verified against what the descriptor recorded** before anything is deleted.
 * The forward direction writes a bare `call()` from a named import, so anything else under
 * that name is the user's edit, and drift is surfaced rather than resolved here.
 *
 * - the call is already absent (or the array is) → return `source` **unchanged**, so a
 *   hand-reverted file is never force-edited (the remover warns and skips instead);
 * - the call now takes arguments → return `source` **unchanged**
 *   (`pluginArrayRemoveRefusal` reports why);
 * - the local name now binds a different import → return `source` **unchanged**, since
 *   repointing the import changes what the call means without touching the call;
 * - the array is left empty → it stays, as an empty array literal. The capability that
 *   owns the file ships that property and depends on it being there for the next install;
 * - the import statement holds other specifiers → only this one is removed;
 * - the identifier is still referenced elsewhere in the file → the import stays, so a
 *   hand-written second use (`stripe.plans`) is not left unbound.
 */
export function removeFromPluginArray(
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
  if (!Array.isArray(array)) {
    return source;
  } // no array — nothing of ours to take out

  const index = findCallIndex(array, patch.call);
  if (index === -1) {
    return source;
  } // already gone — never force-edit
  if (argumentDrift(array[index], patch)) {
    return source;
  } // the user's call now — not ours to delete
  // The call can read exactly as written while meaning something else: repointing the
  // import changes what `stripe` resolves to without touching the `stripe()` line. That
  // makes both the call and the import the user's, so neither is ours to delete.
  if (removeBindingConflict(mod.imports, patch)) {
    return source;
  }

  array.splice(index, 1);
  // The emptied array stays. Unlike a `wrangler.jsonc` binding array, which no module
  // ships and every patch therefore creates, the capability that owns this file writes
  // the array itself — `export const email = defineEmail({ providers: [] })`, with a
  // comment above it saying never to omit the property even while it is empty, because
  // the forward codemod has nothing to push into otherwise. Deleting it would return the
  // file to something the capability never shipped.

  // Guarded twice: magicast's delete trap throws when the local name isn't imported, and
  // a binding the file still references elsewhere must keep its import or the file stops
  // compiling.
  const program = mod.$ast as unknown as ProgramLike;
  if (
    patch.import.name in mod.imports &&
    !isReferenced(program, patch.import.name)
  ) {
    delete mod.imports[patch.import.name];
  }
  return print(source, mod);
}

/**
 * Why `removeFromPluginArray` declined to change `source`, or `undefined` when it had no
 * objection (it removed the call, or the call was already gone). The mirror of what
 * `chainedRouteRemoveRefusal` does for a route: it tells the remover's "nothing left to
 * revert" apart from "that plugin is yours now".
 */
export function pluginArrayRemoveRefusal(
  source: string,
  patch: PluginArrayInsert
): string | undefined {
  const mod = parseModule(source);
  const callArg = mod.exports[patch.exportName]?.$args?.[0];
  if (!callArg) {
    return undefined;
  }
  const array: unknown = callArg[patch.arrayProp];
  if (!Array.isArray(array)) {
    return undefined;
  }
  const index = findCallIndex(array, patch.call);
  if (index === -1) {
    return undefined;
  } // already gone, not a refusal
  return (
    argumentDrift(array[index], patch) ??
    removeBindingConflict(mod.imports, patch)
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

/**
 * Whether the call found under the recorded callee takes arguments. The forward direction
 * writes a bare `call()`, so anything with an argument is a line the user wrote over —
 * deleting it would throw away configuration the manifest never recorded.
 */
function argumentDrift(
  element: unknown,
  patch: PluginArrayInsert
): string | undefined {
  if (!isFunctionCall(element) || (element.$args?.length ?? 0) === 0) {
    return undefined;
  }
  return `${patch.call}() in ${JSON.stringify(patch.arrayProp)} takes arguments now, not the bare call that was applied`;
}

function removeBindingConflict(
  imports: ModuleImports,
  patch: PluginArrayInsert
): string | undefined {
  const held = foreignBinding(imports, patch.import);
  if (!held) {
    return undefined;
  }
  return `${describeBinding(patch.import.name, held)} now, not from ${JSON.stringify(patch.import.from)}, so the plugin and its import are not the ones that were applied`;
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
