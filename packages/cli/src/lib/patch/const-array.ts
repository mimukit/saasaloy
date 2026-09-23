import { parseModule } from "magicast";
import {
  appendEntry,
  entryValue,
  findConstArray,
  hasEntry,
  removeEntry,
  renderObject,
} from "./ts-array.js";
import type { Program } from "./ts-array.js";

export interface ConstArrayInsert {
  /** Module-scope const array to extend. */
  constName: string;
  /** Property whose value identifies an entry. */
  key: string;
  /** JSON object literal to append. */
  entry: Record<string, unknown>;
}

/** Append an object to a named module-scope const array, matched by one property. */
export function insertIntoConstArray(
  source: string,
  patch: ConstArrayInsert
): string {
  const mod = parseModule(source);
  const array = findConstArray(mod.$ast as unknown as Program, patch.constName);
  const wanted = patch.entry[patch.key];
  if (!array || wanted === undefined || hasEntry(array, patch.key, wanted)) {
    return source;
  }

  return appendEntry(source, array, renderObject(patch.entry));
}

/** Explain why an unchanged insert could not find its declared target shape. */
export function constArrayInsertRefusal(
  source: string,
  patch: ConstArrayInsert
): string | undefined {
  const mod = parseModule(source);
  const array = findConstArray(mod.$ast as unknown as Program, patch.constName);
  if (!array) {
    return `const-array could not find a module-scope const array named ${patch.constName}`;
  }
  if (patch.entry[patch.key] === undefined) {
    return `const-array entry has no identity property named ${patch.key}`;
  }
  return undefined;
}

/** Remove the object whose identity property matches the recorded entry. */
export function removeFromConstArray(
  source: string,
  patch: ConstArrayInsert
): string {
  const mod = parseModule(source);
  const array = findConstArray(mod.$ast as unknown as Program, patch.constName);
  const wanted = patch.entry[patch.key];
  if (!array || wanted === undefined) {
    return source;
  }

  const index = array.elements.findIndex(
    (element) => entryValue(element, patch.key) === wanted
  );
  if (index === -1) {
    return source;
  }
  return removeEntry(source, array, index);
}
