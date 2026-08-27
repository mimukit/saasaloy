import { builders, generateCode, parseModule } from "magicast";

// `magicast` codemod for a chained-call router entry file — Hono's RPC shape, where
// `const app = new Hono().route("/x", x)` is the exported chain a client derives
// `typeof app` from. The sibling of ts-module.ts's plugin-array insert, split out
// because a call chain is a different structure from an array literal.
//
// Unlike the other three kinds this one ships its inverse (`removeChainedRoute`), so
// `saasaloy remove` takes the link and its import back out instead of only warning.
// Both directions are pure string→string, so the applier and the remover can preview
// them. Nothing writes an anchor or sentinel comment: magicast is backed by recast, so
// untouched lines keep their exact source and the chain locates itself (ADR 0006).

export interface ChainedRoute {
  /** Exported binding whose call chain to extend, e.g. "default" or "app". */
  exportName: string;
  /** Route path — `.route()`'s first argument, e.g. "/waitlist". Also the match key. */
  path: string;
  /** Identifier passed as `.route()`'s second argument, e.g. "waitlist". */
  call: string;
  /** Named import to ensure is present for `call`. */
  import: { name: string; from: string };
}

/**
 * Append `.route(<path>, <call>)` to the chain the module exports as `exportName`,
 * adding the named import if missing. Idempotent and formatting-safe:
 *
 * - the chain already routes `path` → return `source` **unchanged** (never clobber);
 * - the export is a bare identifier (`export default app`) → follow it to its
 *   declaration and extend that, so `export type AppType = typeof app` keeps working;
 * - the chain has no `.route()` link yet → this becomes the first one;
 * - import already present → not duplicated;
 * - export missing or an unrecognised shape → return `source` unchanged.
 */
export function insertChainedRoute(source: string, patch: ChainedRoute): string {
  const mod = parseModule(source);
  const slot = findChainSlot(mod.$ast as unknown as Program, patch.exportName);
  if (!slot) return source; // not the shape we expected — leave it be

  for (const link of chainLinks(slot.node)) {
    if (isRouteLink(link, patch.path)) return source; // already routed
  }

  // Ensure the named import exists (magicast keys imports by local name).
  if (!(patch.import.name in mod.imports)) {
    mod.imports.$add({
      from: patch.import.from,
      imported: patch.import.name,
      local: patch.import.name,
    });
  }

  slot.replace(buildRouteLink(slot.node, patch.path, patch.call));
  return keepTerminator(source, generateCode(mod).code);
}

/**
 * The inverse: drop the `.route()` link matching `path` from the exported chain, and
 * drop the named import it needed. Matched on `path` alone, since that is the key the
 * forward direction is idempotent on.
 *
 * - link already absent → return `source` **unchanged**, so a hand-reverted file is
 *   never force-edited (the remover warns and skips instead);
 * - the link is the only one → the bare receiver is left behind (`const app = new
 *   Hono();`), which still parses and typechecks;
 * - the import statement holds other specifiers → only this one is removed;
 * - the identifier is still referenced elsewhere in the file → the import stays, so a
 *   hand-written second use (`app.use(waitlist.middleware)`) is not left unbound.
 */
export function removeChainedRoute(source: string, patch: ChainedRoute): string {
  const mod = parseModule(source);
  const slot = findChainSlot(mod.$ast as unknown as Program, patch.exportName);
  if (!slot) return source;

  // Walk outermost-inward, remembering the link that holds the one we're looking for —
  // splicing a link out means re-pointing its holder at the link's own receiver.
  let holder: CallExpression | undefined;
  let found: CallExpression | undefined;
  for (const link of chainLinks(slot.node)) {
    if (isRouteLink(link, patch.path)) {
      found = link;
      break;
    }
    holder = link;
  }
  if (!found) return source; // already gone — never force-edit

  const receiver = (found.callee as MemberExpression).object;
  if (holder) {
    (holder.callee as MemberExpression).object = receiver;
  } else {
    slot.replace(receiver);
  }

  // Guarded twice: magicast's delete trap throws when the local name isn't imported, and
  // a binding the file still references elsewhere must keep its import or the file stops
  // compiling.
  const program = mod.$ast as unknown as Program;
  if (patch.import.name in mod.imports && !isReferenced(program, patch.import.name)) {
    delete mod.imports[patch.import.name];
  }
  return keepTerminator(source, generateCode(mod).code);
}

// recast reprints the whole program, and its printer drops a trailing newline the source
// had. Untouched bytes must stay untouched, so put the terminator back — an add→remove
// round trip is then byte-identical to the file the user started with.
function keepTerminator(source: string, code: string): string {
  if (source.endsWith("\n") && !code.endsWith("\n")) return `${code}\n`;
  if (!source.endsWith("\n") && code.endsWith("\n")) return code.slice(0, -1);
  return code;
}

// Does any non-import part of the program still read `name`? Walks the plain-object AST
// rather than pulling in a visitor, since the only question is whether an `Identifier`
// with this name survives outside the import declarations and outside member/property
// positions (`x.waitlist` is not a use of `waitlist`).
function isReferenced(program: Program, name: string): boolean {
  let found = false;

  function walk(node: unknown, key?: string): void {
    if (found || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const record = node as Record<string, unknown> & { type?: string };
    if (typeof record.type !== "string") return;
    if (record.type === "ImportDeclaration") return; // the import itself is not a use
    if (record.type === "Identifier") {
      // Skip a name in a non-reference slot: `a.name`, `{ name: … }`, `function name()`.
      if (key !== "property" && key !== "key" && record.name === name) found = true;
      return;
    }
    for (const [childKey, value] of Object.entries(record)) {
      // recast hangs its own bookkeeping off these; walking them re-walks the whole file.
      if (childKey === "loc" || childKey === "comments" || childKey === "original") continue;
      walk(value, childKey);
    }
  }

  walk(program.body);
  return found;
}

// --- AST shapes -------------------------------------------------------------------
// magicast types its AST as a broad union; these are the narrow shapes this codemod
// reads, so the casts below stay local and named.

interface AstNode {
  type: string;
}
interface Identifier extends AstNode {
  name: string;
}
interface StringLike extends AstNode {
  value: unknown;
}
interface MemberExpression extends AstNode {
  object: AstNode;
  property: AstNode;
}
interface CallExpression extends AstNode {
  callee: AstNode;
  arguments: AstNode[];
}
interface VariableDeclarator extends AstNode {
  id: AstNode;
  init: AstNode | null;
}
interface VariableDeclaration extends AstNode {
  declarations: VariableDeclarator[];
}
interface ExportDefaultDeclaration extends AstNode {
  declaration: AstNode;
}
interface ExportNamedDeclaration extends AstNode {
  declaration: AstNode | null;
}
interface Program extends AstNode {
  body: AstNode[];
}

/** A writable position in the AST holding the chain expression. */
interface ChainSlot {
  /** The expression currently in the slot. */
  node: AstNode;
  /** Put a different expression in its place. */
  replace(next: AstNode): void;
}

// --- Locating the chain -----------------------------------------------------------

function findChainSlot(program: Program, exportName: string): ChainSlot | undefined {
  const exported = findExportSlot(program, exportName);
  if (!exported) return undefined;
  // `export default app` exports a reference, not the chain. Follow it to the
  // declaration so the edit lands on `const app = …` and the export line is untouched.
  if (exported.node.type === "Identifier") {
    const declared = findDeclaratorSlot(program, (exported.node as Identifier).name);
    if (declared) return declared;
  }
  return exported;
}

function findExportSlot(program: Program, exportName: string): ChainSlot | undefined {
  for (const statement of program.body) {
    if (exportName === "default" && statement.type === "ExportDefaultDeclaration") {
      const node = statement as ExportDefaultDeclaration;
      return {
        node: node.declaration,
        replace: (next) => {
          node.declaration = next;
        },
      };
    }
    if (exportName !== "default" && statement.type === "ExportNamedDeclaration") {
      const declaration = (statement as ExportNamedDeclaration).declaration;
      if (declaration?.type === "VariableDeclaration") {
        const slot = declaratorSlot(declaration as VariableDeclaration, exportName);
        if (slot) return slot;
      }
    }
  }
  return undefined;
}

function findDeclaratorSlot(program: Program, name: string): ChainSlot | undefined {
  for (const statement of program.body) {
    const declaration =
      statement.type === "VariableDeclaration"
        ? statement
        : statement.type === "ExportNamedDeclaration"
          ? (statement as ExportNamedDeclaration).declaration
          : undefined;
    if (declaration?.type !== "VariableDeclaration") continue;
    const slot = declaratorSlot(declaration as VariableDeclaration, name);
    if (slot) return slot;
  }
  return undefined;
}

function declaratorSlot(declaration: VariableDeclaration, name: string): ChainSlot | undefined {
  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier") continue;
    if ((declarator.id as Identifier).name !== name) continue;
    if (!declarator.init) continue;
    return {
      node: declarator.init,
      replace: (next) => {
        declarator.init = next;
      },
    };
  }
  return undefined;
}

// --- Reading and writing the chain ------------------------------------------------

/** Yield each `x.y(…)` link of a call chain, outermost first. */
function* chainLinks(node: AstNode): Generator<CallExpression> {
  let current = node;
  while (current.type === "CallExpression" && (current as CallExpression).callee.type === "MemberExpression") {
    const call = current as CallExpression;
    yield call;
    current = (call.callee as MemberExpression).object;
  }
}

function isRouteLink(link: CallExpression, path: string): boolean {
  const property = (link.callee as MemberExpression).property;
  if (property.type !== "Identifier" || (property as Identifier).name !== "route") return false;
  const first = link.arguments[0];
  return first !== undefined && stringValue(first) === path;
}

// The parser emits `StringLiteral`; magicast's own builders emit ast-types `Literal`.
// A chain can hold both once a previous patch has run, so read either.
function stringValue(node: AstNode): string | undefined {
  if (node.type !== "StringLiteral" && node.type !== "Literal") return undefined;
  const value = (node as StringLike).value;
  return typeof value === "string" ? value : undefined;
}

// magicast has no builder for a chained method call, so parse the link as an
// expression against a placeholder receiver and graft the real chain in as the
// receiver. The grafted node keeps its original source, so recast reprints only the
// appended link.
function buildRouteLink(receiver: AstNode, path: string, call: string): AstNode {
  const parsed = builders.raw(`__chain__.route(${JSON.stringify(path)}, ${call})`) as unknown as {
    $ast: AstNode;
  };
  const link = parsed.$ast as CallExpression;
  (link.callee as MemberExpression).object = receiver;
  return link;
}
