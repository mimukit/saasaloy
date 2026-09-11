# Getting started

By the end of this page you have the `saasaloy` CLI on your `PATH`, a scaffolded project
on disk, and its landing page running at `http://localhost:3000`.

## Before you begin

- **Node 24.13.0 or newer.** The root `package.json`, `packages/cli`, the base template and
  `.nvmrc` all say 24.13.0, and `pnpm-workspace.yaml` sets `engineStrict: true`, so an older Node
  fails the install rather than breaking later. `nvm use` picks the floor up from `.nvmrc`, which
  is also the version CI runs.
- **pnpm 11 or newer.** The repo and the scaffolded project both pin `pnpm@12.3.4`.

Nothing here needs a Cloudflare account. `saasaloy init` scaffolds a static Astro site and
touches no cloud service.

## 1. Install the CLI

`saasaloy` is on npm. Install it globally:

```bash
npm install -g saasaloy
```

or, with pnpm:

```bash
pnpm add -g saasaloy
```

You can also skip the install and run it once. Every command on this page then needs the
`npx saasaloy` prefix in place of `saasaloy`:

```bash
npx saasaloy init my-app
```

Check the install worked:

```bash
saasaloy --help
```

You should see the nine commands: `init`, `add`, `env`, `outdated`, `update`, `remove`, `list`, `new`, `doctor`, and the global `--help`/`--version` flags below them. If the shell can't find
`saasaloy`, pnpm's global bin directory isn't on your `PATH` — `pnpm setup` puts it there.

> **Working on Saasaloy itself?** Don't install the published CLI. Clone the repo and use
> the `.dev/playground` shim, which runs your checkout's CLI against your checkout's
> `modules/`. [`CONTRIBUTING.md`](../../CONTRIBUTING.md#manual-qa-the-devplayground)
> describes it, and explains why global linking from a worktree breaks the other worktrees.

## 2. Scaffold a project

Move somewhere outside the clone and run:

```bash
cd ~
saasaloy init my-app
```

The name has to be lowercase letters, digits and hyphens. You can also pass `.` to
scaffold into the current directory, or a path like `./apps/my-app` — the last path
segment becomes the project name. Omit the name entirely and the CLI asks for it.

`init` copies the base template, then offers to run `pnpm install` for you. Say yes and it
installs; say no and it prints the command in the next steps. It also runs `git init` in the new project, unless the target already sits inside a working tree.

`init` takes three flags: `--force` scaffolds into a directory that is not empty, `--no-install` never runs `pnpm install` and never asks, and `--no-git` skips `git init`. Any other flag stops the command with an error instead of being ignored.

If the target directory already has files in it, `init` stops and tells you to re-run with
`--force`. A `.git` directory on its own doesn't count as non-empty, so you can scaffold
into a freshly cloned repo.

## 3. Run it

```bash
cd my-app
pnpm install     # skip if init already did this
pnpm dev
```

`pnpm dev` runs `turbo run dev`, which starts Astro on port 3000. The port is fixed and
`strictPort` is on, so a busy port fails loudly instead of quietly moving to 3001. Open
`http://localhost:3000` and you have the landing page.

## What you just got

```text
my-app/
  apps/web/            Astro landing page (port 3000)
  packages/ui/         shared React + Tailwind components
  packages/tsconfig/   shared TypeScript configs
  .agents/skills/      three bundled agent skills (symlinked from .claude/skills/)
  DESIGN.md            the design contract, derived from what packages/ui ships
  saasaloy.json        alias map + the list of installed modules
  saasaloy-lock.json   the template and module versions this project was built at
  .saasaloy/manifest.json  one entry per file the CLI wrote, at its hash
  turbo.json
```

That is the whole base: a landing page, the two packages it leans on, and a design
contract (`DESIGN.md`, kept current by the bundled `saasaloy-design` skill). There is no API,
no database and no auth yet, on purpose. Those are modules, and you install the ones you
need.

## Make it yours

The page you are looking at still sells a placeholder product, under a `siteName` that is
just your directory name. The three skills in `.agents/skills/` exist to fix that, and the
first two run in order:

1. **`/saasaloy-setup`** interviews you about the product and writes
   `docs/product-brief.md` — the context every other skill reads.
2. **`/saasaloy-landing-copy`** turns that brief into the landing page's copy, through a
   draft you review first.
3. **`/saasaloy-design theme`** swaps the default theme for a registry preset and keeps
   `DESIGN.md` true — run it whenever you want the look changed, not just now.

[Make the project yours](how-to/make-it-yours.md) walks through all three.

`saasaloy.json` is what marks this directory as a Saasaloy project. `saasaloy add` and
`saasaloy remove` walk up from your working directory looking for it, so you can run them
from any subdirectory.

## Next

- [Make the project yours](how-to/make-it-yours.md) — the setup interview, the landing
  copy, and the theme, via the bundled skills.
- [Add a module](how-to/add-a-module.md) to install a feature, starting with
  `saasaloy list` to see what the registry offers.
- [Architecture](architecture.md) if you want to know what the CLI is doing to your
  project before you let it.

_Verified against `main`@`42cbf03` on 2026-09-11._
