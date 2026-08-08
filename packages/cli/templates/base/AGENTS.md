# {{PROJECT_NAME}} — agent instructions

This is a SaaS project scaffolded with Saasaloy.


## Project Structure

This is a **pnpm workspace monorepo** managed by **Turborepo**.

- **Root**: Configuration files, shared tooling
- **`apps/*`**: Applications (Next.js, Astro apps - currently empty, will be added)
- **`packages/*`**: Shared packages

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
  creating routes/schema/auth; modules drop files into convention-based extension points.

### The `@repo/ui` Design Layer

`packages/ui` owns the design layer: the Tailwind 4 theme (`src/styles/globals.css`),
the `cn()` helper, the vendored [shadcn](https://ui.shadcn.com) primitives in
`src/components/`, the marketing **blocks** in `src/blocks/`, and the landing page's copy
in `src/content/`. `apps/web` pulls the theme in once, through the shared layout that
imports `@repo/ui/globals.css`.

Primitives and blocks are reached by subpath — neither is re-exported from the package
root, so importing one never drags in the rest. The root export is project-wide constants
only (`siteName`):

```ts
import { siteName } from "@repo/ui";
import { Button } from "@repo/ui/components/button";
import { PricingTable } from "@repo/ui/blocks/pricing-table";
import { landing, ui } from "@repo/ui/content/landing";
import { cn } from "@repo/ui/lib/utils";
```

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
`--filter … exec` form applies — there is no separate theme command, and no Saasaloy one
either:

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
- **The landing page has a second extension point.** `index.astro` globs
  `src/sections/*.astro` in sorted order, so dropping a file there adds a section with no
  edit to the page. `saasaloy add <module>` uses it; do not remove the glob.

Blocks, like primitives, are source you own — they are meant to be edited, not wrapped.

**The content module — where the words live.** `packages/ui/src/content/landing.ts` holds
every user-visible string on the landing page, in two namespaces:

- **`landing.*`** — marketing copy. What the product is, who it is for, what it costs.
  This is the whole surface a copy rewrite touches, plus `siteName` in
  `packages/ui/src/index.ts`.
- **`ui.*`** — chrome and accessibility labels (`Monthly`, `Most popular`, `Close menu`,
  `Billing period`). Nothing here says anything about the product.

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
   reordering the feature grid cannot silently reattach the wrong translation.
3. **Single-brace `{token}` placeholders, never a template literal.** Copy is data; a
   template literal is a function, which no extraction tool can read. Render with
   `interpolate()` from `@repo/ui/lib/interpolate`.
4. **No runtime concatenation.** `/month` plus `", billed annually"` is two whole
   messages (`ui.pricing.perMonth`, `ui.pricing.perMonthAnnual`) — word order does not
   survive the seam in every language.
5. **Only user-visible strings move.** `href`s, section `id`s and icons are structure and
   stay in the block. The one stated exception is pricing: the whole `tiers` array lives
   in content, prices and `ctaHref`s included, so pricing is rewritten in one place.

Two consequences worth knowing. Blanking a navbar or footer link's label in content drops
that link, which is how a removed section loses its nav entry without editing a block. And
the theme toggle's labels deliberately stay in `packages/ui/src/lib/theme.ts`: that file is
inlined verbatim into a pre-paint `<script>` and is import-free on purpose.

**Rewriting the copy for your product.** `.claude/skills/saasaloy-landing-copy` (real files
in `.agents/skills/`) interviews you about the product and writes the answers into the
content module. Invoke it rather than editing eight blocks by hand — and if you edit by
hand, keep the strings in the content module so the next pass finds them.

### Naming Conventions

- **Functions**: camelCase (`fetchUserData`, `calculateTotal`)
- **Components**: PascalCase (`UserProfile`, `DataTable`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`, `MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (`User`, `ApiResponse`)
- **Files**: kebab-case for components (`user-profile.tsx`), camelCase for utilities (`utils.ts`)

## Testing Instructions

- Run type checking: `pnpm typecheck` (must pass before commits)
- Run linting: `pnpm lint` (auto-fixes where possible)
- Format check: `pnpm format` (auto-formats all files)
- Run tests: `pnpm test` (when test scripts are added)

## Boundaries

### ✅ Always Do

- Run `pnpm typecheck` before committing code changes
- Run `pnpm lint` and fix all errors
- Give every new app or package a `clean` script backed by `rimraf` (see above)
- Use TypeScript strict mode (no `any` without explicit reason)
- Use workspace package names (`@repo/ui`, `@repo/eslint-config`) for imports

### ⚠️ Ask First

- Adding new dependencies (especially to root `package.json`)
- Modifying Turborepo configuration (`turbo.json`)
- Changing TypeScript strictness settings
- Modifying Husky hooks or commitlint rules
- Creating new workspace packages
- Changing Prettier or ESLint configurations
- Database schema changes or migrations
- CI/CD workflow modifications (`.github/workflows/`)

### 🚫 Never Do

- Never use `npm` or `npx`, instead use `pnpm` & `pnpm dlx`
- Never use `rm -rf` in a package script — it breaks on Windows; use `rimraf`
- Commit secrets, API keys, or environment variables
- Modify `node_modules/` or `pnpm-lock.yaml` manually (use `pnpm install`)
- Remove or disable TypeScript strict mode
- Remove or disable lint-staged or commitlint hooks
- Use `any` type without explicit `@ts-expect-error` or `@ts-ignore` with justification
- Break the workspace structure (don't move packages outside `apps/*` or `packages/*`)
- Commit without running type checks and linting