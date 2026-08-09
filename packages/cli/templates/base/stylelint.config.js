import ultracite from "ultracite/stylelint";

// Ultracite's Stylelint config with the at-rule allow-list widened for Tailwind v4.
// Its list stops at tailwind/apply/layer/variants/responsive/screen/source/reference,
// and `packages/ui/src/styles/globals.css` also uses `@theme` and `@custom-variant`,
// so without these entries the config fails on the only CSS file you ship.
//
// The notation rules match shadcn's own output: its colour tokens are written
// `oklch(0.985 0 0)`, and rewriting them to `oklch(98.5% 0deg)` would have to be
// redone by hand after every `shadcn add` sync.
export default {
  ...ultracite,

  // Stylelint has no .gitignore support and its default ignore list is
  // `node_modules` only, so build output has to be named here. `pnpm lint:css`
  // globs `**/*.css`, which after a `pnpm build` would otherwise walk into
  // `apps/*/dist/_astro/*.css` — Tailwind's minified output, ~600 findings of
  // "violations" in code nobody wrote.
  ignoreFiles: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.astro/**",
    "**/.turbo/**",
    "**/.wrangler/**",
  ],
  rules: {
    ...ultracite.rules,
    "import-notation": "string",
    "hue-degree-notation": "number",
    "lightness-notation": "number",
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          ...ultracite.rules["at-rule-no-unknown"][1].ignoreAtRules,
          "custom-variant",
          "plugin",
          "theme",
          "utility",
          "variant",
        ],
      },
    ],
  },
};
