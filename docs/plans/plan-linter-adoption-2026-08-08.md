# Plan — Adopt a linter across the repo and the code it ships

Grilled: 2026-08-08

> Tracked in [#71](https://github.com/mimukit/saasaloy/issues/71). Reconciles with [#46](https://github.com/mimukit/saasaloy/issues/46).

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
| **Linter** | **Ultracite 7.10.2, ESLint provider** — `ultracite/eslint/*` presets over ESLint 10 + Prettier + Stylelint. Chosen for breadth of *official* stack support over speed, which is a non-factor at ~6k LOC. Reverses #46's Ultracite-over-oxlint pick, whose stated justification ("ships framework presets for `astro`") was **false** — oxlint's presets are `core`/`react`/`next`/`tanstack`/`jest`/`vitest`/`js-plugins`. |
| **Presets enabled** | Repo: `core`, `astro`, `react`, `tanstack`, `vitest`. Template: `core`, `astro`, `react` — `tanstack` when the admin SPA lands, `vitest` when a module ships tests. |
| **Ultracite declares none of the plugins** | Its `dependencies` are CLI-only; every ESLint plugin sits in Ultracite's **own `devDependencies`**, and its only `peerDependencies` are `oxlint`/`oxfmt`, both optional. There is **no peer contract** — we hand-install the full set and `pnpm install` will never warn if a future Ultracite minor imports something new. Pin the versions from Ultracite 7.10.2's own devDependencies and treat an Ultracite bump as a manual re-check. |
| **No native binaries** | `oxlint`/`oxfmt` are never installed. **No `allowBuilds` entries** are needed here or in the template — this deletes one of #46's acceptance criteria outright. |
| **Shipped assets are linted** | `packages/cli/templates/base/**` and `modules/*/files/**` are linted. Reverses #46's exclusion, whose premise doesn't survive the code: `{{PROJECT_NAME}}` appears in 5 files and in the only *code* file among them (`templates/base/packages/ui/src/index.ts:8`) it sits inside a string literal — valid TypeScript. |
| **`.tsx` needs a repo-owned block** | Ultracite's `core` globs only `.js/.ts/.json/.mjs/.cjs/.html` across all five of its config blocks. The `react` preset adds `.tsx`/`.jsx` but only react/hooks/a11y/react-doctor rules. Left alone, 1,173 LOC of shipped React would get **no** typescript-eslint, unicorn, sonarjs, import-x, unused-imports or `prettier/prettier` — including no `no-console`. One override block re-applies `core`'s rule modules (individually importable at `ultracite/eslint/core/rules/*.mjs`) to `**/*.{tsx,jsx}`. File upstream in parallel. |
| **Type-aware wiring** | Override `languageOptions.parserOptions.project` with an **array of the tsconfigs that already exist** — `["./packages/cli/tsconfig.json", "./tsconfig.scripts.json"]` here, `["./apps/*/tsconfig.json", "./packages/*/tsconfig.json"]` in the template. `core` hardcodes `project: "./tsconfig.json"`, which exists in neither repo. No synthetic root project: it would duplicate the existing `include`s here and is **not expressible** in the template, where `apps/web` extends `astro/tsconfigs/strict` and `packages/ui` sets `jsx: "react-jsx"`. `projectService` rejected — `scripts/` has no local `tsconfig.json`, only the root's `tsconfig.scripts.json`. |
| **Type-aware scope** | **On** for `packages/cli/src` and `scripts/`, and for the template's own workspaces. **Off** for shipped assets, which have no resolvable project until after scaffolding. **Off for `.astro` everywhere** — `apps/web/tsconfig.json` includes the build-generated `.astro/types.d.ts`, so type-aware linting would need `astro sync` before every `pnpm lint`, including on a fresh clone. Documented in a config comment so nobody "fixes" it. |
| **Astro parser** | Ultracite's `astro` preset does `plugins: { astro }` + rules and sets **no parser**, and `core`'s glob excludes `.astro`. Not a risk — `eslint-plugin-astro@3.1.0` carries `astro-eslint-parser@^3.0.0` as a real **dependency** and ships flat configs that wire it. A `languageOptions.parser` override on `**/*.astro` closes it. Its peers also pull in `typescript-eslint` (the meta package) and `eslint-plugin-jsx-a11y`. |
| **Formatting** | Prettier + Stylelint, both from Ultracite's configs, **plus `prettier-plugin-tailwindcss`, which Ultracite's `prettier.config.mjs` does not include** — so the config is a spread, not a re-export. One sweep across everything **except Markdown**, landed as its own commit. |
| **Markdown is Prettier-ignored** | Ultracite's Prettier config sets **`proseWrap: "never"`**. A blanket sweep would collapse every hand-wrapped paragraph in 87 Markdown files — every ADR and plan — into one line each. `.prettierignore` excludes `**/*.md`. ESLint's own `prettier/prettier` never globs `.md`, so nothing else reaches them. |
| **`pnpm lint` is three narrow passes** | `eslint .` + `stylelint "**/*.css"` + `prettier --check` scoped to **only** `astro,yaml,yml,jsonc`. `prettier/prettier` is already an error-level rule inside `core` and `stylelint-prettier` covers CSS, so a blanket `prettier --check .` would re-format everything ESLint just formatted. |
| **Stylelint stays, with a patched allow-list** | The repo has exactly one `.css` file — the shipped `templates/base/packages/ui/src/styles/globals.css`. Ultracite's `at-rule-no-unknown` allows `tailwind/apply/layer/source/reference` but **not `@theme` or `@custom-variant`**, both of which that file uses, so it fails on first run. Kept because the template ships `stylelint.config.js` downstream regardless — the repo must run the config its users will. Add `@theme`, `@custom-variant`, `@plugin`, `@utility`, `@variant`. |
| **Generated projects ship the toolchain** | Same argument as [ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md) for the design layer: a non-functional layer earns its place in the base when every project wants it and an opt-in module would be a step everyone takes. |
| **Template config lives in `packages/eslint-config`** | A config-only workspace package mirroring the existing `packages/tsconfig` (`files`, `exports`, its own `clean` script), consumed as `@repo/eslint-config` — the name `templates/base/AGENTS.md` **already** tells users to import. Keeps ~30 devDependencies out of the user's root `package.json` and puts plugin resolution inside the package that declares them, which pnpm's strict layout prefers. Root `eslint.config.js` is a one-line re-export. |
| **No per-workspace `lint` scripts, no turbo task** | `pnpm-workspace.yaml` declares `packages/*`, so `packages/cli` is the **only** workspace member here — `turbo run lint` structurally cannot reach `scripts/`, `modules/`, or `templates/`. Downstream the reasoning differs but the answer matches: the `clean` convention exists because each workspace generates *different* output, and linting has no per-workspace state. The template's own `typecheck` shows the hazard — it is a turbo task, but only `packages/ui` declares a script, so `apps/web` is silently unchecked. The empty `lint` stub leaves `turbo.json`; a **deliberate** inconsistency with `clean`, recorded as such. |
| **Git hooks ship, in both repos** | husky + lint-staged + `@commitlint/config-conventional`, in this repo **and** the base template. The tool repo runs the exact hooks it ships. Commit history is already clean conventional with free-form scopes, which the default config accepts unchanged. Rejected: lefthook and simple-git-hooks — `AGENTS.md` already names husky, and neither alternative buys anything at this size. |
| **pre-commit mirrors the three passes** | lint-staged runs `eslint --fix` on staged JS/TS, `stylelint --fix` on CSS, `prettier --write` on astro/yaml/jsonc. Not a full `pnpm lint` — that throws away the reason lint-staged exists. Generate the globs from the same source as the root scripts so they can't drift. |
| **`saasaloy init` runs `git init`** | Required for husky: `init` scaffolds and then spawns `pnpm install` with no `.git`, which is husky's documented failure case. It also independently fixes the Turborepo cache-invalidation and Tailwind over-scanning that CONTRIBUTING.md already documents, and lets `play:init` drop its own `git init` so the playground finally matches the user path. **Guarded** — only when the target is not already inside a git work tree, since `saasaloy init ./apps/my-app` is a supported shape and must not nest a repo. Never throws, matching `runPnpmInstall`'s treatment of a missing `pnpm`. |
| **Prettier sweep lands with #71** | Three open PRs (#72, #74, #69) all edit files the sweep rewrites. The sweep is **not** deferred until they merge, and #71 is **not** reprioritised — whichever PRs are still open when #71 lands rebase then. |
| **CI stays in #46** | This issue owns linter selection, configuration, and making the repo pass. #46 keeps publishing and CI, including *running* the gate. Its criteria are edited here, in Phase 1, before either issue is worked. |

## Approach

### What this reuses

- **`scripts/update-deps.ts` needs no changes.** Its "Class 1" glob already discovers
  `packages/cli/templates/base/**/package.json` (`scripts/update-deps.ts:400-406`), so the
  template's new lint devDependencies — including `packages/eslint-config/package.json`,
  which the glob reaches — are tracked by `pnpm deps:update` / `deps:check` from the moment
  they land. Class 3 covers `modules/*/files/**/package.json` the same way. The repo's own
  root devDependencies stay on `pnpm outdated`/`update` per CONTRIBUTING's scope boundary.
- **`copyTemplate` needs no changes** (`packages/cli/src/lib/scaffold.ts:12-32`). Only `_foo`
  → `.foo` files are renamed — which is exactly how `_husky/` ships as `.husky/`.
- **`packages/tsconfig` is the template for `packages/eslint-config`** — same `files` /
  `exports` / `clean` shape, already proven in the base.
- **`packages/cli/tsconfig.json` and `tsconfig.scripts.json` are the type-aware projects.**
  No new tsconfig anywhere; ESLint and `pnpm typecheck` read the identical definitions.
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

- Edit #46's acceptance criteria: drop the Ultracite/oxlint+oxfmt criterion, drop the
  `allowBuilds` criterion (moot — no native binaries), and drop "The base template is excluded
  from linting" (reversed here).
- #46 keeps one lint criterion: **CI runs the lint gate on every pull request.**
- Update `docs/plans/plan-ship-the-cli-2026-08-01.md` — the **Linter** row (line 37), the
  **Template files stay unlinted** row (line 43), and **Phase 2** (lines 69–85).

### Phase 2 — Install and configure at the repo root

- `ultracite@7.10.2` plus **~35 exact-pinned devDependencies**, versions taken from
  Ultracite 7.10.2's own `devDependencies` (`eslint@^10.8.0`, `@typescript-eslint/*@^8.65.0`,
  `eslint-plugin-unicorn@^72`, `eslint-plugin-sonarjs@^4.2`, `globals@^17.7`, the
  `@tanstack/eslint-plugin-*` trio, `@vitest/eslint-plugin`, `prettier-plugin-tailwindcss`,
  the four Stylelint packages, and so on). Respect `saveExact`. ESLint 9 reached EOL
  2026-08-06, so v10 is the only supported target and `eslint-plugin-astro@3` requires it.
- **`eslint-plugin-cypress` and `eslint-plugin-storybook` are not optional.** They are
  unconditional top-level `import`s in `core/eslint.config.mjs`; omit either and the config
  throws at load. Install both and move on — this is not a trim decision.
- `eslint.config.js` composing `ultracite/eslint/core` + `astro` + `react` + `tanstack` +
  `vitest`; `prettier.config.js` spreading `ultracite/prettier` **plus**
  `prettier-plugin-tailwindcss`; `stylelint.config.js` spreading `ultracite/stylelint` with
  the extended `at-rule-no-unknown` allow-list.
- Override `parserOptions.project` with the existing-tsconfig array; add the `**/*.astro`
  parser block.
- Root scripts: `lint` (three narrow passes), `lint:fix`, `format`.
- `.prettierignore` excluding `**/*.md`.
- **Add `.dev/**` to the ESLint and Prettier ignores.** Ultracite's shared ignore list covers
  `node_modules`, `dist`, `.astro`, `.wrangler` and friends but not `.dev` — and ESLint flat
  config does not read `.gitignore`, so a root `pnpm lint` would otherwise walk the entire
  scaffolded playground.
- Remove the empty `lint` task from `turbo.json`.

### Phase 3 — Per-surface overrides

Ultracite's `core` merges `globals.browser` **and** `globals.node` into every file, which is
wrong in both directions here. These overrides are load-bearing, not polish.

- `packages/cli/src/**`, `scripts/**` — Node globals, type-aware on.
- `**/*.{tsx,jsx}` — the `core` rule-module re-application (see Design decisions).
- `modules/api/files/**`, `modules/email*/files/**`, `modules/logger*/files/**`,
  `modules/auth/files/**`, `modules/database/files/**` — Workers runtime globals (no
  `process`), type-aware **off**.
- `packages/cli/templates/base/packages/ui/**`, `modules/waitlist/files/web/**` — browser +
  React 19, type-aware **off**.
- `**/*.astro` — the parser block, type-aware **off**, with the reason in a comment.
- `**/*.test.ts` — the `vitest` preset.
- **`no-console`** with commented exemptions where console output *is* the feature:
  `packages/cli/src/index.ts` (terminal UX per [ADR 0009](../adr/adr-0009-cli-dx-clack-picocolors-2026-07-22.md)),
  `scripts/*.ts` (maintainer tooling), `modules/email-console/files/console.ts`, and
  `modules/logger-console/files/console.ts`. Current usage is 6 / 13 / 1 occurrences and
  **zero** in the base template.

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
- `pre-commit` → lint-staged with the three-pass split; `commit-msg` → commitlint.
- In the template these ship as `_husky/` (renamed to `.husky/` by `copyTemplate`).
- `HUSKY=0` documented for CI, so #46's workflow doesn't install hooks.

### Phase 7 — Ship the toolchain in the base template

- `templates/base/packages/eslint-config/` — `package.json` (name `@repo/eslint-config`,
  `exports`, `clean` script backed by exact-pinned `rimraf`), `index.js` composing `core` +
  `astro` + `react`, and the exact-pinned plugin devDependencies.
- Template root: `eslint.config.js` re-export, `prettier.config.js`, `stylelint.config.js`,
  `.prettierignore`, and `lint` / `lint:fix` / `format` scripts. No `allowBuilds` entry — the
  whole toolchain is pure JS.
- **Rewrite `templates/base/AGENTS.md`** so it stops describing tooling that doesn't exist:
  make the `pnpm lint`, `pnpm format` and `@repo/eslint-config` claims true, and rewrite the
  husky / lint-staged / commitlint entries — including the "Never Do: remove or disable
  lint-staged or commitlint hooks" line, which currently protects nothing — to match what
  Phase 6 actually ships.
- Extend `pnpm deps:verify` to run the generated project's `pnpm lint`, after `build`, so a
  template dependency bump that breaks linting fails the standing gate.

### Phase 8 — Document

- `CONTRIBUTING.md`: how to run the linter, how to add a justified suppression, the hook
  setup and how to bypass it, and the boundary against `verify-css` / `verify-preset`.
- **ADR — "the generated project ships a lint and commit-hook toolchain."** Covers the
  `packages/eslint-config` shape and the hooks as facets of one hard-to-reverse base-template
  commitment that every future module inherits.
- **ADR — "`saasaloy init` initialises a git repository."** A separate axis: a CLI product
  decision that also fixes Turborepo cache invalidation and Tailwind over-scanning, and that
  nobody would think to look for inside a linting record.

## Open questions

None. The grill closed all seven of the draft's open questions and the twenty decisions it
raised. Two items are recorded rather than open:

- **React Native, later.** No Ultracite provider ships a `react-native` preset. The mobile app
  will compose `eslint-config-expo` (57.0.1, actively maintained) alongside. Nothing to do now.
- **Git hooks for the template were scope-expanded deliberately.** The draft's non-goal list
  excluded them; the grill reversed that because `AGENTS.md` already promised them.

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
- **Fixing the template's missing `apps/web` `typecheck` script.** Found during the grill —
  `turbo run typecheck` silently covers one of two workspaces. Real, but a separate issue.
