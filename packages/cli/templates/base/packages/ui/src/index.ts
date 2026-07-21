// Shared UI package (`@repo/ui`). A stub for now: real shadcn-based React components
// arrive when a feature module needs them. It already earns its place by proving the
// monorepo's JIT internal-package wiring — apps/web imports `siteName` from here with
// no build step (workspace:* + Vite transpiles the TS directly).
export const siteName = "{{PROJECT_NAME}}";
