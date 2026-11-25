import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import saasaloySchema from "../../schemas/saasaloy.schema.json" with { type: "json" };
import { isRefusal } from "./exit.js";
import { baseTemplateDir } from "./scaffold.js";
import { validateSaasaloyConfig } from "./schema.js";
import {
  BRAND_CSS,
  DEFAULT_THEME,
  parseThemeName,
  readTheme,
  rewriteBrandCss,
  rewriteDesign,
  THEME_NAMES,
  THEMES,
  tokenFingerprint,
  WEB_DESIGN,
} from "./theme.js";

// Plan 0121, Phase 4: the theme files in templates/themes/ and the two rewrites `init`
// runs with them. The neutral theme must give back the template byte for byte, so a
// project with no theme renders what it did before themes existed.

async function template(rel: string): Promise<string> {
  return readFile(join(await baseTemplateDir(), rel), "utf-8");
}

/** The `--name: value;` declarations of one brand.css rule, in file order. */
function declarations(css: string, selector: string): Record<string, string> {
  const escaped = selector.replaceAll(".", "\\.");
  const body = new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(
    css
  )?.[1];
  if (body === undefined) {
    throw new Error(`brand.css has no ${selector} rule`);
  }
  return Object.fromEntries(
    [...body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ])
  );
}

describe("the theme files", () => {
  it("holds neutral equal to the template's brand.css", async () => {
    const css = await template(BRAND_CSS);
    const { radius, ...light } = declarations(css, ":root");
    expect(THEMES.neutral.radius).toBe(radius);
    expect(THEMES.neutral.light).toStrictEqual(light);
    expect(THEMES.neutral.dark).toStrictEqual(declarations(css, ".dark"));
  });

  it.each(THEME_NAMES)(
    "gives %s every token brand.css declares, in light and dark",
    async (name) => {
      const css = await template(BRAND_CSS);
      const { radius: _radius, ...light } = declarations(css, ":root");
      const theme = THEMES[name];
      expect(theme.name).toBe(name);
      expect(Object.keys(theme.light)).toStrictEqual(Object.keys(light));
      expect(Object.keys(theme.dark)).toStrictEqual(
        Object.keys(declarations(css, ".dark"))
      );
      expect(theme.radius).toMatch(/^[\d.]+rem$/);
    }
  );

  it("lists the same names in saasaloy.schema.json", () => {
    expect(saasaloySchema.properties.theme.enum).toStrictEqual([
      ...THEME_NAMES,
    ]);
  });
});

describe("parseThemeName and readTheme", () => {
  it("takes each known name", () => {
    for (const name of THEME_NAMES) {
      expect(parseThemeName(name)).toBe(name);
    }
  });

  it("refuses an unknown name and lists the names", () => {
    let caught: unknown;
    try {
      parseThemeName("bogus");
    } catch (error) {
      caught = error;
    }
    expect(isRefusal(caught)).toBeTruthy();
    expect(String(caught)).toContain(
      'Unknown theme "bogus". Use one of: neutral, cobalt, ember, moss.'
    );
  });

  it("reads an absent or unknown key as neutral", () => {
    const base = { aliases: {}, installed: [] };
    expect(readTheme(base)).toBe(DEFAULT_THEME);
    expect(readTheme({ ...base, theme: "moss" })).toBe("moss");
    expect(readTheme({ ...base, theme: "bogus" })).toBe("neutral");
  });

  it("validates a theme key in saasaloy.json and refuses an unknown one", async () => {
    const base = { aliases: {}, installed: [] };
    await expect(
      validateSaasaloyConfig({ ...base, theme: "ember" })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateSaasaloyConfig({ ...base, theme: "bogus" })
    ).resolves.toMatchObject({ valid: false });
  });
});

describe(rewriteBrandCss, () => {
  it("gives back the template byte for byte for neutral", async () => {
    const css = await template(BRAND_CSS);
    expect(rewriteBrandCss(css, THEMES.neutral)).toBe(css);
  });

  it.each(THEME_NAMES)(
    "writes every %s token into :root and .dark",
    async (name) => {
      const theme = THEMES[name];
      const css = rewriteBrandCss(await template(BRAND_CSS), theme);
      expect(declarations(css, ":root")).toStrictEqual({
        radius: theme.radius,
        ...theme.light,
      });
      expect(declarations(css, ".dark")).toStrictEqual(theme.dark);
    }
  );

  it("changes only the values: comments and the @theme inline mapping stay", async () => {
    const css = await template(BRAND_CSS);
    const ember = rewriteBrandCss(css, THEMES.ember);
    const outside = (text: string) =>
      text.replaceAll(/^(\s*--[\w-]+:\s*)[^;]+;/gm, "$1;");
    expect(outside(ember)).toBe(outside(css));
    expect(ember.slice(ember.lastIndexOf("@theme inline {"))).toBe(
      css.slice(css.lastIndexOf("@theme inline {"))
    );
  });
});

describe(rewriteDesign, () => {
  it("gives back the template byte for byte for neutral", async () => {
    const css = await template(BRAND_CSS);
    const design = await template(WEB_DESIGN);
    expect(rewriteDesign(design, THEMES.neutral, css)).toBe(design);
  });

  it("records the neutral fingerprint the template ships", async () => {
    const css = await template(BRAND_CSS);
    const design = await template(WEB_DESIGN);
    expect(design).toContain(
      `tokens sha256:${tokenFingerprint(css)} of packages/ui/src/styles/brand.css`
    );
  });

  it("names the theme, its colours, its radius and the new fingerprint", async () => {
    const theme = THEMES.ember;
    const css = rewriteBrandCss(await template(BRAND_CSS), theme);
    const design = rewriteDesign(await template(WEB_DESIGN), theme, css);
    expect(design).toContain("Its theme is `ember`");
    expect(design).toContain(
      'description: "The warm ember, content-first design system'
    );
    expect(design).toContain(`  primary: "${theme.light.primary}"`);
    expect(design).toContain(`  dark-primary: "${theme.dark.primary}"`);
    expect(design).toContain("  lg: 0.875rem\n  xl: 1.125rem\n");
    expect(design).toContain("The base radius is `0.875rem`.");
    expect(design).toContain(theme.design.colors);
    expect(design).not.toContain(THEMES.neutral.design.colors);
    expect(design).toContain(
      `tokens sha256:${tokenFingerprint(css)} of packages/ui/src/styles/brand.css`
    );
  });
});
