// Smoke test for the one template failure that `build` and `typecheck` cannot see:
// Tailwind silently dropping every utility class written inside packages/ui.
//
// Tailwind's automatic class detection is rooted at the CURRENT WORKING DIRECTORY, and
// astro runs with cwd = apps/web. Only the explicit `@source` globs in
// packages/ui/src/styles/globals.css pull packages/ui into the scan — and a glob that
// matches nothing is not an error. Get that path wrong (shadcn's own astro-monorepo
// template ships an off-by-one that does exactly this) and the build still succeeds,
// typecheck still passes, and every block in @repo/ui renders unstyled.
//
// So: build the playground, then assert a sentinel utility that exists ONLY in
// packages/ui source actually reached the emitted CSS. The sentinel is
// `[--saasaloy-css-probe:1]`, declared in packages/ui/src/lib/sentinel.ts — Tailwind's
// detection is text-based, so it needs no importer to be picked up.
//
// Runs inside `pnpm deps:verify`, after `build` (it needs the output) and before
// `typecheck`. Imports nothing but node: builtins — unlike `update-deps`, which pulls in
// @clack/prompts and picocolors. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// Astro emits into the app's own dist/, and the playground is a Turborepo monorepo, so
// the output is under apps/web — NOT a top-level .dev/playground/dist.
const distDir = join(root, ".dev/playground/apps/web/dist");
const webSrcDir = join(root, ".dev/playground/apps/web/src");

// The sentinel utility, and the file that is allowed to contain it. Kept as a literal
// rather than imported, so this check fails if the source file moves or is deleted.
const SENTINEL = "--saasaloy-css-probe";
const SENTINEL_SOURCE =
  "packages/cli/templates/base/packages/ui/src/lib/sentinel.ts";

// Astro inlines any stylesheet under ~4 kB straight into the page instead of emitting a
// .css asset, so a CSS-only scan would pass or fail depending on the theme's size. Scan
// both and treat either as a hit.
const BUILT_EXTENSIONS = [".css", ".html"];

function fail(message: string, ...detail: string[]): never {
  console.error(`verify-css: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

// Every file under `dir`, optionally narrowed to a set of extensions. A missing
// directory yields nothing; the callers decide whether that's fatal.
async function collectFiles(
  dir: string,
  extensions: readonly string[] | null = null,
  out: string[] = []
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(abs, extensions, out);
    } else if (
      !extensions ||
      extensions.some((ext) => entry.name.endsWith(ext))
    ) {
      out.push(abs);
    }
  }
  return out;
}

async function filesContaining(
  files: readonly string[],
  needle: string
): Promise<string[]> {
  const hits = [];
  for (const file of files) {
    if ((await readFile(file, "utf-8")).includes(needle)) {
      hits.push(file);
    }
  }
  return hits;
}

const builtFiles = await collectFiles(distDir, BUILT_EXTENSIONS);

// A vacuous pass is the worst outcome here — "no CSS found" must never read as "the CSS
// is fine". If there is no built output at all, the pipeline ran out of order.
if (builtFiles.length === 0) {
  fail(
    `no built output under ${relative(root, distDir)}`,
    "Run `pnpm deps:verify`, which builds the playground before this check.",
    "If the build did run, Astro's output directory moved and this script needs updating."
  );
}

// Guard the guard first: the sentinel only proves the packages/ui glob works if apps/web
// cannot be the source of it. If someone copies the constant into a page, the check below
// would keep passing with the packages/ui glob broken.
const leaked = await filesContaining(await collectFiles(webSrcDir), SENTINEL);
if (leaked.length > 0) {
  fail(
    `sentinel "${SENTINEL}" leaked into apps/web source`,
    ...leaked.map((file) => relative(root, file)),
    `It must exist only in ${SENTINEL_SOURCE}, or this check proves nothing about the glob.`
  );
}

const matches = await filesContaining(builtFiles, SENTINEL);
if (matches.length === 0) {
  fail(
    `sentinel "${SENTINEL}" is missing from all ${builtFiles.length} built CSS/HTML file(s)`,
    "Tailwind is not scanning packages/ui — every utility class in @repo/ui is being dropped.",
    "Check the `@source` globs in packages/cli/templates/base/packages/ui/src/styles/globals.css:",
    'the app glob is FOUR levels up ("../../../../apps/**"), not three.',
    `Also confirm the sentinel still exists in ${SENTINEL_SOURCE}.`
  );
}

console.log(
  `verify-css: sentinel "${SENTINEL}" found in ` +
    `${matches.map((file) => relative(distDir, file)).join(", ")} — Tailwind is scanning packages/ui.`
);
