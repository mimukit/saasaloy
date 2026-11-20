// The literal-reading half of the TS codemods: find a module-scope const and its array or
// object, read an entry's identity, and render a JSON value as TypeScript source.
// `const-property` splices with these, and `doctor` reads the deploy targets with them.
//
// It is byte-level rather than magicast's reprint-the-program route, and deliberately so.
// A patch lands on a file a user owns and keeps editing, so every byte the patch does not
// mean to change has to stay as it was.

/** A module-scope `const <name> = [...]`, `as const` and friends unwrapped. */
export function findConstArray(
  program: Program,
  constName: string
): ArrayExpression | undefined {
  const init = findConstInit(program, constName);
  return init ? asArray(init) : undefined;
}

/** The initializer of a module-scope `const <name>`, exported or not. */
export function findConstInit(
  program: Program,
  constName: string
): AstNode | undefined {
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
        declarator.id.type === "Identifier" &&
        (declarator.id as Identifier).name === constName &&
        declarator.init
      ) {
        return declarator.init;
      }
    }
  }
  return undefined;
}

/** The node as an object literal, `as const` / `satisfies` unwrapped, or `undefined`. */
export function asObject(node: AstNode): ObjectExpression | undefined {
  const value = unwrapTypeExpression(node);
  return value.type === "ObjectExpression"
    ? (value as ObjectExpression)
    : undefined;
}

/** The node as an array literal, `as const` / `satisfies` unwrapped, or `undefined`. */
export function asArray(node: AstNode): ArrayExpression | undefined {
  const value = unwrapTypeExpression(node);
  return value.type === "ArrayExpression"
    ? (value as ArrayExpression)
    : undefined;
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

/** A JSON value as TS source. Throws on anything JSON cannot hold. */
export function renderValue(value: unknown): string {
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

/** A literal node's value, or `undefined` for any other node. */
export function literalValue(node: AstNode): unknown {
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
