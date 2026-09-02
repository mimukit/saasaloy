# {{PROJECT_NAME}} — agent instructions

This is a SaaS project scaffolded with Saasaloy.


## Project Structure

This is a **pnpm workspace monorepo** managed by **Turborepo**.

- **Root**: Configuration files, shared tooling
- **`apps/*`**: Applications (Next.js, Astro apps - currently empty, will be added)
- **`packages/*`**: Shared packages
- **`infra`**: Centralized Cloudflare deployment (Pulumi), if the `infra` capability is installed —
  a root-level workspace, not nested under `apps/*` or `packages/*` (it's neither an app nor a
  shared package)

### Dev Port Map

Every dev port in this repo is pinned, not assigned on the fly. The api Worker's CORS
allow-list and the auth module's trusted origins hardcode the localhost origins, so a
drifting port turns into an unexplained CORS rejection.

| Workspace | Port | Dev URL | Pinned in |
| --- | --- | --- | --- |
| `apps/web` (Astro) | 3000 | `http://localhost:3000` | `apps/web/astro.config.mjs` (`server.port`) |
| `apps/admin` (TanStack Start) | 3001 | `http://localhost:3001` | `apps/admin/vite.config.ts` (`server.port`, `strictPort`) |
| `apps/api` (Hono on Workers) | 4000 | `http://localhost:4000` | `apps/api/wrangler.jsonc` (`dev.port`) |
| Postgres (local, `database-postgres`) | 5432 | `postgres://postgres:postgres@127.0.0.1:5432/app` | `DATABASE_URL` in `.env` |

The `apps/admin` and `apps/api` rows apply once you run `saasaloy add admin` or
`saasaloy add api`.

Rules for a new app or service:

- **Take the next free port in the block** — `apps/*` count up from 3000, backend services
  from 4000. Add a row to this table in the same change.
- **Set `strictPort` (or the framework's equivalent).** A busy port must fail loudly. A
  silent `+1` moves the app to an origin nothing allows.
- **Name the origin, don't infer it.** A browser-side caller reads `PUBLIC_API_URL` and
  falls back to `http://localhost:4000`; a server-side caller reads its own env var.
- **Update both allow-lists when you add a browser origin**: `DEV_ORIGINS` in
  `apps/api/src/index.ts` and `DEV_ORIGINS` in `packages/auth/src/auth.ts`.

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

### The `@repo/ui` Design Layer

`packages/ui` owns the design layer: the Tailwind 4 theme (`src/styles/globals.css`),
the `cn()` helper, the vendored [shadcn](https://ui.shadcn.com) primitives in
`src/components/`, the marketing **blocks** in `src/blocks/`, the store-bound
**containers** in `src/containers/`, and the landing page's copy in `src/content/`.
`apps/web` pulls the theme in once, through the shared layout that imports
`@repo/ui/globals.css`.

`DESIGN.md` at the repository root records the token values and the rules behind them. Read it before you add or change UI.

Primitives, blocks and containers are reached by subpath — none is re-exported from the
package root, so importing one never drags in the rest. The root export is project-wide
constants only (`siteName`):

```ts
import { siteName } from "@repo/ui";
import { Button } from "@repo/ui/components/button";
import { PricingTable } from "@repo/ui/blocks/pricing-table";
import { CartSummary } from "@repo/ui/containers/cart-summary";
import { landing, ui } from "@repo/ui/content/landing";
import { cn } from "@repo/ui/lib/utils";
```

**Three layers, split by state scope — not by "has state".**

1. **`src/components/`** — vendored shadcn primitives. No stores, no copy.
2. **`src/blocks/`** — compositions of primitives plus copy from the content module. Local
   state is allowed (an open accordion, a ticking clock). Importing a shared store is
   forbidden: a block takes its data as props and reports changes through callbacks, so
   every app — the Astro site, a React SPA's panels — can drive the same block from its own
   data source.
3. **`src/containers/`** — compositions that bind a shared store or cross-island state. A
   container subscribes, then wires data and callbacks into pure blocks. Containers are
   thin, app-flavored wiring; the visual weight stays in the blocks.

**One rule covers the whole package: no IO in `@repo/ui`.** No fetch, no persistence, no
auth, in any of the three layers. Client-state stores (nanostores) live in `src/lib/` and
are bound **only** in containers; the app that owns the data hydrates the store. When a
store-shaped need shows up in a block, move the binding up to a container instead of
importing the store in place.

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
- `style` is `base-nova` (Base UI) and is fixed at init — the CLI cannot change it later.
- `rsc` is `false`, so the CLI strips the `"use client"` directive for you. It means
  nothing in Astro, and the vendored primitives don't carry it.

Primitives are source you own. Edit them in place rather than wrapping them.

**Swapping the whole theme for a preset.** The token set in
`packages/ui/src/styles/globals.css` is shadcn's `neutral` with `cssVariables: true`, and
any shadcn **`registry:style`** item is a drop-in replacement for it. The same
`--filter … exec` form applies — there is no separate theme command:

```sh
pnpm --filter @repo/ui exec shadcn add https://tweakcn.com/r/themes/modern-minimal.json
```

The CLI merges the preset's `:root`, `.dark` and `@theme inline` blocks **into** the
existing ones, so the file's hand-written parts — the three `@source` globs, the
`@custom-variant dark`, the `@layer base` rules — stay put, and `components.json` is not
touched. It usually *extends* `@theme inline` with mappings the base does not carry
(fonts, tracking, shadows); that is expected.

Two places to get an item from:

1. **[`https://ui.shadcn.com/create`](https://ui.shadcn.com/create)** — first-party.
   Describe or dial in a theme and it hands you a URL.
2. **[`https://tweakcn.com`](https://tweakcn.com)** — a much larger preset library,
   serving items at `https://tweakcn.com/r/themes/<name>.json`.

Neither is special: the mechanism is the `registry:style` shape, so any URL that serves
one works.

**This edits a base file, and base files have no update path.** Saasaloy hands you the
template once; it never comes back to migrate it. A swapped theme is yours to maintain,
including re-applying anything you had customised in `globals.css` that the preset
overwrote. Diff the file after running the command rather than assuming.

A preset swap invalidates `DESIGN.md`, which records the token values the old theme had. The `saasaloy-design` skill's `theme` flow runs the command above for you and re-derives the contract from the merged result, so prefer it over running the command by hand. Pick one or the other — running both applies the preset twice.

Light/dark/system switching is unaffected by any of this — it keys off the `.dark` class,
which every preset keeps.

**Blocks — the page-level compositions.** `src/blocks/` holds the marketing blocks the
landing page is built from: `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`,
`cta`, `footer`. The rules are not stylistic — each one prevents a real failure:

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
  beside the marketing blocks but is chrome, not copy: `index.astro` places it as a
  sibling of `<Navbar />` and it takes **no** client directive despite being
  interactive. It has no `onClick` and no state — the pre-paint inline script the shared
  layout emits (`THEME_INIT_SCRIPT`, from `packages/ui/src/lib/theme.ts`) drives every
  `[data-theme-toggle]` on the page through one delegated listener, and CSS picks the
  icon off `<html data-theme>`. Move it, restyle it via its `className`, or delete the
  one line in `index.astro` to drop it. Do **not** "fix" it by adding `client:*` or an
  `onClick`, and do not paste a second copy of the boot script into a page: any document
  that renders the block must inline that one constant in its `<head>`, or the control
  stays hidden.
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
- **A block never imports a store either.** Local state is fine; shared state is not. See
  the containers section below.
- **A module's UI arrives here too, and you wire it up by hand.** `saasaloy add <module>`
  writes a UI-bearing module's block into `src/blocks/` exactly like the base blocks, adds
  the app-side island that feeds it, and then stops: nothing globs a folder, and no command
  edits `index.astro`. The command prints a pointer to the module's skill, and that skill's
  **Wire-up** section carries the import line, the component to render, the client
  directive, and a suggested spot on the page. Put it where you want it. `saasaloy remove`
  deletes the files it wrote and leaves your import alone, so take that line out yourself.

Blocks, like primitives, are source you own — they are meant to be edited, not wrapped.

**Containers — the store bindings.** `src/containers/` holds the compositions that read
shared state. The base ships none; the folder carries a note until you add your first.

- **A container subscribes, a block renders.** The container reads the store, passes the
  values down as props, and passes handlers that write back to the store. It adds no markup
  a block could hold. If a container grows layout and copy, that part belongs in a block.
- **The store lives in `src/lib/`, and only a container imports it.** A block that imports
  a store is a block a second app cannot reuse, because the store now decides where its data
  comes from. Move the binding up.
- **Still no IO.** A container reads client state; it does not fetch, persist, or
  authenticate. The app hydrates the store — the same app-side island pattern the blocks use
  for `onSubmit`.
- **Same file rules as blocks:** one container, one file, one component export, semantic
  kebab-case filename, no barrel. Astro gives every `client:*` component its own React root,
  so a container that a page hydrates must hold the whole composition.
- **A container almost always needs a client directive.** It subscribes at runtime, so it
  ships JavaScript by definition. Pick the cheapest one that works (`client:idle` above the
  fold, `client:visible` below it), and keep the blocks it renders static in every page that
  does not need the store.

**The content module — where the words live.** `packages/ui/src/content/landing.ts` holds
every user-visible string on the landing page, in two namespaces:

- **`landing.*`** — marketing copy. What the product is, who it is for, what it costs.
  This is the whole surface a copy rewrite touches. The brand itself is not here: `siteName`
  lives in `packages/ui/src/index.ts`, is not translated, and is set once by
  `saasaloy-setup`.
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
   them are structure and stay in the block. Three things break the rule, all because a
   thing rewritten *with* the copy belongs *near* the copy: the whole `tiers` array (prices
   and `ctaHref`s included); each feature's `icon`, held as a registry *name* like `"zap"`
   and resolved to a component by the map at the top of `blocks/feature-grid.tsx`; and the
   two outbound calls to action, `landing.navbar.ctaHref` and
   `landing.cta.primaryActionHref`/`.secondaryActionHref`, which leave the page and so
   cannot break a section link. A translation layer reads `id`, `icon` and every `*Href` as
   non-message data.

Two consequences worth knowing. Blanking a navbar or footer link's label in content drops
that link, which is how a removed section loses its nav entry without editing a block. And
the theme toggle's labels deliberately stay in `packages/ui/src/lib/theme.ts`: that file is
inlined verbatim into a pre-paint `<script>` and is import-free on purpose.

**Making this project yours.** Three skills ship with the base (linked at
`.claude/skills/`, real files in `.agents/skills/`). The first two run in order:

1. **`saasaloy-setup`** asks ten questions about the product — starting with its name — and
   writes the answers to `docs/product-brief.md`. Every question carries sample answers you
   can take, edit, or ignore. It also sets `siteName` and the page's `lang`. Nothing else
   reads your product knowledge out of your head, so run it first; other skills read the
   brief rather than interviewing you again.
2. **`saasaloy-landing-copy`** turns that brief into the landing page's words. It drafts
   into `docs/landing-copy-draft.md` for you to review and edit, then writes
   `packages/ui/src/content/landing.ts` once you approve, then deletes the draft.

The third has no place in that order, because it runs whenever the UI moves:

3. **`saasaloy-design`** keeps `DESIGN.md` true. Its `theme` flow swaps the preset and
   re-derives the contract; `update` re-derives after you change `globals.css` or add
   components; `audit` reports where the code and the contract disagree. It reads the
   product brief when one exists and never writes it.

Invoke them rather than editing eight blocks by hand — and if you do edit by hand, keep the
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
  1. `lint:types` — oxlint with `--type-aware` over `packages/ui/src`
  2. `lint:code` — oxlint over everything, no type information
  3. `lint:css` — Stylelint over `**/*.css`
  4. `format:check` — `prettier --check .`
- `pnpm lint:fix` — passes 1-3 with `--fix`: the type-aware oxlint invocation over
  `packages/ui/src`, the plain one over everything, then Stylelint. **Never** add
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

**Commit hooks are installed by husky** on your first `pnpm install` (`prepare: "husky"`),
and they need a `.git` directory, which `saasaloy init` creates for you:

- `pre-commit` runs **lint-staged** over staged files only — oxlint `--fix`, Stylelint
  `--fix`, Prettier `--write`. It skips the type-aware pass on purpose: that one needs the
  whole project graph, which defeats staged-file scoping.
- `commit-msg` runs **commitlint** with `@commitlint/config-conventional`, so messages
  must read `type(scope): subject` — `feat:`, `fix(api):`, `chore(deps):`.

Bypass in a genuine emergency with `git commit --no-verify`, or `HUSKY=0` to skip every
hook (which is also how you keep hooks out of CI).

## Testing Instructions

- Run type checking: `pnpm typecheck` (must pass before commits)
- Run linting: `pnpm lint` (see above — it reports, `pnpm lint:fix` fixes)
- Check formatting: `pnpm format:check`, or `pnpm format` to rewrite
- There is no `pnpm test` at the root, and no workspace declares a `test` script. The base ships no test runner: pick one and add it per workspace when you have something to test.

## Boundaries

### ✅ Always Do

- Read `DESIGN.md` before writing or changing UI
- Run `pnpm typecheck` before committing code changes
- Run `pnpm lint` and fix all errors
- Give every new app or package a `clean` script backed by `rimraf` (see above)
- Use TypeScript strict mode (no `any` without explicit reason)
- Use workspace package names (`@repo/ui`, `@repo/tsconfig`) for imports

### ⚠️ Ask First

- Adding new dependencies (especially to root `package.json`)
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
- Commit secrets, API keys, or environment variables
- Modify `node_modules/` or `pnpm-lock.yaml` manually (use `pnpm install`)
- Remove or disable TypeScript strict mode
- Remove or disable the lint-staged or commitlint hooks, or commit with `--no-verify`
  as a habit rather than an emergency
- Use `any` type without explicit `@ts-expect-error` or `@ts-ignore` with justification
- Break the workspace structure (don't move packages outside `apps/*`, `packages/*`, or `infra`)
- Commit without running type checks and linting