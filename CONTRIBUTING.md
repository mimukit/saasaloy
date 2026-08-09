# Contributing

Thanks for your interest in contributing to SaasAloy. We're happy to have you here.

Please take a moment to review this document before submitting your first pull request. We also strongly recommend that you check for open issues and pull requests to see if someone else is working on something similar.

If you need any help, feel free to reach out to [[hello@mimukit.com](mailto:hello@mimukit.com)]([mailto:hello@mimukit.com](mailto:hello@mimukit.com)).

## About this repository

This repository is a monorepo.

- We use [pnpm]([https://pnpm.io](https://pnpm.io)) and `workspaces`]([https://pnpm.io/workspaces](https://pnpm.io/workspaces)) for development.

- We use [Turborepo]([https://turbo.build/repo](https://turbo.build/repo)) as our build system.

- We use [changesets]([https://github.com/changesets/changesets](https://github.com/changesets/changesets)) for managing releases.

## Manual QA: the `.dev/playground`

When you build or change a CLI command or a module, hand-test it in a throwaway
Saasaloy project under `.dev/playground` (gitignored). The workflow is worktree-safe — no
global CLI linking — and installs modules straight from *this* checkout's `modules/`, so you
QA against your uncommitted work.

Two mechanisms make this work:

- **`pnpm cli:dev`** runs `tsup --watch`, rebuilding `packages/cli/dist/index.js` on every
  source change. The playground always invokes this fresh build — never a global install — so
  concurrent git worktrees never collide.
- The generated **`.dev/playground/saasaloy` shim** is self-locating: it derives the worktree
  root from its own path and runs this checkout's CLI with `SAASALOY_REGISTRY_DIR` pointed at
  this checkout's `modules/`. So `./saasaloy add <module>` installs your local, in-progress
  module — no network fetch, no publish step.

### Setup

```sh
pnpm cli:dev            # terminal 1: rebuild the CLI on change — leave running
pnpm play:init          # scaffold .dev/playground + drop the ./saasaloy shim (no install)
cd .dev/playground
pnpm install            # run this yourself when a module adds dependencies
```

### Testing a module

From inside `.dev/playground`, drive the CLI through the shim:

```sh
./saasaloy list         # list modules from your local modules/ registry
./saasaloy add api      # install a local module (add -y to skip the confirm prompt)
pnpm run dev            # run the scaffolded app
```

Edit a module under `modules/` (or a CLI command under `packages/cli/src`), then re-run the
shim — `cli:dev` has already rebuilt, so you're always testing the latest.

### Resetting

```sh
pnpm play:reset         # destroy + re-scaffold a clean playground (you re-run pnpm install)
pnpm play:destroy       # remove .dev/playground entirely
```

### Global linking (`main` checkout only)

Sometimes you want a plain `saasaloy` on your `PATH` — to scaffold a project outside
`.dev/playground`, or to sanity-check the CLI the way an end user invokes it:

```sh
pnpm cli:link           # build the CLI and register its bin globally
saasaloy init ~/tmp/demo
pnpm cli:unlink         # remove the global bin when you're done
```

`pnpm add --global ./packages/cli` symlinks the package rather than copying it, so the global
`saasaloy` always runs the current `dist/` — keep `pnpm cli:dev` running and your edits are live.

The global bin points at **one** checkout's `packages/cli/dist/index.js`, so only link from
your primary `main` checkout — if you link from a worktree (or link one checkout while working
in another), every `saasaloy` call runs whichever build was linked last. It also resolves
modules from the published registry, not this checkout's `modules/`. For module and
uncommitted-work QA, use the playground shim above; it's worktree-safe by construction.

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm cli:dev` | `tsup --watch` — rebuild the CLI on source change |
| `pnpm cli` | run the built CLI directly (`node packages/cli/dist/index.js`) |
| `pnpm cli:link` | build the CLI and put a global `saasaloy` bin on your `PATH` (link from `main` only) |
| `pnpm cli:unlink` | remove the global `saasaloy` bin |
| `pnpm play:init` | build the CLI, scaffold `.dev/playground` (`--no-install`), copy in the `saasaloy` shim |
| `pnpm play:reset` | `play:destroy` then `play:init` |
| `pnpm play:destroy` | delete `.dev/playground` |

### Why the playground is a git repository

`play:init` no longer runs `git init` itself — `saasaloy init` does, for every project it
scaffolds (see [ADR 0024](docs/adr/adr-0024-saasaloy-init-initialises-a-git-repository-2026-08-09.md)).
The playground gets its repository the same way a user's project does, which is the point:
the two paths no longer differ.

The reasons the playground needs one have not changed, they just moved into the CLI. Three
tools in a generated project read git, and all three degrade without it:

- **husky** refuses to install commit hooks outside a work tree, and the template's
  `prepare: "husky"` runs on the very first `pnpm install`.
- **Turborepo** hashes task inputs through git. With no `.git`, `@repo/web:build` never
  invalidates when `packages/ui` changes, so `deps:verify` happily validates a **cached
  build of the previous template**.
- **Tailwind's** scanner honours `.gitignore` only via an ignore walker that needs a real
  `.git` directory. Without one it scans `node_modules` and the emitted stylesheet grows
  roughly 5x.

(The Tailwind half is also covered independently by an explicit `@source not` rule in the
template's `globals.css`, so a build before the first commit is still fine.)

## Linting and formatting

`pnpm lint` is the gate. It runs four passes and fails on the first one that finds
anything — including in `packages/cli/templates/base/**` and `modules/*/files/**`, which
are linted like any other source, because they are the code every generated project
starts from.

| Pass | Command | Covers |
| --- | --- | --- |
| `lint:types` | `oxlint -c oxlint.config.mjs --type-aware --deny-warnings packages/cli/src scripts` | the two paths with a resolvable tsconfig |
| `lint:code` | `oxlint -c oxlint.config.mjs --deny-warnings .` | everything, no type information |
| `lint:css` | `stylelint "**/*.css" --max-warnings 0` | the one CSS file we ship |
| `format:check` | `prettier --check .` | everything except Markdown |

`pnpm lint:fix` mirrors passes 1-3 — the type-aware oxlint invocation over the same two
paths, then the plain one over everything, then Stylelint — each with `--fix` instead of
its reporting flag; `pnpm format` is pass 4 with `--write`. Three things about this are
easy to get wrong:

- **The `-c` flag is not optional.** oxlint only auto-discovers `.oxlintrc.json`, and a
  JSON config cannot `extends` Ultracite's `.mjs` presets. Run it without `-c` and you are
  linting with oxlint's defaults, not ours.
- **Pass 2 re-walks the files pass 1 covered.** That is deliberate and cheap. The
  alternative — an ignore list keeping pass 2 off `packages/cli/src` and `scripts/` — is a
  second place for the path split to drift.
- **Never run `oxlint --fix-suggestions`.** On this repo it rewrites `a[i++]` to
  `a[i += 1]` in `packages/cli/src/lib/diff.ts`, which is a different program, and all 121
  tests still pass. `lint:fix` is `--fix` only.

**Markdown is not formatted**, by decision. Ultracite's Prettier config sets
`proseWrap: "never"`, which would collapse every hand-wrapped paragraph in this repo's
ADRs, plans and QA docs into a single line. `.prettierignore` excludes `**/*.md`.

### Adding a justified suppression

Fix the code first. When a rule is genuinely wrong for one place, suppress **that place**
and say why:

```ts
// for-of is not equivalent here: it would hand back the same raw AST nodes the
// callback form does, which is the whole reason this indexes.
// oxlint-disable-next-line typescript/prefer-for-of
for (let i = 0; i < array.length; i++) {
```

The directive applies to the **immediately following line**, so the reason goes above it,
not between.

Turning a rule off for the whole repo goes in the `suppressed` block in
`oxlint.config.mjs`, with its reason, in the group it belongs to. That block exists
because Ultracite enables ~470 rules and this repo had never been linted — first contact
produced ~670 findings. Everything in it is a style-tier rule that disagrees with a
deliberate convention here (`func-style`, `no-inline-comments`, `no-await-in-loop`,
`sort-keys`, the regex family, typescript-eslint's strict-type-checked tier). **No
correctness rule is in it, and none should be.** `no-control-regex` is the worked example:
it is a Possible Problems rule, it fires in exactly two places, and it is suppressed at
those two lines rather than in the block. Re-tightening one is a code change, not a
config change — see [ADR 0023](docs/adr/adr-0023-generated-projects-ship-a-lint-and-hook-toolchain-2026-08-09.md).

### Commit hooks

`pnpm install` runs `prepare: "husky"`, which installs two hooks:

- **`pre-commit`** runs lint-staged over staged files only — `oxlint --fix --deny-warnings`,
  `stylelint --fix --max-warnings 0`, `prettier --write`. It skips the type-aware pass on
  purpose: that one needs the whole project graph, which defeats staged-file scoping.
- **`commit-msg`** runs commitlint with `@commitlint/config-conventional`, so messages must
  read `type(scope): subject`. Scopes are free-form.

Bypass in a genuine emergency with `git commit --no-verify`. `HUSKY=0` skips every hook at
once, and is how CI avoids installing them.

The same stack ships in the base template, so a generated project gets it too
(`packages/cli/templates/base/_husky/` becomes `.husky/` at scaffold time — `copyTemplate`
renames leading-underscore names, and husky's shims run the hook file through `sh`, so it
needs no executable bit).

### What the linter does *not* replace

`scripts/verify-css.ts` and `scripts/verify-preset.ts` assert build-time invariants no
linter can see: that Tailwind actually scanned `packages/ui` (a non-matching `@source`
glob is silent, not an error), and that a `shadcn` preset swap left the base's
hand-written CSS intact. Both stay exactly as they are. `pnpm lint` passing says nothing
about either.

## Updating dependencies

Saasaloy ships dependency versions to downstream projects from two sets of files that
**pnpm's own tooling can't see** — the base template (`packages/cli/templates/base/**/package.json`)
and the module descriptors (`modules/*/registry-item.json`). They aren't pnpm workspace members, so
`pnpm outdated` / `pnpm update` never touch them, and because we pin **exact** versions there's
nothing for pnpm's install-time `minimumReleaseAge` cooldown to resolve either. A dedicated
maintainer command owns these files:

```sh
pnpm deps:update    # interactive: grouped report → pick which bumps → confirm → write exact versions
pnpm deps:verify    # re-scaffold .dev/playground, install, build, verify-css + typecheck the generated project
pnpm deps:check     # read-only CI gate: report drift, exit non-zero when deps:update would change something
```

`deps:update` is the day-to-day command. In a terminal it shows a semver-grouped, color-coded report
(cross-major bumps like `astro 5 → 7` get their own section), then a **group picker**: within-major
bumps come **pre-checked**, majors are listed **unchecked**, and you tick the ones you want. After a
confirm it writes the selected **exact** pins and stops — it never commits. The recommended flow is
**`deps:update` → review the diff → `deps:verify` → commit**. `deps:check` is the read-only gate for
CI/pre-push hooks, not the interactive path.

**Three dependency sites per descriptor.** A `registry-item.json` parks a version in three places,
and all three are scanned: `dependencies[]`, `devDependencies[]`, and the `range` of every
`package-json-dependency` entry in `patches[]`. That third site is how a module pins a dep into a
`package.json` a *different* module scaffolded — `database-d1` putting `wrangler` into
`packages/db`, `database-postgres` putting `postgres` there. A pin parked in a patch reaches a
downstream project exactly like a `dependencies[]` entry, so it goes through the same cooldown and
within-major gate. A patch missing `name`, `range`, or a `section` naming a real dependency map
fails the run rather than slipping past the gate.

**Resolution policy** (see [ADR 0016](docs/adr/adr-0016-in-script-cooldown-gate-for-invisible-manifests-2026-07-24.md)):
per package the resolver enumerates the npm `versions` map, **drops prereleases**, **ignores
`dist-tags`** (never trusts `latest`), caps the pre-checked default at the **highest eligible version
within the current major**, and requires the publish time to clear `minimumReleaseAge` (read from
`pnpm-workspace.yaml`). Everything is pinned **exact**. Each manifest resolves independently; a shared
dep whose major diverges from the repo's own pin is printed as an informational note.

- **Majors** — never applied by default. Cross one **deliberately**: tick it in the picker's **Major**
  group, or pass `--allow-major` for a non-interactive run. Majors are where the template breaks
  (`astro 5→6`, `wrangler 4→5`), so each is blessed by hand.
- `--allow-fresh` — override the cooldown for a knowing security-fix bump (the audited path;
  replaces `minimumReleaseAgeExclude`). Held-back deps then arrive pre-checked.
- `--yes` / `-y` — skip the picker and confirm; apply all eligible bumps (majors only with
  `--allow-major`). A non-TTY pipe behaves the same. For CI writes / automation.
- `--dry-run` — **print-only preview**: prints the report and the "would update" list a
  default apply would make, then stops. It never opens the picker and never writes.

**Scope boundary:** these commands own only the invisible files (template + descriptors). The tool
repo's own workspace deps (root, `packages/cli`) stay on `pnpm outdated` / `pnpm update`.

| Script | What it does |
| --- | --- |
| `pnpm deps:update` | interactive select-and-confirm; writes exact pins (`--yes`, `--allow-major`, `--allow-fresh`, `--dry-run`) |
| `pnpm deps:check` | read-only gate; non-zero exit iff a default `deps:update` would change something |
| `pnpm deps:verify` | `play:init` → install → build → `verify-css` → typecheck the generated project (post-update gate) |

`verify-css` (`scripts/verify-css.ts`) covers the one template break that `build` and
`typecheck` are both blind to: Tailwind silently dropping every utility class written in
`packages/ui`. Its class detection is rooted at the current working directory — which is
`apps/web` — so only the explicit `@source` globs in the template's `globals.css` reach
`packages/ui`, and a glob that matches nothing is not an error. The script asserts that a
sentinel utility declared only in `packages/ui/src/lib/sentinel.ts` actually landed in the
built CSS. If it fails, suspect those globs before anything else.

`verify-preset` (`scripts/verify-preset.ts`, run with `pnpm verify:preset`) is the drill
for **`shadcn` bumps specifically**. The template's `AGENTS.md` documents swapping a
project's whole token set with `shadcn add <registry:style url>`, which works only
because shadcn merges into the base's `globals.css` instead of overwriting it. The script
runs that recipe for real against a fresh playground and asserts the base's own rules —
the three `@source` globs, `@custom-variant dark`, `@layer base`, one each of `:root` /
`.dark` / `@theme inline` — survived, `components.json` was untouched, and the swapped
`--primary` reached the built CSS.

It is **deliberately not part of `deps:verify`**: it fetches a preset from a third party,
and the standing green gate must not depend on someone else's uptime. Run it by hand
alongside `deps:verify` when `deps:update` moves `shadcn`.

`verify-content` (`scripts/verify-content.ts`, run with `pnpm verify:content`) guards the
template's **content module**. Every word the scaffolded landing page shows lives in
`packages/ui/src/content/landing.ts` — `landing.*` for marketing copy, `ui.*` for chrome
and accessibility labels — which is what lets a project owner (or the
`saasaloy-landing-copy` skill) rewrite the copy in one file. Write a string back into a
block and nothing complains: the build is green, the types are green, and the string is
once again something a founder has to hunt for in markup. The script scans
`packages/cli/templates/base/packages/ui/src/blocks/*.tsx` (and the page that composes
them, `apps/web/src/pages/index.astro`) and fails on three shapes — a prose string
literal, text sitting directly in JSX (`<Badge>Most popular</Badge>`), and a spoken
attribute written as a literal (`aria-label`, `alt`, `title`, `placeholder`). Class names
are exempt; a Tailwind string is not copy.

It is textual, not a TypeScript parse (node: builtins only, like `verify-css`), so it
catches drift rather than proving absence — and it self-tests its own rules on fixtures
first, so a scanner that stopped matching fails loudly instead of passing everything. Run
it by hand after touching a block or the content module; it is **not** in `deps:verify`,
which builds a playground to answer a different question.

