// Shared UI package (`@repo/ui`). This root entrypoint is for project-wide constants
// only — the theme, primitives and blocks are reached through their own subpath exports
// (`@repo/ui/globals.css`, `@repo/ui/components/*`, `@repo/ui/blocks/*`) and are
// deliberately NOT re-exported here, so importing one never drags in the rest.
//
// It also proves the monorepo's JIT internal-package wiring — apps/web imports
// `siteName` from here with no build step (workspace:* + Vite transpiles the TS directly).
import { config } from "@repo/config";

/**
 * The product name. One home, `packages/config/src/project.ts`, and this is the alias every
 * existing consumer already imports — a page, a layout, the footer. Emails and the api read
 * `config.app.name` directly; nothing keeps a second copy of the string.
 */
export const siteName = config.app.name;
