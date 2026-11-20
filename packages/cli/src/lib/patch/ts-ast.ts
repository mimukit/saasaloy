// The bits of AST and import handling the magicast codemods need: "does the local name
// still bind what we imported?" and "did recast eat the file's terminator?".
// drizzle-column.ts asks both.

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
