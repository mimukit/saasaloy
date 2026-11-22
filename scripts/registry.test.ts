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
//     would write it (`components/blocks/`, `lib/`), the template's `button`, `card`,
//     `input` and `label` at `components/ui/` (they match upstream base-nova, which is why
//     the items name them by their shadcn name), and a tsconfig whose `@/*` path points at the fixture. It runs the
//     repo's own `tsc`. The fixture sits under apps/web/node_modules/.cache, so `react`,
//     `lucide-react` and `@base-ui/react` resolve from apps/web;
//   - the module blocks (Phase 5) are `<module>-<block>` items that name their module's own
//     files: `auth-sign-in` and `auth-sign-up` over the shared `auth-card`, and
//     `waitlist-form`. Each shell primitive they render ships as `shell-<name>` with the
//     coss ui notice, and the fixture renders each block with stub props;
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
const itemUrl = (name: string) => `https://saasaloy.com/r/${name}.json`;

/** The module blocks of Phase 5, with the source file each one names. */
const MODULE_BLOCKS: Record<string, string> = {
  "auth-sign-in": "modules/auth/files/ui/blocks/auth/sign-in.tsx",
  "auth-sign-up": "modules/auth/files/ui/blocks/auth/sign-up.tsx",
  "waitlist-form": "modules/waitlist/files/ui/blocks/waitlist.tsx",
};
/** The shell primitives the module blocks render, each a `shell-<name>` item. */
const SHELL_PRIMITIVES = ["button", "field", "input", "spinner"];

/**
 * The item a `@/components/...` import needs. A shell primitive is `shell-<name>`, any
 * other primitive goes by its shadcn name, and a block in a folder is `<folder>-<name>`
 * (`auth/sign-in` is `auth-sign-in`, `auth/auth-card` is `auth-card`). A kit block in no
 * folder is `ink-<name>`.
 */
function dependencyOf(specifier: string): string | undefined {
  const primitive = /^@\/components\/ui\/(.+)$/.exec(specifier)?.[1];
  if (primitive !== undefined) {
    const shell = /^shell\/(.+)$/.exec(primitive)?.[1];
    return shell === undefined ? primitive : itemUrl(`shell-${shell}`);
  }
  const block = /^@\/components\/blocks\/(.+)$/.exec(specifier)?.[1];
  if (block === undefined) {
    return undefined;
  }
  const [folder, file] = block.split("/");
  if (file === undefined) {
    return itemUrl(`ink-${block}`);
  }
  return itemUrl(file.startsWith(`${folder}-`) ? file : `${folder}-${file}`);
}

/** The npm package of a bare import (`@base-ui/react/input` is `@base-ui/react`). */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("@/")) {
    return undefined;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
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
const kitBlocks = () =>
  blocks().filter((item) => !Object.hasOwn(MODULE_BLOCKS, item.name));

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

  it("lists the foundation in every kit block", () => {
    for (const item of kitBlocks()) {
      assert.ok(
        item.registryDependencies?.includes(FOUNDATION_URL),
        `${item.name} does not list ${FOUNDATION_URL}`
      );
    }
  });

  it("matches each item's dependencies to its imports", () => {
    const withCode = items.filter((item) =>
      ["registry:block", "registry:component", "registry:ui"].includes(
        item.type
      )
    );
    assert.ok(withCode.length > 0);
    for (const item of withCode) {
      for (const file of item.files ?? []) {
        const source = file.content ?? "";
        assert.doesNotMatch(source, /from "@repo\//, item.name);
        for (const specifier of importsOf(source)) {
          const needed = dependencyOf(specifier);
          if (needed !== undefined) {
            assert.ok(
              item.registryDependencies?.includes(needed),
              `${item.name} imports ${specifier} but does not list ${needed}`
            );
          }
          const pkg = packageOf(specifier);
          if (pkg !== undefined && pkg !== "react") {
            assert.ok(
              item.dependencies?.includes(pkg),
              `${item.name} imports ${specifier} but does not list ${pkg}`
            );
          }
        }
      }
    }
  });

  it("publishes each module block as <module>-<block> from its module's file", () => {
    const registry = JSON.parse(
      readFileSync(join(WEB_ROOT, "registry.json"), "utf-8")
    ) as { items: { name: string; files: { path: string }[] }[] };
    for (const [name, source] of Object.entries(MODULE_BLOCKS)) {
      const item = items.find((one) => one.name === name);
      assert.ok(item, `${name} is missing`);
      assert.equal(item.type, "registry:block");
      assert.ok(registryItemSchema.safeParse(item).success, name);
      const declared = registry.items.find((one) => one.name === name);
      assert.deepEqual(
        declared?.files.map((file) => file.path),
        [`../../${source}`],
        `${name} names a second copy of its source`
      );
      const [file] = item.files ?? [];
      assert.match(file?.content ?? "", /^"use client";\n/, name);
      assert.match(
        file?.content ?? "",
        /const siteName = "Acme";|^(?![\s\S]*siteName)/,
        name
      );
    }
    for (const name of ["auth-sign-in", "auth-sign-up"]) {
      const item = items.find((one) => one.name === name);
      assert.ok(item?.registryDependencies?.includes(itemUrl("auth-card")));
    }
  });

  it("ships each shell primitive as shell-<name> with the coss ui notice", () => {
    for (const name of SHELL_PRIMITIVES) {
      const item = items.find((one) => one.name === `shell-${name}`);
      assert.ok(item, `shell-${name} is missing`);
      assert.equal(item.type, "registry:ui");
      assert.ok(registryItemSchema.safeParse(item).success);
      const [file] = item.files ?? [];
      assert.equal(file?.target, `components/ui/shell/${name}.tsx`);
      assert.match(file?.content ?? "", /^\/\/ Adapted from coss ui/);
      assert.match(file?.content ?? "", /Copyright \(c\) 2025 coss\.com/);
    }
    const mark = items.find((one) => one.name === "shell-brand-mark");
    assert.equal(
      mark?.files?.[0]?.target,
      "components/blocks/shell/brand-mark.tsx"
    );
    assert.doesNotMatch(mark?.files?.[0]?.content ?? "", /\.svg"/);
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
    for (const name of ["button", "card", "input", "label"]) {
      const source = readFileSync(
        join(TEMPLATE_UI, `src/components/${name}.tsx`),
        "utf-8"
      );
      write(`components/ui/${name}.tsx`, inlineSource(source, sources, name));
    }
    // Each module block rendered with stub props, the way a project outside Saasaloy uses
    // it: an `onSubmit` and the data props, nothing more.
    write(
      "app/stub-props.tsx",
      [
        'import { SignInCard } from "@/components/blocks/auth/sign-in";',
        'import { SignUpCard } from "@/components/blocks/auth/sign-up";',
        'import { Waitlist } from "@/components/blocks/waitlist";',
        "",
        "export function StubProps() {",
        "  return (",
        "    <>",
        "      <SignInCard onSubmit={async () => undefined} />",
        '      <SignInCard onSubmit={async (values) => values.email} signUpHref="/sign-up" />',
        '      <SignUpCard onSubmit={async ({ name }) => (name === "" ? "Name?" : undefined)} signInHref="/sign-in" />',
        "      <Waitlist onSubmit={async () => ({ ok: true })} />",
        '      <Waitlist onSubmit={async () => ({ ok: false, message: "Full." })} title="Soon" />',
        "    </>",
        "  );",
        "}",
        "",
      ].join("\n")
    );
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
