import { defineConfig } from "oxlint";
import astro from "ultracite/oxlint/astro";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

// Run it as `oxlint -c oxlint.config.mjs` — the flag is not optional. oxlint only
// auto-discovers `.oxlintrc.json`, and a JSON config cannot `extends` Ultracite's
// presets: `extends` takes file paths, JSON only, while the presets are `.mjs`
// modules. The JS config format is experimental and needs Node.js, which this
// project already requires (>= 24).
//
// Add `ultracite/oxlint/tanstack` when an admin SPA lands, and
// `ultracite/oxlint/vitest` when the first test file does. The full preset list is
// angular, astro, core, jest, js-plugins, nestjs, next, qwik, react, remix, solid,
// svelte, tanstack, vitest, vue.

// DO NOT replace this with object spread. `{ ...core, ...react }` overwrites
// `plugins` with react's three entries and silently drops core's eight
// (eslint, typescript, unicorn, oxc, import, jsdoc, node, promise). The config
// still loads and still reports *some* violations, so it looks like it works.
// Arrays are unioned; `env` and `rules` are merged key-by-key, later preset wins.
function mergePresets(...presets) {
  const merged = {
    env: {},
    ignorePatterns: [],
    overrides: [],
    plugins: [],
    rules: {},
  };
  for (const preset of presets) {
    Object.assign(merged.env, preset.env);
    Object.assign(merged.rules, preset.rules);
    merged.ignorePatterns.push(...(preset.ignorePatterns ?? []));
    merged.overrides.push(...(preset.overrides ?? []));
    merged.plugins.push(...(preset.plugins ?? []));
  }
  merged.ignorePatterns = [...new Set(merged.ignorePatterns)];
  merged.plugins = [...new Set(merged.plugins)];
  return merged;
}

const ultracite = mergePresets(core, astro, react);

// Rules turned off for the whole project, each with its reason. Ultracite enables
// ~470, including whole families oxlint itself files under `style`, `pedantic` and
// `restriction`. These are the ones that disagree with how the code Saasaloy ships
// you is written — the base template AND every module `saasaloy add` drops in, which
// is why the list is wider than the base alone needs. Turning one back on is fine;
// expect to fix the module files it lands on.
//
// This is your config now. Keep the reasons if you edit it — a rule turned off
// without one comes back as an argument later.
const suppressed = {
  // --- Declaration shape ---------------------------------------------------
  // Ultracite prefers `const Foo = () => {}`. The vendored shadcn primitives and
  // every block here use `function` declarations, which is also what shadcn's own
  // registry emits — so turning these on means diverging from upstream on the next
  // `shadcn add`. Module files put helpers below their callers for the same reason,
  // which is the only thing `no-use-before-define` is reacting to.
  "func-style": "off",
  "no-use-before-define": "off",
  "react/function-component-definition": "off",

  // --- Comment placement ---------------------------------------------------
  // Trailing explanatory comments are the house style in everything Saasaloy ships.
  "no-inline-comments": "off",

  // --- Async shape ---------------------------------------------------------
  // Sequential awaits are deliberate where ordering matters, and `async` is kept on
  // some functions (e.g. an email provider's `send`) to satisfy an interface even
  // when that implementation has nothing to await.
  "no-await-in-loop": "off",
  "require-await": "off",

  // --- Regular expressions -------------------------------------------------
  // Adding `u` changes escape semantics and named capture groups mean rewriting
  // every index-based match access. Both are mechanical-looking edits with real
  // behaviour risk, and the email module's HTML escaping is full of them.
  "prefer-named-capture-group": "off",
  "require-unicode-regexp": "off",

  // --- Key ordering and small style ----------------------------------------
  // Props and config objects are grouped by meaning (`id`, then `title`, then the
  // data). Alphabetising them loses that ordering for no benefit. `no-plusplus` and
  // `method-signature-style` are pure preference.
  "no-plusplus": "off",
  "sort-keys": "off",
  "typescript/method-signature-style": "off",

  // --- Accessibility shape, not accessibility ------------------------------
  // Fires on `<div role="group">` and friends: the roles are correct, and swapping
  // in `<fieldset>`/`<output>` changes the markup's layout defaults. That is a
  // design decision, not a lint fix.
  "jsx-a11y/prefer-tag-over-role": "off",
};

export default defineConfig({
  ...ultracite,

  rules: {
    ...ultracite.rules,
    ...suppressed,
    // Ultracite ships `no-console: "off"`. Turn it on: a stray `console.log` in a
    // deployed Worker or a client bundle is a leak, not a log line. Add an override
    // below for any file where console output is genuinely the feature.
    "no-console": "error",
  },

  overrides: [
    ...ultracite.overrides,

    // Ultracite's core preset sets `env: { browser: true }` and nothing else, so
    // Node globals have to be added where they apply.
    {
      files: ["*.config.{js,mjs,ts}", "apps/*/*.config.{js,mjs,ts}"],
      env: { node: true },
    },

    // oxlint parses `.astro` natively — no parser wiring, no plugin chain. Both the
    // `---` frontmatter and client `<script>` blocks are linted.
    //
    // KEEP `.astro` OUT OF THE TYPE-AWARE PASS (`pnpm lint:types`). `apps/web/tsconfig.json`
    // includes the build-generated `.astro/types.d.ts`, so type-aware linting here
    // would require `astro sync` before every `pnpm lint`, including on a fresh
    // clone. That is why `lint:types` is scoped to `packages/ui/src` and the plain
    // `lint:code` pass covers everything else. Do not merge the two.
    {
      files: ["**/*.astro"],
      env: { astro: true, browser: true },
    },

    // React and Astro components are PascalCase by convention; unicorn wants
    // kebab-case for every filename.
    {
      files: ["**/*.astro", "**/*.tsx"],
      rules: { "unicorn/filename-case": "off" },
    },

    // The design system is vendored from shadcn and re-synced with
    // `pnpm --filter @repo/ui exec shadcn add …`. `Label` is a primitive: the control
    // it labels is supplied by the call site, which this rule cannot see.
    {
      files: ["packages/ui/src/components/**"],
      rules: { "jsx-a11y/label-has-associated-control": "off" },
    },

    // Console output is the whole implementation of a console-backed provider —
    // `saasaloy add email-console` lands one at `packages/email/src/providers/console.ts`.
    // Everything else that wants to log should go through a real logger.
    {
      files: ["packages/*/src/providers/console.ts", "packages/logger*/**"],
      rules: { "no-console": "off" },
    },
  ],
});
