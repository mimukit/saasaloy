// The state of the Saasaloy UI builder (/ui/builder, plan 0121, Phase 7): a template, a
// theme and an ordered block list. The template names the kit, so the builder shows each
// block's kit the way `saasaloy init --template` writes it. Every function here is pure,
// so the builder island, the composed preview frame (/ui/preview/page) and the tests read
// one set of rules.
//
// The state lives in the page URL (`?template=&theme=&blocks=`), so a link reproduces the
// builder. The command the builder prints is the CLI's own `initCommand`, from
// packages/cli/src/lib/recipes.ts, the same reader `init` uses. That keeps the copied
// command and the preview on one definition of a template.

import {
  blockListProblems,
  initCommand,
  isTemplateName,
  KIT_BLOCKS,
  PAGE_BLOCKS,
  RECIPES,
} from "../../../../packages/cli/src/lib/recipes.ts";
import type {
  KitName,
  PageBlock,
  TemplateName,
} from "../../../../packages/cli/src/lib/recipes.ts";
import { THEME_NAMES } from "../../../../packages/cli/src/lib/theme-names.ts";
import type { ThemeName } from "../../../../packages/cli/src/lib/theme-names.ts";

export {
  KIT_BLOCKS,
  PAGE_BLOCKS,
  RECIPES,
  TEMPLATE_NAMES,
} from "../../../../packages/cli/src/lib/recipes.ts";
export type {
  KitName,
  PageBlock,
  TemplateName,
} from "../../../../packages/cli/src/lib/recipes.ts";
export { THEME_NAMES } from "../../../../packages/cli/src/lib/theme-names.ts";
export type { ThemeName } from "../../../../packages/cli/src/lib/theme-names.ts";

export interface BuilderState {
  template: TemplateName;
  theme: ThemeName;
  blocks: readonly PageBlock[];
}

/** The template the builder opens with when the URL names none. */
export const DEFAULT_TEMPLATE: TemplateName = "launch";

/** The project name the printed command uses. */
export const PROJECT_NAME = "my-app";

/**
 * The anchor each navbar link points at, keyed by the block it links to. A composed page
 * blanks the label of a block it leaves out (landing-compose.ts), so the preview hides
 * the link to `/#<anchor>` for that block.
 */
export const NAV_ANCHORS: Readonly<Partial<Record<PageBlock, string>>> = {
  "how-it-works": "how-it-works",
  "feature-grid": "features",
  showcase: "showcase",
  "pricing-table": "pricing",
  faq: "faq",
};

function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value);
}

/** A template's own page: its theme and its block list. */
export function templateState(template: TemplateName): BuilderState {
  const recipe = RECIPES[template];
  return { template, theme: recipe.theme, blocks: [...recipe.blocks] };
}

/**
 * The state a URL query holds. A missing or unknown template reads as `launch`; a missing
 * or unknown theme, or a block list `init` would refuse, reads as the template's own.
 */
export function parseBuilderQuery(
  search: string | URLSearchParams
): BuilderState {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const named = params.get("template") ?? "";
  const template = isTemplateName(named) ? named : DEFAULT_TEMPLATE;
  const state = templateState(template);
  const theme = params.get("theme") ?? "";
  const blocksText = params.get("blocks");
  const blocks =
    blocksText === null
      ? undefined
      : blocksText.split(",").map((part) => part.trim());
  return {
    template,
    theme: isThemeName(theme) ? theme : state.theme,
    blocks:
      blocks !== undefined && blockListProblems(blocks).length === 0
        ? (blocks as PageBlock[])
        : state.blocks,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * The query of the builder page: the template, then the theme and the block list only
 * when they differ from the template's, the same rule the command follows.
 */
export function builderQuery(state: BuilderState): string {
  const recipe = RECIPES[state.template];
  const params = new URLSearchParams({ template: state.template });
  if (state.theme !== recipe.theme) {
    params.set("theme", state.theme);
  }
  if (!sameList(state.blocks, recipe.blocks)) {
    params.set("blocks", state.blocks.join(","));
  }
  return params.toString().replaceAll("%2C", ",");
}

/** The query of the composed preview frame. It always names all three values. */
export function previewQuery(state: BuilderState): string {
  return new URLSearchParams({
    template: state.template,
    theme: state.theme,
    blocks: state.blocks.join(","),
  })
    .toString()
    .replaceAll("%2C", ",");
}

/** The command the builder prints: `saasaloy init` for the state, from the CLI's reader. */
export function builderCommand(state: BuilderState): string {
  return initCommand({
    name: PROJECT_NAME,
    template: state.template,
    theme: state.theme,
    blocks: state.blocks,
  });
}

/** The kit `init` writes a block from: the template's kit when it ships the block. */
export function blockKit(template: TemplateName, block: PageBlock): KitName {
  const { kit } = RECIPES[template];
  return KIT_BLOCKS[kit].includes(block) ? kit : "ink";
}

/** True when the block at `index` may move by `step` (-1 up, 1 down). */
export function canMove(
  blocks: readonly PageBlock[],
  index: number,
  step: -1 | 1
): boolean {
  const block = blocks[index];
  const target = blocks[index + step];
  if (block === undefined || target === undefined) {
    return false;
  }
  // The navbar stays first and the footer stays last, the rule `--blocks` holds.
  const framed = (name: PageBlock) => name === "navbar" || name === "footer";
  return !framed(block) && !framed(target);
}

/** The state with the block at `index` moved by `step`, or the same state. */
export function moveBlock(
  state: BuilderState,
  index: number,
  step: -1 | 1
): BuilderState {
  if (!canMove(state.blocks, index, step)) {
    return state;
  }
  const blocks = [...state.blocks];
  const [block] = blocks.splice(index, 1);
  if (block === undefined) {
    return state;
  }
  blocks.splice(index + step, 0, block);
  return { ...state, blocks };
}

/** True when a block may be removed: the page keeps at least one block. */
export function canRemove(blocks: readonly PageBlock[]): boolean {
  return blocks.length > 1;
}

/** The state without the block at `index`, or the same state. */
export function removeBlock(state: BuilderState, index: number): BuilderState {
  if (!canRemove(state.blocks) || state.blocks[index] === undefined) {
    return state;
  }
  return { ...state, blocks: state.blocks.filter((_, at) => at !== index) };
}

/** The blocks not on the page, in the base page's order. */
export function addableBlocks(blocks: readonly PageBlock[]): PageBlock[] {
  return PAGE_BLOCKS.filter((block) => !blocks.includes(block));
}

/**
 * The state with `block` added: a navbar goes first, a footer last, and any other block
 * just above the footer, or at the end of a page with no footer.
 */
export function addBlock(state: BuilderState, block: PageBlock): BuilderState {
  if (state.blocks.includes(block)) {
    return state;
  }
  const blocks = [...state.blocks];
  if (block === "navbar") {
    blocks.unshift(block);
  } else if (block === "footer") {
    blocks.push(block);
  } else {
    const footer = blocks.indexOf("footer");
    blocks.splice(footer === -1 ? blocks.length : footer, 0, block);
  }
  return { ...state, blocks };
}

/** The navbar anchors of the blocks a page leaves out. */
export function hiddenNavAnchors(blocks: readonly PageBlock[]): string[] {
  return PAGE_BLOCKS.flatMap((block) => {
    const anchor = NAV_ANCHORS[block];
    return anchor === undefined || blocks.includes(block) ? [] : [anchor];
  });
}
