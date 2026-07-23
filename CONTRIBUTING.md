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

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm cli:dev` | `tsup --watch` — rebuild the CLI on source change |
| `pnpm cli` | run the built CLI directly (`node packages/cli/dist/index.js`) |
| `pnpm play:init` | build the CLI, scaffold `.dev/playground` (`--no-install`), copy in the `saasaloy` shim |
| `pnpm play:reset` | `play:destroy` then `play:init` |
| `pnpm play:destroy` | delete `.dev/playground` |

## Updating dependencies

Saasaloy ships dependency versions to downstream projects from two sets of files that
**pnpm's own tooling can't see** — the base template (`packages/cli/templates/base/**/package.json`)
and the module descriptors (`modules/*/registry-item.json` `dependencies[]` / `devDependencies[]`).
They aren't pnpm workspace members, so `pnpm outdated` / `pnpm update` never touch them, and because
we pin **exact** versions there's nothing for pnpm's install-time `minimumReleaseAge` cooldown to
resolve either. A dedicated maintainer command owns these files:

```sh
pnpm deps:check     # read-only drift report (exits non-zero when deps:update would change something)
pnpm deps:update    # rewrite template + descriptor deps to the resolved exact versions
pnpm deps:verify    # re-scaffold .dev/playground, install, build + typecheck the generated project
```

The recommended flow is **`deps:check` → `deps:update` → `deps:verify`**, then review the diff and
commit. `deps:update` only edits the working tree — it never commits.

**Resolution policy** (see [ADR 0016](docs/adr/adr-0016-in-script-cooldown-gate-for-invisible-manifests-2026-07-24.md)):
per package the resolver enumerates the npm `versions` map, **drops prereleases**, **ignores
`dist-tags`** (never trusts `latest`), caps at the **highest eligible version within the current
major**, and requires the publish time to clear `minimumReleaseAge` (read from `pnpm-workspace.yaml`).
Everything is pinned **exact**. Each manifest resolves independently; a shared dep whose major
diverges from the repo's own pin is printed as an informational note.

- `--allow-major` — cross a major (surfaced as `major-available` until you opt in). Majors are where
  the template breaks (`astro 5→6`, `wrangler 4→5`), so each is blessed deliberately.
- `--allow-fresh` — override the cooldown for a knowing security-fix bump (the audited path;
  replaces `minimumReleaseAgeExclude`).
- `--dry-run` — print the diff without writing.

**Scope boundary:** these commands own only the invisible files (template + descriptors). The tool
repo's own workspace deps (root, `packages/cli`) stay on `pnpm outdated` / `pnpm update`.

| Script | What it does |
| --- | --- |
| `pnpm deps:check` | report drift; non-zero exit iff a default `deps:update` would change something |
| `pnpm deps:update` | rewrite template + descriptor deps to exact (`--allow-major`, `--allow-fresh`, `--dry-run`) |
| `pnpm deps:verify` | `play:init` → install → build → typecheck the generated project (post-update gate) |

