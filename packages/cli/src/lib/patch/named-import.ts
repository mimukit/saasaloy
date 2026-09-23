import { parseModule } from "magicast";
import { isReferenced } from "./ts-ast.js";
import type { NamedImport } from "./ts-ast.js";
import type { AstNode, Identifier, Program } from "./ts-array.js";

// Adding and removing one named import specifier, without reprinting the program.
//
// `ts-module.ts` and `chained-route.ts` get their imports from magicast, which is fine
// there because both already reprint the whole file. A codemod that splices bytes —
// `nav-entry`, and anything that follows it — cannot mix the two: recast would reformat
// every line the patch never touched, and the user would see that diff on the next
// `saasaloy add`. So only the one import declaration is rewritten, and every other byte
// in the file is left exactly as it was.

// Prettier's default `printWidth`, which the generated project keeps. An import that fits
// is printed on one line and one that does not gets a line per specifier, so a codemod
// that adds a specifier has to be able to cross that threshold in both directions — the
// project runs `prettier --check` in its own `pnpm lint`, and the user should never be the
// one to re-wrap a line `saasaloy add` wrote.
const PRINT_WIDTH = 80;

/**
 * Ensure `import { <name> } from "<from>"` is present, and answer the new source.
 *
 * Idempotent. A new specifier lands in alphabetical position among the named ones, which
 * is where the project's import order expects it.
 */
export function ensureNamedImport(source: string, want: NamedImport): string {
  const program = parseModule(source).$ast as unknown as Program;
  const declaration = findImport(program, want.from);
  if (!declaration) {
    return insertDeclaration(source, program, want);
  }

  const named = namedSpecifiers(declaration).map((specifier) =>
    source.slice(specifier.start, specifier.end)
  );
  if (named.includes(want.name)) {
    return source;
  }

  const at = named.findIndex((text) => localOf(text) > want.name);
  const next =
    at === -1 ? [...named, want.name] : named.toSpliced(at, 0, want.name);
  return replaceDeclaration(source, declaration, next, want.from);
}

/**
 * Take `<name>` back out of its named import, and answer the new source.
 *
 * Declines — returning `source` unchanged — in the cases where the import is no longer the
 * one that was added: the file still references the name somewhere else, the local name is
 * an alias, or nothing of that shape is there any more. The caller reports the skip; this
 * never force-edits.
 */
export function removeNamedImport(source: string, want: NamedImport): string {
  const program = parseModule(source).$ast as unknown as Program;
  const declaration = findImport(program, want.from);
  if (!declaration || isReferenced(program, want.name)) {
    return source;
  }

  const specifiers = namedSpecifiers(declaration);
  const texts = specifiers.map((specifier) =>
    source.slice(specifier.start, specifier.end)
  );
  const at = texts.indexOf(want.name);
  if (at === -1) {
    return source;
  }

  // The last thing the declaration binds: the statement goes, and its line with it, or
  // the file keeps a blank line nobody wrote.
  if (declaration.specifiers.length === 1) {
    const lineEnd = source.indexOf("\n", declaration.end);
    return lineEnd === -1
      ? source.slice(0, declaration.start)
      : `${source.slice(0, declaration.start)}${source.slice(lineEnd + 1)}`;
  }
  return replaceDeclaration(
    source,
    declaration,
    texts.toSpliced(at, 1),
    want.from
  );
}

/** Whether the file already binds `name` to something other than this named import. */
export function importedElsewhere(source: string, want: NamedImport): boolean {
  const program = parseModule(source).$ast as unknown as Program;
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }
    const declaration = statement as ImportDeclaration;
    for (const specifier of declaration.specifiers) {
      if (localName(specifier) !== want.name) {
        continue;
      }
      const ours =
        specifier.type === "ImportSpecifier" &&
        importedName(specifier) === want.name &&
        sourceValue(declaration) === want.from;
      if (!ours) {
        return true;
      }
    }
  }
  return false;
}

// Rewrite one import declaration with a new list of named specifiers, printed the way
// Prettier prints it: one line while it fits inside `PRINT_WIDTH`, one specifier per line
// once it does not. Anything the declaration binds besides a named specifier (a default
// or a namespace) keeps its text and its place ahead of the braces.
function replaceDeclaration(
  source: string,
  declaration: ImportDeclaration,
  named: string[],
  from: string
): string {
  const leading = declaration.specifiers
    .filter((specifier) => specifier.type !== "ImportSpecifier")
    .map((specifier) => source.slice(specifier.start, specifier.end));
  const text = source.slice(declaration.start, declaration.end);
  const tail = `from ${JSON.stringify(from)}${text.trimEnd().endsWith(";") ? ";" : ""}`;
  const keyword = declaration.importKind === "type" ? "import type" : "import";

  const inline = [...leading, `{ ${named.join(", ")} }`].join(", ");
  const oneLine = `${keyword} ${inline} ${tail}`;
  const printed =
    oneLine.length <= PRINT_WIDTH
      ? oneLine
      : `${[keyword, ...leading.map((part) => `${part},`)].join(" ")} {\n${named
          .map((specifier) => `  ${specifier},\n`)
          .join("")}} ${tail}`;

  return `${source.slice(0, declaration.start)}${printed}${source.slice(declaration.end)}`;
}

function insertDeclaration(
  source: string,
  program: Program,
  want: NamedImport
): string {
  const statement = `import { ${want.name} } from ${JSON.stringify(want.from)};`;
  const last = program.body.findLast(
    (node) => node.type === "ImportDeclaration"
  );
  if (!last) {
    return `${statement}\n\n${source}`;
  }
  return `${source.slice(0, last.end)}\n${statement}${source.slice(last.end)}`;
}

function findImport(
  program: Program,
  from: string
): ImportDeclaration | undefined {
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }
    const declaration = statement as ImportDeclaration;
    // A `import type { … }` declaration binds types only — never the value a nav entry
    // needs — so it is not a target this can add to.
    if (declaration.importKind === "type") {
      continue;
    }
    if (sourceValue(declaration) === from) {
      return declaration;
    }
  }
  return undefined;
}

function namedSpecifiers(declaration: ImportDeclaration): ImportSpecifier[] {
  return declaration.specifiers.filter(
    (specifier) =>
      specifier.type === "ImportSpecifier" && specifier.importKind !== "type"
  );
}

// The local name a specifier's source text binds — `Foo` or `Foo as Bar` — which is what
// the alphabetical insert compares against.
function localOf(text: string): string {
  const [, local] = text.split(/\s+as\s+/);
  return (local ?? text).trim();
}

function sourceValue(declaration: ImportDeclaration): string | undefined {
  const value: unknown = declaration.source.value;
  return typeof value === "string" ? value : undefined;
}

function importedName(specifier: ImportSpecifier): string | undefined {
  return identifierName(specifier.imported);
}

function localName(specifier: ImportSpecifier): string | undefined {
  return identifierName(specifier.local);
}

function identifierName(node: AstNode | undefined): string | undefined {
  if (node?.type === "Identifier") {
    return (node as Identifier).name;
  }
  if (node?.type === "StringLiteral" || node?.type === "Literal") {
    const value: unknown = (node as { value?: unknown }).value;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

interface ImportSpecifier extends AstNode {
  imported?: AstNode;
  local?: AstNode;
  importKind?: string;
}

interface ImportDeclaration extends AstNode {
  specifiers: ImportSpecifier[];
  source: { value?: unknown };
  importKind?: string;
}
