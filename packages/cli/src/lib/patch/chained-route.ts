import { builders, generateCode, parseModule } from "magicast";
import { describeBinding, foreignBinding, keepTerminator } from "./ts-ast.js";
import type { ModuleImports } from "./ts-ast.js";

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
 * - the local name is already bound to a *different* import → return `source`
 *   unchanged, because wiring the route would bind the wrong handler
 *   (`chainedRouteInsertRefusal` reports why);
 * - export missing or an unrecognised shape → return `source` unchanged.
 */
export function insertChainedRoute(
  source: string,
  patch: ChainedRoute
): string {
  const mod = parseModule(source);
  const slot = findChainSlot(mod.$ast as unknown as Program, patch.exportName);
  if (!slot) {
    return source;
  } // not the shape we expected — leave it be

  for (const link of chainLinks(slot.node)) {
    if (isRouteLink(link, patch.path)) {
      return source;
    } // already routed
  }

  const imports = mod.imports;
  if (insertBindingConflict(imports, patch)) {
    return source;
  } // wrong binding — never wire it

  // Ensure the named import exists (magicast keys imports by local name).
  if (!(patch.import.name in mod.imports)) {
    mod.imports.$prepend({
      from: patch.import.from,
      imported: patch.import.name,
      local: patch.import.name,
    });
  }

  slot.replace(buildRouteLink(slot.node, patch.path, patch.call));
  return keepTerminator(source, generateCode(mod).code);
}

/**
 * Why `insertChainedRoute` declined to change `source`, or `undefined` when it had no
 * objection (it applied the link, or the link was already there).
 *
 * The codemods are pure `string → string`, so a refusal is indistinguishable from an
 * idempotent no-op at the call site. `applyPatch` asks this only when nothing changed,
 * which is what lets `add` warn by name instead of silently skipping a route.
 */
export function chainedRouteInsertRefusal(
  source: string,
  patch: ChainedRoute
): string | undefined {
  const mod = parseModule(source);
  const slot = findChainSlot(mod.$ast as unknown as Program, patch.exportName);
  if (!slot) {
    return undefined;
  } // unrecognised shape, reported by the caller as "missing"
  for (const link of chainLinks(slot.node)) {
    if (isRouteLink(link, patch.path)) {
      return undefined;
    } // already routed, not a refusal
  }
  return insertBindingConflict(mod.imports, patch);
}

// --- Ownership -------------------------------------------------------------------
// Both directions key on the route path, and a path is not proof of ownership. These two
// answer "is this link, or this binding, still the one the manifest recorded?" — the check
// that keeps a patch from clobbering a hand edit that happens to sit at the same path.
// `foreignBinding` and `describeBinding` are in ts-ast.ts: ts-module.ts's inverse asks the
// same question of the same import proxy, so only the message text differs.

function insertBindingConflict(
  imports: ModuleImports,
  patch: ChainedRoute
): string | undefined {
  const held = foreignBinding(imports, patch.import);
  if (!held) {
    return undefined;
  }
  return `${describeBinding(patch.import.name, held)}, so routing ${JSON.stringify(patch.path)} would bind the wrong handler`;
}

/** `waitlist` → "waitlist", `api.waitlist` → "api.waitlist", anything else → undefined. */
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

function findChainSlot(
  program: Program,
  exportName: string
): ChainSlot | undefined {
  const exported = findExportSlot(program, exportName);
  if (!exported) {
    return undefined;
  }
  // `export default app` exports a reference, not the chain. Follow it to the
  // declaration so the edit lands on `const app = …` and the export line is untouched.
  if (exported.node.type === "Identifier") {
    const declared = findDeclaratorSlot(
      program,
      (exported.node as Identifier).name
    );
    if (declared) {
      return declared;
    }
  }
  return exported;
}

function findExportSlot(
  program: Program,
  exportName: string
): ChainSlot | undefined {
  for (const statement of program.body) {
    if (
      exportName === "default" &&
      statement.type === "ExportDefaultDeclaration"
    ) {
      const node = statement as ExportDefaultDeclaration;
      return {
        node: node.declaration,
        replace: (next) => {
          node.declaration = next;
        },
      };
    }
    if (
      exportName !== "default" &&
      statement.type === "ExportNamedDeclaration"
    ) {
      const declaration = (statement as ExportNamedDeclaration).declaration;
      if (declaration?.type === "VariableDeclaration") {
        const slot = declaratorSlot(
          declaration as VariableDeclaration,
          exportName
        );
        if (slot) {
          return slot;
        }
      }
    }
  }
  return undefined;
}

function findDeclaratorSlot(
  program: Program,
  name: string
): ChainSlot | undefined {
  for (const statement of program.body) {
    const declaration =
      statement.type === "VariableDeclaration"
        ? statement
        : statement.type === "ExportNamedDeclaration"
          ? (statement as ExportNamedDeclaration).declaration
          : undefined;
    if (declaration?.type !== "VariableDeclaration") {
      continue;
    }
    const slot = declaratorSlot(declaration as VariableDeclaration, name);
    if (slot) {
      return slot;
    }
  }
  return undefined;
}

function declaratorSlot(
  declaration: VariableDeclaration,
  name: string
): ChainSlot | undefined {
  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier") {
      continue;
    }
    if ((declarator.id as Identifier).name !== name) {
      continue;
    }
    if (!declarator.init) {
      continue;
    }
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

/**
 * Yield each `x.y(…)` link of a call chain, outermost first.
 *
 * @yields {CallExpression} the next link, walking inward from the outermost call.
 */
function* chainLinks(node: AstNode): Generator<CallExpression> {
  let current = node;
  while (
    current.type === "CallExpression" &&
    (current as CallExpression).callee.type === "MemberExpression"
  ) {
    const call = current as CallExpression;
    yield call;
    current = (call.callee as MemberExpression).object;
  }
}

function isRouteLink(link: CallExpression, path: string): boolean {
  const property = (link.callee as MemberExpression).property;
  if (
    property.type !== "Identifier" ||
    (property as Identifier).name !== "route"
  ) {
    return false;
  }
  const first = link.arguments[0];
  return first !== undefined && stringValue(first) === path;
}

// The parser emits `StringLiteral`; magicast's own builders emit ast-types `Literal`.
// A chain can hold both once a previous patch has run, so read either.
function stringValue(node: AstNode): string | undefined {
  if (node.type !== "StringLiteral" && node.type !== "Literal") {
    return undefined;
  }
  const value = (node as StringLike).value;
  return typeof value === "string" ? value : undefined;
}

// magicast has no builder for a chained method call, so parse the link as an
// expression against a placeholder receiver and graft the real chain in as the
// receiver. The grafted node keeps its original source, so recast reprints only the
// appended link.
function buildRouteLink(
  receiver: AstNode,
  path: string,
  call: string
): AstNode {
  const parsed = builders.raw(
    `__chain__.route(${JSON.stringify(path)}, ${call})`
  ) as unknown as {
    $ast: AstNode;
  };
  const link = parsed.$ast as CallExpression;
  (link.callee as MemberExpression).object = receiver;
  return link;
}
