import { generateCode, parseModule } from "magicast";
import type { ASTNode } from "magicast";
import { describeBinding, foreignBinding, keepTerminator } from "./ts-ast.js";
import type { ModuleImports } from "./ts-ast.js";

// The magicast codemod that adds one column to a Drizzle table another module already
// wrote: it extends the columns object of
// `export const <name> = <table>("<sql name>", { … })`.
//
// It exists because a table is not extensible by the file-drop route every other schema
// change takes. `packages/db` merges every `src/schema/*.ts` into one object and
// drizzle-kit reads the same glob, so a second file declaring `sqliteTable("users", …)`
// collides with the one `auth` ships, in both. A one-to-one side table holds the same fact
// but not the same shape: Better Auth's own plugins write their columns onto the `user`
// model through a field map and cannot be pointed at another table, so `subscription` needs the
// column itself.
//
// The value is carried as verbatim source, not as a structured column description. A
// structured one would have to be re-rendered per dialect, and the two dialects disagree
// on more than the builder's name — `integer(name, { mode: "boolean" })` against
// `boolean(name)`. Verbatim source lets one patch serve both dialects when the builder is
// the same in each (`text("subscription_customer_id")` parses and means the same thing under
// `sqlite-core` and `pg-core`) and lets a descriptor ship a variant per dialect when it is
// not. Nothing here checks the expression's meaning; the project's own typecheck does.
//
// Unlike its two siblings this codemod does not write through the AST at all. Two things
// rule that out. magicast's `builders.raw` throws `MagicastError: Not implemented` on a
// member-expression callee, and a Drizzle column is a chained call
// (`text("x").notNull().default(…)`) almost every time. And recast reprints any subtree it
// sees changed, putting a blank line before every property that is multi-line or carries a
// leading comment — so a node pushed onto the columns object reformats columns this patch
// never touched, which on `modules/auth`'s real `users` table is five spurious blank lines
// that `remove` then cannot take back out.
//
// So the AST is read, never written: it supplies the guards and the byte offsets, and the
// column goes in and comes out as text. The one place recast still prints is the named
// import, which is a statement of its own and reprints alone.

export interface DrizzleColumn {
  /** Exported binding holding the table, e.g. "users" in `export const users = sqliteTable(…)`. */
  exportName: string;
  /** Property key to add to the columns object, e.g. "subscriptionCustomerId". */
  column: string;
  /** The column expression, verbatim source, e.g. `text("subscription_customer_id")`. */
  value: string;
  /**
   * Named import the value needs, when the file does not already have it. Optional,
   * because the common case adds a column built from a builder the table's other columns
   * already use, and an import that was already there is not the patch's to remove.
   */
  import?: { name: string; from: string };
}

/**
 * The columns object is the table call's **second** argument: `sqliteTable(sqlName,
 * columns, extras?)`. Every `*Table` builder in every dialect agrees on that position.
 */
const COLUMNS_ARG = 1;

/** The bits of a recast/babel AST this file reads. Structural, so no parser type leaks out. */
interface Node {
  type: string;
  [key: string]: unknown;
}

interface PropertyNode extends Node {
  key?: { type?: string; name?: string; value?: unknown };
  value?: unknown;
}

interface ObjectNode extends Node {
  properties: PropertyNode[];
}

/**
 * Add `column: <value>` to the table's columns object, adding the named import when the
 * patch declares one and the file lacks it. Idempotent and formatting-safe:
 *
 * - the column key is already there → return `source` **unchanged** (never clobber a
 *   column the user wrote, whatever it holds);
 * - the export is missing, or its second argument is not an object literal → return
 *   `source` unchanged, and `drizzleColumnInsertRefusal` says which;
 * - the import is already present → not duplicated.
 */
export function insertDrizzleColumn(
  source: string,
  patch: DrizzleColumn
): string {
  const mod = parseModule(source);

  const columns = columnsObject(mod, patch);
  if (!columns) {
    return source;
  } // not the shape we expected — leave it be

  if (indexOfColumn(columns, patch.column) !== -1) {
    return source;
  } // already there — never clobber

  // Parsed for its errors only. The value is spliced in as text below, but a value that is
  // not one expression is the descriptor's mistake and has to throw before anything is
  // written, exactly as it did when the node was the thing being inserted.
  parseExpressionNode(patch.value);

  // Asked before the splice, not after. `addImport` returns early when the local name is
  // already bound to something else, but by then the column is written and it reads a
  // builder this file never imported.
  if (patch.import && foreignBinding(mod.imports, patch.import)) {
    return source;
  }

  const withColumn = spliceColumn(source, columns, patch);
  if (!withColumn) {
    return source;
  }

  return addImport(withColumn, patch);
}

/**
 * Add `column: <value>` to the columns object as text, or `undefined` when the object is
 * not the shape this splice can read.
 *
 * Text rather than a node push, and that is the whole point. recast reprints a subtree it
 * sees changed, and its printer puts a blank line before any property that is multi-line or
 * carries a leading comment — so pushing onto the AST reformats properties this patch never
 * touched. `modules/auth`'s own `users` table has five of them, and the file the `auth`
 * manifest tracks would drift on `add` and stay drifted after `remove`. Splicing text leaves
 * every byte outside the inserted line where it was, which is what makes the round trip
 * byte-identical on the real schema files rather than only on a trimmed fixture.
 *
 * The value goes in verbatim, as `DrizzleColumn.value` already promises; nothing here
 * re-renders it.
 */
function spliceColumn(
  source: string,
  columns: ObjectNode,
  patch: DrizzleColumn
): string | undefined {
  const last = columns.properties.at(-1);
  const end = offset(last, "end");
  if (end === undefined) {
    return undefined;
  } // an empty columns object — the module that ships the file wrote none

  const indent = indentOf(source, offset(last, "start") ?? end);
  // The file's own trailing-comma style is kept: a comma already there means the new
  // property carries one too, and a file written without one keeps not having one.
  const comma = source.slice(end).trimStart().startsWith(",");
  const at = comma ? end + source.slice(end).indexOf(",") + 1 : end;
  const line = `${indent}${patch.column}: ${patch.value}`;

  return comma
    ? `${source.slice(0, at)}\n${line},${source.slice(at)}`
    : `${source.slice(0, at)},\n${line}${source.slice(at)}`;
}

/** The leading whitespace of the line `at` sits on. */
function indentOf(source: string, at: number): string {
  const from = source.lastIndexOf("\n", at) + 1;
  return /^[\t ]*/u.exec(source.slice(from, at))?.[0] ?? "";
}

/** A babel/recast node's byte offset, when the parser recorded one. */
function offset(node: unknown, end: "end" | "start"): number | undefined {
  const value = (node as Record<string, unknown> | undefined)?.[end];
  return typeof value === "number" ? value : undefined;
}

/**
 * Add the patch's named import, when it declares one the file lacks.
 *
 * Re-parsed from the text the column splice already produced, so recast only ever sees the
 * import statement as changed and reprints that one line. The columns object is untouched
 * source by then, which is what keeps its formatting.
 */
function addImport(source: string, patch: DrizzleColumn): string {
  if (!patch.import) {
    return source;
  }
  const mod = parseModule(source);
  if (patch.import.name in mod.imports) {
    return source;
  }
  mod.imports.$prepend({
    from: patch.import.from,
    imported: patch.import.name,
    local: patch.import.name,
  });
  return print(source, mod);
}

/**
 * Why `insertDrizzleColumn` declined to change `source`, or `undefined` when it had no
 * objection. A table the patch cannot find is worth reporting rather than skipping in
 * silence: it means the file the descriptor names is not the file it was written against,
 * and the project would otherwise install a provider whose adapter writes a column that is
 * not there — a failure that surfaces at the first webhook instead of at `add` time.
 */
export function drizzleColumnInsertRefusal(
  source: string,
  patch: DrizzleColumn
): string | undefined {
  const mod = parseModule(source);

  if (!mod.exports[patch.exportName]) {
    return `drizzle-column could not find an export named ${JSON.stringify(patch.exportName)}`;
  }
  const columns = columnsObject(mod, patch);
  if (!columns) {
    return `${JSON.stringify(patch.exportName)} is not a Drizzle table call with a columns object as its second argument`;
  }
  const at = indexOfColumn(columns, patch.column);
  if (at !== -1 && valueDrift(columns, at, patch)) {
    return `${JSON.stringify(patch.column)} on ${JSON.stringify(patch.exportName)} holds ${printed(columns, at)}, not the ${patch.value} this patch adds`;
  }
  if (at === -1 && patch.import) {
    return insertBindingConflict(mod.imports, patch);
  }
  return undefined;
}

/** Why `removeDrizzleColumn` declined, or `undefined` when the column was already gone. */
/**
 * The table's columns object node, or `undefined` when the file is not the shape we expect.
 *
 * `mod` is `unknown` because `ReturnType<typeof parseModule>` resolves magicast's generic
 * to its default and loses the index signature on `exports`. The shape this actually needs
 * is the two lines below, so it says so.
 */
function columnsObject(
  mod: unknown,
  patch: DrizzleColumn
): ObjectNode | undefined {
  const { exports } = mod as {
    exports: Record<string, { $args?: { $ast?: Node }[] } | undefined>;
  };
  const node = exports[patch.exportName]?.$args?.[COLUMNS_ARG]?.$ast;
  return node?.type === "ObjectExpression" ? (node as ObjectNode) : undefined;
}

/** Where the column sits in the object, matching on the property key, or -1. */
function indexOfColumn(columns: ObjectNode, column: string): number {
  return columns.properties.findIndex(
    (property) =>
      property.key?.name === column || property.key?.value === column
  );
}

/** Parse one expression to an AST node the object can hold. */
function parseExpressionNode(code: string): unknown {
  const declaration = parseModule(`const __drizzleColumn = ${code};`).$ast as {
    body: { declarations?: { init?: unknown }[] }[];
  };
  // Exactly one statement, not merely a first one that parsed. `text("x"); other()` yields
  // two statements with an `init` on the first, and `spliceColumn` writes the value
  // verbatim, so accepting it leaves a schema file that no longer parses.
  const init =
    declaration.body.length === 1
      ? declaration.body[0]?.declarations?.[0]?.init
      : undefined;
  if (!init) {
    throw new TypeError(
      `drizzle-column value is not a single expression: ${JSON.stringify(code)}`
    );
  }
  return init;
}

/** The column's current expression, as source. */
function printed(columns: ObjectNode, at: number): string {
  return generateCode(columns.properties[at]?.value as ASTNode).code;
}

/**
 * Whether the column found under the recorded key holds something other than what was
 * applied. Compared with whitespace collapsed, because recast reprints the expression from
 * the AST and a hand-wrapped multi-line chain is the same column, not a different one.
 */
function valueDrift(
  columns: ObjectNode,
  at: number,
  patch: DrizzleColumn
): string | undefined {
  if (collapse(printed(columns, at)) === collapse(patch.value)) {
    return undefined;
  }
  return `${JSON.stringify(patch.column)} on ${JSON.stringify(patch.exportName)} reads ${printed(columns, at)} now, not the ${patch.value} that was applied`;
}

function collapse(code: string): string {
  return code.replaceAll(/\s+/gu, "");
}

function insertBindingConflict(
  imports: ModuleImports,
  patch: DrizzleColumn
): string | undefined {
  const held = patch.import ? foreignBinding(imports, patch.import) : undefined;
  if (!held || !patch.import) {
    return undefined;
  }
  return `${describeBinding(patch.import.name, held)}, so ${JSON.stringify(patch.column)} would read the wrong builder`;
}

// Two recast corrections: `{foo}` for a new named import, and a dropped final newline. The generated project runs `prettier --check` in its own lint.
function print(source: string, mod: ReturnType<typeof parseModule>): string {
  return keepTerminator(
    source,
    generateCode(mod, { format: { objectCurlySpacing: true } }).code
  );
}
