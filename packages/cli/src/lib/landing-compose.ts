import { kitFiles } from "./kits.js";
import {
  DEFAULT_KIT,
  isDefaultBlockList,
  PAGE_BLOCK_INFO,
  PAGE_BLOCKS,
} from "./recipes.js";
import type { KitName, PageBlock } from "./recipes.js";

// The landing page `init --template` and `init --blocks` write (plan 0121, Phase 7). The
// render calls `composeLanding` on the base template's files, before any module, and it
// follows the SECTION RECIPE comment in the base index.astro as far as a render safely
// can:
//
//   - index.astro imports and renders the listed blocks in the listed order. Each line is
//     the base page's own line for that block, so the client directives on Navbar and
//     PricingTable, the `siteName` props, the Layout and the `<main>` wrapper stay;
//   - LANDING_SECTIONS in src/lib/landing-markdown.ts, and the list its test expects,
//     follow the same order, so /index.md describes the page the site shows;
//   - a block left out loses its navbar label in landing.ts (an empty label hides the
//     link), so no link points at a section that is gone. The footer links leave the page
//     and need nothing;
//   - the block files stay in packages/ui/src/blocks/. A file nothing imports costs
//     nothing, and adding the section back is one import and one line;
//   - a kit writes its blocks over the ink files of the same name, the left-out ones too,
//     so a section added back later keeps the page's look;
//   - apps/web/DESIGN.md names the blocks the page renders and the kit.
//
// Every rewrite looks for the base template's exact text and throws when it is missing,
// so a template edit that moves it fails a test instead of writing a page by halves.

export const INDEX_ASTRO = "apps/web/src/pages/index.astro";
export const LANDING_MARKDOWN = "apps/web/src/lib/landing-markdown.ts";
export const LANDING_MARKDOWN_TEST =
  "apps/web/src/lib/landing-markdown.test.ts";
export const LANDING_CONTENT = "packages/ui/src/content/landing.ts";
export const WEB_DESIGN_FILE = "apps/web/DESIGN.md";

export interface LandingChoice {
  kit: KitName;
  blocks: readonly PageBlock[];
}

/** True when the choice is the base template's own page, which needs no rewrite. */
export function isDefaultLanding(choice: LandingChoice): boolean {
  return choice.kit === DEFAULT_KIT && isDefaultBlockList(choice.blocks);
}

function missing(file: string, what: string): never {
  throw new Error(
    `${file}: the base template no longer holds ${what}, so the landing page cannot be composed.`
  );
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** The base page's own line for one block, without its indent. */
function blockLine(source: string, block: PageBlock): string {
  const { component } = PAGE_BLOCK_INFO[block];
  const line = new RegExp(
    `^[ \\t]*(<${component}\\b[^\\n]*/>)[ \\t]*$`,
    "m"
  ).exec(source)?.[1];
  return line ?? missing(INDEX_ASTRO, `a <${component} /> line`);
}

/** index.astro with the imports and the lines of `blocks`, in that order. */
export function composeIndexAstro(
  source: string,
  blocks: readonly PageBlock[]
): string {
  const keep = new Set(blocks);
  let out = source;
  for (const block of PAGE_BLOCKS) {
    const importLine = new RegExp(
      `^import \\{ ${PAGE_BLOCK_INFO[block].component} \\} from "@repo/ui/blocks/${escapeRegExp(block)}";\\n`,
      "m"
    );
    if (!importLine.test(out)) {
      missing(INDEX_ASTRO, `the import of ${block}`);
    }
    if (!keep.has(block)) {
      out = out.replace(importLine, "");
    }
  }

  const start = /^[ \t]*<Navbar\b[^\n]*\/>[ \t]*\n/m.exec(out);
  const end = /^[ \t]*<Footer\b[^\n]*\/>[ \t]*\n/m.exec(out);
  if (!start || !end || end.index < start.index) {
    return missing(INDEX_ASTRO, "a <Navbar /> line before a <Footer /> line");
  }
  const inMain = blocks.filter(
    (block) => block !== "navbar" && block !== "footer"
  );
  const lines = [
    ...(keep.has("navbar") ? [`  ${blockLine(source, "navbar")}`] : []),
    '  <main id="main" tabindex="-1">',
    ...inMain.map((block) => `    ${blockLine(source, block)}`),
    "  </main>",
    ...(keep.has("footer") ? [`  ${blockLine(source, "footer")}`] : []),
  ];
  return `${out.slice(0, start.index)}${lines.join("\n")}\n${out.slice(end.index + end[0].length)}`;
}

/** The landing section keys of `blocks`, in order. */
export function landingSections(blocks: readonly PageBlock[]): string[] {
  return blocks.flatMap((block) => {
    const { section } = PAGE_BLOCK_INFO[block];
    return section === undefined ? [] : [section];
  });
}

/** Prettier's print width, which a generated project's `prettier --check` holds to. */
const PRINT_WIDTH = 80;

/**
 * `head`, a string array and `tail`, laid out the way Prettier prints them: on one line
 * when it fits, else one item a line at `indent` plus two spaces.
 */
function printArray(
  indent: string,
  head: string,
  items: readonly string[],
  tail: string
): string {
  const quoted = items.map((item) => `"${item}"`);
  const flat = `${indent}${head}[${quoted.join(", ")}]${tail}`;
  if (flat.length <= PRINT_WIDTH) {
    return flat;
  }
  const lines = quoted.map((item) => `${indent}  ${item},`);
  return [`${indent}${head}[`, ...lines, `${indent}]${tail}`].join("\n");
}

/** landing-markdown.ts with LANDING_SECTIONS in the order of `blocks`. */
export function composeLandingMarkdown(
  source: string,
  blocks: readonly PageBlock[]
): string {
  const head = "export const LANDING_SECTIONS: readonly LandingSection[] = ";
  const list = new RegExp(`^${escapeRegExp(head)}\\[[\\s\\S]*?\\];$`, "m");
  if (!list.test(source)) {
    missing(LANDING_MARKDOWN, "the LANDING_SECTIONS list");
  }
  return source.replace(list, () =>
    printArray("", head, landingSections(blocks), ";")
  );
}

/** landing-markdown.test.ts expecting the LANDING_SECTIONS of `blocks`. */
export function composeLandingMarkdownTest(
  source: string,
  blocks: readonly PageBlock[]
): string {
  const head = "expect(LANDING_SECTIONS).toStrictEqual(";
  const list = new RegExp(
    `^( *)${escapeRegExp(head)}\\[[\\s\\S]*?\\]\\);$`,
    "m"
  );
  if (!list.test(source)) {
    missing(LANDING_MARKDOWN_TEST, "the LANDING_SECTIONS expectation");
  }
  const sections = landingSections(blocks);
  let out = source.replace(list, (_whole, indent: string) =>
    printArray(indent, head, sections, ");")
  );
  if (!sections.includes("logos")) {
    out = out.replace(
      "lists the same sections as index.astro, logos included",
      "lists the same sections as index.astro"
    );
  }
  return out;
}

/** landing.ts with the navbar label of each left-out block blanked. */
export function blankNavLabels(
  source: string,
  blocks: readonly PageBlock[]
): string {
  const keep = new Set(blocks);
  let out = source;
  for (const block of PAGE_BLOCKS) {
    const label = PAGE_BLOCK_INFO[block].navLabel;
    if (label === undefined || keep.has(block)) {
      continue;
    }
    const line = new RegExp(`^(\\s*${label}: )"[^"\\n]*",$`, "m");
    if (!line.test(out)) {
      missing(LANDING_CONTENT, `the navbar label ${label}`);
    }
    out = out.replace(line, '$1"",');
  }
  return out;
}

const COUNT_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
];

/** apps/web/DESIGN.md naming the page's blocks, in order, and the kit. */
export function composeDesign(source: string, choice: LandingChoice): string {
  const sentence =
    /The landing page is thirteen blocks in `packages\/ui\/src\/blocks\/`, composed by explicit imports in `apps\/web\/src\/pages\/index\.astro`: [^.]+\./;
  if (!sentence.test(source)) {
    missing(WEB_DESIGN_FILE, "the sentence that lists the landing blocks");
  }
  const count =
    COUNT_WORDS[choice.blocks.length] ?? String(choice.blocks.length);
  const listed = choice.blocks;
  const list =
    listed.length > 1
      ? `${listed.slice(0, -1).join(", ")} and ${listed.at(-1) ?? ""}`
      : (listed[0] ?? "");
  const kitNote =
    choice.kit === DEFAULT_KIT
      ? ""
      : ` The ${kitBlockList(choice.kit)} files come from the Saasaloy UI \`${choice.kit}\` kit: softer cards whose corners are 2.4 times \`--radius\`, left-aligned section titles, and a full-width primary panel for the closing call to action. The other blocks keep the ink look this section describes.`;
  return source.replace(
    sentence,
    () =>
      `The landing page renders ${count} block${choice.blocks.length === 1 ? "" : "s"} from \`packages/ui/src/blocks/\`, composed by explicit imports in \`apps/web/src/pages/index.astro\`: ${list}.${kitNote}`
  );
}

function kitBlockList(kit: KitName): string {
  const blocks = [...kitFiles(kit).keys()].map((path) =>
    path.replace(/^packages\/ui\/src\/blocks\//, "").replace(/\.tsx$/, "")
  );
  return blocks.length > 1
    ? `${blocks.slice(0, -1).join(", ")} and ${blocks.at(-1) ?? ""}`
    : (blocks[0] ?? "");
}

/**
 * The files a landing choice changes, each passed through its rewrite: the kit's block
 * files, then index.astro, the Markdown copy and its test, landing.ts and DESIGN.md.
 * `read` gives a base file's rendered content, or `undefined` when the render holds none.
 * The base page needs no change, so it returns an empty map.
 */
export function composeLanding(
  choice: LandingChoice,
  read: (path: string) => string | undefined
): Map<string, string> {
  const out = new Map<string, string>();
  if (isDefaultLanding(choice)) {
    return out;
  }
  for (const [path, source] of kitFiles(choice.kit)) {
    if (read(path) === undefined) {
      missing(path, "the ink block this kit file replaces");
    }
    out.set(path, source);
  }
  const rewrite = (path: string, edit: (source: string) => string): void => {
    const source = read(path);
    out.set(path, edit(source ?? missing(path, "the file")));
  };
  rewrite(INDEX_ASTRO, (source) => composeIndexAstro(source, choice.blocks));
  rewrite(LANDING_MARKDOWN, (source) =>
    composeLandingMarkdown(source, choice.blocks)
  );
  // The test ships with the template; a render whose template lacks it skips it.
  const test = read(LANDING_MARKDOWN_TEST);
  if (test !== undefined) {
    out.set(
      LANDING_MARKDOWN_TEST,
      composeLandingMarkdownTest(test, choice.blocks)
    );
  }
  rewrite(LANDING_CONTENT, (source) => blankNavLabels(source, choice.blocks));
  rewrite(WEB_DESIGN_FILE, (source) => composeDesign(source, choice));
  return out;
}
