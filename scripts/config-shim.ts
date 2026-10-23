// What `@repo/config` resolves to while this repo's own tests run (#154).
//
// A module payload file may read `config.auth.adminRole`, and that package does not exist
// here: it ships inside the base template and is composed in a scaffolded project out of
// the base's sections plus one file per installed module. `pnpm test:modules` has no
// project, so this file builds the same object from the two halves on disk — every section
// file the template ships, and every one a module would install.
//
// It composes *every* module's section, not the ones one test needs, because the sections
// are keyed and a key collision is the one way this can be wrong. Two modules claiming one
// key throw here, in the test run, which is the earliest place it can be caught.
//
// Each section file is loaded by dynamic import rather than a static one. That is not
// incidental: a static import would pull template payload into `tsconfig.scripts.json`,
// which resolves as `nodenext` and rejects the extensionless relative imports every payload
// file is written with (a scaffolded project compiles them as `bundler`). `define.ts` is the
// one file imported statically, and it imports nothing at all.
//
// `scripts/ts-resolve-hook.ts` maps the bare specifier onto this file, and appends the `.ts`
// each payload file leaves off. Nothing imports this file directly.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnySection } from "../packages/cli/templates/base/packages/config/src/define.ts";
import { defineConfig } from "../packages/cli/templates/base/packages/config/src/define.ts";

const root = join(import.meta.dirname, "..");
const BASE_SECTIONS = join(
  root,
  "packages/cli/templates/base/packages/config/src/sections"
);

/** Every `.ts` file in a directory, sorted, so a collision reads the same on every run. */
function filesIn(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .toSorted()
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(dir, name));
}

/** The base's own section files, then every module's, in module-name order. */
function sectionFiles(): string[] {
  const found = filesIn(BASE_SECTIONS);
  const modules = join(root, "modules");
  for (const name of readdirSync(modules).toSorted()) {
    found.push(...filesIn(join(modules, name, "files", "config")));
  }
  return found;
}

const sections: AnySection[] = [];
for (const file of sectionFiles()) {
  const loaded: Record<string, unknown> = await import(
    pathToFileURL(file).href
  );
  for (const exported of Object.values(loaded)) {
    if (typeof exported === "function") {
      sections.push((exported as () => AnySection)());
    }
  }
}

export const config = defineConfig({ sections });
