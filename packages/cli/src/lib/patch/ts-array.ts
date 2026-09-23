// The array-literal half of the TS codemods: find a module-scope const array, read an
// entry's identity, splice one in or out, and render an object literal to insert.
//
// It is byte-level rather than magicast's reprint-the-program route, and deliberately so.
// These patches land on files a user owns and keeps editing, so every byte the patch does
// not mean to change has to stay as it was. `const-array` built this first; `nav-entry`
// needs the same splices one level deeper, which is why they live here rather than twice.

/** A module-scope `const <name> = [...]`, `as const` and friends unwrapped. */
export function findConstArray(
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
      return asArray(declarator.init);
    }
  }
  return undefined;
}

/** The node as an array literal, `as const` / `satisfies` unwrapped, or `undefined`. */
export function asArray(node: AstNode): ArrayExpression | undefined {
  const value = unwrapTypeExpression(node);
  return value.type === "ArrayExpression"
    ? (value as ArrayExpression)
    : undefined;
}

/** The first element object whose `key` property holds `wanted`. */
export function findElement(
  array: ArrayExpression,
  key: string,
  wanted: unknown
): ObjectExpression | undefined {
  for (const element of array.elements) {
    if (
      element?.type === "ObjectExpression" &&
      entryValue(element, key) === wanted
    ) {
      return element as ObjectExpression;
    }
  }
  return undefined;
}

/** The value node of a non-computed property, for walking one level deeper. */
export function propertyValue(
  object: ObjectExpression,
  key: string
): AstNode | undefined {
  for (const property of object.properties) {
    if (property.type !== "ObjectProperty" || property.computed) {
      continue;
    }
    if (propertyName(property.key) === key) {
      return property.value;
    }
  }
  return undefined;
}

/**
 * Splice `entry` in as the array's last element.
 *
 * Matches what is already there rather than imposing a house style: a one-line array gets
 * `, entry`, a multi-line one gets its own line at the existing indent, and a last element
 * without a trailing comma gains one. Prettier runs in the generated project, so anything
 * else comes back as a diff the user did not ask for.
 */
export function appendEntry(
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

/** Splice the element at `index` back out, taking its line or its separator with it. */
export function removeEntry(
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

/** Whether any element already carries `wanted` under its `key` property. */
export function hasEntry(
  array: ArrayExpression,
  key: string,
  wanted: unknown
): boolean {
  return array.elements.some((element) => entryValue(element, key) === wanted);
}

/** The literal value an element holds under `key`, or `undefined`. */
export function entryValue(element: AstNode | null, key: string): unknown {
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

/** Render a JSON object as a single-line TS object literal. */
export function renderObject(entry: Record<string, unknown>): string {
  return `{ ${renderProperties(entry).join(", ")} }`;
}

/** The rendered `key: value` pairs, so a caller can append one of its own. */
export function renderProperties(entry: Record<string, unknown>): string[] {
  return Object.entries(entry).map(
    ([key, value]) => `${renderKey(key)}: ${renderValue(value)}`
  );
}

/** A property key, quoted only when it is not a plain identifier. */
export function renderKey(key: string): string {
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
  throw new TypeError("patch entries must contain JSON values");
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

export interface AstNode {
  type: string;
  start: number;
  end: number;
}
export interface Identifier extends AstNode {
  name: string;
}
export interface Literal extends AstNode {
  value: unknown;
}
export interface ObjectProperty extends AstNode {
  computed: boolean;
  key: AstNode;
  value: AstNode;
}
export interface ObjectExpression extends AstNode {
  properties: ObjectProperty[];
}
export interface ArrayExpression extends AstNode {
  elements: (AstNode | null)[];
}
export interface VariableDeclarator extends AstNode {
  id: AstNode;
  init: AstNode | null;
}
export interface VariableDeclaration extends AstNode {
  declarations: VariableDeclarator[];
  kind: string;
}
export interface ExportNamedDeclaration extends AstNode {
  declaration: AstNode | null;
}
export interface TypeExpression extends AstNode {
  expression: AstNode;
}
export interface Program extends AstNode {
  body: AstNode[];
}
