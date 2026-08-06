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
`src/components/`, and the marketing **blocks** in `src/blocks/`. `apps/web` pulls the
theme in once, through the shared layout that imports `@repo/ui/globals.css`.

Everything is reached by subpath — nothing is re-exported from the package root, so
importing one primitive or block never drags in the rest:

```ts
import { Button } from "@repo/ui/components/button";
import { PricingTable } from "@repo/ui/blocks/pricing-table";
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

**Blocks — the page-level compositions.** `src/blocks/` holds the marketing blocks the
landing page is built from: `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`,
`cta`, `footer`. The rules are not stylistic — each one prevents a real failure:

- **One block, one file, one named export.** `pricing-table.tsx` exports `PricingTable`
  and nothing else — no default export, no `blocks/index.ts` barrel. Astro gives every
  `client:*` component its own React root, so a compound primitive (accordion, dialog,
  dropdown) split across an `.astro` file throws "must be used within" at runtime. Keep
  the whole composition inside the block.
- **Props-driven, with the copy as in-file defaults.** Every block takes optional props
  and falls back to a `const` default at the top of the file. Change the copy by editing
  that const; keep the props for the cases a page really varies.
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
- **The landing page has a second extension point.** `index.astro` globs
  `src/sections/*.astro` in sorted order, so dropping a file there adds a section with no
  edit to the page. `saasaloy add <module>` uses it; do not remove the glob.

Blocks, like primitives, are source you own — they are meant to be edited, not wrapped.

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