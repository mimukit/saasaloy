// The Saasaloy UI themes (plan 0121, Phase 4), read from the one theme source the CLI
// ships: packages/cli/templates/themes/<name>.json (light and dark tokens and the
// radius). `saasaloy init --theme=<name>` writes the same files into a project's
// brand.css, so the registry item, the /ui pages and a new project hold one set of values.
//
// Three readers use this file: the registry build (`themeItem`, written to
// /r/theme-<name>.json), the /ui/themes page and the block page (`themeRules`, scoped
// variables for a sample), and the preview frame (`themeRules` on its <html>). It imports
// only JSON, so Node runs it in the registry build and Vite in the site.

import cobalt from "../../../../packages/cli/templates/themes/cobalt.json" with { type: "json" };
import ember from "../../../../packages/cli/templates/themes/ember.json" with { type: "json" };
import moss from "../../../../packages/cli/templates/themes/moss.json" with { type: "json" };
import neutral from "../../../../packages/cli/templates/themes/neutral.json" with { type: "json" };

/** One theme file. */
export interface UiTheme {
  name: string;
  title: string;
  description: string;
  radius: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** The themes in the order every page lists them: neutral first, the default. */
export const UI_THEMES: readonly UiTheme[] = [neutral, cobalt, ember, moss];

/** The theme a page shows before the reader picks one. */
export const DEFAULT_UI_THEME = "neutral";

/** The registry name of a theme: `theme-ember`. */
export function themeItemName(theme: Pick<UiTheme, "name">): string {
  return `theme-${theme.name}`;
}

/** The command that installs a theme into a shadcn project. */
export function themeCommand(theme: Pick<UiTheme, "name">): string {
  return `npx shadcn@latest add @saasaloy/${themeItemName(theme)}`;
}

/**
 * The `registry:theme` item of a theme. shadcn merges `light` into `:root` and `dark`
 * into `.dark` of the file components.json names, which is brand.css in a Saasaloy
 * project. The radius goes into `light`, beside the colours, because brand.css declares
 * `--radius` in `:root`; shadcn adds the `--radius-*` steps to `@theme inline` from it.
 */
export function themeItem(theme: UiTheme): Record<string, unknown> {
  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: themeItemName(theme),
    type: "registry:theme",
    title: `${theme.title} theme`,
    description: `${theme.description} Changes colour tokens and the radius only, so every Saasaloy UI block fits it.`,
    author: "Saasaloy <https://saasaloy.com>",
    cssVars: {
      light: { radius: theme.radius, ...theme.light },
      dark: { ...theme.dark },
    },
  };
}

function declarations(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
}

/**
 * CSS rules that set a theme's variables on `light` and `dark` selectors: the light
 * tokens and the radius on the first, the dark tokens on the second. Tailwind's
 * `@theme inline` mapping reads the variables where a utility applies, so `bg-primary`
 * under the selector takes the theme's colour.
 */
export function themeRules(
  theme: UiTheme,
  selectors: { light: string; dark: string }
): string {
  return [
    `${selectors.light}{${declarations({ ...theme.light, radius: theme.radius })}}`,
    `${selectors.dark}{${declarations(theme.dark)}}`,
  ].join("\n");
}
