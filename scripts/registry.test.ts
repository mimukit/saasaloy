// Guards the Saasaloy UI registry (plan 0121, Phase 2). It builds the registry fresh into a
// temporary folder with apps/web/scripts/registry-build.ts, the same code the site build
// runs, and checks what a shadcn user would install:
//
//   - every item parses with shadcn's own `registryItemSchema`, and the index with
//     `registrySchema`;
//   - apps/web/registry.json names each base block as `ink-<block>`, and every block lists
//     the `saasaloy-foundation` item;
//   - each block's `registryDependencies` and npm `dependencies` agree with its imports, and
//     no public file still imports `@repo/*`;
//   - the inlined blocks typecheck. A fixture folder holds every file at the path shadcn
//     would write it (`components/blocks/`, `lib/`), the template's `button` and `card` at
//     `components/ui/` (they match upstream base-nova, which is why the items name them by
//     their shadcn name), and a tsconfig whose `@/*` path points at the fixture. It runs the
//     repo's own `tsc`. The fixture sits under apps/web/node_modules/.cache, so `react`,
//     `lucide-react` and `@base-ui/react` resolve from apps/web;
//   - each theme in packages/cli/templates/themes/ is a `registry:theme` item,
//     `theme-<name>`, whose `cssVars` name only the variables the template's brand.css
//     declares, so shadcn merges it in place, and `theme-neutral` equals brand.css.
//
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  buildRegistry,
  FOUNDATION,
  REPO_ROOT,
  registryItemSchema,
  registrySchema,
  TEMPLATE_UI,
  WEB_ROOT,
} from "../apps/web/scripts/registry-build.ts";
import { inlineSource } from "../apps/web/src/lib/registry-inline.ts";

const FOUNDATION_URL = `https://saasaloy.com/r/${FOUNDATION}.json`;
const BASE_BLOCKS = readdirSync(join(TEMPLATE_UI, "src/blocks"))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => name.replace(/\.tsx$/, ""))
  .toSorted();

interface Item {
  name: string;
  type: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files?: { path: string; type: string; target?: string; content?: string }[];
  cssVars?: Record<string, Record<string, string>>;
}

const THEME_NAMES = readdirSync(
  join(REPO_ROOT, "packages/cli/templates/themes")
)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .toSorted();

/** The `--name: value;` declarations of one rule of the template's brand.css. */
function brandDeclarations(selector: string): Record<string, string> {
  const css = readFileSync(join(TEMPLATE_UI, "src/styles/brand.css"), "utf-8");
  const escaped = selector.replaceAll(".", "\\.");
  const body =
    new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ])
  );
}

let out = "";
let items: Item[] = [];

before(async () => {
  out = mkdtempSync(join(WEB_ROOT, "node_modules/.cache-registry-test-"));
  await buildRegistry(out);
  items = readdirSync(out)
    .filter((name) => name !== "registry.json")
    .map((name) => JSON.parse(readFileSync(join(out, name), "utf-8")) as Item);
});

after(() => {
  rmSync(out, { recursive: true, force: true });
});

const blocks = () => items.filter((item) => item.type === "registry:block");

/** What a source file imports, by specifier. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map(
    (match) => match[1] ?? ""
  );
}

describe("registry", () => {
  it("parses every item and the index with the shadcn schema", () => {
    assert.ok(items.length > 0);
    for (const item of items) {
      const result = registryItemSchema.safeParse(item);
      assert.ok(result.success, `${item.name}: ${result.error?.message}`);
    }
    const index = JSON.parse(readFileSync(join(out, "registry.json"), "utf-8"));
    assert.ok(registrySchema.safeParse(index).success);
  });

  it("names each base block as ink-<block>", () => {
    const expected = BASE_BLOCKS.map((block) => `ink-${block}`);
    const names = new Set(blocks().map((item) => item.name));
    for (const name of expected) {
      assert.ok(names.has(name), `${name} is missing`);
    }
    for (const item of blocks().filter((one) => one.name.startsWith("ink-"))) {
      const block = item.name.replace(/^ink-/, "");
      assert.deepEqual(
        item.files?.map((file) => file.target),
        [`components/blocks/${block}.tsx`]
      );
    }
  });

  it("lists the foundation in every block", () => {
    for (const item of blocks()) {
      assert.ok(
        item.registryDependencies?.includes(FOUNDATION_URL),
        `${item.name} does not list ${FOUNDATION_URL}`
      );
    }
  });

  it("matches each block's dependencies to its imports", () => {
    for (const item of blocks()) {
      for (const file of item.files ?? []) {
        const source = file.content ?? "";
        assert.doesNotMatch(source, /from "@repo\//, item.name);
        for (const specifier of importsOf(source)) {
          const primitive = /^@\/components\/ui\/(.+)$/.exec(specifier)?.[1];
          if (primitive) {
            assert.ok(
              item.registryDependencies?.includes(primitive),
              `${item.name} imports ${specifier} but does not list "${primitive}"`
            );
          }
          const block = /^@\/components\/blocks\/(.+)$/.exec(specifier)?.[1];
          if (block) {
            const url = `https://saasaloy.com/r/ink-${block}.json`;
            assert.ok(
              item.registryDependencies?.includes(url),
              `${item.name} imports ${specifier} but does not list ${url}`
            );
          }
          if (specifier === "lucide-react") {
            assert.ok(
              item.dependencies?.includes("lucide-react"),
              `${item.name} imports lucide-react but does not list it`
            );
          }
        }
      }
    }
  });

  it("ships every helper a block imports in the foundation", () => {
    const foundation = items.find((item) => item.name === FOUNDATION);
    const helpers = new Set(
      foundation?.files?.map((file) => basename(file.path, ".ts"))
    );
    for (const item of blocks()) {
      for (const specifier of importsOf(item.files?.[0]?.content ?? "")) {
        const helper = /^@\/lib\/(.+)$/.exec(specifier)?.[1];
        if (helper && helper !== "utils") {
          assert.ok(helpers.has(helper), `${item.name} needs lib/${helper}`);
        }
      }
    }
  });

  it("ships each theme as a registry:theme item named theme-<name>", () => {
    assert.deepEqual(THEME_NAMES, ["cobalt", "ember", "moss", "neutral"]);
    const index = JSON.parse(
      readFileSync(join(out, "registry.json"), "utf-8")
    ) as { items: { name: string; type: string }[] };
    for (const name of THEME_NAMES) {
      const item = items.find((one) => one.name === `theme-${name}`);
      assert.ok(item, `theme-${name} is missing`);
      assert.equal(item.type, "registry:theme");
      assert.ok(registryItemSchema.safeParse(item).success);
      assert.ok(
        index.items.some(
          (one) => one.name === `theme-${name}` && one.type === "registry:theme"
        ),
        `the index does not list theme-${name}`
      );
    }
  });

  it("merges every theme into brand.css in place: the same variables, light and dark", () => {
    const root = brandDeclarations(":root");
    const dark = brandDeclarations(".dark");
    for (const name of THEME_NAMES) {
      const vars = items.find((one) => one.name === `theme-${name}`)?.cssVars;
      assert.deepEqual(Object.keys(vars ?? {}).toSorted(), ["dark", "light"]);
      assert.deepEqual(
        Object.keys(vars?.light ?? {}).toSorted(),
        Object.keys(root).toSorted(),
        `theme-${name} light`
      );
      assert.deepEqual(
        Object.keys(vars?.dark ?? {}).toSorted(),
        Object.keys(dark).toSorted(),
        `theme-${name} dark`
      );
    }
    const neutral = items.find((one) => one.name === "theme-neutral")?.cssVars;
    assert.deepEqual(neutral?.light, root);
    assert.deepEqual(neutral?.dark, dark);
  });

  it("typechecks the inlined blocks in a fixture", () => {
    const fixture = join(out, "fixture");
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(fixture, path)), { recursive: true });
      writeFileSync(join(fixture, path), content);
    };
    for (const item of items) {
      for (const file of item.files ?? []) {
        const path =
          file.type === "registry:lib"
            ? `lib/${basename(file.path)}`
            : (file.target ?? file.path);
        write(path, file.content ?? "");
      }
    }
    // The primitives the items name by their shadcn name, and shadcn init's own utils.
    const sources = { content: {}, config: {} };
    for (const name of ["button", "card"]) {
      const source = readFileSync(
        join(TEMPLATE_UI, `src/components/${name}.tsx`),
        "utf-8"
      );
      write(`components/ui/${name}.tsx`, inlineSource(source, sources, name));
    }
    write(
      "lib/utils.ts",
      readFileSync(join(TEMPLATE_UI, "src/lib/utils.ts"), "utf-8")
    );
    write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          isolatedModules: true,
          types: [],
          paths: { "@/*": ["./*"] },
        },
        include: ["**/*.ts", "**/*.tsx"],
      })
    );
    const tsc = join(REPO_ROOT, "node_modules/.bin/tsc");
    const run = spawnSync(tsc, ["-p", join(fixture, "tsconfig.json")], {
      encoding: "utf-8",
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  });
});
