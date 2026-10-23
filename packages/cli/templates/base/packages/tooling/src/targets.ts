import type { DeployTarget, SmokeCheck } from "./types.ts";

// What `pnpm deploy:production` uploads, in which order, and what it asks the live hosts
// afterwards. This file is the project's: `saasaloy init` writes it once and `saasaloy
// update` never touches it again. `saasaloy add api` and `saasaloy add admin` each append
// their own rows with a `const-array` patch.
//
// Keep both lines in exactly this shape: `export const NAME: Type[] = [...]` with a real
// array literal. The codemod behind the `const-array` patch kind has nothing to push into
// otherwise, and `saasaloy add` cannot add the module's rows.

/**
 * Every Worker the deploy uploads, lowest `order` first. Every workspace under `apps/`
 * with a `wrangler.jsonc` and a `deploy` script needs a row, or the deploy stops and
 * names it.
 */
export const DEPLOY_TARGETS: DeployTarget[] = [{ service: "web", order: 30 }];

/**
 * The requests the deploy sends once every Worker is live. The host is each
 * `custom_domain: true` entry in the service's `wrangler.jsonc` `routes`. A service
 * with no custom domain gets no smoke check, and the run says so.
 */
export const SMOKE_CHECKS: SmokeCheck[] = [
  { id: "web-home", service: "web", path: "/", status: 200 },
  {
    id: "web-not-found",
    service: "web",
    path: "/__saasaloy-smoke-404",
    status: 404,
  },
  {
    id: "web-no-wrangler-json",
    service: "web",
    path: "/wrangler.json",
    status: 404,
  },
];
