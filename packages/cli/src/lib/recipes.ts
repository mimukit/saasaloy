import focus from "../../templates/recipes/focus.json" with { type: "json" };
import glow from "../../templates/recipes/glow.json" with { type: "json" };
import launch from "../../templates/recipes/launch.json" with { type: "json" };
import { RefusalError } from "./exit.js";
import { THEME_NAMES } from "./theme-names.js";
import type { ThemeName } from "./theme-names.js";

// The landing page a project starts with (plan 0121, Phase 7): which blocks, in which
// order, from which kit. Three words name the parts:
//
//   - a **block** is one section file in `packages/ui/src/blocks/` (`hero`, `faq`);
//   - a **kit** is a visual family of blocks. `ink` is the base template's own set. A
//     second kit ships some of the same blocks under the same names and props, in
//     `templates/kits/<kit>/blocks/`, and `init` writes them over the ink files;
//   - a **template** (a recipe) names one theme, one kit and an ordered block list.
//     `templates/recipes/<name>.json` holds each one, and every template takes the base
//     `landing.ts` copy as its sample content.
//
// Two readers share this file: `saasaloy init --template --blocks` and the Saasaloy UI
// pages in apps/web. It imports no Node built-in, so the site can bundle it.

/** The page blocks in the base page's own order. The navbar and the footer frame `main`. */
export const PAGE_BLOCKS = [
  "navbar",
  "hero",
  "logo-cloud",
  "pain-points",
  "how-it-works",
  "feature-grid",
  "showcase",
  "audience",
  "testimonials",
  "pricing-table",
  "faq",
  "cta",
  "footer",
] as const;

export type PageBlock = (typeof PAGE_BLOCKS)[number];

/** How index.astro, LANDING_SECTIONS and the navbar labels name one block. */
export interface PageBlockInfo {
  /** The component index.astro imports from `@repo/ui/blocks/<block>`. */
  component: string;
  /** The key in LANDING_SECTIONS (src/lib/landing-markdown.ts). The frame has none. */
  section?: string;
  /** The `landing.navbar` label that links to the block's anchor, when one does. */
  navLabel?: string;
}

export const PAGE_BLOCK_INFO: Readonly<Record<PageBlock, PageBlockInfo>> = {
  navbar: { component: "Navbar" },
  hero: { component: "Hero", section: "hero" },
  "logo-cloud": { component: "LogoCloud", section: "logos" },
  "pain-points": { component: "PainPoints", section: "painPoints" },
  "how-it-works": {
    component: "HowItWorks",
    section: "howItWorks",
    navLabel: "linkHowItWorks",
  },
  "feature-grid": {
    component: "FeatureGrid",
    section: "features",
    navLabel: "linkFeatures",
  },
  showcase: {
    component: "Showcase",
    section: "showcase",
    navLabel: "linkShowcase",
  },
  audience: { component: "Audience", section: "audience" },
  testimonials: { component: "Testimonials", section: "testimonials" },
  "pricing-table": {
    component: "PricingTable",
    section: "pricing",
    navLabel: "linkPricing",
  },
  faq: { component: "Faq", section: "faq", navLabel: "linkFaq" },
  cta: { component: "Cta", section: "cta" },
  footer: { component: "Footer" },
};

/** The page the base template ships: every block, in order. */
export const DEFAULT_BLOCKS: readonly PageBlock[] = PAGE_BLOCKS;

export const KIT_NAMES = ["ink", "dusk"] as const;

export type KitName = (typeof KIT_NAMES)[number];

/** The base template's kit. A project records a kit only when it is another one. */
export const DEFAULT_KIT: KitName = "ink";

/**
 * The blocks each kit ships in place of the ink file of the same name. Ink is the base
 * template, so it replaces nothing. A block a kit does not ship stays ink.
 */
export const KIT_BLOCKS: Readonly<Record<KitName, readonly PageBlock[]>> = {
  ink: [],
  dusk: ["hero", "feature-grid", "pricing-table", "testimonials", "faq", "cta"],
};

export const TEMPLATE_NAMES = ["launch", "focus", "glow"] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** One template, as `templates/recipes/<name>.json` holds it. */
export interface Recipe {
  name: TemplateName;
  title: string;
  /** One line for the CLI prompt and the /ui/templates card. */
  description: string;
  theme: ThemeName;
  kit: KitName;
  /** The page, in order. The navbar comes first and the footer last when present. */
  blocks: readonly PageBlock[];
  /** Where the sample words come from. Every template says "base landing copy". */
  content: string;
}

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

export function isTemplateName(value: string): value is TemplateName {
  return isOneOf(TEMPLATE_NAMES, value);
}

export function isKitName(value: string): value is KitName {
  return isOneOf(KIT_NAMES, value);
}

/** The template `value` names. Any other value is a refusal that lists the names. */
export function parseTemplateName(value: string): TemplateName {
  if (!isTemplateName(value)) {
    throw new RefusalError(
      `Unknown template "${value}". Use one of: ${TEMPLATE_NAMES.join(", ")}.`
    );
  }
  return value;
}

/**
 * The faults of an ordered block list, as sentences: an unknown name, a name twice, a
 * navbar that is not first or a footer that is not last, or no block at all. Empty when
 * the list is good.
 */
export function blockListProblems(blocks: readonly string[]): string[] {
  const problems: string[] = [];
  if (blocks.length === 0) {
    problems.push("The block list is empty.");
  }
  const unknown = blocks.filter((block) => !isOneOf(PAGE_BLOCKS, block));
  if (unknown.length > 0) {
    problems.push(
      `Unknown block${unknown.length === 1 ? "" : "s"} ${unknown.map((block) => `"${block}"`).join(", ")}. Use any of: ${PAGE_BLOCKS.join(", ")}.`
    );
  }
  const twice = blocks.filter(
    (block, index) => blocks.indexOf(block) !== index
  );
  if (twice.length > 0) {
    problems.push(
      `Block${twice.length === 1 ? "" : "s"} ${[...new Set(twice)].map((block) => `"${block}"`).join(", ")} listed twice. Name each block once.`
    );
  }
  const navbar = blocks.indexOf("navbar");
  if (navbar > 0) {
    problems.push("The navbar goes first, above the page's main content.");
  }
  const footer = blocks.indexOf("footer");
  if (footer !== -1 && footer !== blocks.length - 1) {
    problems.push("The footer goes last, below the page's main content.");
  }
  return problems;
}

/**
 * `--blocks=<comma list>` as an ordered block list. A bad list is a refusal that names
 * each fault and the valid block names.
 */
export function parseBlockList(value: string): PageBlock[] {
  const blocks = value.split(",").map((part) => part.trim());
  const problems = blocks.includes("")
    ? [
        "The block list has an empty entry.",
        ...blockListProblems(blocks.filter(Boolean)),
      ]
    : blockListProblems(blocks);
  if (problems.length > 0) {
    throw new RefusalError(problems.join(" "));
  }
  return blocks as PageBlock[];
}

/** True when `blocks` is the base page, every block in the base order. */
export function isDefaultBlockList(blocks: readonly string[]): boolean {
  return (
    blocks.length === DEFAULT_BLOCKS.length &&
    blocks.every((block, index) => block === DEFAULT_BLOCKS[index])
  );
}

/** Check one recipe file. A bad file is a bug in the CLI, so it throws a plain Error. */
export function validateRecipe(value: unknown, file: string): Recipe {
  const fail = (why: string): never => {
    throw new Error(`templates/recipes/${file}: ${why}`);
  };
  if (typeof value !== "object" || value === null) {
    return fail("not an object.");
  }
  const raw = value as Record<string, unknown>;
  if (!isOneOf(TEMPLATE_NAMES, raw.name) || `${raw.name}.json` !== file) {
    fail(
      `"name" must be the file's own name, one of ${TEMPLATE_NAMES.join(", ")}.`
    );
  }
  for (const key of ["title", "description", "content"]) {
    if (typeof raw[key] !== "string" || raw[key] === "") {
      fail(`"${key}" must be a non-empty string.`);
    }
  }
  if (!isOneOf(THEME_NAMES, raw.theme)) {
    fail(`"theme" must be one of ${THEME_NAMES.join(", ")}.`);
  }
  if (!isOneOf(KIT_NAMES, raw.kit)) {
    fail(`"kit" must be one of ${KIT_NAMES.join(", ")}.`);
  }
  const blocks = raw.blocks;
  if (
    !Array.isArray(blocks) ||
    blocks.some((block) => typeof block !== "string")
  ) {
    return fail('"blocks" must be a list of block names.');
  }
  const problems = blockListProblems(blocks as string[]);
  if (problems.length > 0) {
    fail(problems.join(" "));
  }
  return value as Recipe;
}

/** Every template, in TEMPLATE_NAMES order, each checked. */
export const RECIPES: Readonly<Record<TemplateName, Recipe>> = {
  launch: validateRecipe(launch, "launch.json"),
  focus: validateRecipe(focus, "focus.json"),
  glow: validateRecipe(glow, "glow.json"),
};

/** The recipe of one template. */
export function readRecipe(name: TemplateName): Recipe {
  return RECIPES[name];
}

/**
 * The `saasaloy init` command that writes a page: the template, then the theme and the
 * block list when they differ from the template's own, or the whole list with no
 * template. The builder page prints it.
 */
export function initCommand(args: {
  name: string;
  template?: TemplateName;
  theme?: ThemeName;
  blocks?: readonly PageBlock[];
}): string {
  const parts = ["npx saasaloy@latest init", args.name];
  const recipe =
    args.template === undefined ? undefined : RECIPES[args.template];
  if (recipe !== undefined) {
    parts.push(`--template=${recipe.name}`);
  }
  if (args.theme !== undefined && args.theme !== recipe?.theme) {
    parts.push(`--theme=${args.theme}`);
  }
  const base = recipe?.blocks ?? DEFAULT_BLOCKS;
  if (
    args.blocks !== undefined &&
    (args.blocks.length !== base.length ||
      args.blocks.some((block, index) => block !== base[index]))
  ) {
    parts.push(`--blocks=${args.blocks.join(",")}`);
  }
  return parts.join(" ");
}

/**
 * The landing options a project's `saasaloy.json` records, for a later render: the
 * template, the kit (absent reads as `ink`) and the block list (absent reads as the base
 * page). A value this CLI does not know reads as absent, the way `readTheme` reads one.
 */
export function readLanding(config: {
  template?: string;
  kit?: string;
  blocks?: string[];
}): { template?: TemplateName; kit?: KitName; blocks?: PageBlock[] } {
  const { template, kit, blocks } = config;
  return {
    ...(template !== undefined && isTemplateName(template) ? { template } : {}),
    ...(kit !== undefined && isKitName(kit) && kit !== DEFAULT_KIT
      ? { kit }
      : {}),
    ...(blocks !== undefined && blockListProblems(blocks).length === 0
      ? { blocks: blocks as PageBlock[] }
      : {}),
  };
}
