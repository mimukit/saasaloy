import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vitest/config";
import { defineConfig } from "vitest/config";
import { moduleLayoutPlugin } from "./test/module-layout";

// `pnpm test:modules`: runs every module unit test in place, from the saasaloy repo, with no
// network (ADR 0054, issue #243).
//
// A module test is `<name>.vitest.ts` under `modules/*/files/`, and its descriptor ships it
// as `<name>.test.ts` when the project's testing mode is on. In a project it imports its
// neighbours by their project paths. Here those paths resolve two ways:
//
// - `test/module-layout.ts` maps every project path to the repo file `saasaloy add`
//   writes there, from the descriptors and the base template. A relative import and a
//   `@repo/<workspace>` import from a module file resolve through it, so a provider test's
//   `../index` lands on the real core, and `@repo/kv` on `modules/kv/files/src/index.ts`.
// - `@repo/config` resolves to `scripts/config-shim.ts`, which composes the sections the
//   way an installed project does, because the project's `config` object is assembled by
//   patches no single repo file holds.
//
// Route tests (`api/routes/*.vitest.ts`) and the seed completeness test are left out. They
// need the scaffolded `apps/api` and `@repo/db/testing`, which exist only in a project, so
// the playground run proves them (plan 0080, Phase 9).
const repo = fileURLToPath(new URL("../../", import.meta.url));
const modules = `${repo}modules/`;
const base = `${repo}packages/cli/templates/base/`;

const ICON_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
const ICON_STUB = "\0lucide-react-stub:";

/**
 * Answers `lucide-react` with stub icons (#264). A payload file such as an app's
 * `components/nav.ts` imports its icons at runtime, and this repo installs no icon set. The
 * plugin reads the importing file and exports each name it takes as a component that renders
 * nothing. A test never renders an icon; it only needs the import to bind.
 */
function lucideStub(): Plugin {
  return {
    name: "lucide-react-stub",
    enforce: "pre",
    resolveId(source, importer) {
      return source === "lucide-react" && importer
        ? `${ICON_STUB}${importer}`
        : undefined;
    },
    load(id) {
      if (!id.startsWith(ICON_STUB)) {
        return null;
      }
      const source = readFileSync(id.slice(ICON_STUB.length), "utf-8");
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
      return [...names]
        .map((name) => `export const ${name} = () => null;`)
        .join("\n");
    },
  };
}

export default defineConfig({
  oxc: { tsconfig: false },
  plugins: [lucideStub(), moduleLayoutPlugin(repo, base)],
  resolve: {
    alias: [
      { find: /^@repo\/config$/, replacement: `${repo}scripts/config-shim.ts` },
      {
        find: /^@repo\/config\/define$/,
        replacement: `${base}packages/config/src/define.ts`,
      },
    ],
  },
  test: {
    name: "modules",
    root: modules,
    environment: "node",
    include: ["*/files/**/*.vitest.ts"],
    exclude: [
      "*/files/api/routes/**",
      "database/files/src/seed/completeness.vitest.ts",
    ],
    pool: "forks",
    maxWorkers: 2,
  },
});
