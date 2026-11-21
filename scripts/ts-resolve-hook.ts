// A module resolve hook for `pnpm test:modules`, registered by importing this file:
// `node --import ./scripts/ts-resolve-hook.ts --test "modules/*/files/**/*.test.ts"`.
//
// Shipped payload code under `modules/*/files/` imports without a file extension
// (`import { defineQueue } from "./define"`), because the scaffolded project compiles it
// with `moduleResolution: "Bundler"` and does not set `allowImportingTsExtensions`.
// Node's ESM resolver is stricter: it wants the real filename, so a payload test that
// pulls in a module which imports a sibling fails with ERR_MODULE_NOT_FOUND before a
// single assertion runs. A test file can carry the `.ts` itself; it cannot fix the
// imports inside the payload, and adding them there would put a non-portable extension
// into every generated project.
//
// The hook closes that gap and nothing else: an extensionless *relative* specifier gets
// `.ts` appended, then `/index.ts`, and anything that still does not resolve falls
// through to Node's own answer, so a bare package name or an explicit extension behaves
// exactly as before.

// It also resolves the one workspace package a payload file may import that is not payload
// itself: `@repo/config` ships in the base template, so a tested module file reading
// `config.auth.adminRole` would otherwise fail on a bare specifier no node_modules holds.
// `./config-shim.ts` composes that object the way an installed project does; the `/define`
// subpath goes straight to the template source, since a section file only needs the helper.
// `@repo/kv` maps onto `modules/kv/files/src/index.ts`, because `payment-bkash`'s provider
// file imports the kv core for the store its token lives in (ADR 0057).
// The map is deliberately closed — three entries — rather than a general workspace resolver,
// because every other `@repo/*` package is scaffolded by a module and is not on disk in this
// repo at all.

// It also answers a generated table file (plan 0116, Phase 7). A module file that holds a
// table imports `./<name>.generated`, which the CLI writes into a project and no module
// ships, so a test of that file would stop at the import. The hook answers a missing
// `*.generated` specifier with a `data:` module: each name the importer takes from it is
// the table's render with no rows, `[]`, or for a route table a function that returns the
// app it is given. The names and shapes come from the descriptors' `tables`, so a new
// table needs no edit here.

// It also answers `lucide-react` with stub icons (#264). A payload file such as an app's
// `components/nav.ts` imports its icons at runtime, and this repo installs no icon set, so
// a test that walks the real NAV_AREAS would stop at the import. The hook reads the
// importing file, finds the names it takes from `lucide-react`, and answers with a `data:`
// module that exports each one as a component rendering nothing. A test never renders an
// icon; it only needs the import to bind. Reading the names from the importer, not from a
// fixed list, means a module that adds a nav row with a new icon needs no edit here.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

const here = import.meta.dirname;
const WORKSPACES = new Map([
  [
    "@repo/kv",
    pathToFileURL(join(here, "../modules/kv/files/src/index.ts")).href,
  ],
  ["@repo/config", pathToFileURL(join(here, "config-shim.ts")).href],
  [
    "@repo/config/define",
    pathToFileURL(
      join(here, "../packages/cli/templates/base/packages/config/src/define.ts")
    ).href,
  ],
]);

const ICON_PACKAGE = "lucide-react";
const ICON_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g;

/**
 * The value names a file imports from `lucide-react`. `import type { … }` does not match
 * the pattern, and an inline `type X` is dropped: type stripping erases both.
 */
function iconNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(ICON_IMPORT)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name =
        part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim() ?? "";
      if (name !== "" && !name.startsWith("type ")) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/** A `data:` module exporting a stub component for every icon the importer names. */
function iconStub(parentURL: string | undefined): string {
  const source =
    parentURL?.startsWith("file:") === true
      ? readFileSync(fileURLToPath(parentURL), "utf-8")
      : "";
  const body = iconNames(source)
    .map((name) => `export const ${name} = () => null;`)
    .join("\n");
  return `data:text/javascript,${encodeURIComponent(body)}`;
}

const GENERATED_SUFFIX = ".generated";

let tableShapes: Map<string, string> | undefined;

/** Every table of every descriptor: its export name (the camelCase of its id) to its shape. */
function shapes(): Map<string, string> {
  if (tableShapes) {
    return tableShapes;
  }
  tableShapes = new Map();
  const modules = join(here, "../modules");
  for (const name of readdirSync(modules)) {
    const path = join(modules, name, "registry-item.json");
    if (!existsSync(path)) {
      continue;
    }
    const item = JSON.parse(readFileSync(path, "utf-8")) as {
      tables?: { id: string; shape: string }[];
    };
    for (const table of item.tables ?? []) {
      const [head = "", ...rest] = table.id.split(/[.-]/);
      const exported =
        head +
        rest.map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
      tableShapes.set(exported, table.shape);
    }
  }
  return tableShapes;
}

/** A `data:` module exporting the empty render of each table the importer names. */
function generatedStub(
  specifier: string,
  parentURL: string | undefined
): string {
  const source =
    parentURL?.startsWith("file:") === true
      ? readFileSync(fileURLToPath(parentURL), "utf-8")
      : "";
  const quoted = specifier.replaceAll(".", String.raw`\.`);
  const pattern = new RegExp(
    String.raw`import\s*\{([^}]*)\}\s*from\s*["']${quoted}["']`,
    "g"
  );
  const body: string[] = [];
  for (const match of source.matchAll(pattern)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name =
        part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim() ?? "";
      if (name === "" || name.startsWith("type ")) {
        continue;
      }
      body.push(
        shapes().get(name) === "routes"
          ? `export const ${name} = (app) => app;`
          : `export const ${name} = [];`
      );
    }
  }
  return `data:text/javascript,${encodeURIComponent(body.join("\n"))}`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === ICON_PACKAGE) {
      return { shortCircuit: true, url: iconStub(context.parentURL) };
    }
    if (RELATIVE.test(specifier) && specifier.endsWith(GENERATED_SUFFIX)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return {
          shortCircuit: true,
          url: generatedStub(specifier, context.parentURL),
        };
      }
    }
    const workspace = WORKSPACES.get(specifier);
    if (workspace) {
      return { shortCircuit: true, url: workspace };
    }
    if (!RELATIVE.test(specifier) || HAS_EXTENSION.test(specifier)) {
      return nextResolve(specifier, context);
    }

    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return nextResolve(candidate, context);
      } catch {
        // Try the next shape. The fall-through below reports Node's own error for the
        // specifier the payload actually wrote, which is the one a reader can act on.
      }
    }

    return nextResolve(specifier, context);
  },
});
