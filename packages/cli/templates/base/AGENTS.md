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

## Tech & Tools

- **pnpm** — non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`.
  Exact versions are pinned (`saveExact`).
- **TypeScript + ESM.** Internal packages are consumed JIT (no build step) via `workspace:*`.
- **Add features, don't hand-wire them.** Prefer `saasaloy add <module>` over manually
  creating routes/schema/auth; modules drop files into convention-based extension points.

### Naming Conventions

- **Functions**: camelCase (`fetchUserData`, `calculateTotal`)
- **Components**: PascalCase (`UserProfile`, `DataTable`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`, `MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (`User`, `ApiResponse`)
- **Files**: kebab-case for components (`user-profile.tsx`), camelCase for utilities (`utils.ts`)

## Testing Instructions

- Run type checking: `pnpm check-types` (must pass before commits)
- Run linting: `pnpm lint` (auto-fixes where possible)
- Format check: `pnpm format` (auto-formats all files)
- Run tests: `pnpm test` (when test scripts are added)

## Boundaries

### ✅ Always Do

- Run `pnpm check-types` before committing code changes
- Run `pnpm lint` and fix all errors
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
- Commit secrets, API keys, or environment variables
- Modify `node_modules/` or `pnpm-lock.yaml` manually (use `pnpm install`)
- Remove or disable TypeScript strict mode
- Remove or disable lint-staged or commitlint hooks
- Use `any` type without explicit `@ts-expect-error` or `@ts-ignore` with justification
- Break the workspace structure (don't move packages outside `apps/*` or `packages/*`)
- Commit without running type checks and linting