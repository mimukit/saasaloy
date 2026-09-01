import { parseModule } from "magicast";

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

function appendEntry(
  source: string,
  array: ArrayExpression,
  entry: string
): string {
  const close = array.end - 1;
  const closeLineStart = source.lastIndexOf("\n", close - 1) + 1;
  const closeIndent = source.slice(closeLineStart, close);
  const isMultiline = closeIndent.trim() === "" && closeLineStart > array.start;
  if (!isMultiline) {
    const separator = array.elements.length === 0 ? "" : ", ";
    return `${source.slice(0, close)}${separator}${entry}${source.slice(close)}`;
  }

  let before = source.slice(0, closeLineStart);
  const last = array.elements.at(-1);
  if (last && !source.slice(last.end, close).includes(",")) {
    before = `${source.slice(0, last.end)},${source.slice(last.end, closeLineStart)}`;
  }
  const itemIndent = `${closeIndent}  `;
  return `${before}${itemIndent}${entry},\n${source.slice(closeLineStart)}`;
}

function removeEntry(
  source: string,
  array: ArrayExpression,
  index: number
): string {
  const element = array.elements[index];
  if (!element) {
    return source;
  }
  const lineStart = source.lastIndexOf("\n", element.start - 1) + 1;
  const lineEnd = source.indexOf("\n", element.end);
  const ownLine = source.slice(lineStart, element.start).trim() === "";
  if (ownLine && lineEnd !== -1) {
    return `${source.slice(0, lineStart)}${source.slice(lineEnd + 1)}`;
  }

  const next = array.elements[index + 1];
  if (next) {
    return `${source.slice(0, element.start)}${source.slice(next.start)}`;
  }
  const previous = array.elements[index - 1];
  const start = previous
    ? source.lastIndexOf(",", element.start - 1)
    : element.start;
  return `${source.slice(0, start)}${source.slice(element.end)}`;
}

function hasEntry(
  array: ArrayExpression,
  key: string,
  wanted: unknown
): boolean {
  return array.elements.some((element) => entryValue(element, key) === wanted);
}

function entryValue(element: AstNode | null, key: string): unknown {
  if (element?.type !== "ObjectExpression") {
    return undefined;
  }
  for (const property of (element as ObjectExpression).properties) {
    if (property.type !== "ObjectProperty" || property.computed) {
      continue;
    }
    if (propertyName(property.key) !== key) {
      continue;
    }
    return literalValue(property.value);
  }
  return undefined;
}

function propertyName(node: AstNode): string | undefined {
  if (node.type === "Identifier") {
    return (node as Identifier).name;
  }
  return literalValue(node) as string | undefined;
}

function literalValue(node: AstNode): unknown {
  if (
    node.type !== "StringLiteral" &&
    node.type !== "NumericLiteral" &&
    node.type !== "BooleanLiteral" &&
    node.type !== "NullLiteral" &&
    node.type !== "Literal"
  ) {
    return undefined;
  }
  return node.type === "NullLiteral" ? null : (node as Literal).value;
}

function findConstArray(
  program: Program,
  constName: string
): ArrayExpression | undefined {
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? (statement as ExportNamedDeclaration).declaration
        : statement;
    if (
      declaration?.type !== "VariableDeclaration" ||
      (declaration as VariableDeclaration).kind !== "const"
    ) {
      continue;
    }
    for (const declarator of (declaration as VariableDeclaration)
      .declarations) {
      if (
        declarator.id.type !== "Identifier" ||
        (declarator.id as Identifier).name !== constName ||
        !declarator.init
      ) {
        continue;
      }
      const value = unwrapTypeExpression(declarator.init);
      return value.type === "ArrayExpression"
        ? (value as ArrayExpression)
        : undefined;
    }
  }
  return undefined;
}

function unwrapTypeExpression(node: AstNode): AstNode {
  let value = node;
  while (
    value.type === "TSAsExpression" ||
    value.type === "TSSatisfiesExpression" ||
    value.type === "TypeCastExpression"
  ) {
    value = (value as TypeExpression).expression;
  }
  return value;
}

function renderObject(entry: Record<string, unknown>): string {
  return `{ ${Object.entries(entry)
    .map(([key, value]) => `${renderKey(key)}: ${renderValue(value)}`)
    .join(", ")} }`;
}

function renderKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderValue(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(renderValue).join(", ")}]`;
  }
  if (typeof value === "object") {
    return renderObject(value as Record<string, unknown>);
  }
  throw new TypeError("const-array entries must contain JSON values");
}

interface AstNode {
  type: string;
  start: number;
  end: number;
}
interface Identifier extends AstNode {
  name: string;
}
interface Literal extends AstNode {
  value: unknown;
}
interface ObjectProperty extends AstNode {
  computed: boolean;
  key: AstNode;
  value: AstNode;
}
interface ObjectExpression extends AstNode {
  properties: ObjectProperty[];
}
interface ArrayExpression extends AstNode {
  elements: (AstNode | null)[];
}
interface VariableDeclarator extends AstNode {
  id: AstNode;
  init: AstNode | null;
}
interface VariableDeclaration extends AstNode {
  declarations: VariableDeclarator[];
  kind: string;
}
interface ExportNamedDeclaration extends AstNode {
  declaration: AstNode | null;
}
interface TypeExpression extends AstNode {
  expression: AstNode;
}
interface Program extends AstNode {
  body: AstNode[];
}
