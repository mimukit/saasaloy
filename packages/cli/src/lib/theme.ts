import { createHash } from "node:crypto";
import cobalt from "../../templates/themes/cobalt.json" with { type: "json" };
import ember from "../../templates/themes/ember.json" with { type: "json" };
import moss from "../../templates/themes/moss.json" with { type: "json" };
import neutral from "../../templates/themes/neutral.json" with { type: "json" };
import { RefusalError } from "./exit.js";
import { THEME_NAMES } from "./theme-names.js";
import type { ThemeName } from "./theme-names.js";
import type { SaasaloyConfig } from "./schema.js";

// A project's theme (plan 0121, Phase 4): one of the Saasaloy UI token sets, picked at
// `saasaloy init --theme=<name>`. A theme changes colour tokens and the radius only, so
// every block fits every theme.
//
// One source holds each theme: `templates/themes/<name>.json` (light and dark tokens, the
// radius, and the prose the seeded DESIGN.md takes). Three readers share it: this file,
// the Saasaloy UI registry build (`/r/theme-<name>.json`) and the /ui preview pages.
// `neutral.json` holds the values the template's brand.css ships with, and a test holds
// the two equal, so a neutral project renders byte for byte what it did before themes.
//
// The render applies the theme to two base files, both `once` files: brand.css (the
// `:root` and `.dark` token values and `--radius`) and apps/web/DESIGN.md (the colour
// tokens, the radius scale, the prose that names the theme and the brand.css token
// fingerprint, ADR 0027). `saasaloy.json` records a theme other than `neutral`, so a later
// render of the project's set writes the same bytes and `outdated` sees no upstream change.

export { THEME_NAMES } from "./theme-names.js";
export type { ThemeName } from "./theme-names.js";

/** The theme an absent `theme` key reads as, and the answer with no terminal. */
export const DEFAULT_THEME: ThemeName = "neutral";

/** One theme file, as `templates/themes/<name>.json` holds it. */
export interface Theme {
  name: string;
  title: string;
  description: string;
  /** The `--radius` value, in `:root`. */
  radius: string;
  /** `:root` token values, keyed by name without the `--`. */
  light: Record<string, string>;
  /** `.dark` token values, the same keys as `light`. */
  dark: Record<string, string>;
  design: {
    /** The word the DESIGN.md description and overview put before "content-first". */
    adjective: string;
    /** The first paragraph of DESIGN.md's `## Colors`. */
    colors: string;
  };
}

export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  neutral,
  cobalt,
  ember,
  moss,
};

/** The brand.css a project takes its tokens from, project-relative. */
export const BRAND_CSS = "packages/ui/src/styles/brand.css";

/** The web app's seeded design contract, project-relative. */
export const WEB_DESIGN = "apps/web/DESIGN.md";

export function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value);
}

/** The theme `value` names. Any other value is a refusal (exit 2) that lists the names. */
export function parseThemeName(value: string): ThemeName {
  if (!isThemeName(value)) {
    throw new RefusalError(
      `Unknown theme "${value}". Use one of: ${THEME_NAMES.join(", ")}.`
    );
  }
  return value;
}

/** The project's theme. A project scaffolded before the key existed reads as `neutral`. */
export function readTheme(config: SaasaloyConfig): ThemeName {
  const value = config.theme;
  return value !== undefined && isThemeName(value) ? value : DEFAULT_THEME;
}

/** The DESIGN.md token fingerprint (ADR 0027): the first 12 hex of the file's SHA-256. */
export function tokenFingerprint(content: string): string {
  return createHash("sha256")
    .update(content, "utf-8")
    .digest("hex")
    .slice(0, 12);
}

/** `values`, each written over its `--<name>: …;` declaration inside one rule body. */
function rewriteDeclarations(
  body: string,
  values: Readonly<Record<string, string>>
): string {
  return body.replaceAll(
    /^(\s*--)([\w-]+)(:\s*)([^;]+);/gm,
    (whole, lead: string, name: string, colon: string) => {
      const value = values[name];
      return value === undefined ? whole : `${lead}${name}${colon}${value};`;
    }
  );
}

/** `css` with the body of the first rule whose selector is `selector` passed through `edit`. */
function editRule(
  css: string,
  selector: string,
  edit: (body: string) => string
): string {
  const escaped = selector.replaceAll(/[.:]/g, (char) => `\\${char}`);
  return css.replace(
    new RegExp(`(^${escaped}\\s*\\{)([\\s\\S]*?)(^\\})`, "m"),
    (_whole, open: string, body: string, close: string) =>
      `${open}${edit(body)}${close}`
  );
}

/**
 * brand.css with `theme`'s token values in `:root` and `.dark`, and its `--radius`. Only
 * the values change: every comment, the order and the `@theme inline` mapping stay. A
 * token the file does not declare is left out rather than added, so an older template
 * renders what it can; a test holds the shipped template to every token.
 */
export function rewriteBrandCss(css: string, theme: Theme): string {
  const root = editRule(css, ":root", (body) =>
    rewriteDeclarations(body, { ...theme.light, radius: theme.radius })
  );
  return editRule(root, ".dark", (body) =>
    rewriteDeclarations(body, theme.dark)
  );
}

/** `0.625rem` → 0.625. A radius in any other unit is a theme file bug. */
function remOf(value: string): number {
  const match = /^([\d.]+)rem$/.exec(value);
  if (!match?.[1]) {
    throw new Error(`A theme radius must be in rem, not "${value}".`);
  }
  return Number(match[1]);
}

/** The `rounded` scale brand.css derives from `--radius`: sm, md, lg and xl, in rem. */
function roundedScale(radius: string): Record<string, string> {
  const base = remOf(radius);
  const rem = (value: number) => `${Number(value.toFixed(4))}rem`;
  return {
    sm: rem(base - 0.25),
    md: rem(base - 0.125),
    lg: rem(base),
    xl: rem(base + 0.25),
  };
}

/** The `<key>: <value>` lines of one top-level frontmatter map, passed through `edit`. */
function editFrontmatterMap(
  markdown: string,
  key: string,
  edit: (name: string, value: string) => string | undefined
): string {
  return markdown.replace(
    new RegExp(`(^${key}:\\n)((?:^ {2}\\S.*\\n)+)`, "m"),
    (_whole, head: string, body: string) =>
      head +
      body.replaceAll(
        /^( {2})([\w-]+)(: )(.*)$/gm,
        (line, indent: string, name: string, colon: string, value: string) => {
          const next = edit(name, value);
          return next === undefined ? line : `${indent}${name}${colon}${next}`;
        }
      )
  );
}

/**
 * The seeded apps/web/DESIGN.md for `theme`, given the brand.css the same render writes:
 * the colour tokens (`dark-<name>` reads the dark value), the `rounded` scale, the
 * description and overview adjective, the sentence that names the theme, the first
 * `## Colors` paragraph, the base radius sentence, and the token fingerprint of `brandCss`.
 * The neutral theme gives back the template's own text.
 */
export function rewriteDesign(
  markdown: string,
  theme: Theme,
  brandCss: string
): string {
  const neutralTheme = THEMES.neutral;
  let next = editFrontmatterMap(markdown, "colors", (name, value) => {
    const isDark = name.startsWith("dark-");
    const token = isDark ? name.slice("dark-".length) : name;
    const tokens = isDark ? theme.dark : theme.light;
    const found = tokens[token];
    return found === undefined || !value.startsWith('"')
      ? undefined
      : `"${found}"`;
  });
  const scale = roundedScale(theme.radius);
  next = editFrontmatterMap(next, "rounded", (name) => scale[name]);
  const adjective = (text: string) =>
    text.replace(
      `The ${neutralTheme.design.adjective}, content-first`,
      `The ${theme.design.adjective}, content-first`
    );
  next = next.replace(
    /^(description: ")(.*)(")$/m,
    (_whole, open: string, text: string, close: string) =>
      `${open}${adjective(text)}${close}`
  );
  next = next
    .replace(
      `The base uses a ${neutralTheme.design.adjective}, content-first system.`,
      `The base uses a ${theme.design.adjective}, content-first system.`
    )
    .replace(/Its theme is `[a-z]+`/, `Its theme is \`${theme.name}\``)
    .replace(neutralTheme.design.colors, theme.design.colors)
    .replace(
      /The base radius is `[\d.]+rem`\./,
      `The base radius is \`${theme.radius}\`.`
    )
    .replace(
      /tokens sha256:[a-f0-9]{12} of packages\/ui\/src\/styles\/brand\.css/,
      `tokens sha256:${tokenFingerprint(brandCss)} of packages/ui/src/styles/brand.css`
    );
  return next;
}
