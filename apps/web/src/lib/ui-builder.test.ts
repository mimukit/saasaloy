import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  initCommand,
  KIT_BLOCKS,
  PAGE_BLOCK_INFO,
  parseBlockList,
} from "../../../../packages/cli/src/lib/recipes.ts";
import {
  addableBlocks,
  addBlock,
  blockKit,
  builderCommand,
  builderQuery,
  canMove,
  hiddenNavAnchors,
  moveBlock,
  NAV_ANCHORS,
  PAGE_BLOCKS,
  parseBuilderQuery,
  previewQuery,
  PROJECT_NAME,
  RECIPES,
  removeBlock,
  TEMPLATE_NAMES,
  templateState,
} from "./ui-builder.ts";
import type { BuilderState } from "./ui-builder.ts";

/** The value of `--<flag>=` in a command, or undefined. */
function flag(command: string, name: string): string | undefined {
  return command
    .split(" ")
    .find((part) => part.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

const edited: BuilderState = {
  template: "glow",
  theme: "moss",
  blocks: ["navbar", "faq", "hero", "pricing-table", "footer"],
};

const states: BuilderState[] = [
  ...TEMPLATE_NAMES.map((name) => templateState(name)),
  edited,
  { template: "launch", theme: "cobalt", blocks: ["hero"] },
  { template: "focus", theme: "ember", blocks: [...RECIPES.focus.blocks] },
];

describe("builderCommand", () => {
  for (const state of states) {
    it(`equals initCommand and round-trips for ${previewQuery(state)}`, () => {
      const command = builderCommand(state);
      assert.equal(
        command,
        initCommand({
          name: PROJECT_NAME,
          template: state.template,
          theme: state.theme,
          blocks: state.blocks,
        })
      );
      const recipe = RECIPES[state.template];
      assert.equal(flag(command, "template"), state.template);
      assert.equal(flag(command, "theme") ?? recipe.theme, state.theme);
      const blocks = flag(command, "blocks");
      assert.deepEqual(
        blocks === undefined ? recipe.blocks : parseBlockList(blocks),
        state.blocks
      );
    });
  }

  it("prints every flag that differs from the template", () => {
    assert.equal(
      builderCommand(edited),
      "npx saasaloy@latest init my-app --template=glow --theme=moss --blocks=navbar,faq,hero,pricing-table,footer"
    );
    assert.equal(
      builderCommand(templateState("focus")),
      "npx saasaloy@latest init my-app --template=focus"
    );
  });
});

describe("parseBuilderQuery", () => {
  for (const state of states) {
    it(`reads back builderQuery and previewQuery for ${previewQuery(state)}`, () => {
      assert.deepEqual(parseBuilderQuery(builderQuery(state)), state);
      assert.deepEqual(parseBuilderQuery(previewQuery(state)), state);
    });
  }

  it("keeps commas readable in the query", () => {
    assert.equal(
      builderQuery(edited),
      "template=glow&theme=moss&blocks=navbar,faq,hero,pricing-table,footer"
    );
  });

  it("opens launch when the URL names no template or an unknown one", () => {
    assert.deepEqual(parseBuilderQuery(""), templateState("launch"));
    assert.deepEqual(parseBuilderQuery("?template=nope&theme=ember"), {
      ...templateState("launch"),
      theme: "ember",
    });
  });

  it("takes the template's theme and blocks for an unknown theme or a bad list", () => {
    const glow = templateState("glow");
    assert.deepEqual(parseBuilderQuery("template=glow&theme=pink"), glow);
    for (const blocks of [
      "",
      "hero,,faq",
      "hero,hero",
      "hero,navbar",
      "footer,hero",
      "hero,banner",
    ]) {
      assert.deepEqual(
        parseBuilderQuery(`template=glow&blocks=${blocks}`),
        glow,
        blocks
      );
    }
  });
});

describe("block list edits", () => {
  const focus = templateState("focus");

  it("moves a block and keeps the navbar first and the footer last", () => {
    assert.deepEqual(moveBlock(focus, 2, -1).blocks, [
      "navbar",
      "feature-grid",
      "hero",
      "pricing-table",
      "cta",
      "footer",
    ]);
    assert.equal(canMove(focus.blocks, 1, -1), false);
    assert.equal(canMove(focus.blocks, 4, 1), false);
    assert.equal(canMove(focus.blocks, 0, 1), false);
    assert.equal(moveBlock(focus, 1, -1), focus);
  });

  it("removes a block but never the last one", () => {
    assert.deepEqual(removeBlock(focus, 0).blocks, focus.blocks.slice(1));
    const one = { ...focus, blocks: ["hero"] as const };
    assert.equal(removeBlock(one, 0), one);
  });

  it("adds a block above the footer, a navbar first and a footer last", () => {
    assert.deepEqual(addBlock(focus, "faq").blocks, [
      "navbar",
      "hero",
      "feature-grid",
      "pricing-table",
      "cta",
      "faq",
      "footer",
    ]);
    const bare = { ...focus, blocks: ["hero"] as const };
    assert.deepEqual(addBlock(bare, "navbar").blocks, ["navbar", "hero"]);
    assert.deepEqual(addBlock(bare, "footer").blocks, ["hero", "footer"]);
    assert.deepEqual(addBlock(bare, "cta").blocks, ["hero", "cta"]);
    assert.deepEqual(addableBlocks(RECIPES.launch.blocks), []);
    assert.deepEqual(addableBlocks(focus.blocks), [
      "logo-cloud",
      "pain-points",
      "how-it-works",
      "showcase",
      "audience",
      "testimonials",
      "faq",
    ]);
  });

  it("gives every edit a list that init accepts", () => {
    let state = templateState("glow");
    state = removeBlock(state, 2);
    state = moveBlock(state, 4, -1);
    state = addBlock(state, "showcase");
    assert.deepEqual(parseBlockList(state.blocks.join(",")), state.blocks);
  });
});

describe("blockKit", () => {
  it("takes the template's kit for the blocks the kit ships, else ink", () => {
    for (const name of TEMPLATE_NAMES) {
      const { kit } = RECIPES[name];
      for (const block of PAGE_BLOCKS) {
        assert.equal(
          blockKit(name, block),
          KIT_BLOCKS[kit].includes(block) ? kit : "ink"
        );
      }
    }
    assert.equal(blockKit("glow", "hero"), "dusk");
    assert.equal(blockKit("glow", "navbar"), "ink");
    assert.equal(blockKit("launch", "hero"), "ink");
  });
});

describe("navbar anchors", () => {
  it("names one anchor for each block whose navbar label a composed page blanks", () => {
    assert.deepEqual(
      Object.keys(NAV_ANCHORS).toSorted(),
      PAGE_BLOCKS.filter(
        (block) => PAGE_BLOCK_INFO[block].navLabel !== undefined
      ).toSorted()
    );
    const navbar = readFileSync(
      new URL(
        "../../../../packages/cli/templates/base/packages/ui/src/blocks/navbar.tsx",
        import.meta.url
      ),
      "utf-8"
    );
    for (const [block, anchor] of Object.entries(NAV_ANCHORS)) {
      const label =
        PAGE_BLOCK_INFO[block as keyof typeof PAGE_BLOCK_INFO].navLabel;
      assert.match(
        navbar,
        new RegExp(`label: landing\\.navbar\\.${label}, href: "/#${anchor}"`)
      );
    }
  });

  it("hides the links of the blocks a page leaves out", () => {
    assert.deepEqual(hiddenNavAnchors(RECIPES.focus.blocks), [
      "how-it-works",
      "showcase",
      "faq",
    ]);
    assert.deepEqual(hiddenNavAnchors(RECIPES.launch.blocks), []);
  });
});

describe("the composed preview page", () => {
  it("pre-renders every page block of every kit once", () => {
    const page = readFileSync(
      new URL("../pages/ui/preview/page.astro", import.meta.url),
      "utf-8"
    );
    const rendered = [
      ...page.matchAll(/data-compose-block="([^"]+)" data-kit="([^"]+)"/g),
    ].map((match) => `${match[2]}/${match[1]}`);
    const expected = [
      ...PAGE_BLOCKS.map((block) => `ink/${block}`),
      ...Object.entries(KIT_BLOCKS).flatMap(([kit, blocks]) =>
        blocks.map((block) => `${kit}/${block}`)
      ),
    ];
    assert.deepEqual(rendered.toSorted(), expected.toSorted());
  });
});
