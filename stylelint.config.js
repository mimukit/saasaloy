import ultracite from "ultracite/stylelint";

// Ultracite's Stylelint config, with the `at-rule-no-unknown` allow-list widened
// for Tailwind v4. Its list stops at tailwind/apply/layer/variants/responsive/
// screen/source/reference, and the design layer we ship
// (`packages/cli/templates/base/packages/ui/src/styles/globals.css`) also uses
// `@theme` and `@custom-variant` — so without these entries the config fails on
// the repo's only CSS file. `@plugin`, `@utility` and `@variant` are added for the
// same reason before someone reaches for them.
export default {
  ...ultracite,

  // Stylelint has no .gitignore support and its default ignore list is
  // `node_modules` only. `pnpm lint:css` globs `**/*.css`, so build output has to
  // be named here — including `.dev/`, the scaffolded playground, whose built
  // `_astro/*.css` is Tailwind's minified output and produces ~600 findings.
  // (The glob skips dot-directories today, which hides `.dev/`; do not rely on that.)
  ignoreFiles: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.astro/**",
    "**/.turbo/**",
    "**/.wrangler/**",
    ".dev/**",
  ],
  rules: {
    ...ultracite.rules,

    // `stylelint-config-standard` wants `@import url("tailwindcss")`. Tailwind v4
    // documents — and its build requires — the bare string form, so this rule is
    // pointed at the convention we actually ship rather than turned off.
    "import-notation": "string",

    // The colour tokens in `globals.css` come from shadcn verbatim, in oklch's
    // decimal form (`oklch(0.985 0 0)`). Rewriting 62 of them to `oklch(98.5% 0deg)`
    // is equivalent CSS that would then have to be re-applied by hand after every
    // upstream sync, and `scripts/verify-preset.ts` asserts on that block. Match
    // the source of truth instead.
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
