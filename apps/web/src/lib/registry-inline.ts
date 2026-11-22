// The copy inlining of the Saasaloy UI registry (plan 0121, assumption 17). A base block in
// packages/cli/templates/base/packages/ui/src/blocks/ imports its words from
// `@repo/ui/content/landing`, the product name from `@repo/ui` and the legal paths from
// `@repo/config`. None of those exists in a plain shadcn project, so the public copy of a
// block carries them as literals instead:
//
//   - a content import becomes a `const landing = {…}` literal that holds only the paths
//     the file reads (`landing.hero.title` keeps `hero.title`, and nothing else);
//   - `siteName` becomes the sample name "Acme";
//   - `@repo/ui/components/*` becomes `@/components/ui/*`, `@repo/ui/lib/utils` becomes
//     `@/lib/utils`, other `@repo/ui/lib/*` becomes `@/lib/*`, and `@repo/ui/blocks/*`
//     becomes `@/components/blocks/*`. shadcn rewrites each `@/` prefix to the alias the
//     user's components.json names.
//
// The module is pure: no file system and no imports, so the registry build in
// apps/web/scripts/registry-build.ts and the block pages under src/pages/ui/ share it. The
// caller passes the content objects in.

/** The sample product name a public block shows in place of `siteName`. */
export const SAMPLE_SITE_NAME = "Acme";

/** The objects a block may import, keyed by the module that exports them. */
export interface InlineSources {
  /** `@repo/ui/content/<file>` exports, keyed by file name (`landing`, `errors`). */
  content: Record<string, Record<string, unknown>>;
  /** `@repo/config` exports (`config`). */
  config: Record<string, unknown>;
}

// A generated table file that a block imports. The CLI writes the rows into a project, so a
// public block takes the table with no rows.
const GENERATED: Record<string, Record<string, string>> = {
  "./navbar.generated": { uiPageLinks: "NavbarLink[]" },
};

const IMPORT = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";\n/gm;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The public import path for a `@repo/ui` subpath, or `undefined` when it has none. */
export function publicImportPath(specifier: string): string | undefined {
  if (specifier === "@repo/ui/lib/utils") {
    return "@/lib/utils";
  }
  const match = /^@repo\/ui\/(components|lib|blocks)\/(.+)$/.exec(specifier);
  if (!match) {
    return undefined;
  }
  const [, folder, rest] = match;
  if (folder === "components") {
    return `@/components/ui/${rest}`;
  }
  if (folder === "blocks") {
    return `@/components/blocks/${rest}`;
  }
  return `@/lib/${rest}`;
}

interface Binding {
  imported: string;
  local: string;
}

function bindingsOf(list: string): Binding[] {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [imported = "", local = imported] = part
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/);
      return { imported: imported.trim(), local: local.trim() };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The part of `value` that `source` reads through the name `local`. Each `local.a.b.c`
 * path keeps the deepest key that exists, so `landing.footer.links.map` keeps
 * `footer.links`. A bare use of the name keeps the whole object.
 */
export function pruneTo(
  value: Record<string, unknown>,
  local: string,
  source: string
): Record<string, unknown> {
  const escaped = local.replaceAll("$", String.raw`\$`);
  const bare = new RegExp(String.raw`\b${escaped}\b(?![\w$]*\??\.)`);
  if (bare.test(source)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  const paths = new RegExp(
    String.raw`\b${escaped}((?:\??\.[A-Za-z_$][\w$]*)+)`,
    "g"
  );
  for (const match of source.matchAll(paths)) {
    const keys = (match[1] ?? "").split(".").filter((key) => key !== "");
    let from: unknown = value;
    let into = result;
    for (const [index, raw] of keys.entries()) {
      const key = raw.replace(/\?$/, "");
      if (!isRecord(from) || !Object.hasOwn(from, key)) {
        break;
      }
      const next = from[key];
      const last = index === keys.length - 1;
      const nextKey = keys[index + 1]?.replace(/\?$/, "");
      const descends =
        !last &&
        isRecord(next) &&
        nextKey !== undefined &&
        Object.hasOwn(next, nextKey);
      if (!descends) {
        into[key] = next;
        break;
      }
      const existing = into[key];
      if (isRecord(existing) && existing !== next) {
        into = existing;
      } else if (existing === undefined) {
        const child: Record<string, unknown> = {};
        into[key] = child;
        into = child;
      } else {
        break;
      }
      from = next;
    }
  }
  return result;
}

/** A value as TypeScript source: identifier keys unquoted, two-space indents. */
export function toLiteral(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return `[\n${value.map((item) => `${inner}${toLiteral(item, inner)},`).join("\n")}\n${indent}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "{}";
    }
    const lines = entries.map(([key, item]) => {
      const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
      return `${inner}${name}: ${toLiteral(item, inner)},`;
    });
    return `{\n${lines.join("\n")}\n${indent}}`;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

/**
 * The public source of a block or a helper: its content imports replaced by literals and
 * its `@repo/ui` imports moved onto the `@/` aliases. Throws on an import it cannot map,
 * so a new `@repo/*` dependency fails the registry build instead of shipping broken.
 */
export function inlineSource(
  source: string,
  sources: InlineSources,
  file = "block"
): string {
  const declarations: string[] = [];
  let lastImportEnd = 0;
  // What the code reads, for pruning: the source with its imports and comments removed,
  // so `import { landing }` and a comment naming `landing` never count as a bare use.
  const body = source
    .replaceAll(IMPORT, "")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1");
  const rewritten = source.replaceAll(
    IMPORT,
    (
      statement,
      typeOnly: string | undefined,
      list: string,
      specifier: string
    ) => {
      const keep = (path: string) =>
        statement.replace(`"${specifier}"`, `"${path}"`);
      const publicPath = publicImportPath(specifier);
      if (publicPath !== undefined) {
        return keep(publicPath);
      }
      if (!specifier.startsWith("@repo/") && !(specifier in GENERATED)) {
        return statement;
      }
      if (typeOnly) {
        throw new Error(
          `${file}: cannot inline the type import from "${specifier}".`
        );
      }
      for (const { imported, local } of bindingsOf(list)) {
        declarations.push(
          declarationFor(specifier, imported, local, body, sources, file)
        );
      }
      return "";
    }
  );
  for (const match of rewritten.matchAll(IMPORT)) {
    lastImportEnd = match.index + match[0].length;
  }
  if (declarations.length === 0) {
    return rewritten;
  }
  const block = `\n${declarations.join("\n\n")}\n`;
  if (lastImportEnd === 0) {
    const directive = /^(["'])use client\1;\n/.exec(rewritten);
    const at = directive ? directive[0].length : 0;
    return `${rewritten.slice(0, at)}${block}${rewritten.slice(at)}`;
  }
  return `${rewritten.slice(0, lastImportEnd)}${block}${rewritten.slice(lastImportEnd)}`;
}

function declarationFor(
  specifier: string,
  imported: string,
  local: string,
  source: string,
  sources: InlineSources,
  file: string
): string {
  const generated = GENERATED[specifier];
  if (generated) {
    const type = generated[imported];
    if (type === undefined) {
      throw new Error(`${file}: unknown generated table "${imported}".`);
    }
    return `const ${local}: ${type} = [];`;
  }
  if (specifier === "@repo/ui" && imported === "siteName") {
    return `const ${local} = ${JSON.stringify(SAMPLE_SITE_NAME)};`;
  }
  let exported: unknown;
  if (specifier === "@repo/config") {
    exported = sources.config[imported];
  } else {
    const content = /^@repo\/ui\/content\/(.+)$/.exec(specifier);
    exported = content
      ? sources.content[content[1] ?? ""]?.[imported]
      : undefined;
  }
  if (!isRecord(exported)) {
    throw new Error(
      `${file}: cannot inline "${imported}" from "${specifier}".`
    );
  }
  return `const ${local} = ${toLiteral(pruneTo(exported, local, source))};`;
}

/** A block's public source opens with where it came from, after any directive. */
export function withProvenance(name: string, content: string): string {
  const header = `// ${name} from Saasaloy UI (https://saasaloy.com/ui/blocks/${name}), MIT licensed.\n// The sample copy sits in the literals below the imports. Edit it in place.\n\n`;
  const directive = /^(["'])use client\1;\n\n?/.exec(content);
  const at = directive ? directive[0].length : 0;
  return `${content.slice(0, at)}${header}${content.slice(at)}`;
}
