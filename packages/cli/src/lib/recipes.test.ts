import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import saasaloySchema from "../../schemas/saasaloy.schema.json" with { type: "json" };
import { isRefusal } from "./exit.js";
import {
  composeDesign,
  composeIndexAstro,
  composeLandingMarkdown,
  composeLandingMarkdownTest,
} from "./landing-compose.js";
import { kitFiles } from "./kits.js";
import {
  blockListProblems,
  DEFAULT_BLOCKS,
  initCommand,
  KIT_BLOCKS,
  KIT_NAMES,
  PAGE_BLOCKS,
  parseBlockList,
  readLanding,
  RECIPES,
  TEMPLATE_NAMES,
  validateRecipe,
} from "./recipes.js";
import type { PageBlock } from "./recipes.js";

const TEMPLATE = join(import.meta.dirname, "../../templates");

describe("the recipes", () => {
  it("ships one valid recipe file per template name", () => {
    expect(Object.keys(RECIPES)).toStrictEqual([...TEMPLATE_NAMES]);
    for (const name of TEMPLATE_NAMES) {
      expect(RECIPES[name].name).toBe(name);
      expect(RECIPES[name].content).toBe("base landing copy");
      expect(blockListProblems(RECIPES[name].blocks)).toStrictEqual([]);
    }
  });

  it("refuses a recipe with an unknown theme or block", () => {
    const glow = { ...RECIPES.glow };
    expect(() =>
      validateRecipe({ ...glow, theme: "plaid" }, "glow.json")
    ).toThrow('"theme" must be one of');
    expect(() =>
      validateRecipe({ ...glow, blocks: ["hero", "carousel"] }, "glow.json")
    ).toThrow('Unknown block "carousel"');
    expect(() => validateRecipe(glow, "focus.json")).toThrow(
      "the file's own name"
    );
  });

  it("lists the same names in saasaloy.schema.json", () => {
    const { properties } = saasaloySchema;
    expect(properties.template.enum).toStrictEqual([...TEMPLATE_NAMES]);
    expect(properties.kit.enum).toStrictEqual([...KIT_NAMES]);
    expect(properties.blocks.items.enum).toStrictEqual([...PAGE_BLOCKS]);
  });

  it("has a kit file for each block a kit names, and one ink file under it", async () => {
    for (const kit of KIT_NAMES) {
      expect([...kitFiles(kit).keys()]).toStrictEqual(
        KIT_BLOCKS[kit].map((block) => `packages/ui/src/blocks/${block}.tsx`)
      );
    }
    for (const [path, source] of kitFiles("dusk")) {
      const block = path.replace(/^packages\/ui\/src\/blocks\//, "");
      await expect(
        readFile(join(TEMPLATE, "kits/dusk/blocks", block), "utf-8")
      ).resolves.toBe(source);
      await expect(
        readFile(join(TEMPLATE, "base", path), "utf-8")
      ).resolves.toBeTruthy();
    }
  });
});

describe(parseBlockList, () => {
  it("is a refusal (exit 2) for a bad list", () => {
    let caught: unknown;
    try {
      parseBlockList("hero,nope");
    } catch (error) {
      caught = error;
    }
    expect(isRefusal(caught)).toBeTruthy();
  });

  it("refuses an empty list", () => {
    expect(() => parseBlockList("")).toThrow("empty");
  });
});

describe(readLanding, () => {
  it("reads the recorded keys and drops an unknown or default value", () => {
    expect(
      readLanding({ template: "glow", kit: "dusk", blocks: ["hero", "faq"] })
    ).toStrictEqual({ template: "glow", kit: "dusk", blocks: ["hero", "faq"] });
    expect(
      readLanding({ template: "old", kit: "ink", blocks: ["hero", "hero"] })
    ).toStrictEqual({});
    expect(readLanding({})).toStrictEqual({});
  });
});

describe(initCommand, () => {
  it("names only what differs from the template", () => {
    expect(initCommand({ name: "app", template: "glow", theme: "ember" })).toBe(
      "npx saasaloy@latest init app --template=glow"
    );
    expect(
      initCommand({
        name: "app",
        template: "focus",
        theme: "moss",
        blocks: ["hero", "cta"],
      })
    ).toBe(
      "npx saasaloy@latest init app --template=focus --theme=moss --blocks=hero,cta"
    );
    expect(initCommand({ name: "app", blocks: DEFAULT_BLOCKS })).toBe(
      "npx saasaloy@latest init app"
    );
  });
});

describe("the landing rewrites", () => {
  it("throws when the base page no longer holds a block's line", () => {
    expect(() => composeIndexAstro("<Layout>\n</Layout>\n", ["hero"])).toThrow(
      "cannot be composed"
    );
  });

  it("names the blocks and the kit in DESIGN.md", async () => {
    const design = await readFile(
      join(TEMPLATE, "base/apps/web/DESIGN.md"),
      "utf-8"
    );
    const out = composeDesign(design, {
      blocks: ["navbar", "hero", "footer"],
      kit: "dusk",
    });
    expect(out).toContain(
      "The landing page renders three blocks from `packages/ui/src/blocks/`, composed by explicit imports in `apps/web/src/pages/index.astro`: navbar, hero and footer."
    );
    expect(out).toContain("Saasaloy UI `dusk` kit");
  });
});

describe("the composed section lists", () => {
  const LISTS: (readonly PageBlock[])[] = [
    ...Object.values(RECIPES).map((recipe) => recipe.blocks),
    ["hero"],
    ["navbar", "hero", "pricing-table", "faq", "cta", "footer"],
    [...PAGE_BLOCKS].toReversed().slice(1, -1),
  ];

  it("print the way the project's Prettier does", async () => {
    const prettier = await import("prettier");
    const options = { parser: "typescript", trailingComma: "es5" } as const;
    const base = join(TEMPLATE, "base/apps/web/src/lib");
    const markdown = await readFile(join(base, "landing-markdown.ts"), "utf-8");
    const test = await readFile(
      join(base, "landing-markdown.test.ts"),
      "utf-8"
    );
    for (const blocks of LISTS) {
      const out = composeLandingMarkdown(markdown, blocks);
      await expect(prettier.format(out, options)).resolves.toBe(out);
      const outTest = composeLandingMarkdownTest(test, blocks);
      await expect(prettier.format(outTest, options)).resolves.toBe(outTest);
    }
  });
});
