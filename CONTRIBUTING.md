# Contributing

Thanks for your interest in contributing to SaasAloy. We're happy to have you here.

Please take a moment to review this document before submitting your first pull request. We also strongly recommend that you check for open issues and pull requests to see if someone else is working on something similar.

If you need any help, feel free to reach out to [[hello@mimukit.com](mailto:hello@mimukit.com)]([mailto:hello@mimukit.com](mailto:hello@mimukit.com)).

## About this repository

This repository is a monorepo.

- We use [pnpm]([https://pnpm.io](https://pnpm.io)) and `workspaces`]([https://pnpm.io/workspaces](https://pnpm.io/workspaces)) for development.

- We use [Turborepo]([https://turbo.build/repo](https://turbo.build/repo)) as our build system.

- We do not use changesets. The CLI is published to npm as [`saasaloy`](https://www.npmjs.com/package/saasaloy), and the maintainer cuts each release by hand with [release-it](https://github.com/release-it/release-it). See [Releasing](#releasing).

## The public site's dev port

`pnpm dev` starts the public site (`apps/web`) on port 3000 in the main checkout. A linked worktree takes its own port from 10000 to 19999 instead, so two worktrees can run the site at once. Run `wtports` in the worktree before the first `pnpm dev`: it reads `.devports.json`, hashes the repository, the service and the branch into a port, and writes `DEV_PORT` into a marked block in `apps/web/.env.local`. `apps/web/astro.config.mjs` reads `DEV_PORT` from that file, and a `DEV_PORT` in the shell wins over it. `wtports list` shows the port of every worktree, and `wtports clean` removes the block. Astro also allows one `astro dev` per folder, so a second `pnpm dev` in the same worktree stops with "Another astro dev server is already running". Stop the first one with `pnpm --filter @saasaloy/web exec astro dev stop`, or press Ctrl-C in its terminal. A service you add to the dev setup gets an entry in `.devports.json` in the same change.

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
pnpm play:init          # scaffold .dev/playground, drop the ./saasaloy shim, install, commit a baseline
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

### Live module sync

`pnpm play:watch` removes the re-run. Leave it running in its own terminal, next to `pnpm run dev` in the playground:

```sh
pnpm play:watch         # terminal 2: sync module edits into the playground
```

When a file under `modules/<module>/files/` or `modules/<module>/registry-item.json` changes, the watcher runs `./saasaloy add <module> --force --yes` for that module, about 0.7s, and prints the files it wrote. A module the playground has not installed is skipped. The dev server then picks the file up the way it picks up any edit.

`add --force` never overwrites a playground file you edited by hand. The watcher prints each one as `kept`: make the edit in `modules/` instead, or run `pnpm play:restore`. A `registry-item.json` change re-applies the patches, but a patch or file you removed from the descriptor stays in the playground until `pnpm play:restore`.

The watcher also re-scaffolds the base when `packages/cli/templates/base` changes, but only while no module is installed. `init --force` resets `saasaloy.json` to a base-only project, so with modules installed it prints a warning instead, and `pnpm play:reset` picks the template edit up.

### Unit tests over module payloads

`pnpm test` is three passes. `turbo run test` runs the CLI's vitest suite, `pnpm test:modules`
runs `node --test` over `modules/*/files/**/*.test.ts` — the security-relevant pure functions a
module ships, such as `deriveCookieDomain` and `requireAuthSecret` in `modules/auth/files/src/env.ts` —
and `pnpm test:scripts` runs the same runner over `scripts/**/*.test.ts`, which today covers the
write path of `scripts/update-deps.ts`, the pin rules in `scripts/verify-pins.ts`, and the two
release scripts' pure decisions — the `workspace:` detector in `scripts/release-smoke.ts` and the
skip flag in `scripts/release-preflight.ts`.

That last file guards its `main()` call behind a `process.argv[1]` check, because a test importing
its helpers must not start a registry scan. Keep the guard if you add another script test.

`scripts/provider-selection.test.ts` checks the `<CAP>_PROVIDER` rule in every capability core: a
module with both `files/src/define.ts` and a `files/src/providers/` folder. It imports each core's
`define.ts`, so `pnpm test:scripts` loads `scripts/ts-resolve-hook.ts`, the hook `test:modules`
uses. A new core fails that test until you add its row to `CORES`, with its env key, its
`define<Cap>` export and its mode (`required`, `optional` or `list`).

The second pass uses Node's own test runner rather than vitest, and the reason is mechanical.
Vite loads a tsconfig for every file it transforms; a module payload's `tsconfig.json` extends
`@repo/tsconfig/base.json`, which resolves only inside a scaffolded project, so vitest fails those
files with `TSCONFIG_ERROR` before an assertion runs. Node 24 strips the types with no tsconfig at
all — the same reason `scripts/*.ts` needs no build step.

Two rules for a test under `modules/`:

- Keep it out of the descriptor's `files` and `scaffolds[].files` lists, so `add` never copies it
  into a user's project.
- Import with the explicit `.ts` extension (`from "./env.ts"`). Node resolves the real file. Shipped
  payload code keeps the extensionless style the bundler expects.

A payload file may import a sibling. `pnpm test:modules` runs with `--import ./scripts/ts-resolve-hook.ts`, a `registerHooks` resolver that appends `.ts` to an extensionless relative specifier, so `import { defineQueue } from "./define"` inside a payload resolves under `node --test` without putting a non-portable extension into every generated project. The hook touches relative specifiers only.

What still will not resolve is anything outside the payload: `cloudflare:workers`, `better-auth`, or a `@repo/*` workspace package all need a scaffolded project. Extract the pure part into its own file first, the way `auth.ts` extracted `env.ts`.

### The two suites `pnpm test` does not run

Two more suites live under `packages/cli/test/` and run on their own scripts, because both need
something the unit run does not: a build, or the whole `modules/` directory.

```sh
pnpm --filter saasaloy build      # both suites assume dist/ is current
pnpm --filter saasaloy test:e2e   # spawn the real binary against a temp project
pnpm --filter saasaloy test:matrix # every module and every pair of modules
```

`test:e2e` runs `dist/index.js` as a subprocess — `init`, then `add` — and asserts on the files
that land, not on the log. It is the only place argument parsing, the preserved shebang, the exit
codes and the published `files` array are all exercised together. Set `SAASALOY_E2E_BIN` to run the
same suite against an installed tarball instead of `dist/`.

`test:matrix` reads `modules/*/registry-item.json` off disk and checks every module alone and every
pair together for a file collision, an alias registered twice for different directories, or one npm
package pinned to two versions. Nothing maintains the list: a new module joins the matrix by
existing. A failure is named by the pair, so it says which two modules disagree.

Fixtures for both live in `packages/cli/test/fixtures/`, outside `src/` because several are invalid
by design — `registry-broken/` is what `saasaloy doctor`'s tests read, and one descriptor there is
not parseable JSON at all. That directory is in `.prettierignore` for the same reason.

### Starting a module

`saasaloy new module <name> [--type <tier>] [--depends-on <a,b>]` writes the skeleton: a schema-valid
`modules/<name>/registry-item.json`, an empty `modules/<name>/files/`, and a
`modules/<name>/skills/saasaloy-<name>/SKILL.md` stub whose frontmatter already matches the folder.
It prompts for the tier and the dependencies when you leave the flags off, runs the `doctor` checks
over what it wrote, and refuses inside a generated project — a `modules/` folder means nothing in a
repo that installs modules rather than hosting them. The `create-module` skill runs this command for
the skeleton and keeps the judgment: which tier, which conventions, and how thin a vertical slice can
be. One scaffolder, not two.

A module that ships a table names it in plural snake_case, and exports it under the camelCase
plural: `featureFlagOverrides` on `feature_flag_overrides`. That covers Better Auth plugin tables
too. The adapter runs with `usePlural: true` and finds a table by its export key, so a singular key
type-checks and then fails every auth call. A plugin with a custom `modelName: "X"` needs the export
`Xs`. `pnpm test:scripts` runs `scripts/table-names.test.ts`, which checks every
`modules/*/files/db/schema/*.ts` file. The rule and its reasons are in
[ADR 0038](docs/adr/0038-adr-table-names-are-plural-snake-case-2026-09-12.md).

### Checking a descriptor you wrote

`saasaloy doctor [path]` validates module descriptors against `registry-item.schema.json` and against
the conventions the schema cannot express: that every declared file is on disk, that every `target`
names an alias the base template or some scaffold in the registry defines, that `dependsOn` resolves
within the registry, that npm deps are exact-pinned, and that each `agent.skills` folder exists and
carries the `saasaloy-` prefix ADR 0014 requires. It also checks that a `requires.saasaloy` range is
a range it can parse — structurally only, never against the version of the CLI you happen to be
running, because your CLI is not your consumer's. It reports every violation, not the first, and
exits 2 when it finds any — so it works as a pre-publish gate.

### Declaring the CLI a descriptor needs

A descriptor sets `additionalProperties: false`, so an old CLI meeting a field it has never heard of
already fails — as a raw Ajv dump, and not at all when an existing field merely changed meaning. The
optional `requires.saasaloy` field turns both into one sentence, checked before any write is planned:

```json
{ "name": "waitlist", "type": "saasaloy:feature", "requires": { "saasaloy": ">=0.3" } }
```

Any semver range works, upper bounds included (`>=0.3 <2`, `^1.2.0`, `1.x`), so there is no separate
maximum field. A CLI outside the range refuses the whole run and writes nothing, and it does so for a
transitive `dependsOn` too — the message names the module in the chain that declared the range, not
the one you typed. The matcher is `packages/cli/src/lib/semver.ts`, ~400 lines owned rather than the
`semver` package added as a runtime dependency for one boolean.

The floor is also read off the raw JSON when a descriptor fails the schema, so a CLI meeting a field it does not know prints the upgrade line rather than the Ajv dump (#205). That only works for a CLI that already has the check: 0.5.2 and older validate first and print the dump whatever the floor says.

`packages/cli/src/lib/registry-floors.test.ts` keeps the floors honest. It reads the descriptor schema at every `v*` tag out of git and fails when a descriptor some release cannot read declares no floor, or a floor that release still satisfies. It also fails when the floor excludes the CLI in this tree, and when the schema changed since the latest tag while `packages/cli/package.json` still names that tag's version. A CLI change a descriptor opts into by value rather than by a new field, such as the `@root` alias, has no schema trace, so the test carries a `BEHAVIOURS` table: add a row with the version that ships it.

```sh
pnpm cli doctor modules            # the whole registry
pnpm cli doctor modules/waitlist   # one module
pnpm cli doctor .dev/playground    # a scaffolded project: installed vs manifest, plus the base
```

It reads local folders only. Validating a remote coordinate is a separate command and a follow-up.

Pointed at a project, `doctor` also prints a Base section: which CLI recorded the base template, which base files were edited since, which are missing, and the seed files it does not check. A project with no record reads `untracked`, and `saasaloy update` is what records it (ADR 0032).

### Changing the base template

Every file under `packages/cli/templates/base/` is a tracked file in a scaffolded project, recorded at `init` under the module name `base` with the sha256 of its raw render and the release that wrote it. `saasaloy outdated` compares the lock's release with the running CLI's, and `saasaloy update` then writes the clean copies and merges edited ones three ways, so an edit to the template reaches every project at the next release. Two rules follow. A file the owner is meant to rewrite goes in `_saasaloy-base.json`'s `seedFiles` or `ownedFiles`, which makes it a `once` file (ADR 0067); a test asserts every listed `seedFiles` path exists. And the declaration itself is never copied: `copyTemplate` skips it by name before the `_` to `.` rename. A module marks the same kind of file with `"seed": true` on its `files[]` or `scaffolds[].files[]` entry: written once, never overwritten or merged by `update` unless `update --merge <path>` asks, and kept by `remove` once changed (ADR 0060, ADR 0067).

### One-command bring-up

```sh
pnpm play:up                    # the full preset on Postgres in a Compose container
pnpm play:up --preset minimal   # the base template only
pnpm play:smoke                 # every installed module's smoke checks
pnpm play:down                  # stop the dev servers play:up started
```

`play:up` stops the playground's own dev servers, deletes `.dev/playground`, and then builds the CLI, scaffolds, adds the preset's modules with `database-postgres`, installs, writes `packages/env/.env` from the preset, runs `pnpm env:setup`, `db:generate`, `pnpm db:setup` and `pnpm db:seed`, commits a baseline, and starts every app's `pnpm dev` in the background. It ends when the web (3000), admin (3001), app (3002) and api (4000) ports answer. Logs and pid files go to `.dev/play/`. Every dev port is `strictPort`, so `play:up` refuses to start when a process from another checkout holds one, and it names that process. It never stops a process outside the playground.

The presets live in `scripts/play-presets.json`: a module list and an `env` map each. `full` is every module with a local provider, so it needs no vendor account and no network. `BETTER_AUTH_SECRET` stays unset, and Better Auth then uses its dev key on the loopback `BETTER_AUTH_URL`. Sign in as `superadmin@example.test`, `admin@example.test` or `member@example.test` with the password `saasaloy-dev-password`; `banned@example.test` is refused.

`play:up` gives this checkout its own Compose project (`playground-<hash>`), removes that project's container and named volume, and refuses when another Postgres answers on 5432. Remove the container when you are done with `docker compose --project-name playground-<hash> down --volumes`, using the name `docker ps` shows.

A module can ship `modules/<name>/smoke.ts`, beside its descriptor. It is never copied into a project. It drives the api over HTTP only, and it uses the helper in `scripts/smoke.ts`, which signs a seeded user in on the client (`/auth`) or admin (`/admin/auth`) surface, keeps the cookie, and prints one `PASS` or `FAIL` line per check. `pnpm play:smoke` runs the script of every installed module in install order, prints the total, and exits 1 on any failure. Run it on a fresh seed.

### Resetting

```sh
pnpm play:restore       # back to the baseline commit in about a second, node_modules kept
pnpm play:restore --db  # also stop the api, wipe the database, migrate
pnpm play:snap          # commit the current playground as the new baseline
pnpm play:reset         # destroy + re-scaffold a clean playground
pnpm play:destroy       # remove .dev/playground entirely
```

The playground is a git repository, and `play:init` commits a baseline after the install. `play:restore` runs `git reset --hard` and `git clean -fd` against it, then `pnpm install`. Ignored files stay, so `node_modules` and the env files survive a restore. The Postgres database lives in a Docker volume outside the playground, and only `--db` resets it. Add the modules you test most, run `pnpm play:snap`, and every later restore returns to that state. `git diff` in the playground shows exactly what an `add` wrote.

`play:restore --db` stops whatever listens on the api port (4000) with its workerd children, and waits for them to exit, so no running api holds a connection to the database the reset drops. It then runs `db:generate`, wipes and migrates the database, and prints the command that starts the api again. It does not start the api itself, so the api runs in your own terminal with its output in view. The wipe drops the `public` and `drizzle` schemas at `DATABASE_URL`, read from the environment or from `apps/api/.env`.

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
| `pnpm play:init` | build the CLI, scaffold `.dev/playground` (`--no-install`), copy in the `saasaloy` shim, `pnpm install`, commit a git baseline |
| `pnpm play:watch` | re-run `add <module> --force` when an installed module's files or descriptor change |
| `pnpm play:snap` | commit the current playground as the new baseline |
| `pnpm play:restore` | reset the playground to its baseline and `pnpm install`; `--db` also resets the database |
| `pnpm play:up` | a fresh playground from a preset, migrated, seeded, with every app's dev server running; `--preset minimal\|full` |
| `pnpm play:down` | stop the dev servers `play:up` started |
| `pnpm play:smoke` | run every installed module's `modules/<name>/smoke.ts` against the running playground |
| `pnpm play:reset` | `play:destroy` then `play:init` |
| `pnpm play:destroy` | delete `.dev/playground` |
| `pnpm --filter saasaloy test:e2e` | spawn the built binary against a temp project |
| `pnpm --filter saasaloy test:matrix` | check every module and every pair of modules |

### Why the playground is a git repository

`play:init` no longer runs `git init` itself — `saasaloy init` does, for every project it
scaffolds (see [ADR 0024](docs/adr/0024-adr-saasaloy-init-initialises-a-git-repository-2026-08-09.md)).
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

`play:snap` and `play:restore` need the repository too. The playground sits inside this repository's work tree, so `init` runs `git init` there only because `.dev/` is ignored: `git check-ignore` is the second half of the nesting guard. Until #178 the CLI asked only the first half, and the playground got no repository at all.

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

For a quick local check, `pnpm format:check:cached` runs pass 4 with Prettier's cache, which cuts a repeat run from about 20s to about 5s. Keep the cache out of `format:check` itself. The cache key holds the Prettier version and options but not the plugin versions, so a plugin bump can leave a stale pass for a file that did not change, and `pnpm lint` is the gate the release preflight and CI run.

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
config change — see [ADR 0023](docs/adr/0035-adr-generated-projects-ship-a-lint-and-hook-toolchain-2026-08-09.md).

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
`pnpm outdated` / `pnpm update` never touch them. A dedicated maintainer command owns these files:

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
`package.json` a *different* module scaffolded — `database-postgres` putting `postgres` into
`packages/db`. A pin parked in a patch reaches a
downstream project exactly like a `dependencies[]` entry, so it goes through the same within-major
gate. A patch missing `name`, `range`, or a `section` naming a real dependency map
fails the run rather than slipping past the gate.

**Writes are text edits, not reserializations.** `deps:update` changes a version with
`jsonc-parser`'s `modify` + `applyEdits` over the file's own bytes, so a bump is a one-line diff
and the rest of the document is untouched. It used to reserialize the parsed document with
`JSON.stringify(json, null, 2)`, which is byte-stable for a prettier-formatted `package.json` but
explodes every compact one-line array a hand-authored descriptor holds — `dependsOn`, `files`,
`agent.skills` — turning a one-character bump into a ~60-line diff (issue #93). That is why
`jsonc-parser` is pinned in the **root** `devDependencies` and not only in `packages/cli`:
`scripts/` runs under bare `node` with type stripping, with no bundler and no build step, so its
imports have to resolve in the root `node_modules`, and pnpm's isolated layout will not surface a
`packages/cli` dependency there. Keep the two pins on the same version.

**Resolution policy** (see [ADR 0016](docs/adr/0016-adr-in-script-cooldown-gate-for-invisible-manifests-2026-07-24.md)):
per package the resolver enumerates the npm `versions` map, **drops prereleases**, **ignores
`dist-tags`** (never trusts `latest`), and caps the pre-checked default at the **highest stable version
within the current major**. There is no release-age cooldown: you run `deps:update` by hand and pick
each bump, and `deps:verify` installs and builds the result. Everything is pinned **exact**. Each manifest resolves independently; a shared
dep whose major diverges from the repo's own pin is printed as an informational note, and so is a dep
name that resolves to two different exact versions across the scanned manifests in one run. Both notes
are informational: neither writes a change and neither affects the `deps:check` exit code.

- **Majors** — never applied by default. Cross one **deliberately**: tick it in the picker's **Major**
  group, or pass `--allow-major` for a non-interactive run. Majors are where the template breaks
  (`astro 5→6`, `wrangler 4→5`), so each is blessed by hand.
- `--yes` / `-y` — skip the picker and confirm; apply all eligible bumps (majors only with
  `--allow-major`). A non-TTY pipe behaves the same. For CI writes / automation.
- `--dry-run` — **print-only preview**: prints the report and the "would update" list a
  default apply would make, then stops. It never opens the picker and never writes.

**`wrangler` and `@cloudflare/vite-plugin` move together.** Each plugin release refuses to start a dev server against a wrangler older than the one it was released with. `@astrojs/cloudflare` takes the plugin through a caret range, so the web template pins the plugin as a direct devDependency, which makes pnpm install that version for the adapter too (issue #186). Take both bumps in one `deps:update` run. `verify-pins` fails when the plugin pin differs between `apps/web` and `apps/api`, or when any Cloudflare workspace pins a different `wrangler`.

**The `deps:verify` playground has its own git repository.** `saasaloy init` runs `git init` in `.dev/playground` because this repo ignores `/.dev/`. Without a `.git` of its own, the playground would inherit this repo's `.gitignore`, so oxlint would find no files and the lint step would fail with "No files found to lint".

**Scope boundary:** these commands own only the invisible files (template + descriptors). The tool
repo's own workspace deps (root, `packages/cli`) stay on `pnpm outdated` / `pnpm update`.

| Script | What it does |
| --- | --- |
| `pnpm deps:update` | interactive select-and-confirm; writes exact pins (`--yes`, `--allow-major`, `--dry-run`) |
| `pnpm deps:check` | read-only gate; non-zero exit iff a default `deps:update` would change something |
| `pnpm deps:verify` | `verify-pins` → `play:init` (which runs `git init` and installs) → build → lint → `verify-css` → typecheck the generated project (post-update gate) |
| `pnpm verify:a11y` | axe, overflow, reduced-motion, skip-link, island and metadata checks over the built playground at four widths in both themes (by hand, and nightly in `smoke.yml`) |
| `pnpm verify:e2e` | scaffolds a clean playground with the `e2e` module and runs its Playwright suite against the running apps on Postgres (by hand, and in `e2e.yml` on a path filter) |

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
because shadcn merges into the base's `brand.css` instead of overwriting it, and leaves
the shared `globals.css` and the landing `web.css` alone. The script runs that recipe for
real against a fresh playground and asserts that `globals.css` and `web.css` were
untouched and `globals.css` still holds the `@source` rules and `@layer base`; that the
three files hold one each of `:root`, `.dark`, `@theme inline` and `@custom-variant dark`
between them; that `components.json` was untouched; that `apps/web/DESIGN.md`'s
fingerprint of `brand.css` went stale; and that the swapped `--primary` reached the built
CSS.

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

`verify-a11y` (`scripts/verify-a11y.ts`, run with `pnpm verify:a11y`) is the landing page's production bar from plan 0068. It serves the built playground from `node:http`, drives Playwright's Chromium over `/`, `/terms`, `/privacy` and `/404` at 360, 768, 1280 and 1536 px in the light and the dark theme, and fails on any axe violation at `wcag2a`, `wcag2aa` and `wcag21aa`, a document wider than its viewport, an animation that runs under reduced motion, or a first Tab stop that is not a skip link to `<main>`. On `/` it also checks that only `Navbar` and `PricingTable` hydrate and that the Open Graph, Twitter and canonical tags are present. The rubric it enforces is `docs/qa/0058-qa-landing-page-rubric-2026-10-18.md`.

It needs a built playground and a browser, so it is **not** in `deps:verify` or `ci.yml`. Run it by hand after touching a block, the layout or the theme:

```sh
pnpm play:init
cp .dev/playground/packages/env/.env.example .dev/playground/packages/env/.env
pnpm -C .dev/playground env:setup
pnpm -C .dev/playground build
pnpm exec playwright install chromium   # once per machine
pnpm verify:a11y
```

The `a11y` job in `.github/workflows/smoke.yml` runs the same steps every night.

`verify-e2e` (`scripts/verify-e2e.ts`, run with `pnpm verify:e2e`) is the gate for the **`e2e` module**. It runs `play:reset`, adds the driver plus `auth`, `admin`, `waitlist` and `e2e` through the local-registry shim, places the waitlist form the way a project owner would, writes every service's `.env` from the example's local defaults, generates the migrations, downloads Chromium, lints and typechecks `packages/e2e` in the project, and runs `pnpm e2e`. The suite migrates and seeds the database, starts the apps, signs the seeded superadmin in, submits the waitlist form and checks that a guarded route refuses an anonymous caller.

The run uses Postgres, the only database. Run it when the module, the base template or Playwright moves. Locally the run starts the driver's own `compose.yaml` container, which needs a Docker daemon. That container is named after the playground directory, so every worktree's playground on one machine shares it. To keep a run off it, point the run at a server of your own:

```sh
pnpm verify:e2e
E2E_DATABASE_SERVER=postgres://postgres:postgres@127.0.0.1:55432/postgres E2E_DB_SETUP_ARGS=--server pnpm verify:e2e
```

It is **deliberately not part of `deps:verify`**: it downloads a browser and takes minutes. `.github/workflows/e2e.yml` runs it as one job on a pull request that touches `modules/**`, the CLI or its templates, with Postgres from a service container.

`scripts/e2e-tags.test.ts` is the cheap half of the same guard and runs in `pnpm test`. It asserts that every tag in the suite's `SPEC_TAGS` names a real directory under `modules/`, and that every tag a spec writes is declared. A tag naming no module is never in any project's `installed`, so its spec is uncollected everywhere and the suite still reports green, which is exactly what a module rename would cause.


## Releasing

Only the maintainer releases. The maintainer cuts each release by hand from a `main` checkout with `pnpm release`, which tags and pushes but never publishes. The tag push starts `.github/workflows/publish.yml`, and that workflow publishes to npm after the maintainer approves it on GitHub ([ADR 0064](docs/adr/0064-adr-the-cli-publishes-from-a-tag-started-approved-oidc-workflow-2026-11-19.md)). The `ci` workflow is a gate and never touches npm.

An agent can do the release with the maintainer. The repo skill [`release`](.agents/skills/release/SKILL.md) runs the checks below in order, asks the maintainer to confirm the version and the command, runs the release, and stops for the npm approval. It follows this section and does not copy it, so a rule changes here and nowhere else.

One package is published — `packages/cli`, as [`saasaloy`](https://www.npmjs.com/package/saasaloy). The root package is private and stays at `0.0.0` forever. Modules are not published; the repo is the registry (ADR 0012).

### When to release

After a merged pull request, if it changed `packages/cli/**` (source, templates, or schemas) or `modules/**`.

- A PR that only touched `modules/**` needs a release too. The CLI reads the default registry at the tag of its own version ([ADR 0062](docs/adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md)), so a module change reaches a plain `saasaloy add` at the next release. Until then it reaches only someone who asks for it with `saasaloy add <module>@main`. A module hotfix is a CLI patch release.
- A PR whose commits are all `docs`, `chore`, or `refactor` gets **no release**. Nothing a user runs changed.

Nothing enforces this. Read the diff and decide.

### Picking the bump

release-it always asks. It never picks for you, because on `0.x` the conventional-commit recommendation is wrong more often than it is right.

Before `1.0.0`:

- A **breaking change** is a **minor** bump. `0.x` has no other channel for one.
- `feat` is a **minor** bump.
- `fix` and `perf` are a **patch** bump.

`1.0.0` is a deliberate decision about the engine being stable. It is never the answer to a prompt you clicked through.

### Breaking changes need an update note

A breaking commit is one with `!` before the colon (`feat!:`, `feat(cli)!:`) or a `BREAKING CHANGE:` footer. It does one of two things in the same commit:

- It adds a note under `packages/cli/update-notes/` or `modules/<name>/update-notes/`. The note tells the agent in a scaffolded project what to change by hand.
- It carries the footer `Update-Note: none (<reason>)`, for a break that needs nothing from a project. The reason must not be empty.

If a breaking commit lands without its note, a later commit adds the note and carries the footer `Update-Note-For: <full sha>`. Name the breaking commit by its full 40-character SHA (`git rev-parse <short sha>`), because a short SHA can become ambiguous. One commit may carry several of these footers, one for each breaking commit it covers. The preflight counts the notes that commit adds for each commit it names.

The preflight fails on a breaking commit since the last tag that has no note of its own, no later note and no opt-out. It prints each opt-out reason and each late note with the commit's short SHA and subject. It warns about an `Update-Note-For:` footer that names a short SHA, names a commit that is not a breaking commit since the last tag, or sits on a commit that adds no note, and it quotes the footer. Such a footer covers nothing, so the breaking commit it meant to cover still fails as a missing note. The check warns instead of failing because a commit on `main` cannot change, and a failure would stop every later release. The commit-msg hook rejects an `Update-Note:` footer that is not `none (<reason>)` with a non-empty reason, and an `Update-Note-For:` footer that is not a full SHA.

The changelog stays short. For each breaking item, `packages/cli/.release-it.js` appends a link to the note file that commit added, or that a later commit added with `Update-Note-For:`, at the release tag. The full steps live only in the note. `scripts/changelog-update-notes.ts` holds that logic, and `scripts/update-note-footer.ts` holds the footer rule both checks share.

### The agent benchmark

The agent benchmark is on demand. It never blocks a release. A run takes about an hour and costs agent usage, so the maintainer decides when to run it. The preflight and the `release` skill suggest a run when the changes since the last tag touch a base skill, the unattended CLI contract or a module of the scaffold set, and no score report covers them. Any other release gets no suggestion. `scripts/bench-gate.ts` holds each definition, and `scripts/release-preflight.test.ts` pins them:

- A base skill is any file under `packages/cli/templates/base/_agents/skills/`.
- The unattended CLI contract is the six files that hold the no-TTY refusals, the exit codes, the `--json` documents, `env --from-file` and `list --json` (ADR 0046): `packages/cli/src/lib/prompts.ts`, `tui.ts`, `exit.ts` and `json-output.ts`, and `packages/cli/src/commands/env.ts` and `list.ts`. Their tests do not count.
- The scaffold set is `MVP_MODULES` in `scripts/scaffold-check.ts`, the list the `scaffold` CI job builds. It is the widest common build, not a set every build installs: since ADR 0069 a build installs only the modules the owner approves. Any file under `modules/<name>/` of one of them counts.
- A score report is a file in `docs/research/` named `NNNN-research-agent-bench-<slug>-YYYY-MM-DD.md`. It holds the `score.md` of one run for each folder under `scripts/agent-bench/briefs/` (Shelfnote, Prepline and Receiptbox). Each run must be in interview mode, and its `Revision:` must be an ancestor of HEAD with no gated change after it. The newest such report decides. It covers the release when it holds no FAIL line: no table cell that reads FAIL, and no line that starts with `FAIL`.

To make the report, run each brief on this box: `node scripts/agent-bench.ts --interview --brief <name>`. The agent starts from one sentence (`scripts/agent-bench/opening.md`), and the harness answers each question of the interview from the brief's `answers.md`, one agent call per turn. The run folder goes to `~/.cache/saasaloy-bench/` (`--runs <dir>` moves it, never into the repo), and the run takes its own block of ports from 10000 up, so other dev servers may keep ports 3000 to 4004. The harness has no default agent. It asks you to select Claude or Codex in a terminal. For a non-interactive run, specify `--agent claude` or `--agent codex`. A custom command still works through `--agent "<command>"`. Claude uses its latest `opus` alias. Codex selects the newest versioned Sol model from the logged-in user's `models_cache.json` and keeps that choice for the interview. Both adapters use medium effort. Pass overrides inside the agent command, such as `--agent "codex --model gpt-6.2-sol --effort high"` or `--agent "claude --model opus --effort high"`. If the Codex cache has no Sol model, specify the model explicitly. A runtime rescore asks for an agent again; `--score <run-dir> --static` needs none. Each `score.md` records the turns, the time and the cost the agent reported. Copy the three into one research report beside `docs/research/0005-research-agent-bench-baseline-2026-10-24.md`, and commit it on `main`. The brief mode of the October baseline still runs without `--interview`: it hands the agent `brief.md` and `env`.

Two bar lines check that the built product is usable by agents (plan 0110). With the dev servers up, the scorer signs up a fresh user and issues it a key through `/auth/api-key/create`, with the read and write scopes that `/openapi.json` states for the spec's first entity and no delete scope. The first line runs `pnpm agent:audit --require-key --json` with that key and passes on exit 0 with `agent` installed. The second starts one more call of the same agent command in an empty temp folder, with only the site's address and the key (`scripts/agent-bench/second-agent.md`). It passes when the transcript holds an MCP `tools/call`, the scorer reads a row of the entity back through MCP with the key, and the agent's last line `READ BACK: <id>` names that row. `scripts/agent-bench/agent-use.ts` and `second-agent.ts` hold the details, and `agent-key.json` and `second-agent/` in the run's out folder hold the evidence.

### Running it

From a clean `main` checkout — not a worktree, because the release commit and tag belong on `main`:

```sh
pnpm release
```

Both release scripts read `GITHUB_TOKEN` from your shell and fall back to `gh auth token`, so you do not pass it by hand. Without a token release-it does not stop; it falls back to a web release and puts the whole changelog in a `releases/new` query string, and GitHub answers 414. The preflight fails on an empty token for that reason.

That bumps `packages/cli/package.json`, prepends a section to `packages/cli/CHANGELOG.md` written from the commits, commits it as `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes, and creates the GitHub Release. It prompts before each step. It does not publish to npm: `packages/cli/.release-it.js` sets `npm: { publish: false }`, so release-it's npm plugin only bumps the version.

The tag push starts the `publish` workflow. A published CLI reads the modules at its own tag, so the tag must be on GitHub before npm offers the version to anyone, and a publish that starts from the tag push has that order by construction. `scripts/release-order.test.ts` fails the gate when a release-it dry run shows an `npm publish` step, or when `publish.yml` starts on anything but a `v*` tag push, gives an OIDC token to a job outside the `npm` environment, or names an action by tag instead of a commit SHA. See [ADR 0062](docs/adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md) and [ADR 0064](docs/adr/0064-adr-the-cli-publishes-from-a-tag-started-approved-oidc-workflow-2026-11-19.md).

### Deploying the docs site

The same release deploys the docs site at saasaloy.com. After the tag, the push and the GitHub Release, release-it runs the `after:release` hook in `packages/cli/.release-it.js`. The hook runs `pnpm -w run release:deploy vX.Y.Z`, which runs `pnpm --filter @saasaloy/web run deploy:release -- vX.Y.Z`. That script builds `apps/web` and runs `wrangler deploy --tag vX.Y.Z --message "saasaloy vX.Y.Z"`, so the Worker version in Cloudflare carries the release tag. The build runs at the release commit, so the docs header shows `saasaloy vX.Y.Z`, and the footer of every page shows `vX.Y.Z` and the short commit, each linked to GitHub. `deploy:release` refuses to deploy when HEAD is not at the tag. A site-only change has a second deploy path, described in [Deploying a site-only change](#deploying-a-site-only-change).

The hook needs `wrangler` logged in to the Brainaloy Labs account on the machine that runs `pnpm release`. Check it with `pnpm --filter @saasaloy/web exec wrangler whoami` before you release. The site can go live before the `publish` job finishes, because the hook does not wait for it.

If the deploy fails, the tag and the GitHub Release already exist and release-it cannot undo them. The hook prints the rerun command and exits non-zero. Run it from the same checkout:

```sh
git checkout vX.Y.Z && pnpm --filter @saasaloy/web deploy:production
```

Return to `main` afterwards with `git checkout main`. `scripts/release-deploy.test.ts` checks the hook and the failure text with a fake failing command, and no test deploys.

### Deploying a site-only change

A change to the site itself, such as a layout, a title or a header rule under `apps/web/`, does not need a CLI release. Run this from a clean, pushed `main`:

```sh
pnpm site:deploy            # add --dry-run to build and check without uploading
```

The script builds the site code from `origin/main` and the content from the tag of the npm `latest` version: `docs/wiki/`, `modules/`, `packages/cli/package.json` and `llms.txt` (ADR [0071](docs/adr/0071-adr-the-site-deploys-from-main-with-content-from-the-release-tag-2026-11-25.md)). It checks the content out with `git checkout --no-overlay`, so a page or a module that `main` added after the tag stays off the site. It builds in a temporary worktree, which it removes afterwards, and runs `wrangler deploy --tag site-<sha7> --message "site <sha7> with content vX.Y.Z"`. It warns when local `main` differs from `origin/main`, and it prints whether `PUBLIC_CF_ANALYTICS_TOKEN` is set in your shell, because the build reads the token from there.

A docs change still waits for a release. A change under `docs/wiki/` or `modules/`, or a new CLI command, is content, and a site deploy takes the content from the release tag. A site change that needs newer content fails its build, and the script says the change waits for the next release. When the site reads a new path outside `apps/web`, add it to `CONTENT_PATHS` or `CODE_PATHS` in `apps/web/scripts/site-content.ts`; `site-content.test.ts` fails until you do.

To return production to an earlier version, run:

```sh
pnpm --filter @saasaloy/web exec wrangler rollback
```

The `site-<sha7>` and `vX.Y.Z` tags in the Cloudflare version list name each version.

### Approving the publish

The workflow has two jobs. `build` runs at once, with no approval and no OIDC token. `publish` needs `build`, and it runs in the GitHub environment `npm`, which has the maintainer as required reviewer, so it waits until you approve it:

1. Open the `publish` run for the tag: `gh run list --workflow publish.yml --limit 1`, or the repository's Actions tab.
2. Select **Review deployments**, tick `npm`, and select **Approve and deploy**.
3. Wait for the job to finish: `gh run watch <run id>`.
4. Check the result: `npm view saasaloy@X.Y.Z dist.attestations` prints the provenance attestation.

The `build` job checks that the tagged commit is on `main` and that the tag equals `v` plus the `packages/cli` version. Then it builds the CLI with no dependency cache, packs the tarball with `pnpm pack`, installs the tarball, checks that `saasaloy --version` prints the version, and uploads the tarball as an artifact. The `publish` job downloads that tarball and runs `npm publish <tarball> --access public --provenance`, and nothing else. So no install script and no build step runs in the job that can get a publish token. Neither job runs the gate again, because the preflight ran it on the same commit. `publish` fails by name when `npm --version` is below 11.5.1, the first npm with trusted publishing. Every `uses:` in `publish.yml` is pinned to a commit SHA.

npm authenticates the `publish` job with trusted publishing (OIDC). Only that job has `id-token: write`, and the repository holds no `NPM_TOKEN` secret. The trusted publisher in the `saasaloy` package settings on npmjs.com names `mimukit/saasaloy`, `publish.yml` and the environment `npm`. If you rename the workflow file or the environment, change the trusted publisher too, or the publish fails with a 404. The same 404 comes when the trusted publisher is missing: the `npm publish` step prints `npm error 404 Not Found - PUT https://registry.npmjs.org/saasaloy` after it has signed the provenance statement. The 0.9.0 publish, the first through `publish.yml`, failed this way until the trusted publisher was added.

To lint the workflow after you change it, run actionlint from its Docker image, pinned by digest. Nothing is installed on the box:

```sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 .github/workflows/publish.yml
```

To see the whole plan without doing any of it:

```sh
pnpm release:dry
```

The dry run skips the preflight hook and the deploy hook, and it shows no `npm publish` step, because release-it does not publish. It prints the deploy hook as `! pnpm -w run release:deploy vX.Y.Z`, and the `!` marks a command it did not run. Run `pnpm release:preflight` to check the release requirements and the packed artifact.

### The npm README

`packages/cli/README.md` is generated and gitignored. npm reads a package's README from the directory holding its `package.json` and nowhere else, so the repo root README never reaches the npm page on its own. `prepack` runs `pnpm readme:cli`, which copies the root README into `packages/cli/` and rewrites every relative link to an absolute `github.com` URL. npm resolves relative links against `repository.directory`, which is `packages/cli`, so `LICENSE.md` would otherwise 404.

Edit the root `README.md`. Never edit the copy. `release:smoke` asserts `README.md` is in the tarball, which is the check that would have caught the blank npm page on 0.1.0.

### Machine setup

One piece of state, and one tool. A second machine needs both:

- `gh auth login` — the release scripts read `GITHUB_TOKEN` from the shell, or call `gh auth token` when it is unset, and release-it uses it to create the GitHub Release.
- Docker, for the actionlint command above. It is needed only when you change a workflow.

The normal release needs no npm login on the machine, because the `publish` workflow publishes. An npm login on an account with 2FA (`npm login`, then `npm whoami`) is needed only for the emergency token publish in [If the publish fails](#if-the-publish-fails).

### The preflight

Before release-it writes anything it runs `pnpm release:preflight`, which:

1. Fails if `GITHUB_TOKEN` is empty. Without it release-it silently degrades to a web release that GitHub rejects.
2. Fails if local `main` is not `origin/main`. A release cut from a stale checkout tags code that origin does not hold.
3. Fails if a breaking commit since the last tag adds no update note, gets none from a later `Update-Note-For: <full sha>` commit and carries no `Update-Note: none (<reason>)` footer, and prints each opt-out reason. See [Breaking changes need an update note](#breaking-changes-need-an-update-note).
4. Prints each hand-written docs page whose covered files changed after its stamp, the list `pnpm docs:stale` prints. It warns and never fails. The site deploys the pages as they are at the tag, so read each listed page before you release, or fix it in the next release.
5. Fails if the version of the last tag is not on npm (`npm view saasaloy@<version> version`). A tag with no publish behind it means a `publish` run that waits for approval or failed. Approve or rerun it first, because a new release on top would skip that version on npm for good. When npm cannot answer, a network error for example, the preflight stops and prints npm's error. It never reads that as a published or a missing version.
6. Suggests an agent benchmark run when the changes since the last tag touch a gated path and no score report covers them. It warns and never fails. See [The agent benchmark](#the-agent-benchmark).
7. Builds the CLI and fails if the root `llms.txt` names a skill, a command or a flag the release does not hold. The release is the npm package (the base skills under `packages/cli/templates/base/_agents/skills/`, and the commands and flags `saasaloy --help` and `saasaloy <command> --help` print) plus the registry at the release tag, which is this commit's `modules/`. `scripts/llms-txt.ts` reads the file.
8. Runs `lint`, `typecheck`, `test`, `verify:content`, `verify:pins` and `docs:check` — the same six scripts, in the same order, as the `gate` job in `.github/workflows/ci.yml`. It re-runs them rather than asking GitHub, so a release never depends on GitHub's view of a run against a different tree. The `scaffold` job there (`pnpm scaffold:check`) is left to step 9, whose projects hold its modules and more.
9. Runs `pnpm release:smoke` to check the packed artifact. The script installs the tarball with npm in `.dev/release-smoke/`, outside the workspace. It checks `saasaloy --version`, `saasaloy init`, and `saasaloy add api` through the installed command. The script uses local modules for `add` and installs project dependencies from npm. It runs `pnpm env:setup` and checks the web app's development server. Then it runs `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` in each compatible combination of module choices, with testing on so the module tests run. Each database driver runs with each API key owner, and each project adds its driver first. A module that depends on a module the project's choice excludes stays out: `ecommerce` runs in the Postgres projects only. Before the checks each project runs `db:generate`, `db:setup` and `env:setup`, and fills each key with no default with a local value. The Postgres projects need Docker with the compose plugin, because `db:setup` starts their server with `docker compose`; the script stops it at the end. The projects and the development server check run at the same time.

On a rerun after a transient failure you can skip step 8:

```sh
SAASALOY_RELEASE_SKIP_GATE=1 pnpm release
```

Use it only when you have just watched the gate pass on this exact tree. Steps 1 to 7 and 9 always run.

### Modules that need a new CLI

A module change and a CLI change both reach a plain `saasaloy add` at the next release, because the CLI reads the modules at its own tag. A module on `main` still reaches anyone who reads `@main`, and a published CLI meets it there. So the PR that teaches the CLI something a descriptor uses does three things in the same diff:

1. Bump `packages/cli/package.json` to the version that will ship the change, at least a **minor**.
2. Set `requires.saasaloy` on every module that uses it to `>=` that version. See [Declaring the CLI a descriptor needs](#declaring-the-cli-a-descriptor-needs).
3. Ask for a release in the PR body, because until it ships every published CLI refuses those modules at `@main`, and no CLI reads them by default.

`registry-floors.test.ts` fails the gate when step 1 or 2 is missing. Nothing enforces step 3, so release soon after the merge.

The version is then already bumped when you release. Release it as it stands, so release-it tags that version rather than asking for a new one:

```sh
pnpm release 0.6.0 --only-version
```

Replace `0.6.0` with the version in `packages/cli/package.json`. The explicit version preserves the planned version and selects the changelog range from the latest tag to the new tag. The npm configuration enables `allowSameVersion`, so `npm version` accepts the unchanged version. Do not use `--no-increment` here because the changelog plugin selects the previous release range. At a terminal, do not use `--ci`, because it skips the prompt before each step. An agent has no TTY, and the prompts would wait for ever, so the `release` skill adds `--ci` only after the maintainer confirms the version and the command.

### If it fails after the push

release-it has no rollback. Once the commit, tag, and push exist, the version is spent.

1. **Never rerun `pnpm release` for the same version**, and never rewrite pushed `main` history.
2. Fix whatever failed.
3. If the GitHub Release is missing, create it by hand with `gh release create vX.Y.Z --notes-from-tag`.
4. If the failure is in the published package itself, fix it and release the next patch. Do not unpublish.

### If the publish fails

A failed `publish` run leaves a tag with no npm version. That is safe: no installed CLI names the tag until npm offers it, so it delays users and breaks nothing. The preflight refuses the next release until the version is on npm.

1. Read the failed step: `gh run view <run id> --log-failed`.
2. If the cause is outside the tagged code (an npm outage, the trusted publisher settings, the environment), fix it.
3. Rerun the job: `gh run rerun <run id> --failed`, or **Re-run failed jobs** on the run page. The rerun waits for your approval again.
4. If the cause is in the tagged code, never move the tag. The preflight ran the same build, pack and install on that commit, so this is rare. The preflight refuses the next release while the version is missing on npm, and it has no override, so decide by hand whether to publish the tag as it is or to remove the check for one release.

The emergency path is a token publish, for when GitHub Actions is down. It has no provenance, so use it only when the `publish` workflow cannot run:

1. Check out the tag in a clean clone: `git checkout vX.Y.Z`.
2. Run `pnpm install --frozen-lockfile`.
3. Log in to npm with 2FA: `npm login`, then `npm whoami`.
4. From `packages/cli`, run `npm publish --access public`. npm asks for the one-time code. `prepack` builds `dist/` first.
5. Check the result: `npm view saasaloy@X.Y.Z version`.

The trusted publisher stays the normal path. npm keeps token publishes allowed on the package for this path only.

## README module badge

The module badge reads `apps/web/public/badges.json` through the raw GitHub URL. After you add or remove a module descriptor, run `pnpm badges:generate` and include the JSON file in your commit. The count includes providers and drivers. CI and the release preflight run `pnpm badges:check` to reject a missing or stale file.
