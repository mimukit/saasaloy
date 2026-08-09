# Plan — Adopt a linter across the repo and the code it ships

Grilled: 2026-08-08 · Revised: 2026-08-09 (provider switched to oxlint — see below)

> Tracked in [#71](https://github.com/mimukit/saasaloy/issues/71). Reconciles with [#46](https://github.com/mimukit/saasaloy/issues/46).

## Revision note — 2026-08-09

The 2026-08-08 grill settled on Ultracite's **ESLint** provider. That is not
implementable in this repo, and the reason is structural rather than a version lag.

`@typescript-eslint/parser@8.66.0` reads `require('typescript').versionMajorMinor` at
**module-load time** and throws when the major is >= 7. This repo and the shipped template
pin `typescript@7.0.2` in seven manifests. `ultracite/eslint/core` imports that parser
unconditionally, so `eslint .` dies before linting a single file — the whole configuration,
not just the type-aware criterion. The peer range is `>=4.8.4 <6.1.0` on both `latest` and
`canary`; there is no v9 and no `next` tag. TypeScript 7 is the native Go port, so this is an
API-surface incompatibility, not a bump waiting to happen. pnpm `overrides` is not a way out:
`typescript` is a peer and resolves from the root under both the `package.json` and
`pnpm-workspace.yaml` forms.

The plan now uses **Ultracite's oxlint provider** with `oxlint-tsgolint` for type-aware
linting. Every mechanism below was verified against this repo by prototype on 2026-08-09
(recorded in [#71](https://github.com/mimukit/saasaloy/issues/71#issuecomment-5230159871));
rows carry their evidence inline. Formatting is unchanged — Prettier and Stylelint stay, and
oxfmt is **not** adopted.

The 2026-08-08 grill rejected oxlint on a stated justification that is false: it claimed
oxlint's presets are `core`/`react`/`next`/`tanstack`/`jest`/`vitest`/`js-plugins`, so no
Astro. Ultracite 7.10.2 ships oxlint presets for `angular`, `astro`, `core`, `jest`,
`js-plugins`, `nestjs`, `next`, `qwik`, `react`, `remix`, `solid`, `svelte`, `tanstack`,
`vitest` and `vue` — and oxlint lints `.astro` files directly, which is a separate capability
from preset coverage. That grill reversed #46 because #46's justification was false; its
replacement justification was false the same way. Both are now corrected.

## Context

**Nothing in this repo has ever been linted.** `turbo.json` declares `"lint": {}` — an empty
task with nothing behind it — so `pnpm lint` is a silent success. There is no `eslint`,
`oxlint`, or `biome` config at the root, in `packages/cli`, in `packages/cli/templates/base/`,
or in any module, and no workspace declares a `lint` script. That covers 4,851 LOC of CLI
TypeScript, 13 TypeScript maintainer scripts, and the 41-file base template that every
generated project starts from.

This already cost something concrete. #66 (`logger` capability) was supposed to ship a guard
so `console.*` couldn't creep back into generated apps. With no lint infrastructure the
choices were inventing one inside a module issue or bolting on a bespoke grep script, so the
guard was dropped and pointed here.

The grill also surfaced that `templates/base/AGENTS.md` **already documents** a linter, a
formatter, a `@repo/eslint-config` package, husky, lint-staged and commitlint — none of which
exist. Generated projects have been shipping instructions for tooling that was never there.

**Success:** `pnpm lint` fails on a real violation anywhere in the repo — including the
template and every module's shipped source — `saasaloy init` produces a git-initialised
project that lints itself and refuses a badly-formatted commit, #66's `no-console` guard is
reinstated where it matters, and `templates/base/AGENTS.md` describes tooling that exists.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Linter** | **Ultracite 7.10.2, oxlint provider** — `ultracite/oxlint/*` presets over `oxlint@1.77.0` + `oxlint-tsgolint@7.0.2001`, alongside Prettier + Stylelint. The ESLint provider is not available at `typescript@7.0.2` (see Revision note). **Verified:** linted 35 real CLI source files and produced genuine findings — the exact call where ESLint throws. |
| **Type-aware linting runs on the compiler we ship** | `oxlint-tsgolint` is a native Go binary built on typescript-go, carrying its own compiler; it never loads the `typescript` npm package. **Verified:** type-aware rules fired in a workspace where `typescript` was not installed at all. So the linter analyses TS 7 semantics — the same semantics `tsc` compiles with — rather than the TS 6 semantics options (a) and (b) would have forced. There is no version guard to trip and nothing to re-check on a TypeScript bump. |
| **Presets enabled** | Repo: `core`, `astro`, `react`, `tanstack`, `vitest`. Template: `core`, `astro`, `react` — `tanstack` when the admin SPA lands, `vitest` when a module ships tests. **Verified:** all five load and compose to 103 merged rules. |
| **The dependency set is three packages, not ~35** | `ultracite`, `oxlint`, `oxlint-tsgolint`. Ultracite's oxlint presets are self-contained config data — there is no plugin-per-rule-family sprawl to hand-install, and no "no peer contract" hazard to manage. This deletes the ESLint plan's single largest install surface and its standing re-check burden on every Ultracite bump. |
| **Native binaries, but no `allowBuilds` entry** | oxlint and oxlint-tsgolint ship prebuilt per-platform binaries via `optionalDependencies` (`@oxlint/binding-linux-x64-gnu`, `@oxlint-tsgolint/linux-x64`). **Verified:** none of these packages — wrapper or platform — declares `preinstall`, `install` or `postinstall`. pnpm's build block is never hit, so **no `allowBuilds` entry is needed** here or in the template. #46's `allowBuilds` criterion still drops, for a corrected reason: not "no native binaries", but "native binaries that need no build scripts". |
| **Shipped assets are linted** | `packages/cli/templates/base/**` and `modules/*/files/**` are linted. Reverses #46's exclusion, whose premise doesn't survive the code: `{{PROJECT_NAME}}` appears in 5 files and in the only *code* file among them (`templates/base/packages/ui/src/index.ts:8`) it sits inside a string literal — valid TypeScript. |
| **`.tsx` needs no special block** | The ESLint plan's central worry — that shipped React would receive react-only rules and no `no-console`, unicorn or typescript coverage — does not arise. **Verified:** `unicorn/no-new-array` and `no-console` both fire inside `.tsx`, and type-aware rules apply there too. The `core` rule-module re-application block, and the upstream bug it was going to be filed against, are both dropped. |
| **Type-aware wiring** | `oxlint --type-aware`. oxlint discovers the relevant `tsconfig.json` per file on its own; `--tsconfig` is only for non-standard names or locations. No `parserOptions.project` array, no synthetic root project, no `projectService` question — the entire ESLint wiring row collapses to one flag. **Verified** against `packages/cli/tsconfig.json` unmodified, which extends `tsconfig.base.json`. |
| **Type-aware scope is a *path split*, not a config toggle** | `--type-aware` is a **global CLI switch** — there is no `typeAware` config key and no per-override control. **Verified.** Per-path opt-out by setting rules to `"off"` in an override does **not** work either, because the failure is not a rule: pointing `--type-aware` at shipped assets emits five `typescript(tsconfig-error)` diagnostics (`File '@repo/tsconfig/base.json' not found` — it resolves only after scaffolding + install) plus a spurious `no-redundant-type-constituents` warning caused by types degrading to `any`. `tsconfig-error` comes from tsconfig discovery and no override suppresses it. So the split is by **invocation**: one type-aware pass scoped to `packages/cli/src` and `scripts/`, one plain pass over everything else. |
| **`.astro` is type-aware off everywhere** | `apps/web/tsconfig.json` includes the build-generated `.astro/types.d.ts`, so type-aware linting would need `astro sync` before every `pnpm lint`, including on a fresh clone. Falls out of the path split for free — `.astro` lives only in shipped assets, which the type-aware pass never reaches. Documented in a config comment so nobody "fixes" it. |
| **Astro needs no parser wiring** | oxlint parses `.astro` natively. **Verified:** violations were reported in **both** the `---` frontmatter and the client `<script>` block, and all five of the repo's real `.astro` files were confirmed visited. No `astro-eslint-parser`, no `languageOptions.parser` override, no plugin peer chain. |
| **Rule families lost by leaving ESLint** | `ultracite/oxlint/core` covers `eslint`, `typescript`, `unicorn`, `oxc`, `import`, `jsdoc`, `node` and `promise` — 472 rules enabled of 534 declared. The ESLint set additionally carried **sonarjs**, and `unused-imports` as a distinct plugin. Accepted: `oxc` and `typescript` cover the unused-symbol ground, and sonarjs's cognitive-complexity family is a nice-to-have this repo has never had. Recorded so nobody rediscovers it as a regression. |
| **Formatting** | Prettier + Stylelint, both from Ultracite's configs, **plus `prettier-plugin-tailwindcss`, which Ultracite's `prettier.config.mjs` does not include** — so the config is a spread, not a re-export. One sweep across everything **except Markdown**, landed as its own commit. |
| **Markdown is Prettier-ignored** | Ultracite's Prettier config sets **`proseWrap: "never"`**. A blanket sweep would collapse every hand-wrapped paragraph in 87 Markdown files — every ADR and plan — into one line each. `.prettierignore` excludes `**/*.md`. This matters **more** now that the Prettier pass has widened to everything: `.prettierignore` is the only thing standing between `prettier --check .` and 87 flattened documents. |
| **`pnpm lint` is four passes, and Prettier's widens** | Two oxlint invocations (the path split above) + `stylelint "**/*.css"` + `prettier --check .`, every one carrying `--deny-warnings` or its equivalent. The Prettier pass is **no longer narrowed** to `astro,yaml,yml,jsonc`: that narrowing existed only because `prettier/prettier` ran as an error-level rule inside ESLint's `core`. oxlint has no formatting-integration rule, so Prettier becomes the sole owner of JS/TS/TSX formatting and must check it. **Verified** no conflict: the only formatting-adjacent rule in `ultracite/oxlint/core` is `import/newline-after-import`, which Prettier does not enforce — they are complementary. `.prettierignore` still carves out Markdown. |
| **`--deny-warnings` is load-bearing** | Ultracite's oxlint preset sets most rules to warn, and oxlint exits **0** on warnings by default. Without `--deny-warnings` the gate is a silent success — the exact defect this issue exists to delete. **Verified:** exit 0 without the flag, exit 1 with it. |
| **Stylelint stays, with a patched allow-list** | The repo has exactly one `.css` file — the shipped `templates/base/packages/ui/src/styles/globals.css`. Ultracite's `at-rule-no-unknown` allows `tailwind/apply/layer/source/reference` but **not `@theme` or `@custom-variant`**, both of which that file uses, so it fails on first run. Kept because the template ships `stylelint.config.js` downstream regardless — the repo must run the config its users will. Add `@theme`, `@custom-variant`, `@plugin`, `@utility`, `@variant`. |
| **Generated projects ship the toolchain** | Same argument as [ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md) for the design layer: a non-functional layer earns its place in the base when every project wants it and an opt-in module would be a step everyone takes. |
| **No shared config package — config lives at each root** | **oxlint does not support shared config packages.** **Verified:** `"extends": ["@repo/oxlint-config"]` fails with *"Unsupported named config … Oxlint does not support ESLint shared configs"* and exit 1; `extends` takes **file paths only**, and **JSON only**. Good news that it fails loudly rather than linting nothing. The ESLint plan's `packages/eslint-config` is dropped, and its rationale is gone anyway — it existed to keep ~30 devDependencies out of the user's root, and there are now three. Both repos get an `oxlint.config.mjs` at the root (see Phase 2 for why JS, not JSON). `templates/base/AGENTS.md`'s `@repo/eslint-config` claim is deleted in Phase 7 rather than made true. |
| **No per-workspace `lint` scripts, no turbo task** | `pnpm-workspace.yaml` declares `packages/*`, so `packages/cli` is the **only** workspace member here — `turbo run lint` structurally cannot reach `scripts/`, `modules/`, or `templates/`. Downstream the reasoning differs but the answer matches: the `clean` convention exists because each workspace generates *different* output, and linting has no per-workspace state. The template's own `typecheck` shows the hazard — it is a turbo task, but only `packages/ui` declares a script, so `apps/web` is silently unchecked. The empty `lint` stub leaves `turbo.json`; a **deliberate** inconsistency with `clean`, recorded as such. |
| **Git hooks ship, in both repos** | husky + lint-staged + `@commitlint/config-conventional`, in this repo **and** the base template. The tool repo runs the exact hooks it ships. Commit history is already clean conventional with free-form scopes, which the default config accepts unchanged. Rejected: lefthook and simple-git-hooks — `AGENTS.md` already names husky, and neither alternative buys anything at this size. |
| **pre-commit mirrors the passes, minus type-aware** | lint-staged runs `oxlint --fix` on staged JS/TS/TSX/Astro, `stylelint --fix` on CSS, `prettier --write` on everything but Markdown. Not a full `pnpm lint` — that throws away the reason lint-staged exists. Type-aware is **off** in the hook: it needs the whole project graph, which defeats staged-file scoping. Generate the globs from the same source as the root scripts so they can't drift. |
| **`saasaloy init` runs `git init`** | Required for husky: `init` scaffolds and then spawns `pnpm install` with no `.git`, which is husky's documented failure case. It also independently fixes the Turborepo cache-invalidation and Tailwind over-scanning that CONTRIBUTING.md already documents, and lets `play:init` drop its own `git init` so the playground finally matches the user path. **Guarded** — only when the target is not already inside a git work tree, since `saasaloy init ./apps/my-app` is a supported shape and must not nest a repo. Never throws, matching `runPnpmInstall`'s treatment of a missing `pnpm`. |
| **Prettier sweep lands with #71** | Three open PRs (#72, #74, #69) all edit files the sweep rewrites. The sweep is **not** deferred until they merge, and #71 is **not** reprioritised — whichever PRs are still open when #71 lands rebase then. |
| **CI stays in #46** | This issue owns linter selection, configuration, and making the repo pass. #46 keeps publishing and CI, including *running* the gate. Its criteria are edited here, in Phase 1, before either issue is worked. |

## Approach

### What this reuses

- **`scripts/update-deps.ts` needs no changes.** Its "Class 1" glob already discovers
  `packages/cli/templates/base/**/package.json` (`scripts/update-deps.ts:400-406`), so the
  template's new lint devDependencies are tracked by `pnpm deps:update` / `deps:check` from
  the moment they land. Class 3 covers `modules/*/files/**/package.json` the same way. The
  repo's own root devDependencies stay on `pnpm outdated`/`update` per CONTRIBUTING's scope
  boundary.
- **`copyTemplate` needs no changes** (`packages/cli/src/lib/scaffold.ts:12-32`). Only `_foo`
  → `.foo` files are renamed — which is exactly how `_husky/` ships as `.husky/`.
- **`packages/cli/tsconfig.json` and `tsconfig.scripts.json` are the type-aware projects.**
  No new tsconfig anywhere; oxlint discovers them per file and `pnpm typecheck` reads the
  identical definitions.
- **oxlint honours git ignore rules**, and `.gitignore:151` already excludes `/.dev/`. The
  scaffolded playground is therefore invisible to the linter with no configuration at all.
  Prettier does **not** read `.gitignore`, so `.dev` still needs a `.prettierignore` entry —
  the ESLint plan's ignore item survives on the formatter side only.
- **`pnpm deps:verify` is the downstream gate.** It already scaffolds `.dev/playground`,
  installs, builds, and typechecks; the template's `pnpm lint` slots into that same chain.
- **`docs/qa/`** is the established home for CLI-behaviour QA (`qa-command-picker`,
  `qa-logger-capability-module`, `qa-theme-switcher`) — Phase 5 adds one.
- **`scripts/verify-css.ts`** is the precedent for a narrow invariant check, and stays as-is.
  Tailwind silently dropping `packages/ui` utilities is a build behaviour, not a CSS syntax
  error, and Stylelint cannot see it.

### Phase 1 — Reconcile #46 first

Nothing else starts until this lands, or whichever issue merges second rebases onto the
other's config.

- Edit #46's acceptance criteria: drop the Ultracite/oxlint+oxfmt criterion (oxlint is
  adopted, oxfmt is not — see Non-goals), drop the `allowBuilds` criterion (moot — the
  binaries declare no install scripts), and drop "The base template is excluded from linting"
  (reversed here).
- #46 keeps one lint criterion: **CI runs the lint gate on every pull request.**
- Update `docs/plans/plan-ship-the-cli-2026-08-01.md` — the **Linter** row (line 37), the
  **Template files stay unlinted** row (line 43), and **Phase 2** (lines 69–85).

### Phase 2 — Install and configure at the repo root

- **Three linter devDependencies**, exact-pinned per `saveExact`: `ultracite@7.10.2`,
  `oxlint@1.77.0`, `oxlint-tsgolint@7.0.2001`. `oxlint-tsgolint` must be a **real project
  dependency** — oxlint resolves it project-locally, and a symlink into `node_modules` is not
  enough. Without it, `--type-aware` fails with *"Failed to find tsgolint executable"*.
- **Formatting dependencies are unchanged from the ESLint plan**: `prettier`, the four
  Stylelint packages, `prettier-plugin-tailwindcss`, and `prettier-plugin-astro`. None of
  these ship in Ultracite's `devDependencies`, so their versions are chosen independently —
  current latest, exact-pinned, honouring `minimumReleaseAge: 4320`.
- **No `allowBuilds` entry.** Verified: no oxlint package declares install scripts.
- **`oxlint.config.mjs` at the repo root, run as `oxlint -c oxlint.config.mjs`.** Not
  `.oxlintrc.json`: `extends` accepts **JSON only** (*"Only JSON configuration files are
  supported"*), and Ultracite's presets are `.mjs` modules calling `defineConfig` from
  `oxlint`. The JS config path is the only one that can consume them. oxlint documents JS/TS
  configs as **experimental, requiring Node.js** — accepted, since we already require Node
  >= 24 and the fallback (inlining a JSON snapshot of the composed rules) is a frozen copy
  that silently drifts from Ultracite on every bump. **Verified:** a JS config composing
  `core` + `astro` + `react` linted correctly.
- **Merge the presets by concatenating arrays, never by object spread.** `ultracite/oxlint/react`
  declares `plugins: ["react","react-perf","jsx-a11y"]` and `core` declares eight
  (`eslint`, `typescript`, `unicorn`, `oxc`, `import`, `jsdoc`, `node`, `promise`). A naive
  `{...core, ...react}` **silently drops all eight** — the config still loads, still reports
  a few violations, and looks like it works. **Verified both ways:** `unicorn/no-new-array`
  vanished under spread and returned under a concatenating merge. Union `plugins`,
  `ignorePatterns` and `overrides`; `Object.assign` `env` and `rules`. Only `core` declares
  `env`, `plugins` and `ignorePatterns`; `tanstack` and `vitest` contribute `overrides` only.
  This is the single most dangerous step in the phase — it fails silently in the exact way
  this issue exists to eliminate. Assert it: plant a `new Array(1)` and confirm the config
  catches it before moving on.
- `prettier.config.js` spreading `ultracite/prettier` **plus** `prettier-plugin-tailwindcss`
  and `prettier-plugin-astro`; `stylelint.config.js` spreading `ultracite/stylelint` with the
  extended `at-rule-no-unknown` allow-list. Both exports are provider-independent and survive
  the switch untouched.
- Root scripts. `lint` chains four passes, in this order:
  1. `oxlint -c oxlint.config.mjs --type-aware --deny-warnings packages/cli/src scripts`
  2. `oxlint -c oxlint.config.mjs --deny-warnings .` — everything, no type information
  3. `stylelint "**/*.css"`
  4. `prettier --check .`

  Pass 2 re-walks the files pass 1 covered. That is deliberate and cheap: oxlint is fast, and
  the alternative — an ignore list keeping pass 2 off `packages/cli/src` and `scripts/` — is a
  second place for the path split to drift out of sync. `lint:fix` and `format` mirror passes
  1–3 and 4 respectively.
- `.prettierignore` excluding `**/*.md` **and** `.dev/`. oxlint needs neither — it honours
  `.gitignore`, which already excludes `/.dev/`.
- Remove the empty `lint` task from `turbo.json`.

### Phase 3 — Per-surface overrides

`ultracite/oxlint/core` sets `env: { browser: true }` and nothing else — Node globals are
**absent**, not over-applied. The ESLint plan's framing ("merges browser *and* node into every
file, wrong in both directions") does not carry over; the fix is additive rather than
corrective, but the overrides are still load-bearing.

- `packages/cli/src/**`, `scripts/**` — Node globals **added** (`env.node`). These are the two
  paths the type-aware invocation targets; everything else is reached only by the plain pass.
- `modules/api/files/**`, `modules/email*/files/**`, `modules/logger*/files/**`,
  `modules/auth/files/**`, `modules/database/files/**` — Workers runtime globals (no
  `process`), type-aware **off**.
- `packages/cli/templates/base/packages/ui/**`, `modules/waitlist/files/web/**` — browser +
  React 19, type-aware **off**.
- `**/*.astro` — no parser block; oxlint reads `.astro` natively. Type-aware never reaches it
  by construction (it lives only in shipped assets), but keep the `astro sync` reason in a
  comment so nobody adds it to the type-aware pass later.
- `**/*.test.ts` — the `vitest` preset. Note `ultracite/oxlint/core` already ships one
  override block globbing `**/*.{test,spec}.{ts,tsx,js,jsx}` and `**/__tests__/**`; check it
  before adding a second that fights it.
- **`no-console`** with commented exemptions where console output *is* the feature:
  `packages/cli/src/index.ts` (terminal UX per [ADR 0009](../adr/adr-0009-cli-dx-clack-picocolors-2026-07-22.md)),
  `scripts/*.ts` (maintainer tooling), `modules/email-console/files/console.ts`, and a
  forward-looking `modules/logger*/files/**` glob — **`modules/logger-console/` does not exist
  yet**; `modules/` currently holds api, auth, database, email, email-cloudflare,
  email-console and waitlist. **Verified:** `no-console` is configurable and fires in `.ts`,
  `.tsx`, Astro frontmatter and Astro `<script>` blocks alike. Current usage is 6 / 13 / 1
  occurrences and **zero** in the base template.

### Phase 4 — Make the repo pass

- Fix violations, or leave an explicit commented suppression for each one that stays.
- Land the Prettier + Stylelint sweep as **its own commit**, separate from the config.
- `stylelint-config-idiomatic-order` will want to reorder every declaration in
  `globals.css` — the file `verify-preset` asserts structure on. **Run `pnpm verify:preset`
  against the reordered file before committing the sweep.**
- **Flag in the PR:** reformatting `modules/*/files/**` changes the content the applier writes
  and therefore the hashes in `.saasaloy/manifest.json`
  (`packages/cli/src/lib/applier.ts:169,362`). Already-scaffolded projects see a churnier
  `saasaloy update` diff. It classifies as a safe **overwrite**, not **drift**, so nothing
  routes to AI-merge. Also flag the rebase cost to #72, #74 and #69.

### Phase 5 — `saasaloy init` initialises a git repository

- `runGitInit(target)` in `packages/cli/src/commands/init.ts`, called **after**
  `copyTemplate` and **before** the install prompt. Guarded by
  `git rev-parse --is-inside-work-tree` against the target, so `saasaloy init ./apps/my-app`
  inside an existing repo does nothing. Never throws — a missing `git` warns and continues,
  matching `runPnpmInstall`.
- Drop the now-redundant `git init -q .dev/playground` from `pnpm play:init`, so the
  playground exercises the same path a user takes.
- Update CONTRIBUTING.md's "Why `play:init` runs `git init`" section — the reasons move into
  the CLI rather than disappearing.
- `docs/qa/qa-init-git-init-<date>.md` covering: bare `saasaloy init my-app`,
  `saasaloy init .`, `saasaloy init ./apps/x` inside an existing repo, a target that already
  has `.git`, and `git` absent from `PATH`.

### Phase 6 — Git hooks, in this repo and the template

- husky + lint-staged + `@commitlint/config-conventional`; `prepare: "husky"` in both roots.
- `pre-commit` → lint-staged; `commit-msg` → commitlint. The hook runs **one** plain oxlint
  pass on staged files, not the type-aware split — type-aware needs the whole project graph,
  which defeats staged-file scoping.
- In the template these ship as `_husky/` (renamed to `.husky/` by `copyTemplate`).
- `HUSKY=0` documented for CI, so #46's workflow doesn't install hooks.

### Phase 7 — Ship the toolchain in the base template

- **No `packages/eslint-config` workspace package** — oxlint cannot consume one (see the
  decisions table). Template root gets `oxlint.config.mjs`, `prettier.config.js`,
  `stylelint.config.js`, `.prettierignore`, and `lint` / `lint:fix` / `format` scripts, plus
  the three linter devDependencies and the formatting set. No `allowBuilds` entry.
- **The generated project's `lint` uses the same path split, with its own paths.** Once
  scaffolded and installed, `@repo/tsconfig` resolves, so type-aware works there — but only
  where `.astro` isn't involved. Type-aware pass over `packages/ui/src`; plain pass over
  everything including `apps/web`. Comment the `astro sync` reason at the split, since a
  downstream user has none of this context and the obvious "improvement" is to merge the two.
- **Rewrite `templates/base/AGENTS.md`** so it stops describing tooling that doesn't exist.
  Its `pnpm lint` and `pnpm format` claims (lines 184–185, 193) become true. Its
  **`@repo/eslint-config` claim (line 196) is deleted rather than satisfied** — that package
  is not being built. Line 205's "Changing Prettier or ESLint configurations" becomes oxlint.
  The husky / lint-staged / commitlint entries (lines 203, 216, 219) — including "Never Do:
  remove or disable lint-staged or commitlint hooks", which currently protects nothing — are
  rewritten to match what Phase 6 actually ships.
- Extend `pnpm deps:verify` to run the generated project's `pnpm lint`, after `build`, so a
  template dependency bump that breaks linting fails the standing gate.

### Phase 8 — Document

- `CONTRIBUTING.md`: how to run the linter, how to add a justified suppression, the hook
  setup and how to bypass it, and the boundary against `verify-css` / `verify-preset`.
- **ADR 0023 — "the generated project ships a lint and commit-hook toolchain."** Covers the
  root-level `oxlint.config.mjs` shape and the hooks as facets of one hard-to-reverse
  base-template commitment that every future module inherits.
- **ADR 0024 — "`saasaloy init` initialises a git repository."** A separate axis: a CLI
  product decision that also fixes Turborepo cache invalidation and Tailwind over-scanning,
  and that nobody would think to look for inside a linting record.
- **ADR 0025 — "the linter runs on the compiler we ship."** Records why the ESLint provider
  was abandoned and oxlint chosen: typescript-eslint is capped below TypeScript 7 by an
  architectural port, not a version lag, and `oxlint-tsgolint` tracks TS 7 by construction.
  This is the decision most likely to be relitigated by someone who sees "everyone uses
  ESLint" and does not know why we do not. Numbers assume 0022 is the latest on disk —
  confirm before writing.

## Open questions

None. The 2026-08-08 grill closed all seven of the draft's open questions and the twenty
decisions it raised; the 2026-08-09 revision closed the provider question the ESLint route
opened, with each replacement mechanism verified by prototype rather than by reading. Four
items are recorded rather than open:

- **React Native, later.** No Ultracite provider ships a `react-native` preset. Revisit when
  the mobile app lands; the ESLint plan's `eslint-config-expo` answer no longer applies, since
  there is no ESLint here to compose it into.
- **Git hooks for the template were scope-expanded deliberately.** The draft's non-goal list
  excluded them; the grill reversed that because `AGENTS.md` already promised them.
- **sonarjs and `unused-imports` are not replaced.** See the decisions table. Accepted, not
  overlooked.
- **oxlint's JS config format is marked experimental.** Phase 2 depends on it, because it is
  the only way to consume Ultracite's `.mjs` presets. Verified working today on oxlint 1.77.0.
  If a future oxlint drops or breaks it, the fallback is a generated JSON snapshot of the
  composed config — workable, but a frozen copy that drifts from Ultracite silently. Worth a
  note in the ADR so the risk is owned rather than discovered.

## Non-goals

- **CI wiring.** #46 owns the workflow that runs the gate. This issue makes the gate exist.
- **Publishing, changesets, npm.** #46's scope, untouched here.
- **Replacing `verify-css.ts` or `verify-preset.ts`.** They assert build-time invariants that
  no linter can see; both stay exactly as they are.
- **Retrofitting the toolchain into already-scaffolded projects.** Base files are a one-time
  gift per ADR 0022 — no manifest entries, no update path. Existing projects adopt it by hand.
- **Linting or formatting Markdown.** Prose tooling is a separate argument with a separate
  rule set, and Ultracite's `proseWrap: "never"` makes the formatting half actively harmful
  to a documentation-heavy repo.
- **oxfmt.** Adopting oxlint as the *linter* does not oblige us to take oxc's *formatter*.
  Prettier + Stylelint stay: they carry `prettier-plugin-tailwindcss` class sorting and the
  Stylelint at-rule allow-list this repo's `globals.css` depends on, and swapping the
  formatter would mean re-auditing the Markdown `proseWrap` hazard on a new tool. Revisit as
  its own issue if ever.
- **Vite+ (`vite-plus`).** VoidZero's unified toolchain bundles oxlint, oxfmt, Vitest,
  Rolldown, tsdown and a Rust task runner, and would subsume turbo, tsup and the hook stack.
  Free and MIT, and its `oxlint-tsgolint` pin is the same one adopted here. Out of scope: it
  is beta (0.2.x), and this repo *generates projects for other people* — putting a pre-1.0
  toolchain in the base template imposes it on every user. Its own plan, revisited at 1.0.
- **Fixing the template's missing `apps/web` `typecheck` script.** Found during the grill —
  `turbo run typecheck` silently covers one of two workspaces. Real, but a separate issue.
