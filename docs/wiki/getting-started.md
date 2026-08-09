# Getting started

By the end of this page you have the `saasaloy` CLI on your `PATH`, a scaffolded project
on disk, and its landing page running at `http://localhost:3000`.

## Before you begin

- **Node 24.13.0 or newer.** `packages/cli` declares `"node": ">=24.13.0"`, and
  `pnpm-workspace.yaml` sets `engineStrict: true`, so an older Node fails the install
  rather than breaking later. The repo's `.nvmrc` pins `v24.18.0` if you use `nvm`.
- **pnpm 11 or newer.** The repo is pinned to `pnpm@11.14.0`.
- **git**, to clone the repo.

Nothing here needs a Cloudflare account. `saasaloy init` scaffolds a static Astro site and
touches no cloud service.

## 1. Install the CLI from a clone

`saasaloy` is not on npm yet, so you build it from source and link the binary:

```bash
git clone https://github.com/mimukit/saasaloy.git
cd saasaloy
pnpm install
pnpm cli:link
```

`pnpm cli:link` builds `packages/cli` and runs `pnpm add --global ./packages/cli`, which
symlinks the package rather than copying it. Check it worked:

```bash
saasaloy --help
```

You should see the four commands: `init`, `add`, `remove`, `list`. If the shell can't find
`saasaloy`, pnpm's global bin directory isn't on your `PATH` — `pnpm setup` puts it there.

Link from one checkout only. The global bin points at a single
`packages/cli/dist/index.js`, so linking from a second worktree silently repoints the
first. [`CONTRIBUTING.md`](../../CONTRIBUTING.md#global-linking-main-checkout-only) explains
why, and describes the `.dev/playground` shim to use instead when you are developing
modules.

When [#46](https://github.com/mimukit/saasaloy/issues/46) lands, this section becomes an
`npm install` and the clone stops being necessary.

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
installs; say no and it prints the command in the next steps.

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

```
my-app/
  apps/web/            Astro landing page (port 3000)
  packages/ui/         shared React + Tailwind components
  packages/tsconfig/   shared TypeScript configs
  saasaloy.json        alias map + the list of installed modules
  turbo.json
```

That is the whole base: a landing page and the two packages it leans on. There is no API,
no database and no auth yet, on purpose. Those are modules, and you install the ones you
need.

`saasaloy.json` is what marks this directory as a Saasaloy project. Every later `saasaloy`
command walks up from your working directory looking for it, so you can run them from any
subdirectory.

## Next

- [Add a module](how-to/add-a-module.md) to install a feature, starting with
  `saasaloy list` to see what the registry offers.
- [Architecture](architecture.md) if you want to know what the CLI is doing to your
  project before you let it.

When you're done with the linked CLI, remove the global bin:

```bash
cd /path/to/saasaloy
pnpm cli:unlink
```

_Verified against `main`@`48d32d7` on 2026-08-09._
