import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readManifestState } from "../engine/manifest.js";
import { readProjectState } from "../engine/project.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { kitFiles } from "../lib/kits.js";
import { RECIPES } from "../lib/recipes.js";
import { THEMES } from "../lib/theme.js";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, resolveInitLanding, runInit } from "./init.js";

// `init --template` and `init --blocks` (plan 0121, Phase 7): the flags are checked before
// a byte is written, and a scaffold writes the kit's blocks, the template's theme, a
// composed index.astro and the matching LANDING_SECTIONS, all recorded in the manifest.

const ORIGINAL_CWD = process.cwd();
const TEMPLATE = join(import.meta.dirname, "../../templates/base");

const INDEX = "apps/web/src/pages/index.astro";
const MARKDOWN = "apps/web/src/lib/landing-markdown.ts";
const MARKDOWN_TEST = "apps/web/src/lib/landing-markdown.test.ts";
const LANDING = "packages/ui/src/content/landing.ts";
const BRAND = "packages/ui/src/styles/brand.css";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-init-landing-"));
  process.chdir(dir);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(dir, { recursive: true, force: true });
});

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  try {
    return { code: await runInit(argv), out: lines.join("") };
  } finally {
    process.stdout.write = originalWrite;
  }
}

/** The components index.astro renders, in page order. */
function pageOrder(index: string): string[] {
  const body = index.slice(index.indexOf("<Layout"));
  return [...body.matchAll(/^\s*<([A-Z]\w+)\b[^\n]*\/>$/gm)].map(
    (match) => match[1] ?? ""
  );
}

/** The LANDING_SECTIONS list of landing-markdown.ts. */
function sections(markdown: string): string[] {
  const body =
    /export const LANDING_SECTIONS: readonly LandingSection\[\] = \[([\s\S]*?)\];/.exec(
      markdown
    )?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("init — parseArgs reads --template and --blocks raw", () => {
  it("keeps both values for runInit to check", () => {
    expect(
      parseArgs(["app", "--template=glow", "--blocks=navbar,hero"])
    ).toMatchObject({ blocks: "navbar,hero", template: "glow", unknown: [] });
  });

  it("leaves both unset when the flags are absent", () => {
    const opts = parseArgs(["app"]);
    expect(opts.template).toBeUndefined();
    expect(opts.blocks).toBeUndefined();
  });
});

describe(resolveInitLanding, () => {
  it("takes the kit, the theme and the blocks from a template", () => {
    expect(resolveInitLanding("glow")).toStrictEqual({
      blocks: RECIPES.glow.blocks,
      kit: "dusk",
      template: "glow",
      theme: "ember",
    });
  });

  it("lets --blocks replace the template's list and order", () => {
    expect(resolveInitLanding("glow", "hero,faq")).toMatchObject({
      blocks: ["hero", "faq"],
      kit: "dusk",
    });
  });

  it("takes the ink kit and no theme for --blocks with no template", () => {
    expect(
      resolveInitLanding(undefined, " navbar, hero ,footer")
    ).toStrictEqual({ blocks: ["navbar", "hero", "footer"], kit: "ink" });
  });

  it("refuses an unknown template and lists the names", () => {
    expect(() => resolveInitLanding("shiny")).toThrow(
      'Unknown template "shiny". Use one of: launch, focus, glow.'
    );
  });

  it("refuses an unknown block and lists the block names", () => {
    expect(() => resolveInitLanding(undefined, "hero,carousel")).toThrow(
      /Unknown block "carousel"\. Use any of: navbar, hero, logo-cloud, .*, footer\./
    );
  });

  it("refuses a block named twice", () => {
    expect(() => resolveInitLanding(undefined, "hero,faq,hero")).toThrow(
      'Block "hero" listed twice.'
    );
  });

  it("refuses a navbar that is not first, a footer that is not last, and an empty entry", () => {
    expect(() => resolveInitLanding(undefined, "hero,navbar")).toThrow(
      "The navbar goes first"
    );
    expect(() => resolveInitLanding(undefined, "footer,hero")).toThrow(
      "The footer goes last"
    );
    expect(() => resolveInitLanding(undefined, "hero,,faq")).toThrow(
      "empty entry"
    );
  });
});

describe("runInit — refuses a bad landing flag before anything is written", () => {
  it("refuses an unknown template", async () => {
    const { code, out } = await run([
      "landing-bogus",
      "--template=bogus",
      "--no-install",
      "--no-git",
    ]);
    expect(code).toBe(2);
    expect(out).toContain('Unknown template "bogus"');
    await expect(pathExists(join(dir, "landing-bogus"))).resolves.toBeFalsy();
  });

  it("refuses a duplicate block", async () => {
    const { code, out } = await run([
      "landing-twice",
      "--blocks=hero,hero",
      "--no-install",
      "--no-git",
    ]);
    expect(code).toBe(2);
    expect(out).toContain('Block "hero" listed twice.');
    await expect(pathExists(join(dir, "landing-twice"))).resolves.toBeFalsy();
  });
});

describe("runInit — a template and a custom block list", () => {
  async function scaffold(project: string, flags: string[]) {
    const target = join(dir, project);
    const { code, out } = await run([
      project,
      "--no-install",
      "--no-git",
      ...flags,
    ]);
    const read = (rel: string) => readFile(join(target, rel), "utf-8");
    return { code, out, target, read };
  }

  async function expectManifestMatchesDisk(target: string): Promise<void> {
    const state = await readManifestState(target);
    const entries = state.kind === "v2" ? state.manifest.files : {};
    expect(Object.keys(entries).length).toBeGreaterThan(0);
    for (const [rel, entry] of Object.entries(entries)) {
      const onDisk = await readFile(join(target, ...rel.split("/")), "utf-8");
      expect(entry.hash, `${rel} hash`).toBe(hashContent(onDisk));
    }
  }

  it("writes the glow template: dusk blocks, ember tokens, the page in order", async () => {
    const result = await scaffold("landing-glow", ["--template=glow"]);
    try {
      expect(result.code).toBe(0);
      // The kit swap: each dusk file replaces the ink file of the same name.
      for (const [path, source] of kitFiles("dusk")) {
        await expect(result.read(path)).resolves.toBe(source);
      }
      // A block the kit does not ship stays ink.
      await expect(
        result.read("packages/ui/src/blocks/navbar.tsx")
      ).resolves.toBe(
        await readFile(
          join(TEMPLATE, "packages/ui/src/blocks/navbar.tsx"),
          "utf-8"
        )
      );
      await expect(result.read(BRAND)).resolves.toContain(
        `--primary: ${THEMES.ember.light.primary};`
      );
      const index = await result.read(INDEX);
      expect(pageOrder(index)).toStrictEqual([
        "Navbar",
        "Hero",
        "LogoCloud",
        "FeatureGrid",
        "Testimonials",
        "PricingTable",
        "Faq",
        "Cta",
        "Footer",
      ]);
      expect(index).toContain("<Navbar client:idle siteName={siteName} />");
      expect(index).toContain(
        "<PricingTable client:visible siteName={siteName} />"
      );
      expect(index).toContain('<main id="main" tabindex="-1">');
      expect(index).not.toContain("PainPoints");
      expect(sections(await result.read(MARKDOWN))).toStrictEqual([
        "hero",
        "logos",
        "features",
        "testimonials",
        "pricing",
        "faq",
        "cta",
      ]);
      // The page dropped how-it-works and showcase, so their navbar links go too.
      const landing = await result.read(LANDING);
      expect(landing).toContain('linkHowItWorks: "",');
      expect(landing).toContain('linkShowcase: "",');
      expect(landing).toContain('linkFeatures: "Features",');
      // The dropped block files stay, for a section added back later.
      await expect(
        pathExists(join(result.target, "packages/ui/src/blocks/showcase.tsx"))
      ).resolves.toBeTruthy();
      const config = JSON.parse(await result.read("saasaloy.json")) as Record<
        string,
        unknown
      >;
      expect(config).toMatchObject({
        blocks: RECIPES.glow.blocks,
        kit: "dusk",
        template: "glow",
        theme: "ember",
      });
      await expectManifestMatchesDisk(result.target);
      // A later render reads the same options back, so `outdated` agrees with the disk.
      const state = await readProjectState(result.target);
      expect(state.options).toMatchObject({
        blocks: RECIPES.glow.blocks,
        kit: "dusk",
        template: "glow",
        theme: "ember",
      });
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });

  it("writes a custom --blocks list over the launch template, and --theme wins", async () => {
    const result = await scaffold("landing-custom", [
      "--template=launch",
      "--theme=moss",
      "--blocks=navbar,hero,pricing-table,faq,cta,footer",
    ]);
    try {
      expect(result.code).toBe(0);
      expect(pageOrder(await result.read(INDEX))).toStrictEqual([
        "Navbar",
        "Hero",
        "PricingTable",
        "Faq",
        "Cta",
        "Footer",
      ]);
      expect(sections(await result.read(MARKDOWN))).toStrictEqual([
        "hero",
        "pricing",
        "faq",
        "cta",
      ]);
      const test = await result.read(MARKDOWN_TEST);
      expect(test).toContain(
        'it("lists the same sections as index.astro", () => {'
      );
      // Short enough for one line, as Prettier prints it in the project.
      expect(test).toContain(
        '    expect(LANDING_SECTIONS).toStrictEqual(["hero", "pricing", "faq", "cta"]);\n'
      );
      await expect(result.read(BRAND)).resolves.toContain(
        `--primary: ${THEMES.moss.light.primary};`
      );
      // Launch is the ink kit: the hero is the template's own file.
      await expect(
        result.read("packages/ui/src/blocks/hero.tsx")
      ).resolves.toBe(
        await readFile(
          join(TEMPLATE, "packages/ui/src/blocks/hero.tsx"),
          "utf-8"
        )
      );
      const config = JSON.parse(await result.read("saasaloy.json")) as Record<
        string,
        unknown
      >;
      expect(config.template).toBe("launch");
      expect(config.theme).toBe("moss");
      expect(config.kit).toBeUndefined();
      expect(config.blocks).toStrictEqual([
        "navbar",
        "hero",
        "pricing-table",
        "faq",
        "cta",
        "footer",
      ]);
      await expectManifestMatchesDisk(result.target);
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });

  it("writes the base page byte for byte and no landing key with no flag", async () => {
    const result = await scaffold("landing-default", []);
    try {
      expect(result.code).toBe(0);
      for (const rel of [INDEX, MARKDOWN, MARKDOWN_TEST, LANDING]) {
        await expect(result.read(rel)).resolves.toBe(
          await readFile(join(TEMPLATE, rel), "utf-8")
        );
      }
      const config = JSON.parse(await result.read("saasaloy.json")) as Record<
        string,
        unknown
      >;
      expect(Object.keys(config)).not.toContain("template");
      expect(Object.keys(config)).not.toContain("kit");
      expect(Object.keys(config)).not.toContain("blocks");
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });
});
