// The bits of AST and import handling both magicast codemods need. chained-route.ts and
// ts-module.ts ask the same three questions in their inverse direction — "does the local
// name still bind what we imported?", "is the name still used anywhere else?", "did recast
// eat the file's terminator?" — so the answers live here once rather than twice.

/** Structural view of magicast's import proxy: local name → what it binds. */
export type ModuleImports = Record<
  string,
  { imported?: unknown; from?: unknown } | undefined
>;

/** A named import as a descriptor declares it. */
export interface NamedImport {
  name: string;
  from: string;
}

/**
 * The binding currently held by the patch's local name, when it is not the recorded one.
 *
 * magicast keys imports by *local* name, so `want.name in mod.imports` proves only that
 * something holds the name — not that it is the binding this patch needs. Both directions
 * care: an insert would wire the wrong value, and a remove would delete an import line the
 * user rewrote. Compare the local name, the imported name, and the source. An unbound name
 * is not a conflict; it is the ordinary case.
 */
export function foreignBinding(
  imports: ModuleImports,
  want: NamedImport
): { imported: string; from: string } | undefined {
  const held = imports[want.name];
  if (!held) {
    return undefined;
  }

  const imported = typeof held.imported === "string" ? held.imported : "";
  const from = typeof held.from === "string" ? held.from : "";
  if (imported === want.name && from === want.from) {
    return undefined;
  }
  return { imported, from };
}

/** "…is imported as a default import from "./legacy.js"" — the shared half of both reasons. */
export function describeBinding(
  name: string,
  held: { imported: string; from: string }
): string {
  const bound =
    held.imported === "*"
      ? "as a namespace import"
      : held.imported === "default"
        ? "as a default import"
        : `as ${JSON.stringify(held.imported)}`;
  return `${JSON.stringify(name)} is imported ${bound} from ${JSON.stringify(held.from)}`;
}

// recast reprints the whole program, and its printer drops a trailing newline the source
// had. Untouched bytes must stay untouched, so put the terminator back — an add→remove
// round trip is then byte-identical to the file the user started with.
export function keepTerminator(source: string, code: string): string {
  if (source.endsWith("\n") && !code.endsWith("\n")) {
    return `${code}\n`;
  }
  if (!source.endsWith("\n") && code.endsWith("\n")) {
    return code.slice(0, -1);
  }
  return code;
}

/** The one thing `isReferenced` needs of a program: its top-level statements. */
export interface ProgramLike {
  body: unknown[];
}

// Does any non-import part of the program still read `name`? Walks the plain-object AST
// rather than pulling in a visitor, since the only question is whether an `Identifier`
// with this name survives outside the import declarations and outside member/property
// positions (`x.waitlist` is not a use of `waitlist`).
export function isReferenced(program: ProgramLike, name: string): boolean {
  let found = false;

  function walk(node: unknown, key?: string): void {
    if (found || node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
      }
      return;
    }
    const record = node as Record<string, unknown> & { type?: string };
    if (typeof record.type !== "string") {
      return;
    }
    if (record.type === "ImportDeclaration") {
      return;
    } // the import itself is not a use
    if (record.type === "Identifier") {
      // Skip a name in a non-reference slot: `a.name`, `{ name: … }`, `function name()`.
      if (key !== "property" && key !== "key" && record.name === name) {
        found = true;
      }
      return;
    }
    for (const [childKey, value] of Object.entries(record)) {
      // recast hangs its own bookkeeping off these; walking them re-walks the whole file.
      if (
        childKey === "loc" ||
        childKey === "comments" ||
        childKey === "original"
      ) {
        continue;
      }
      walk(value, childKey);
    }
  }

  walk(program.body);
  return found;
}
