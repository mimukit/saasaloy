// The Saasaloy UI registry build (plan 0121, Phase 2): `pnpm --filter @saasaloy/web
// registry:build`, and the first step of the site's `build`.
//
// 1. `shadcn build` reads apps/web/registry.json. Its items name the template's own files,
//    so no block has a second copy: base blocks in
//    packages/cli/templates/base/packages/ui/src/blocks/, helpers in .../src/lib/.
// 2. Each file's source goes through `inlineSource` (src/lib/registry-inline.ts): the
//    `landing` copy, the `siteName` sample and the `@repo/*` imports become what a plain
//    shadcn project can compile.
// 3. `saasaloy-foundation` takes the landing vocabulary from the template's web.css: the
//    `@theme` values as `cssVars.theme`, the keyframes, `@property` and `@utility` rules as
//    `css`. web.css stays the one copy.
// 4. Each theme in packages/cli/templates/themes/ becomes a `registry:theme` item,
//    `theme-<name>` (src/lib/ui-themes.ts). The theme files are the one source, so
//    registry.json names no theme.
// 5. Every item is checked against shadcn's own schema and written to public/r/<name>.json,
//    with the registry index at public/r/registry.json.
//
// public/r/ is gitignored: the site build writes it fresh, and scripts/registry.test.ts
// builds into a temporary folder.
//
// Run it with the repo's resolve hook (`--import ../../scripts/ts-resolve-hook.ts`), which
// answers `@repo/config` and the template's extensionless imports.

import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registryItemSchema, registrySchema } from "shadcn/schema";

import { inlineSource, withProvenance } from "../src/lib/registry-inline.ts";
import type { InlineSources } from "../src/lib/registry-inline.ts";
import { themeItem, UI_THEMES } from "../src/lib/ui-themes.ts";

// Re-exported for scripts/registry.test.ts: the repo root has no `shadcn` of its own.
export { registryItemSchema, registrySchema } from "shadcn/schema";

export const WEB_ROOT = resolve(import.meta.dirname, "..");
export const REPO_ROOT = resolve(WEB_ROOT, "../..");
export const TEMPLATE_UI = join(
  REPO_ROOT,
  "packages/cli/templates/base/packages/ui"
);
export const REGISTRY_FILE = join(WEB_ROOT, "registry.json");
export const PUBLIC_OUT = join(WEB_ROOT, "public/r");
export const FOUNDATION = "saasaloy-foundation";

/** A CSS rule body: declarations as strings, nested rules as records. */
export interface CssRecord {
  [key: string]: string | CssRecord;
}

/**
 * Parse a stylesheet into nested records, the shape shadcn's `css` field takes. A
 * statement at-rule (`@import`) is dropped. Comments go first, and a multi-line value
 * collapses onto one line.
 */
export function parseCss(text: string): CssRecord {
  const source = text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const root: CssRecord = {};
  const stack: CssRecord[] = [root];
  let buffer = "";
  let parens = 0;
  let quote = "";
  for (const char of source) {
    if (quote !== "") {
      buffer += char;
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === "(") {
      parens++;
    } else if (char === ")") {
      parens--;
    }
    const current = stack.at(-1) ?? root;
    if (parens === 0 && char === "{") {
      const child: CssRecord = {};
      current[buffer.trim().replaceAll(/\s+/g, " ")] = child;
      stack.push(child);
      buffer = "";
    } else if (parens === 0 && (char === ";" || char === "}")) {
      const statement = buffer.trim().replaceAll(/\s+/g, " ");
      const colon = statement.indexOf(":");
      if (statement !== "" && !statement.startsWith("@") && colon > 0) {
        current[statement.slice(0, colon).trim()] = statement
          .slice(colon + 1)
          .trim()
          .replaceAll("( ", "(")
          .replaceAll(" )", ")");
      }
      buffer = "";
      if (char === "}") {
        stack.pop();
      }
    } else {
      buffer += char;
    }
  }
  return root;
}

/** The foundation's `css` and `cssVars` from the template's web.css. */
export function foundationStyles(webCss: string): {
  css: CssRecord;
  cssVars: { theme: Record<string, string> };
} {
  const parsed = parseCss(webCss);
  const css: CssRecord = {};
  const theme: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      continue;
    }
    if (key === "@theme") {
      for (const [name, inner] of Object.entries(value)) {
        if (typeof inner === "string") {
          theme[name.replace(/^--/, "")] = inner;
        } else {
          css[name] = inner;
        }
      }
    } else {
      css[key] = value;
    }
  }
  return { css, cssVars: { theme } };
}

/** The content, config and sample values the copy inlining reads. */
export async function loadInlineSources(): Promise<InlineSources> {
  const content: InlineSources["content"] = {};
  for (const name of ["landing", "errors"]) {
    content[name] = (await import(
      pathToFileURL(join(TEMPLATE_UI, `src/content/${name}.ts`)).href
    )) as Record<string, unknown>;
  }
  // A variable specifier, so the type checker leaves the hook-resolved module alone.
  const configSpecifier = "@repo/config";
  const config = (await import(configSpecifier)) as Record<string, unknown>;
  return { content, config };
}

interface BuiltFile {
  path: string;
  type: string;
  target?: string;
  content?: string;
}

/** The public path of a file: `registry/<kit or saasaloy>/<folder>/<name>`. */
function publicPath(itemName: string, file: BuiltFile): string {
  const kit = itemName === FOUNDATION ? "saasaloy" : itemName.split("-")[0];
  const folder = file.type === "registry:lib" ? "lib" : "blocks";
  return `registry/${kit}/${folder}/${basename(file.path)}`;
}

function shadcnBin(): string {
  const require = createRequire(join(WEB_ROOT, "package.json"));
  // `shadcn/package.json` is not an export, so walk up from the main entry (dist/index.js).
  const manifestPath = join(
    dirname(require.resolve("shadcn")),
    "../package.json"
  );
  const manifest = require(manifestPath) as {
    bin: string | Record<string, string>;
  };
  const bin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin.shadcn;
  if (bin === undefined) {
    throw new Error("shadcn has no `shadcn` bin.");
  }
  return join(manifestPath, "..", bin);
}

/** Build the registry into `outDir`. Returns the names of the items it wrote. */
export async function buildRegistry(outDir: string): Promise<string[]> {
  const staging = await mkdtemp(join(tmpdir(), "saasaloy-registry-"));
  try {
    const run = spawnSync(
      process.execPath,
      [shadcnBin(), "build", REGISTRY_FILE, "--output", staging],
      { cwd: WEB_ROOT, encoding: "utf-8" }
    );
    if (run.status !== 0) {
      throw new Error(
        `shadcn build failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`
      );
    }
    const sources = await loadInlineSources();
    const webCss = await readFile(
      join(TEMPLATE_UI, "src/styles/web.css"),
      "utf-8"
    );
    await mkdir(outDir, { recursive: true });
    const names: string[] = [];
    const listing = await readdir(staging);
    const entries = listing.filter(
      (name) => name.endsWith(".json") && name !== "registry.json"
    );
    for (const entry of entries.toSorted()) {
      const item = JSON.parse(
        await readFile(join(staging, entry), "utf-8")
      ) as { name: string; files?: BuiltFile[] } & Record<string, unknown>;
      item.files = (item.files ?? []).map((file) => {
        const content = inlineSource(file.content ?? "", sources, file.path);
        return {
          ...file,
          path: publicPath(item.name, file),
          content:
            file.type === "registry:component"
              ? withProvenance(item.name, content)
              : content,
        };
      });
      if (item.name === FOUNDATION) {
        Object.assign(item, foundationStyles(webCss));
      }
      const parsed = registryItemSchema.parse(item);
      await writeFile(
        join(outDir, `${parsed.name}.json`),
        `${JSON.stringify(item, null, 2)}\n`
      );
      names.push(parsed.name);
    }
    const themes = UI_THEMES.map((theme) => themeItem(theme));
    for (const theme of themes) {
      const parsed = registryItemSchema.parse(theme);
      await writeFile(
        join(outDir, `${parsed.name}.json`),
        `${JSON.stringify(theme, null, 2)}\n`
      );
      names.push(parsed.name);
    }
    const index = JSON.parse(
      await readFile(join(staging, "registry.json"), "utf-8")
    ) as {
      items: ({ name: string; files?: BuiltFile[] } & Record<
        string,
        unknown
      >)[];
    };
    for (const item of index.items) {
      item.files = (item.files ?? []).map((file) => ({
        ...file,
        path: publicPath(item.name, file),
      }));
    }
    for (const theme of themes) {
      const { $schema: _schema, ...entry } = theme;
      index.items.push(entry as { name: string } & Record<string, unknown>);
    }
    registrySchema.parse(index);
    await writeFile(
      join(outDir, "registry.json"),
      `${JSON.stringify(index, null, 2)}\n`
    );
    return names;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await rm(PUBLIC_OUT, { recursive: true, force: true });
  const names = await buildRegistry(PUBLIC_OUT);
  console.log(`registry: wrote ${names.length} items to public/r/`);
}
