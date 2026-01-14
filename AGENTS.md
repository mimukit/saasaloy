# AGENTS.md

Instructions for AI coding agents working on SaasAloy.

## Setup Commands

- Install dependencies: `pnpm install`
- Start dev server: `pnpm dev` (runs all packages in watch mode via Turborepo)
- Build all packages: `pnpm build` (Turborepo cached build)
- Run linting: `pnpm lint` (runs ESLint across all packages)
- Check TypeScript types: `pnpm check-types` (runs `tsc --noEmit` across all packages)
- Format code: `pnpm format` (runs Prettier on all files)

## Project Structure

This is a **pnpm workspace monorepo** managed by **Turborepo**.

- **Root**: Configuration files, shared tooling
- **`apps/*`**: Applications (Next.js, Astro apps - currently empty, will be added)
- **`packages/*`**: Shared packages
  - `packages/ui` - Shadcn UI component library (React 19, Tailwind CSS 4)
  - `packages/eslint-config` - Shared ESLint configuration
  - `packages/typescript-config` - Shared TypeScript configurations

### Workspace Commands

- Filter to specific package: `pnpm --filter <package-name> <command>`
- Example: `pnpm --filter @repo/ui build`
- Use `pnpm turbo run <task> --filter <package-name>` for Turborepo tasks

## Tech Stack

- **Runtime**: Node.js >=24 (see `.nvmrc` for exact version)
- **Package Manager**: pnpm 10.28.0 (enforced via `packageManager` field)
- **Build System**: Turborepo 2.7.4
- **Frontend**: React 19, Next.js, Astro, Tailwind CSS 4.1.18
- **UI Library**: Shadcn UI (new-york style, Radix UI primitives)
- **Language**: TypeScript 5.9.3 (strict mode enabled)
- **Testing**: Vitest, Playwright (to be added)
- **AI**: Vercel AI SDK (for autonomous reasoning loops)
- **Database**: Postgres with Row-Level Security (RLS)

## Code Style

### Formatting

- **Quotes**: Double quotes (`"`), not single quotes
- **Semicolons**: Always use semicolons
- **Indentation**: 2 spaces (see `.editorconfig`)
- **Line endings**: LF (Unix-style)
- **Trailing commas**: ES5 style (objects, arrays, function parameters)
- **Import sorting**: Automatic via `@trivago/prettier-plugin-sort-imports`
  - React imports first
  - Built-in modules
  - Third-party modules
  - `@/` aliases
  - Relative imports (`./`, `../`)

### TypeScript

- **Strict mode**: Enabled (no implicit any, strict null checks, etc.)
- **Module system**: NodeNext (ESM)
- **Target**: ES2022
- **Unchecked indexed access**: Enabled (`noUncheckedIndexedAccess: true`)

### Code Examples

```typescript
// ✅ Good - proper types, error handling, descriptive names
import { type User } from "@repo/types";

async function fetchUserById(id: string): Promise<User> {
  if (!id) {
    throw new Error("User ID is required");
  }

  const response = await api.get(`/users/${id}`);
  return response.data;
}

// ❌ Bad - implicit any, no error handling, vague names
async function get(x) {
  return await api.get("/users/" + x).data;
}
```

```tsx
// ✅ Good - proper component structure with variants
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border bg-background",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

function Button({ className, variant, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, className }))} {...props} />
  );
}

// ❌ Bad - inline styles, no type safety, magic strings
function Button({ className, variant }) {
  return (
    <button className={`btn ${variant === "outline" ? "border" : "bg-blue"}`} />
  );
}
```

### Naming Conventions

- **Functions**: camelCase (`fetchUserData`, `calculateTotal`)
- **Components**: PascalCase (`UserProfile`, `DataTable`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`, `MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (`User`, `ApiResponse`)
- **Files**: kebab-case for components (`user-profile.tsx`), camelCase for utilities (`utils.ts`)

## Testing Instructions

- Run tests: `pnpm test` (when test scripts are added)
- Run type checking: `pnpm check-types` (must pass before commits)
- Run linting: `pnpm lint` (auto-fixes where possible)
- Format check: `pnpm format` (auto-formats all files)

### Before Committing

1. Run `pnpm check-types` - all TypeScript errors must be resolved
2. Run `pnpm lint` - all linting errors must be fixed
3. Run `pnpm format` - code will be auto-formatted
4. Husky pre-commit hook runs `lint-staged` automatically:
   - ESLint with `--fix` on `*.{js,ts,jsx,tsx}`
   - Prettier on all files

## Git Workflow

### Commit Messages

- **Format**: Conventional Commits (enforced by commitlint)
- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, etc.
- **Scope**: Optional package name (e.g., `feat(ui): add button component`)
- **Examples**:
  - `feat: add user authentication`
  - `fix(ui): resolve button hover state`
  - `docs: update contributing guide`
  - `chore: update dependencies`

### Hooks

- **Pre-commit**: Runs `lint-staged` (ESLint + Prettier)
- **Commit-msg**: Validates commit message format via commitlint

### Branching

- Follow conventional branch naming
- Create feature branches from `main`
- PR titles should follow commit message format

## Package-Specific Notes

### `@repo/ui` Package

- **Location**: `packages/ui/`
- **Exports**: Components via `@repo/ui/components/*`, utilities via `@repo/ui/lib/*`
- **Styles**: Global CSS exported as `@repo/ui/globals.css`
- **Shadcn config**: `components.json` (new-york style, RSC disabled)
- **Type checking**: `pnpm --filter @repo/ui check-types`

### Shared Configs

- **ESLint**: `@repo/eslint-config` (extends TypeScript ESLint recommended)
- **TypeScript**: `@repo/typescript-config` (base, nextjs, react-library presets)

## Boundaries

### ✅ Always Do

- Run `pnpm check-types` before committing code changes
- Run `pnpm lint` and fix all errors
- Follow the code style examples above
- Use TypeScript strict mode (no `any` without explicit reason)
- Write components using Shadcn UI patterns (variants with `cva`)
- Use workspace package names (`@repo/ui`, `@repo/eslint-config`) for imports
- Keep commit messages in conventional format
- Update tests when modifying functionality

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

- Commit secrets, API keys, or environment variables
- Modify `node_modules/` or `pnpm-lock.yaml` manually (use `pnpm install`)
- Remove or disable TypeScript strict mode
- Remove or disable lint-staged or commitlint hooks
- Use `any` type without explicit `@ts-expect-error` or `@ts-ignore` with justification
- Modify files in `packages/eslint-config` or `packages/typescript-config` without updating all consumers
- Break the workspace structure (don't move packages outside `apps/*` or `packages/*`)
- Commit without running type checks and linting

## Additional Context

- **Project Purpose**: Enterprise-grade AI SaaS starter kit with data sovereignty focus
- **Key Features**: Multi-tenancy via Postgres RLS, Vercel AI SDK integration, pgvector RAG pipeline
- **Deployment**: Docker-based, fully portable
- **License**: MIT
