import { parseModule } from "magicast";
import {
  asObject,
  findConstInit,
  literalValue,
  propertyValue,
  renderValue,
} from "./ts-array.js";
import type { AstNode, Identifier, Program } from "./ts-array.js";

// Filling one empty setting in a config object the project owns.
//
// `packages/tooling/src/deploy.config.ts` ships `ciWorkflow: undefined`, and the `ci`
// module names its workflow there (#244). The file is the owner's, so the patch only
// fills a property that still reads `undefined`: a value the owner set is theirs, and the
// patch leaves it alone and says so. The splice is byte-level, like `const-array`, so the
// comments around the property survive.

export interface ConstProperty {
  /** Module-scope const holding the object, e.g. `deployConfig`. */
  constName: string;
  /** Top-level property of that object to fill, e.g. `ciWorkflow`. */
  property: string;
  /** JSON value to write in place of `undefined`. */
  value: string | number | boolean;
}

/** Replace `property: undefined` with `property: <value>`. */
export function setConstProperty(source: string, patch: ConstProperty): string {
  const node = findValue(source, patch);
  if (!node || !isUndefined(node)) {
    return source;
  }
  return splice(source, node, renderValue(patch.value));
}

/** Explain why an unchanged set did not write: no such property, or the owner's value. */
export function constPropertyRefusal(
  source: string,
  patch: ConstProperty
): string | undefined {
  const node = findValue(source, patch);
  if (!node) {
    return `const-property could not find a property ${patch.property} on a module-scope const object named ${patch.constName}`;
  }
  if (isUndefined(node) || literalValue(node) === patch.value) {
    return undefined;
  }
  return `${patch.constName}.${patch.property} already holds ${source.slice(node.start, node.end)}, so it was left as it is`;
}

/** Put `undefined` back, but only while the property still holds the patch's value. */
export function unsetConstProperty(
  source: string,
  patch: ConstProperty
): string {
  const node = findValue(source, patch);
  if (!node || literalValue(node) !== patch.value) {
    return source;
  }
  return splice(source, node, "undefined");
}

/** Why `unsetConstProperty` declined. An owner's other value is theirs, so it says so. */
export function constPropertyRemoveRefusal(
  source: string,
  patch: ConstProperty
): string | undefined {
  const node = findValue(source, patch);
  if (!node) {
    return `const-property could not find a property ${patch.property} on a module-scope const object named ${patch.constName}`;
  }
  if (isUndefined(node) || literalValue(node) === patch.value) {
    return undefined;
  }
  return `${patch.constName}.${patch.property} now holds ${source.slice(node.start, node.end)}, not the value this module wrote, so it was left as it is`;
}

function findValue(source: string, patch: ConstProperty): AstNode | undefined {
  const program = parseModule(source).$ast as unknown as Program;
  const init = findConstInit(program, patch.constName);
  const object = init ? asObject(init) : undefined;
  return object ? propertyValue(object, patch.property) : undefined;
}

function isUndefined(node: AstNode): boolean {
  return (
    node.type === "Identifier" && (node as Identifier).name === "undefined"
  );
}

function splice(source: string, node: AstNode, text: string): string {
  return `${source.slice(0, node.start)}${text}${source.slice(node.end)}`;
}
