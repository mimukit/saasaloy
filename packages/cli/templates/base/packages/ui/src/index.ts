// Shared UI package (`@repo/ui`). This root entrypoint is for project-wide constants
// only — the theme, primitives and blocks are reached through their own subpath exports
// (`@repo/ui/styles/web.css`, `@repo/ui/components/*`, `@repo/ui/blocks/*`) and are
// deliberately NOT re-exported here, so importing one never drags in the rest.
//
// It also proves the monorepo's JIT internal-package wiring — apps/web imports
// `siteName` from here with no build step (workspace:* + Vite transpiles the TS directly).
import { config } from "@repo/config";

/**
 * The brand every block and page shows. Its one home is `config.app.name`, and this is the
 * alias every existing consumer already imports: a page, the layout, the footer. It ships
 * as "Saasaloy" because the default landing page describes Saasaloy itself, so the name and
 * the copy agree on a fresh project. The saasaloy-setup skill sets your product's name in
 * `packages/config/src/project.ts`, and saasaloy-landing-copy rewrites the words to match.
 */
export const siteName = config.app.name;
