import { defineConfig } from "oxlint";
import astro from "ultracite/oxlint/astro";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

// oxlint config for the tool repo. Run it as `oxlint -c oxlint.config.mjs` — the
// flag is not optional. oxlint only auto-discovers `.oxlintrc.json`, and a JSON
// config cannot `extends` Ultracite's presets: `extends` takes file paths, JSON
// only, while the presets are `.mjs` modules. The JS config format is marked
// experimental by oxlint and requires Node.js, which we already require (>= 24).
// The fallback if it ever breaks is a generated JSON snapshot of the composed
// rules — a frozen copy that drifts from Ultracite silently — so keep this path
// working rather than freezing it. See ADR 0025.
//
// `pnpm lint` runs this config TWICE, and the split is by invocation because
// `--type-aware` is a global CLI switch with no config key and no per-override
// control. See package.json and the Astro note below.

// ---------------------------------------------------------------------------
// Preset composition
// ---------------------------------------------------------------------------
// DO NOT replace this with object spread. `{ ...core, ...react }` overwrites
// `plugins` with react's three entries and silently drops core's eight
// (eslint, typescript, unicorn, oxc, import, jsdoc, node, promise). The config
// still loads and still reports *some* violations, so it looks like it works —
// the exact silent-success failure this repo adopted a linter to delete. Arrays
// are unioned; `env` and `rules` are merged key-by-key, later preset wins.
//
// Assert it after any change here: plant `new Array(1)` in a `.ts` file and
// confirm `unicorn/no-new-array` fires. If it doesn't, the merge is broken.
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

// `astro` contributes an empty `rules` object in ultracite 7.10.x — composed
// anyway because it is forward-compatible and costs nothing. Real `.astro`
// coverage comes from oxlint's native parser, not from this preset.
const ultracite = mergePresets(core, astro, react, tanstack, vitest);

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------
// Ultracite turns on ~470 rules, including whole families oxlint itself files
// under `style`, `pedantic` and `restriction`. This repo had never been linted,
// so first contact produced ~670 findings. Everything oxlint could fix safely was
// fixed (`oxlint --fix`); what stays off is listed here with its reason, per the
// linter-adoption plan's "fix it or suppress it explicitly" rule.
//
// Nothing switched off here is one of ESLint's Possible Problems, and nothing here
// is switched off globally when a narrower home exists: `no-control-regex` is
// suppressed at its two call sites with `oxlint-disable-next-line`, and
// `typescript/return-await` is retuned to `in-try-catch` below rather than dropped.
// Deleting an entry in this block should produce churn, not bugs — if that ever
// stops being true of one of them, it belongs somewhere else, not here.
//
// Re-litigating one of these is welcome. Do it by fixing the code the rule
// objects to, not by quietly widening the block.
const suppressed = {
  // --- Declaration shape ---------------------------------------------------
  // Ultracite prefers `const f = () => {}`. This repo consistently uses hoisted
  // `function` declarations and puts helpers *below* their callers so each file
  // reads top-down. Those two choices are the same choice; `no-use-before-define`
  // only fires because the hoisting is deliberate.
  "func-style": "off",
  "no-use-before-define": "off",
  "react/function-component-definition": "off",

  // --- Comment placement ---------------------------------------------------
  // Trailing explanatory comments are house style throughout the CLI and the
  // shipped modules, and several carry the only record of a subtle decision.
  "no-inline-comments": "off",

  // --- Sequential async is deliberate --------------------------------------
  // The CLI writes files, prompts, and hits the registry in a fixed order; the
  // maintainer scripts honour npm rate limits. `Promise.all` is not a drop-in
  // here, and `async` is kept on some functions for interface consistency.
  "no-await-in-loop": "off",
  "promise/avoid-new": "off",
  "promise/param-names": "off",
  "promise/prefer-await-to-callbacks": "off",
  "promise/prefer-await-to-then": "off",
  "promise/prefer-catch": "off",
  "require-await": "off",
  "typescript/promise-function-async": "off",
  "unicorn/no-await-expression-member": "off",

  // --- Regular expressions -------------------------------------------------
  // Adding `u` changes escape semantics, and named capture groups mean rewriting
  // every index-based match access. Both are mechanical-looking edits with real
  // behaviour risk across ~70 sites in the applier's patch engine.
  //
  // `no-control-regex` is deliberately NOT here. It is a Possible Problems rule, it
  // fires in exactly two places (the `stripAnsi` ANSI pattern in
  // packages/cli/src/lib/tui.ts and its copy in scripts/update-deps.ts), and both
  // carry an `oxlint-disable-next-line` with the reason at the line. Everywhere
  // else — including the modules we ship — it stays on.
  "prefer-named-capture-group": "off",
  "require-unicode-regexp": "off",
  "typescript/prefer-regexp-exec": "off",

  // --- Key and import ordering ---------------------------------------------
  // `sort-keys` ran with `--fix` during the adoption sweep, so most object literals
  // in the repo are already alphabetical and stay that way. Turning it back on today
  // reports ~37 sites its fixer would not touch, and those are the ones where the
  // order carries meaning: the error-code table in modules/email-cloudflare, the
  // `files`/`env`/`rules` shape of the override blocks in this very file and the
  // template's, lint-staged's glob-to-command map, the URL-segment order in
  // registry.ts's parsed spec, and the descriptor fixtures in applier.test.ts that
  // mirror a registry item on disk. Alphabetising those is churn against readability.
  // Do not re-order anything back — the rule is off for what it *still* reports.
  //
  // `unicorn/import-style` wants default imports for `node:path` and friends,
  // against the named-import style used in every file.
  "sort-keys": "off",
  "unicorn/import-style": "off",

  // --- Increment operator --------------------------------------------------
  // `no-plusplus` fires 13 times, mostly inside the LCS diff in
  // packages/cli/src/lib/diff.ts. Note that `oxlint --fix-suggestions` "fixes"
  // `a[i++]` to `a[i += 1]`, which is a different program — the tests do not
  // catch it. Never run that flag here; `lint:fix` is `--fix` only.
  "no-plusplus": "off",

  // --- Type-strictness tier ------------------------------------------------
  // typescript-eslint's strict-type-checked tier. It fires on the JSON.parse
  // boundary (where ajv, not the type system, is what actually validates — see
  // packages/cli/src/lib/schema.ts), on ts-morph's `any`-typed AST, and on
  // idiomatic truthiness tests. Turning these into real fixes is a typing
  // project of its own, not a lint config change.
  "typescript/no-dynamic-delete": "off",
  "typescript/no-non-null-assertion": "off",
  "typescript/no-unsafe-assignment": "off",
  "typescript/no-unsafe-call": "off",
  "typescript/no-unsafe-member-access": "off",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/strict-boolean-expressions": "off",

  // --- Accessibility shape, not accessibility ------------------------------
  // Both of these fire on markup that is already accessible. `prefer-tag-over-role`
  // wants `<output>` for `role="status"` and `<fieldset>` for `role="group"` — a
  // change to shipped markup with different layout defaults, which is a UI decision
  // and not a lint fix. `label-has-associated-control` fires on the `Label`
  // primitive in the design system, where the control is supplied by the call site.
  "jsx-a11y/label-has-associated-control": "off",
  "jsx-a11y/prefer-tag-over-role": "off",

  // --- Thresholds and remaining style --------------------------------------
  // Arbitrary numeric limits and shape preferences with no defect behind them.
  "class-methods-use-this": "off",
  complexity: "off",
  "max-classes-per-file": "off",
  "no-nested-ternary": "off",
  "prefer-destructuring": "off",
  "typescript/method-signature-style": "off",
  "typescript/parameter-properties": "off",
  "unicorn/no-nested-ternary": "off",
};

export default defineConfig({
  ...ultracite,

  rules: {
    ...ultracite.rules,
    ...suppressed,
    // Ultracite enables `default-case`, `consistent-return` AND the strict form of
    // `switch-exhaustiveness-check`, which cannot all be satisfied at once: dropping
    // the `default` clause to satisfy the third trips the first two. Treating a
    // `default` as exhaustive reconciles them without turning any of the three off.
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
    // Ultracite's core preset ships `no-console: "off"`. Console output is a
    // deliberate feature in exactly three places (exempted in `overrides`) and a
    // defect everywhere else — above all in the assets we ship to users. #66's
    // logger guard was dropped and pointed at this line.
    "no-console": "error",
    // Ultracite ships this as `["error", "always"]`, a stack-trace style preference
    // that fired 11 times. The rule's `in-try-catch` mode is the correctness half —
    // it catches a returned, un-awaited promise escaping the enclosing `catch`, where
    // the handler never runs. That mode reports zero findings here, so the bug class
    // stays guarded for free instead of being switched off with the style tier.
    "typescript/return-await": ["error", "in-try-catch"],
  },

  overrides: [
    // Ultracite's own override blocks first, so ours can correct them. `core`
    // relaxes two rules for test files; `vitest` adds the vitest plugin over the
    // same globs; `tanstack` relaxes filename-case under `routes/`.
    ...ultracite.overrides,

    // --- Node surfaces -----------------------------------------------------
    // The CLI's own source and the maintainer scripts. `ultracite/oxlint/core`
    // sets `env: { browser: true }` and nothing else, so Node globals have to be
    // added rather than un-applied. These two paths are also exactly what the
    // type-aware `pnpm lint` pass targets — see `lint:types` in package.json.
    {
      files: ["packages/cli/src/**", "scripts/**"],
      env: { browser: false, node: true },
    },

    // --- Cloudflare Workers surfaces ---------------------------------------
    // Module code that runs on workerd: fetch/Response/caches are global and
    // `process` is not. Type-aware linting never reaches these — they are shipped
    // assets whose `@repo/tsconfig` reference resolves only after scaffolding.
    {
      files: [
        "modules/api/files/**",
        "modules/auth/files/**",
        "modules/database/files/**",
        "modules/email*/files/**",
        "modules/logger*/files/**",
      ],
      env: { node: false, serviceworker: true, worker: true },
    },

    // --- Pulumi surface ----------------------------------------------------
    // The infra module is the one shipped asset that does NOT run on workerd.
    // Pulumi executes it as an ordinary Node ESM program on the deploying
    // machine, so it reads `process.env` and the filesystem. Keep it out of the
    // Workers glob above; giving it `serviceworker`/`worker` env would hide the
    // Node globals it actually depends on.
    {
      files: ["modules/infra/files/**"],
      env: { browser: false, node: true },
    },

    // --- React surfaces ----------------------------------------------------
    // The shipped design system and the waitlist module's client components:
    // browser globals plus React 19. Type-aware off, same reason as above.
    {
      files: [
        "modules/waitlist/files/web/**",
        "packages/cli/templates/base/packages/ui/**",
      ],
      env: { browser: true, node: false },
    },

    // --- Astro -------------------------------------------------------------
    // oxlint parses `.astro` natively — no parser wiring, no plugin chain. Both
    // the `---` frontmatter and client `<script>` blocks are linted.
    //
    // KEEP `.astro` OUT OF THE TYPE-AWARE PASS. `apps/web/tsconfig.json` includes
    // the build-generated `.astro/types.d.ts`, so type-aware linting here would
    // need `astro sync` before every `pnpm lint`, including on a fresh clone.
    // Today that falls out for free: `.astro` exists only in shipped assets,
    // which the type-aware invocation never reaches. Do not "fix" it by widening
    // `lint:types` to cover them.
    {
      files: ["**/*.astro"],
      env: { astro: true, browser: true },
    },

    // --- Component filenames -----------------------------------------------
    // React and Astro components are PascalCase by their own conventions;
    // unicorn wants kebab-case for everything.
    {
      files: ["**/*.astro", "**/*.tsx"],
      rules: { "unicorn/filename-case": "off" },
    },

    // --- Test-file shape ---------------------------------------------------
    // Assertion counts and a mandatory top-level `describe` are house style, and
    // this repo's suites are organised by exported function instead. The globs
    // and `plugins` here mirror Ultracite's vitest block on purpose: an override
    // that reconfigures a plugin's rule has to re-declare the plugin, or the
    // entry is silently ignored.
    {
      files: [
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/__tests__/**/*.{ts,tsx,js,jsx}",
      ],
      plugins: ["vitest"],
      rules: {
        // A test that asserts on help output has to swap `console.log` for a capture
        // and swap it back. That is the assertion, not stray debug output, and the
        // rule cannot tell the two apart.
        "no-console": "off",
        "vitest/max-expects": "off",
        "vitest/require-top-level-describe": "off",
      },
    },

    // --- no-console exemptions ---------------------------------------------
    // Terminal UX is the product here: @clack/prompts + picocolors write to the
    // console by design (ADR 0009). Note this is the entrypoint pair only —
    // `index.ts` bootstraps and `cli.ts` prints help and the unknown-command error.
    // Every other file under packages/cli/src goes through lib/logger.ts.
    {
      files: ["packages/cli/src/index.ts", "packages/cli/src/cli.ts"],
      rules: { "no-console": "off" },
    },
    // Maintainer tooling — these scripts *are* their output.
    {
      files: ["scripts/**"],
      rules: { "no-console": "off" },
    },
    // The console providers (email-console, sms-console, …): writing the message
    // to stdout is the whole implementation. Ditto any future logger-console
    // provider — `modules/logger*/` does not exist yet, so that glob is
    // forward-looking on purpose (see #66).
    {
      files: ["modules/*-console/files/**", "modules/logger*/files/**"],
      rules: { "no-console": "off" },
    },
    // The infra module is deploy tooling, in the same class as `scripts/**`
    // above: a Pulumi program reports its own progress on stdout, and the three
    // sites here are that report — an empty-discovery notice and the per-secret
    // push lines. `@repo/logger` is a Workers runtime package and never resolves
    // on the deploying machine, so there is no logger to route them through.
    {
      files: ["modules/infra/files/**"],
      rules: { "no-console": "off" },
    },
  ],
});
