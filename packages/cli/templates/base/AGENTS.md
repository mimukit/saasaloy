# {{PROJECT_NAME}} — agent instructions

This is a SaaS project scaffolded with Saasaloy.

## Find the right skill

Every installed module ships a skill in `.agents/skills/<name>/SKILL.md`, linked into `.claude/skills/`. Before you change a module's code, list `.agents/skills/` or run `saasaloy list --installed --json`, which gives each installed module's `skill`, `description` and `stage`, and read that skill first.

## Project Structure

This is a **pnpm workspace monorepo** managed by **Turborepo**.

- **Root**: Configuration files only. Repository tooling lives in `packages/tooling` (see "Code at the Root")
- **`apps/*`**: Applications (Next.js, Astro apps - currently empty, will be added)
- **`packages/*`**: Shared packages

### Dev Port Map

Every dev port in this repo is pinned, not assigned on the fly. The api Worker's CORS
allow-list and the auth module's trusted origins hardcode the localhost origins, so a
drifting port turns into an unexplained CORS rejection.

| Workspace | Port | Dev URL | Pinned in |
| --- | --- | --- | --- |
| `apps/web` (Astro) | 3000 | `http://localhost:3000` | `apps/web/astro.config.mjs` (`server.port`) |
| `apps/admin` (TanStack Start) | 3001 | `http://localhost:3001` | `apps/admin/vite.config.ts` (`server.port`, `strictPort`) |
| `apps/api` (Hono on Workers) | 4000 | `http://localhost:4000` | `apps/api/wrangler.jsonc` (`dev.port`) |
| Postgres (local, `database-postgres`) | 5432 | `postgres://postgres:postgres@127.0.0.1:5432/app` | `DATABASE_URL` in `packages/env/.env.example` |

The `apps/admin` and `apps/api` rows apply once you run `saasaloy add admin` or
`saasaloy add api`.

Rules for a new app or service:

- **Take the next free port in the block** — `apps/*` count up from 3000, backend services
  from 4000. Add a row to this table in the same change.
- **Set `strictPort` (or the framework's equivalent).** A busy port must fail loudly. A
  silent `+1` moves the app to an origin nothing allows.
- **Name the origin, don't infer it.** A browser-side caller reads `PUBLIC_API_URL`
  through `webEnv()` or `adminEnv()`, with no fallback — an unset key fails the build
  naming the key. A server-side caller reads its own key through `apiEnv(c.env)`.
- **Update both allow-lists when you add a browser origin**: `DEV_ORIGINS` in
  `apps/api/src/index.ts` and `DEV_ORIGINS` in `packages/auth/src/auth.ts`.

### Code at the Root

No code lives at the repository root. The root holds configuration only: `package.json`, `turbo.json`, the lint and format configs, `vitest.config.ts`. A tool, a script or a codemod goes into a workspace, where it gets a `tsconfig.json`, a `typecheck` script, the type-aware lint pass and the root Vitest run. A root `scripts/` folder gets none of them.

`packages/tooling` (`@repo/tooling`) is the workspace for the repository's own tooling. It holds the deploy command (`src/deploy-production.ts`) and the skill linker (`src/link-skills.ts`). A root script that runs one of them names the file: `node packages/tooling/src/<name>.ts`. Two of its files are yours: `src/deploy.config.ts` and `src/targets.ts`. `saasaloy update` never writes them again after `saasaloy init`. The other files are managed.

### Workspace Commands

- Filter to specific package: `pnpm --filter <package-name> <command>`
- Example: `pnpm --filter @repo/ui build`
- Use `pnpm turbo run <task> --filter <package-name>` for Turborepo tasks

### The `clean` Script — Required in Every Workspace

`pnpm clean` at the root wipes the repo back to a fresh-clone state: it runs
`turbo run clean` across every workspace, then deletes all `node_modules` and `.turbo`
directories. Recover with `pnpm install`.

**Every app and package you create MUST declare its own `clean` script.** A workspace
without one is silently skipped by `turbo run clean` and leaves stale build output behind.

- Use **`rimraf`** (added as an exact-pinned `devDependency` of that workspace) — never
  `rm -rf`, which does not exist on Windows. Pass `-g` when any argument is a glob;
  without it rimraf treats arguments as literal paths.
- Delete only what the workspace **generates**: `dist`, `.astro`, `.wrangler`,
  `*.tsbuildinfo`. Never delete committed source or generated-then-committed files
  (e.g. Drizzle migrations).
- Do **not** delete `node_modules` or `.turbo` from a workspace-level `clean` — the root
  script removes those in one pass after Turborepo has finished. Deleting `.turbo` while
  Turborepo is still streaming its task log into it fails on Windows.

```jsonc
// apps/<name>/package.json
"scripts": {
  "clean": "rimraf -g dist .wrangler \"*.tsbuildinfo\""
},
"devDependencies": {
  "rimraf": "6.1.3"
}
```

## Tech & Tools

- **pnpm** — non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`.
  Exact versions are pinned (`saveExact`).
- **TypeScript + ESM.** Internal packages are consumed JIT (no build step) via `workspace:*`.
- **Add features, don't hand-wire them.** Prefer `saasaloy add <module>` over manually
  creating routes/schema/auth. Most of what a module contributes is a file dropped at a
  convention-based extension point; the rest is a small reversible patch on a file that has
  to name its entries statically. An api route is the second kind — `saasaloy add` edits
  `apps/api/src/index.ts` to add one `.route()` link and its import, and `saasaloy remove`
  takes both out again. Do not add a route by dropping a file into `apps/api/src/routes/`
  and expecting it to mount: nothing globs that folder, and the entry file's `AppType` is
  what the typed `hc` client reads.

### The `@repo/env` Environment Layer

`packages/env` owns every environment value this project reads. One tracked key list, one
command that distributes it, one typed gate in front of the capabilities.

- **`packages/env/.env.example` is the key list**, and it is the only example file. It is
  tracked, and `saasaloy add` regenerates it from the installed modules' own descriptions.
  A value you type in it survives that, and nothing is ever removed.
- **`packages/env/.env` holds the values**, and it is gitignored. `saasaloy env` prompts
  for each unset key and writes it.
- **`pnpm env:setup` writes every service's own `.env`** from those two files. A *service*
  is a workspace that reads a `.env` — `api`, `web`, `admin` — and
  `packages/env/src/services.ts` is the table. The `deploy` row has no file: it holds the
  Cloudflare credentials a deploy loads in memory.
- **`pnpm deploy:production` deploys every Worker.** It checks the git gates and every service's production values first, then deploys each Worker one at a time in the order `packages/tooling/src/targets.ts` gives. Each Worker runs its own `env-deploy <service>`: build with the production values in the environment, then `wrangler deploy --secrets-file`. The `local` source reads production values from the gitignored `packages/env/.env.prod`. Nothing writes a production value under `apps/`. The `saasaloy-deploy` skill covers the gates, the flags and the rollback.
- **`createEnv` is the gate.** `apiEnv(c.env)` on the server, `webEnv()` in a frontend.
  It validates on the first call and throws once naming every failing key, its module and
  what the key is for.
- **A `client` key must start with `PUBLIC_`**, and the type system enforces it. Client
  code reading a server key throws by name.
- **There is no `.dev.vars`.** Every runtime here reads `.env`. A leftover `.dev.vars`
  hides `.env` from wrangler without warning, so `saasaloy doctor` reports one and
  `pnpm env:setup` carries its values across and deletes it.
- **Never read `process.env`** in a file a Worker imports. Node tooling reads it freely.

The `saasaloy-env` skill is the runbook: adding a key, the section rule, the server/client
split, blank-on-purpose keys, and the offline rule.

### The `@repo/config` Value Layer

`packages/config` (`@repo/config`) owns the values this project checks into its repo and ships
identically to every environment: the product name, the locale, the legal paths, and each
installed module's section. Read it with a plain import, from any app or package:

```ts
import { config } from "@repo/config";

config.app.name; // `siteName` in @repo/ui re-exports this
config.app.locale; // the shared layout's <html lang>
```

It is a frozen plain object, built once at module load. It has **zero runtime dependencies and
imports nothing**, which is what lets every app, every package and every browser bundle import it.

**config or `.env`?** Two deployments of *this* project — production and staging. If the value can
differ between them it is an env var, secret or not. If it cannot, it is config. A database URL is
env; the product's name is config.

**The landing copy is not config.** Prices, tier ids and every sentence on the page stay in
`@repo/ui/content/landing.ts`.

Four files, and only one is yours:

| Path | Who owns it |
|------|-------------|
| `src/project.ts` | **You.** The only file here you edit. Nothing overwrites it. |
| `src/sections.ts` | The section registry. `saasaloy add` patches one line in; don't hand-edit the array. |
| `src/sections/<key>.ts` | The module that installed it (`app` is the base's). |
| `src/define.ts` | The base template. The composition core. |

The merge goes **one level below the section**: `app: { name: "..." }` replaces the name and keeps
the rest of `app`, while a nested record or an array is replaced whole. A key no installed section
defines is a `typecheck` error, which is the only validation there is — the values are literals in
this repo. Run `/saasaloy-config` for the whole runbook.

### The `@repo/ui` Design Layer

`packages/ui` owns the design layer: the Tailwind 4 theme in `src/styles/`, the `cn()` helper and the client-state stores in `src/lib/`, the vendored [shadcn](https://ui.shadcn.com) primitives in `src/components/`, the **blocks** in `src/blocks/`, the shells and layouts in `src/containers/`, and the copy in `src/content/`.

Those layer folders are the whole top level of `src/`: `assets` (images, SVGs and icons, added when the first one arrives), `blocks`, `components`, `containers`, `content`, `lib` and `styles`. Do not add an app folder such as `src/admin/` or `src/web/` beside them. When one app needs its own files inside a layer, give that layer a child folder (`blocks/admin/`, `components/shared/`).

The theme is one shared file, one brand file, and one stylesheet per app:

- **`src/styles/globals.css`** is the shared layer: the Tailwind imports, the `@source`
  globs and the base layer. It holds no token values, and no app imports it directly.
- **`src/styles/brand.css`** is the product's theme: the `dark` custom variant, the
  `:root` and `.dark` token values, the `@theme inline` colour mapping and the radius
  scale. It imports `globals.css`, so an app stylesheet that imports `brand.css` gets the
  whole theme. `components.json` points here, so a shadcn preset lands here.
- **`src/styles/web.css`** is the web app's stylesheet. It imports `brand.css` and adds
  the landing page's layout, type and motion utilities, which a preset leaves alone.
  `apps/web` pulls it in once, through the shared layout that imports
  `@repo/ui/styles/web.css`.
- **`src/styles/admin.css`** is the admin app's theme, written by `saasaloy add admin`.
  It imports `globals.css` and carries its own tokens in the same shape as `brand.css`.

Each theme file repeats the `dark` variant and the `@theme inline` mapping on purpose.
shadcn merges a preset in place only when the target file itself holds them, and it does
not look through an `@import`. Move either one into `globals.css` or `web.css` and a
preset appends a duplicate to `brand.css` instead.

**Each app has its own `DESIGN.md`, in its own folder.** `apps/web/DESIGN.md` records the
tokens in `brand.css`, the landing vocabulary in `web.css` and the rules behind them, and
fingerprints `brand.css`. An app that carries its own theme file gets its own
`apps/<app>/DESIGN.md`, which fingerprints that file. There is no `DESIGN.md` at the
repository root. Read the document for the app you are changing before you add or change
UI.

With the admin app installed, `apps/admin/DESIGN.md` records the admin tokens in `packages/ui/src/styles/admin.css` and fingerprints that file. A preset never targets `admin.css`; the admin theme changes by hand.

Primitives, blocks and containers are reached by subpath — none is re-exported from the
package root, so importing one never drags in the rest. The root export is project-wide
constants only (`siteName`, which re-exports `config.app.name`):

```ts
import { siteName } from "@repo/ui";
import { Button } from "@repo/ui/components/button";
import { PricingTable } from "@repo/ui/blocks/pricing-table";
import { landing, ui } from "@repo/ui/content/landing";
import { cn } from "@repo/ui/lib/utils";
```

**The admin app has its own primitive set.** `saasaloy add admin` writes it into `src/components/admin/`, with its blocks in `src/blocks/admin/` and its shell and layouts in `src/containers/admin/`. Admin code imports only those, and a lint rule makes a base primitive under `apps/admin/**` an error, because both sets have a `button` and the wrong one renders with no complaint:

```ts
import { Button } from "@repo/ui/components/admin/button";
import { DataTable } from "@repo/ui/blocks/admin/data-table";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";
```

The `saasaloy-admin` skill lists the whole set and how a page composes it.

**Seven top-level folders, and no app folder at the root of `src/`.** A folder may hold `admin/`, `web/` or `shared/` children where one app owns the files, for example `src/blocks/admin/` or `src/containers/admin/`, which `saasaloy add admin` writes. A project without that app carries none of them.

1. **`src/assets/`** holds images, SVGs and icons. The base ships no asset, so the folder does not exist until the first one lands, together with an `assets.d.ts` that types its imports.
2. **`src/components/`** holds the vendored shadcn primitives, official and custom. No stores, no copy.
3. **`src/blocks/`** holds compositions of primitives plus copy from the content module. Local state is allowed (an open accordion, a ticking clock). Importing a shared store is forbidden: a block takes its data as props and reports changes through callbacks, so every app can drive the same block from its own data source.
4. **`src/containers/`** holds the shells and layouts that hold blocks and components on a page: an app shell, a page layout, a page frame. A container takes its data, its links and its callbacks as props. It imports no router and no session, so the app that owns them passes them in.
5. **`src/content/`** holds copy, in one place for later translation.
6. **`src/lib/`** holds utilities and the client-state stores.
7. **`src/styles/`** holds the CSS files with the token variables.

**One rule covers the whole package: no IO in `@repo/ui`.** No fetch, no persistence, no auth, no router, in any layer. Client-state stores (nanostores) live in `src/lib/`; the app that owns the data hydrates the store and passes what a block needs as props. When a store-shaped need shows up in a block, move the binding up into the app instead of importing the store in place.

**Adding a primitive the base doesn't vendor.** `shadcn` is already an exact-pinned
dependency of `@repo/ui`, so reach it with `--filter … exec` — that runs in the package
directory, where `components.json` lives:

```sh
pnpm --filter @repo/ui exec shadcn add dialog
```

- **Not `pnpm -C packages/ui dlx …`.** `-C` scopes pnpm's own workspace resolution; it
  does *not* change the directory `dlx` spawns the command in. shadcn then looks for
  `components.json` wherever your shell happens to be and dies at `Verifying framework`.
  If you must use `dlx`, pass shadcn's own flag: `--cwd packages/ui`.
- Never `npx` (see Never Do).
- The CLI writes into `src/components/`. Anything it appends to `package.json` arrives
  as a range — **re-pin it to an exact version**.
- **Add the primitive to a `@source` list, or it renders unstyled.** `globals.css` names
  the components it scans one file at a time, because Tailwind scans content rather than
  imports and a blanket glob charges every app for every primitive. A primitive the
  landing page or `src/blocks/` renders gets an `@source "../components/<name>.tsx";` line
  in `globals.css`; a primitive only one app renders gets its `@source` line in that app's
  own theme file, the way `src/styles/admin.css` takes the whole directory.
  Nothing errors when you skip this — the classes just never reach the CSS.
- `style` is `base-nova` (Base UI) and is fixed at init — the CLI cannot change it later.
- `rsc` is `false`, so the CLI strips the `"use client"` directive for you. It means
  nothing in Astro, and the vendored primitives don't carry it.

Primitives are source you own. Edit them in place rather than wrapping them.

**No UI kit or component library as a dependency.** When a design comes from a kit (Tailark, coss ui, a licensed dashboard kit), copy or rebuild the component into `src/components/` or `src/blocks/` as source this project owns. Do not install the kit's package, and keep no link to its repository for later updates. A copied component changes by hand, like any other file here. The shadcn CLI above is the one sanctioned way to fetch a primitive, because it writes source and leaves no runtime dependency behind.

**Swapping the whole theme for a preset.** The token set in
`packages/ui/src/styles/brand.css` is shadcn's `neutral` with `cssVariables: true`, and
any shadcn **`registry:style`** item is a drop-in replacement for it. The same
`--filter … exec` form applies — there is no separate theme command:

```sh
pnpm --filter @repo/ui exec shadcn add https://tweakcn.com/r/themes/modern-minimal.json
```

The CLI merges the preset's `:root`, `.dark` and `@theme inline` blocks **into** the
existing ones in `brand.css` and keeps its `@custom-variant dark`, so the hand-written
parts in `globals.css` — the `@source` rules and the `@layer base` rules — stay put, the
landing utilities in `web.css` stay put, and `components.json` is not touched. The
preset reaches the web app only; the admin theme in `admin.css` keeps its own values. It
usually *extends* `@theme inline` with mappings the base does not carry (fonts, tracking,
shadows); that is expected.

Two places to get an item from:

1. **[`https://ui.shadcn.com/create`](https://ui.shadcn.com/create)** — first-party.
   Describe or dial in a theme and it hands you a URL.
2. **[`https://tweakcn.com`](https://tweakcn.com)** — a much larger preset library,
   serving items at `https://tweakcn.com/r/themes/<name>.json`.

Neither is special: the mechanism is the `registry:style` shape, so any URL that serves
one works.

**This edits a file the project owns.** `brand.css` is an owned base file: `saasaloy
update` never overwrites it, and a later template change to it reaches you only through
the merge plan. A swapped theme is yours to maintain, including re-applying anything you
had customised in `brand.css` that the preset overwrote. Diff the file after running the
command rather than assuming.

A preset swap invalidates `apps/web/DESIGN.md`, which records the token values the old theme had. The `saasaloy-design` skill's `theme` flow runs the command above for you and re-derives the contract from the merged result, so prefer it over running the command by hand. Pick one or the other — running both applies the preset twice.

Theme switching is unaffected by any of this. It keys off the `.dark` class, which every preset keeps. The toggle has two states, light and dark: `system` is only the starting state for a visitor who never pressed it, and no press steps back to `system`. Do not give the toggle a third state or a light/dark/system menu.

**A project made before the theme split.** Older projects kept the web tokens in
`globals.css` and the design document at the repository root. `saasaloy update` creates
`packages/ui/src/styles/brand.css` and `web.css`, and lists `globals.css` and
`Layout.astro` in the merge plan, because the project owns both; it never moves your
tokens for you. Finish the split by hand, in this order:

1. Move the `@custom-variant dark` line, the `:root` block, the `.dark` block and the
   `@theme inline` block from `globals.css` into `brand.css`, replacing the template's
   copies there, below its `@import "./globals.css";`. Keep your own values, not the
   template's.
2. Add `"./styles/*": "./src/styles/*"` to the `exports` of `packages/ui/package.json`,
   if the update did not.
3. In `apps/web/src/layouts/Layout.astro`, import `@repo/ui/styles/web.css` in place of
   `@repo/ui/globals.css`.
4. Set `tailwind.css` in `packages/ui/components.json` to `src/styles/brand.css`, if
   the update did not.
5. Move `DESIGN.md` to `apps/web/DESIGN.md`, and run the `saasaloy-design` skill's
   `update` flow so its fingerprint names `brand.css`.
6. Run `pnpm build` and check that `globals.css`, `brand.css` and `web.css` hold one
   `@theme inline` and one `@custom-variant dark` between them.

With the admin app installed, `saasaloy update` also moves its theme: it creates
`packages/ui/src/styles/admin.css` and deletes `apps/admin/src/styles/admin.css`, or
keeps it with a warning when you edited it. Carry any edit across to the new file, then
delete the old one. The new admin app imports `@repo/ui/styles/admin.css`, so its build
fails until step 2 adds the `./styles/*` export. Update the base and finish step 2 before
you build admin, and before you run `saasaloy add admin` on a project made before the
split.

**Blocks — the page-level compositions.** `src/blocks/` holds the thirteen marketing
blocks the landing page is built from: `navbar`, `hero`, `logo-cloud`, `pain-points`,
`how-it-works`, `feature-grid`, `showcase`, `audience`, `testimonials`, `pricing-table`,
`faq`, `cta` and `footer`. `logo-cloud`, `pain-points`, `how-it-works`, `showcase`,
`audience` and `testimonials` are new; a project scaffolded before them gets the files
through `saasaloy update`, and adds each to its own `index.astro` by hand, since the page
is the owner's. The blocks need the landing utilities at the end of `web.css`. `web.css`
is an owned file, so `update` lists it in the merge plan and never adds them for you.
Copy the template's block, from the comment that opens "The landing page's layout" to
the `stylelint-enable` line, to the end of your `web.css`. A project made before the
theme split skips this: `update` creates its `web.css` from the template, block included.

**The section recipe.** `index.astro` composes the page from explicit imports, one line
per section. To remove a section, delete its line and its import, delete its file in
`src/blocks/`, and blank its navbar and footer labels in `landing.ts`. To reorder, move
the lines. Every block uses the same container (`section-container`, `-narrow`, `-wide`)
and spacing (`section-y`) utilities from `src/styles/web.css`, so any order keeps one
rhythm. A block sets no width, no section padding and no keyframes of its own; motion
comes from the named utilities there (`blur-in`, `beam-in`, `reveal`, `marquee`,
`shine-text`, `nav-float`, `hover-lift`), and every one stops under reduced motion.

**The logo recipe.** `landing.logos.items[]` is `{ id, name, mark }`. `mark` is a key in
`LOGO_MARKS` at the top of `blocks/logo-cloud.tsx`. Paste a customer's SVG there under a
kebab-case key with `fill="currentColor"`, then name the key in content. An unknown key
renders `name` as a text wordmark.

**The production bar.** The page holds to a rubric: no axe violation at WCAG 2.1 AA in
either theme, no sideways scroll from 360px up, nothing animating under reduced motion, a
skip link to `<main>` on every page, link-preview metadata on `/`, and exactly two islands
(`Navbar`, `PricingTable`). Keep each true when you change a block: a new section with
state is a third island and needs a reason.

The rules below are not stylistic — each one prevents a real failure:

- **One block, one file, one component export (plus its prop types).**
  `pricing-table.tsx` exports `PricingTable` alongside `PricingTier` and
  `PricingTableProps`, and nothing else — no second component, no default export, no
  `blocks/index.ts` barrel. Astro gives every `client:*` component its own React root, so
  a compound primitive (accordion, dialog, dropdown) split across an `.astro` file throws
  "must be used within" at runtime. Keep the whole composition inside the block.
- **Props-driven, with every default read from the content module.** Every prop is still
  optional and still carries a default — but the *words* come from
  `packages/ui/src/content/landing.ts`, not from the block. `hero.tsx` has
  `title = landing.hero.title`; `pricing-table.tsx` holds no tier data at all. Keep the
  props for the cases a page really varies (a second landing page can override any of
  them); change the copy by editing the content module. See below.
- **Never pass a component or a function as a prop from `.astro`.** Astro serializes
  island props, so icons live *inside* the block. Swap one by editing the block.
- **Semantic kebab-case filenames** (`feature-grid.tsx`), never shadcn's registry-style
  `{category}-{NN}` numbering — that disambiguates variants in a public registry, and
  this project has neither.
- **Static by default.** A block with no state renders to HTML and ships zero JS. Add a
  client directive only to the block that actually needs the browser, and pick the
  cheapest one: `client:idle` above the fold, `client:visible` below it. A blanket
  `client:load` on the page hydrates everything and throws away the reason this is a
  static site — see `apps/web/src/pages/index.astro` for the worked example.
- **`theme-toggle` is the exception that proves the rule.** It sits in `src/blocks/`
  beside the marketing blocks but is chrome, not copy: `navbar.tsx` renders it inside the
  bar, and it needs **no** client directive of its own despite being interactive. It has
  no `onClick` and no state — the pre-paint inline script the shared layout emits
  (`THEME_INIT_SCRIPT`, from `packages/ui/src/lib/theme.ts`) drives every
  `[data-theme-toggle]` on the page through one delegated listener, and CSS picks the
  icon off `<html data-theme>`. Move it, restyle it via its `className`, or delete the
  one line in `navbar.tsx` to drop it. Do **not** "fix" it by adding `client:*` or an
  `onClick`, and do not paste a second copy of the boot script into a page: any document
  that renders the block must inline that one constant in its `<head>`, or the control
  stays hidden.
- **`error-state` is the only error screen, and every app renders it.** An app that adds
  a route surface answers a miss with `ErrorState` — `apps/web` through
  `src/pages/404.astro`, the admin SPA through the root route's `notFoundComponent` and
  its error boundary, and `apps/api` through `base.notFound(...)`, which answers the same
  `{ error: { code, message } }` envelope as every other failure. Do **not** write a
  second error screen in an app: one block means one restyle when the theme moves, and a
  bespoke copy drifts out of the token vocabulary the day nobody is looking. Change the
  words in `packages/ui/src/content/errors.ts`, the markup in
  `packages/ui/src/blocks/error-state.tsx`.
- **A `prerender = false` page inherits `500.astro`.** `apps/web` registers
  `@astrojs/cloudflare` while staying on `output: "static"`, so `src/pages/500.astro` is
  built ahead of time and carries no detail from the failed request. The day a page opts
  into on-demand rendering, a throw inside it lands on that page for free — nothing to
  add. Two things move on that day and only that day: `wrangler.jsonc` gains a `main`
  pointing at the server entry the adapter now writes, and `dist/server` stops being
  empty. Setting `main` before then breaks the build, which is why the comment in
  `wrangler.jsonc` says to wait.
- **A block never reaches the network; the app injects the behaviour.** A block that needs
  to send something takes a function prop (`onSubmit`) and calls it. It does not import an
  api package, an http client, or `import.meta.env`. Two reasons, both concrete.
  `packages/ui` has a `typecheck` script and consumes workspaces as source, so one
  `import type { AppType } from "@repo/api/client"` here makes `tsc` compile the entire
  Worker source tree under this package's tsconfig. And a block that hardcodes an endpoint
  is a block you cannot reuse on a second page. The counterpart lives in the app: a small
  React file under `apps/web/src/components/` builds the client and passes the function
  down. Astro serializes island props, so the page renders **that** file, never the block
  directly.
- **A link that leaves the site opens a new tab.** Spread `externalLinkProps(href)` from `@repo/ui/lib/external-link` onto the anchor and render `newTabHint(href)` inside it. The href decides: an absolute URL gets `target="_blank"`, `rel="noopener noreferrer"` and a screen-reader hint, and a path or a same-page anchor stays in the tab. Do not write `target="_blank"` by hand.
- **A value that waits on a request shows a skeleton.** Render the `Skeleton` primitive at the size the value will take until the response arrives, never a blank gap or a spinner. Add it with `pnpm --filter @repo/ui exec shadcn add skeleton` the first time a block needs it.
- **A block never imports a store either.** Local state is fine; shared state is not. The app-side island reads the store and passes the values and the handlers down, the same pattern it uses for `onSubmit`.
- **A module's UI arrives here too, and you wire it up by hand.** `saasaloy add <module>`
  writes a UI-bearing module's block into `src/blocks/` exactly like the base blocks, adds
  the app-side island that feeds it, and then stops: nothing globs a folder, and no command
  edits `index.astro`. The command prints a pointer to the module's skill, and that skill's
  **Wire-up** section carries the import line, the component to render, the client
  directive, and a suggested spot on the page. Put it where you want it. `saasaloy remove`
  deletes the files it wrote and leaves your import alone, so take that line out yourself.

Blocks, like primitives, are source you own — they are meant to be edited, not wrapped.

**Containers — the shells and the layouts.** `src/containers/` holds the compositions that place blocks and components on a page: an app shell, a page layout, a page frame. The base ships none; `saasaloy add admin` writes the admin app's into `src/containers/admin/`.

- **A container places, a block renders.** It decides where the panels, the header and the detail view go, and it adds no copy a block could hold.
- **No router, no session.** A container takes the nav data, the current area, a link component and the account as props. The app reads its router and its session and passes them in, so a container never depends on one app's routes.
- **Still no IO.** A container does not fetch, persist, or authenticate.
- **Same file rules as blocks:** one container per file, semantic kebab-case filename, no barrel.

**The content module — where the words live.** `packages/ui/src/content/landing.ts` holds
every user-visible string on the landing page, in two namespaces:

- **`landing.*`** — marketing copy. What the product is, who it is for, what it costs.
  This is the whole surface a copy rewrite touches. The brand itself is not here: it is
  `config.app.name` in `packages/config/src/project.ts`, is not translated, and is set once
  by `saasaloy-setup`. The currency symbol and the tier ids and names are read from
  `@repo/config` for the same reason — they are ids and numbers, and `packages/billing`
  charges against the same ids.
- **`ui.*`** — chrome and accessibility labels (`Monthly`, `Most popular`, `Close menu`,
  `Billing period`). Nothing here says anything about the product, so a copy pass never
  rewrites it. It does get translated, key for key, when `landing.*` is written in some
  language other than English — no translation layer ships in the base, so that pass is the
  only one these strings get.

Blocks import it **directly** — `import { landing, ui } from "@repo/ui/content/landing"` —
never as props from `index.astro`. Astro serializes island props, so passing content into
`<PricingTable client:visible />` would write every string into the HTML payload *and*
still ship the defaults inside the island's bundle. Direct import keeps the static blocks
at zero JavaScript.

Five rules keep that file mechanically translatable — a translation layer reads a keyed
record and nothing else. Follow them when you add a block or a key:

1. **Max three levels below a namespace** (`landing.features.title`). Compiler-based i18n
   libraries emit one flat identifier per message and cannot see deeper nesting.
2. **Position is never the key.** Lists are arrays whose items carry a stable `id`, so
   reordering the feature grid cannot silently reattach the wrong translation. One list is
   exempt — a tier's `features` bullets stay a plain `string[]`, because nothing reads them
   individually (a feature id and an FAQ id both anchor an item that outlives its wording)
   and a tier's bullets are rewritten with that tier. The content file states the trade-off
   in full.
3. **Single-brace `{token}` placeholders, never a template literal.** Copy is data; a
   template literal is a function, which no extraction tool can read. Render with
   `interpolate()` from `@repo/ui/lib/interpolate`.
4. **No runtime concatenation.** `/month` plus `", billed annually"` is two whole
   messages (`ui.pricing.perMonth`, `ui.pricing.perMonthAnnual`) — word order does not
   survive the seam in every language.
5. **Only user-visible strings move.** Section `id`s and the same-page anchors pointing at
   them are structure and stay in the block. A few things break the rule, all because a
   thing rewritten *with* the copy belongs *near* the copy: the whole `tiers` array (prices
   and `ctaHref`s included); every `icon`, held as a registry *name* like `"zap"` and
   resolved to a component by `packages/ui/src/lib/icons.ts`, and every logo `mark`,
   resolved by `blocks/logo-cloud.tsx`; every outbound link (`*Href`), which leaves the
   page and so cannot break a section link; and the code the page quotes (terminal
   commands, module names, file paths). A translation layer reads `id`, `icon`, `mark`,
   every `*Href` and the quoted code as non-message data. A pair of backticks inside a
   message renders as `<code>` through `inlineCode()` from `@repo/ui/lib/inline-code`.

**No copy that goes stale.** Do not write a version number, a release date or a count into a message. Say something general and link to where the current value lives: the hero pill says "See what's new" and links to the changelog, so it stays true across every release.

Two consequences worth knowing. Blanking a navbar or footer link's label in content drops
that link, which is how a removed section loses its nav entry without editing a block. And
the theme toggle's labels deliberately stay in `packages/ui/src/lib/theme.ts`: that file is
inlined verbatim into a pre-paint `<script>` and is import-free on purpose.

**The default copy is Saasaloy's own.** A fresh project's page describes Saasaloy, and
`config.app.name` in `packages/config/src/sections/app.ts` defaults to `"Saasaloy"`, so the brand and the
words agree until you replace both. The two skills below replace them in one pass.

**Making this project yours.** Four skills ship with the base (linked at
`.claude/skills/`, real files in `.agents/skills/`). The first two run in order:

1. **`saasaloy-setup`** asks ten questions about the product — starting with its name — and
   writes the answers to `docs/product-brief.md`. Every question carries sample answers you
   can take, edit, or ignore. It also sets `config.app.name` and `config.app.locale`. Nothing else
   reads your product knowledge out of your head, so run it first; other skills read the
   brief rather than interviewing you again.
2. **`saasaloy-landing-copy`** turns that brief into the landing page's words. It drafts
   into `docs/landing-copy-draft.md` for you to review and edit, then writes
   `packages/ui/src/content/landing.ts` once you approve, then deletes the draft.

The other two have no place in that order, because they run whenever the thing they own moves:

3. **`saasaloy-design`** keeps `apps/web/DESIGN.md` true, and `apps/admin/DESIGN.md` when the admin app is installed. Its `theme` flow swaps the
   preset and re-derives the contract; `update` re-derives after you change `brand.css`,
   `web.css` or `admin.css`, or add components; `audit` reports where the code and the
   contract disagree. It reads the product brief when one exists and never writes it.
4. **`saasaloy-config`** covers `@repo/config`: the config-versus-`.env` rule, adding a
   section, the merge rule, and why an override is not taking effect.

Invoke them rather than editing thirteen blocks by hand — and if you do edit by hand, keep the
strings in the content module so the next pass finds them.

### Naming Conventions

- **Functions**: camelCase (`fetchUserData`, `calculateTotal`)
- **Components**: PascalCase (`UserProfile`, `DataTable`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`, `MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (`User`, `ApiResponse`)
- **Files**: kebab-case for components (`user-profile.tsx`), camelCase for utilities (`utils.ts`)

## Linting, Formatting, and Commit Hooks

The linter is **[oxlint](https://oxc.rs)** configured from
**[Ultracite](https://www.ultracite.ai)**'s presets, with **Prettier** and **Stylelint**
owning formatting. All four run from `oxlint.config.mjs`, `prettier.config.js` and
`stylelint.config.js` at the root — there is no shared config package, because oxlint
cannot consume one (`extends` takes file paths, JSON only).

- `pnpm lint` — the gate. Four passes, in order:
  1. `lint:types` — oxlint with `--type-aware` over `packages/env/src`, `packages/tooling/src` and `packages/ui/src`
  2. `lint:code` — oxlint over everything, no type information
  3. `lint:css` — Stylelint over `**/*.css`
  4. `format:check` — `prettier --check .`
- `pnpm lint:fix` — passes 1-3 with `--fix`: the type-aware oxlint invocation over
  the same three folders, the plain one over everything, then Stylelint. **Never** add
  `--fix-suggestions`: it rewrites `a[i++]` to `a[i += 1]`, which is a different program.
- `pnpm format` — `prettier --write .`
- `pnpm typecheck` — `tsc`, and it must pass before you commit.

**Why the type-aware pass is scoped and the plain one is not.** `--type-aware` is a
global CLI switch, so the split is by invocation rather than by config. It stays off
`.astro` because `apps/web/tsconfig.json` includes the build-generated
`.astro/types.d.ts`, which would make `astro sync` a prerequisite of every `pnpm lint`,
including on a fresh clone. Do not merge the two passes.

**Markdown is not formatted.** `.prettierignore` excludes `**/*.md` because Ultracite's
Prettier config sets `proseWrap: "never"`, which would collapse every hand-wrapped
paragraph — this file included — into a single line.

**Commit hooks are installed by husky** on your first `pnpm install`, and they need a `.git` directory, which `saasaloy init` creates for you. The root `prepare` script is `husky && node packages/tooling/src/link-skills.ts`, so the same install also links every folder in `.agents/skills/` into `.claude/skills/`. pnpm skips `prepare` when an install changes nothing, so after you add a skill folder to a checkout that is already installed, run `pnpm skills:link`. The hooks:

- `pre-commit` runs **lint-staged** over staged files only — oxlint `--fix`, Stylelint
  `--fix`, Prettier `--write`. It skips the type-aware pass on purpose: that one needs the
  whole project graph, which defeats staged-file scoping.
- `commit-msg` runs **commitlint** with `@commitlint/config-conventional`, so messages
  must read `type(scope): subject` — `feat:`, `fix(api):`, `chore(deps):`.

Bypass in a genuine emergency with `git commit --no-verify`, or `HUSKY=0` to skip every
hook (which is also how you keep hooks out of CI).

## Testing Instructions

The block below states this project's testing mode, which `saasaloy.json` records under `testing.mode`. Change the mode with `saasaloy testing <off|tests-after|tdd>`, never by hand: the command rewrites the block and the file together. The `saasaloy-testing` skill says what each mode asks and which test each kind of change needs: a unit test, a route test, a seed slice or a Playwright spec. Once `auth` is installed with testing on, `apps/api/src/routes/auth.test.ts` is the route test to copy.

<!-- saasaloy:testing -->
Testing mode: `off`. This project ships no module tests, and `saasaloy add` writes none. Do not add tests unless the owner asks for them.

- Turn module tests on with `saasaloy testing tests-after`, or `saasaloy testing tdd` to work test-first.
<!-- /saasaloy:testing -->

- Run type checking: `pnpm typecheck` (must pass before commits)
- Run linting: `pnpm lint` (see above — it reports, `pnpm lint:fix` fixes)
- Check formatting: `pnpm format:check`, or `pnpm format` to rewrite
- Run the tests: `pnpm test`. It runs `turbo run test` (each workspace's own `test` script), then `vitest run` from the root, whose `vitest.config.ts` treats every workspace under `apps/*` and `packages/*` as a project. Write new tests for Vitest: put a `*.test.ts` file beside the code, and give the workspace a `vitest.config.ts` only when it needs setup of its own. Do not add a per-workspace `test` script that calls Vitest, or the file runs twice. `packages/env` is the exception: its tests run on `node --test` through its own `test` script, and the root config leaves it out.
- Run the browser suite: `pnpm e2e`, once `saasaloy add e2e` is installed. It is Playwright against the running apps, in `packages/e2e`. Run `pnpm e2e:install` once per machine first to download Chromium. The root `vitest.config.ts` leaves `packages/e2e` out, so `pnpm test` never collects a Playwright spec. The `saasaloy-e2e` skill covers adding a flow and reading a red run.
- `packages/tooling` tests run on Vitest through the root `vitest.config.ts`, like every other workspace. The workspace has a `typecheck` script and no `test` script, so `pnpm test` runs each file once.
- Before you hand over UI work, run `pnpm dev`, load the pages you changed, and read the dev server's terminal output. Fix every error and warning it prints. A clean build does not prove a clean dev server.

## Branches and Deploys

- **Deploy from `main`.** `pnpm deploy:production` starts only from a branch that `branches` in `packages/tooling/src/deploy.config.ts` allows: `main` and `hotfix-*` by default. Every other branch fails the branch gate.
- **A fix while `main` holds unreleased work goes on a `hotfix-<slug>` branch** cut from the last deploy tag: `git switch -c hotfix-<slug> "$(git describe --tags --match 'deploy-*' --abbrev=0)"`. Deploy from that branch, then merge it into `main` so the next deploy keeps the fix.
- **No long-lived production branch.** The newest deploy tag marks the commit that is live, so no branch has to.
- **Never move or delete a deploy tag.** Each successful deploy pushes an annotated `deploy-<UTC yyyymmdd-hhmm>` tag. `git log <tag>..main` lists what the next deploy ships, and a hotfix branches from the tag.
- **Release before you deploy.** `pnpm release` bumps the root `package.json` version, writes `CHANGELOG.md`, and pushes an annotated `v<version>` tag and a GitHub Release. The `v*` tag names the release, and the `deploy-*` tag records when it went live. A deploy from a commit that is not a release warns and still runs. Never move or delete a release tag, and never edit `version` by hand.
- **Merge a hotfix branch into `main`, never rebase it.** A rebase rewrites the commit its release tag names.
- **An agent deploys only after the owner says so in the same session.** It runs `pnpm deploy:production --dry-run` and reports first. The `saasaloy-deploy` skill is the procedure, and `docs/runbook-deploy.md` holds this project's own deploy steps.

## Boundaries

### ✅ Always Do

- Read the app's `DESIGN.md` (`apps/web/DESIGN.md` for the web app, `apps/admin/DESIGN.md` for the admin app) before writing or changing UI
- Run `pnpm typecheck` before committing code changes
- Run `pnpm lint` and fix all errors
- Give every new app or package a `clean` script backed by `rimraf` (see above)
- Use TypeScript strict mode (no `any` without explicit reason)
- Use workspace package names (`@repo/ui`, `@repo/config`, `@repo/tsconfig`) for imports
- Put a value you would otherwise write twice in `@repo/config`, and a per-deployment value in
  `.env`/`.dev.vars` — see above

### ⚠️ Ask First

- Adding new dependencies (especially to root `package.json`)
- Building new UI before the owner has approved a mockup. Show screenshots of the mockup first and get approval. A change after approval gets a new mockup, not a fix after the work lands
- Modifying Turborepo configuration (`turbo.json`)
- Changing TypeScript strictness settings
- Modifying the husky hooks (`.husky/`), `lint-staged.config.js`, or `commitlint.config.js`
- Creating new workspace packages
- Changing `oxlint.config.mjs`, `prettier.config.js`, or `stylelint.config.js` — including
  turning a rule off. Suppress the one occurrence with a comment that says why instead
- Database schema changes or migrations
- CI/CD workflow modifications (`.github/workflows/`)

### 🚫 Never Do

- Never use `npm` or `npx`, instead use `pnpm` & `pnpm dlx`
- Never use `rm -rf` in a package script — it breaks on Windows; use `rimraf`
- Commit secrets or API keys. `packages/env/.env` is gitignored; `packages/env/.env.example`
  is tracked and holds local defaults only
- Modify `node_modules/` or `pnpm-lock.yaml` manually (use `pnpm install`)
- Remove or disable TypeScript strict mode
- Remove or disable the lint-staged or commitlint hooks, or commit with `--no-verify`
  as a habit rather than an emergency
- Use `any` type without explicit `@ts-expect-error` or `@ts-ignore` with justification
- Break the workspace structure (don't move packages outside `apps/*` or `packages/*`)
- Commit without running type checks and linting