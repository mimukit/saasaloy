import { generateCode, parseModule } from "magicast";
import type { ASTNode } from "magicast";
import {
  describeBinding,
  foreignBinding,
  isReferenced,
  keepTerminator,
} from "./ts-ast.js";
import type { ModuleImports, ProgramLike } from "./ts-ast.js";

// The third magicast codemod: add one column to a Drizzle table another module already
// wrote. `plugin-array` extends an array, `chained-route` extends a call chain, and this
// extends the columns object of `export const <name> = <table>("<sql name>", { … })`.
//
// It exists because a table is not extensible by the file-drop route every other schema
// change takes. `packages/db` merges every `src/schema/*.ts` into one object and
// drizzle-kit reads the same glob, so a second file declaring `sqliteTable("user", …)`
// collides with the one `auth` ships, in both. A one-to-one side table holds the same fact
// but not the same shape: Better Auth's own plugins write their columns onto the `user`
// model through a field map and cannot be pointed at another table, so `billing` needs the
// column itself.
//
// The value is carried as verbatim source, not as a structured column description. A
// structured one would have to be re-rendered per dialect, and the two dialects disagree
// on more than the builder's name — `integer(name, { mode: "boolean" })` against
// `boolean(name)`. Verbatim source lets one patch serve both dialects when the builder is
// the same in each (`text("billing_customer_id")` parses and means the same thing under
// `sqlite-core` and `pg-core`) and lets a descriptor ship a variant per dialect when it is
// not. Nothing here checks the expression's meaning; the project's own typecheck does.
//
// Unlike its two siblings this codemod edits the AST directly rather than through
// magicast's value proxies. `builders.raw` throws `MagicastError: Not implemented` on a
// member-expression callee, and a Drizzle column is a chained call
// (`text("x").notNull().default(…)`) almost every time. Parsing the expression and
// splicing its node in is what recast is for, and it keeps every other line's formatting.

export interface DrizzleColumn {
  /** Exported binding holding the table, e.g. "user" in `export const user = sqliteTable(…)`. */
  exportName: string;
  /** Property key to add to the columns object, e.g. "billingCustomerId". */
  column: string;
  /** The column expression, verbatim source, e.g. `text("billing_customer_id")`. */
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

  if (patch.import && !(patch.import.name in mod.imports)) {
    mod.imports.$add({
      from: patch.import.from,
      imported: patch.import.name,
      local: patch.import.name,
    });
  }

  // Cloned from a property the file already has, so the node carries whatever `type`
  // discriminator this parser build uses (`ObjectProperty` under babel, `Property` under
  // espree) instead of this file guessing one.
  const [proto] = columns.properties;
  columns.properties.push({
    computed: false,
    key: { name: patch.column, type: "Identifier" },
    kind: "init",
    shorthand: false,
    type: proto?.type ?? "ObjectProperty",
    value: parseExpressionNode(patch.value),
  });

  return print(source, mod);
}

/**
 * The inverse: take the column back out, and the import with it when the patch brought one
 * and nothing else reads it.
 *
 * Verified against what the descriptor recorded before anything is deleted, the same rule
 * `removeFromPluginArray` follows. The forward direction writes exactly `patch.value`, so a
 * column reading anything else is the user's edit — a `.notNull()` added, a default filled
 * in — and dropping it would throw away a schema decision the manifest never recorded.
 *
 * - the column is already gone (or the table is) → return `source` **unchanged**;
 * - the column now holds a different expression → return `source` **unchanged**
 *   (`drizzleColumnRemoveRefusal` reports why);
 * - the local name now binds a different import → return `source` **unchanged**;
 * - the import statement holds other specifiers → only this one is removed;
 * - the identifier is still referenced elsewhere → the import stays.
 *
 * An emptied columns object is not a case to handle: a table this patch found always had
 * columns of its own, because the module that ships the file wrote them.
 */
export function removeDrizzleColumn(
  source: string,
  patch: DrizzleColumn
): string {
  const mod = parseModule(source);

  const columns = columnsObject(mod, patch);
  const at = columns ? indexOfColumn(columns, patch.column) : -1;
  if (!columns || at === -1) {
    return source;
  } // already gone — never force-edit
  if (valueDrift(columns, at, patch)) {
    return source;
  } // the user's column now — not ours to delete
  if (patch.import && removeBindingConflict(mod.imports, patch.import)) {
    return source;
  }

  columns.properties.splice(at, 1);

  // Guarded twice, as in ts-module.ts: magicast's delete trap throws when the local name
  // isn't imported, and a binding the file still references elsewhere must keep its import
  // or the file stops compiling. Deleting the column is exactly what can drop the last
  // reference, so the question is asked after the splice rather than before it.
  const program = mod.$ast as unknown as ProgramLike;
  if (
    patch.import &&
    patch.import.name in mod.imports &&
    !isReferenced(program, patch.import.name)
  ) {
    delete mod.imports[patch.import.name];
  }

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
  return undefined;
}

/** Why `removeDrizzleColumn` declined, or `undefined` when the column was already gone. */
export function drizzleColumnRemoveRefusal(
  source: string,
  patch: DrizzleColumn
): string | undefined {
  const mod = parseModule(source);

  const columns = columnsObject(mod, patch);
  const at = columns ? indexOfColumn(columns, patch.column) : -1;
  if (!columns || at === -1) {
    return undefined;
  } // already gone, not a refusal
  return (
    valueDrift(columns, at, patch) ??
    (patch.import
      ? removeBindingConflict(mod.imports, patch.import)
      : undefined)
  );
}

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
  const init = declaration.body[0]?.declarations?.[0]?.init;
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

function removeBindingConflict(
  imports: ModuleImports,
  want: { name: string; from: string }
): string | undefined {
  const held = foreignBinding(imports, want);
  if (!held) {
    return undefined;
  }
  return `${describeBinding(want.name, held)} now, not from ${JSON.stringify(want.from)}, so the column and its import are not the ones that were applied`;
}

// Same two recast corrections ts-module.ts makes: `{foo}` for a new named import, and a
// dropped final newline. The generated project runs `prettier --check` in its own lint.
function print(source: string, mod: ReturnType<typeof parseModule>): string {
  return keepTerminator(
    source,
    generateCode(mod, { format: { objectCurlySpacing: true } }).code
  );
}
