// Shared UI package (`@repo/ui`). This root entrypoint is for project-wide constants
// only — the theme, primitives and blocks are reached through their own subpath exports
// (`@repo/ui/globals.css`, `@repo/ui/components/*`, `@repo/ui/blocks/*`) and are
// deliberately NOT re-exported here, so importing one never drags in the rest.
//
// It also proves the monorepo's JIT internal-package wiring — apps/web imports
// `siteName` from here with no build step (workspace:* + Vite transpiles the TS directly).
export const siteName = "{{PROJECT_NAME}}";
