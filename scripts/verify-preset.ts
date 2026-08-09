// Drill for the one thing the template promises but does not own: that a scaffolded
// project can swap its whole token set with `shadcn add <registry:style url>` and keep
// everything the base hand-wrote around those tokens.
//
// The template's globals.css is not stock shadcn output. It carries three `@source`
// globs (without which every utility in packages/ui is silently dropped — see
// verify-css), a `@custom-variant dark`, and a `@layer base`. The preset recipe
// documented in the template's AGENTS.md points shadcn at that same file and asks it to
// merge. Today shadcn merges `:root` / `.dark` / `@theme inline` in place and leaves the
// rest alone. Nothing guarantees the next shadcn keeps doing that, and the failure is
// quiet: the project still builds, it is just unstyled or mis-scoped. So run the recipe
// for real and assert the surrounding file survived it.
//
// NOT part of `deps:verify`, and it must not become part of it: this fetches a preset
// over the network from a third party, and the repo's standing green gate may not depend
// on someone else's uptime. Run it by hand — `pnpm verify:preset` — whenever `shadcn`
// moves, alongside `deps:verify`.
//
// It leaves .dev/playground with the preset applied. That is a scratch directory; any
// `play:init` (including the one `deps:verify` starts with) re-scaffolds it clean.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build
// step; `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// tweakcn serves the widest catalogue of `registry:style` items, and its URL shape is
// stable and versionless. The mechanism under test is the registry item, not the host —
// shadcn's own https://ui.shadcn.com/create emits the same shape and is what the
// template's AGENTS.md recommends first, but it has no fixed URL to probe.
const PRESET_URL = "https://tweakcn.com/r/themes/modern-minimal.json";

const playground = join(root, ".dev/playground");
const playgroundUi = join(playground, "packages/ui");
const playgroundCss = join(playgroundUi, "src/styles/globals.css");
const playgroundComponentsJson = join(playgroundUi, "components.json");
const playgroundDist = join(playground, "apps/web/dist");

// Everything the base hand-wrote into globals.css that a merge must not eat. Each one is
// a real failure mode, not a formatting preference: drop a @source glob and packages/ui
// renders unstyled, drop @custom-variant and every `dark:` utility stops matching, drop
// @layer base and the border/background reset goes with it.
const MUST_SURVIVE = [
  '@source "../**/*.{ts,tsx}";',
  '@source "../../../../apps/**/*.{ts,tsx,astro}";',
  '@source not "../../../../**/node_modules";',
  "@custom-variant dark (&:is(.dark *));",
  "@layer base {",
] as const;

// Blocks shadcn is expected to MERGE INTO rather than append after. A second `:root`
// later in the file would win by source order and silently strip whatever the first one
// declared but the preset did not.
const SINGLETON_BLOCKS: readonly [label: string, pattern: RegExp][] = [
  [":root", /^\s*:root\s*\{/gm],
  [".dark", /^\s*\.dark\s*\{/gm],
  ["@theme inline", /^\s*@theme inline\s*\{/gm],
];

function fail(message: string, ...detail: string[]): never {
  console.error(`verify-preset: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

function step(message: string): void {
  console.log(`verify-preset: ${message}`);
}

// Every command runs from the repo root with its output on this process's stdio, so a
// failing pnpm/shadcn reports itself in full rather than through a summary of ours.
function run(command: string, args: readonly string[], label: string): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    fail(`${label} could not start`, String(result.error));
  }
  if (result.status !== 0) {
    fail(`${label} failed`, `exit code ${String(result.status)}`);
  }
}

// CSS values survive the build re-serialised: `oklch(0.205 0 0)` comes back as
// `oklch(.205 0 0)`, whitespace collapses, and the declaration may be inlined into HTML.
// Compare on a shape that ignores all of it.
function normalize(css: string): string {
  return css.replaceAll(/\s+/g, "").replaceAll(/(^|[^\d.])0\./g, "$1.");
}

// The `--primary: <value>;` declared in a stylesheet's FIRST :root block.
function readRootPrimary(css: string, source: string): string {
  const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(css);
  if (!rootBlock?.[1]) {
    fail(`no :root block in ${source}`);
  }
  const primary = /--primary:\s*([^;]+);/.exec(rootBlock[1]);
  if (!primary?.[1]) {
    fail(`no --primary declaration in ${source}'s :root block`);
  }
  return primary[1].trim();
}

// --- Scaffold a clean project and install it -------------------------------------

step("scaffolding .dev/playground from the template");
run("pnpm", ["run", "play:init"], "play:init");
run("pnpm", ["-C", ".dev/playground", "install"], "playground install");

const cssBefore = await readFile(playgroundCss, "utf-8");
const componentsJsonBefore = await readFile(playgroundComponentsJson, "utf-8");
const basePrimary = readRootPrimary(
  cssBefore,
  "the freshly scaffolded globals.css"
);

// --- Run the documented recipe ---------------------------------------------------

step(`applying preset ${PRESET_URL}`);
// `--dir` puts pnpm in packages/ui, which is where components.json lives; shadcn reads
// it from the working directory and dies at "Verifying framework" without it. This is
// the same `exec` form the template's AGENTS.md documents, aimed at the playground.
run(
  "pnpm",
  [
    "--dir",
    ".dev/playground/packages/ui",
    "exec",
    "shadcn",
    "add",
    PRESET_URL,
    "--yes",
  ],
  "shadcn add"
);

const cssAfter = await readFile(playgroundCss, "utf-8");
const componentsJsonAfter = await readFile(playgroundComponentsJson, "utf-8");

// --- Assert the base's own rules survived the merge -------------------------------

if (cssAfter === cssBefore) {
  fail(
    "shadcn add left globals.css untouched",
    `The preset at ${PRESET_URL} applied nothing — the URL may have moved, or shadcn`,
    "no longer treats a registry:style item as a theme swap. Check its output above."
  );
}

if (componentsJsonAfter !== componentsJsonBefore) {
  fail(
    "shadcn add rewrote components.json",
    "ADR 0022 fixes `style` at init because the CLI cannot change it later; a preset",
    "moving that field would silently re-base the project's primitives.",
    `See ${relative(root, playgroundComponentsJson)}.`
  );
}

const missing = MUST_SURVIVE.filter((rule) => !cssAfter.includes(rule));
if (missing.length > 0) {
  fail(
    `${String(missing.length)} hand-written rule(s) did not survive the preset merge`,
    ...missing,
    "shadcn now overwrites globals.css rather than merging into it. Either pin shadcn",
    "back, or stop documenting the in-place recipe in the template's AGENTS.md."
  );
}

for (const [label, pattern] of SINGLETON_BLOCKS) {
  const count = cssAfter.match(pattern)?.length ?? 0;
  if (count !== 1) {
    fail(
      `expected exactly one \`${label}\` block after the merge, found ${String(count)}`,
      "A duplicated block wins by source order and drops whatever the first one declared."
    );
  }
}

const presetPrimary = readRootPrimary(cssAfter, "globals.css after the preset");
if (normalize(presetPrimary) === normalize(basePrimary)) {
  fail(
    `--primary is still the base value (${basePrimary}) after applying the preset`,
    "The merge preserved the file but changed no tokens, so this check proves nothing.",
    "Pick a preset whose palette differs from the template's, or suspect shadcn."
  );
}

step(`tokens swapped: --primary ${basePrimary} → ${presetPrimary}`);

// --- Build, and assert the swapped token actually reached the output ---------------

run("pnpm", ["-C", ".dev/playground", "build"], "playground build");
run("node", ["scripts/verify-css.ts"], "verify-css");

// Astro inlines small stylesheets straight into the page, so scan both extensions —
// same reason verify-css does.
const built = (await collectBuiltFiles(playgroundDist))
  .map(normalize)
  .join("\n");

// Assert the preset's own value positively. A bare `--primary:` declaration only proves
// the build emitted the token; any third value would satisfy it, and that is not what
// the recipe promises.
if (!built.includes(normalize(`--primary:${presetPrimary}`))) {
  fail(
    "the built CSS does not carry the preset --primary value",
    `Expected ${presetPrimary} under ${relative(root, playgroundDist)}.`,
    "Either the build did not run, or it re-serialised the value in a way normalize()",
    "does not yet flatten — check the built output before trusting this failure."
  );
}

if (built.includes(normalize(`--primary:${basePrimary}`))) {
  fail(
    "the built CSS still carries the base --primary value",
    `Expected the preset's ${presetPrimary}, found the template's ${basePrimary}.`,
    "globals.css was swapped but the build did not pick it up — suspect a stale",
    "Turborepo cache in the playground (play:init runs `git init` for exactly this)."
  );
}

console.log(
  `verify-preset: preset ${PRESET_URL} applied cleanly — base rules intact, ` +
    `--primary swapped to ${presetPrimary} in the built output.`
);

// Read every built .css/.html file. Declared after use on purpose: the assertions above
// read top-to-bottom as the drill, and hoisting keeps the helper out of the way.
async function collectBuiltFiles(dir: string): Promise<string[]> {
  const contents: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    fail(
      `no built output under ${relative(root, dir)}`,
      "The playground build did not emit anything where this script expects it."
    );
  }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".css") && !entry.name.endsWith(".html")) {
      continue;
    }
    contents.push(await readFile(join(entry.parentPath, entry.name), "utf-8"));
  }
  if (contents.length === 0) {
    fail(`no built CSS or HTML under ${relative(root, dir)}`);
  }
  return contents;
}
