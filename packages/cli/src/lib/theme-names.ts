// The Saasaloy UI theme names (plan 0121), apart from ./theme.ts so a reader with no
// Node built-ins can import them: ./recipes.ts checks a template's theme against this
// list, and the /ui pages read the recipes in the browser. ./theme.ts re-exports both.

export const THEME_NAMES = ["neutral", "cobalt", "ember", "moss"] as const;

export type ThemeName = (typeof THEME_NAMES)[number];
