import { hc } from "hono/client";

import type { AppType } from "@repo/api/client";

import { apiBaseUrl } from "@admin/lib/auth";

// The one typed api client for the SPA. `AppType` is `apps/api`'s route chain, so
// `api.health.$get()` and the shape it answers with come from the route file itself:
// rename a path or change a response schema in apps/api and this file stops
// typechecking. That check runs in CI because turbo runs `typecheck` across every
// workspace, and apps/admin is one of them.
//
// `@repo/api/client` is a types-only export (its package.json maps "./client" under a
// `types` condition alone), which is why `@repo/api` is a devDependency here. Nothing
// of the Worker — its bindings, its middleware, its handlers — reaches this bundle.
//
// The origin is shared with the auth client rather than re-read from
// `import.meta.env`, so api calls and session calls can never point at two different
// hosts. Cookies are what makes that matter: the session cookie is scoped to the api
// origin, and a client bound elsewhere would send none.
//
// `init.credentials: "include"` is the whole reason this file exists instead of a
// one-line `hc()` at each call site. `fetch` omits cookies cross-origin by default, so
// without it every request from :3001 to :4000 arrives anonymous and the api answers
// 401. The api's CORS layer already sets `credentials: true` for the allowlisted dev
// origins, which is the server half of the same handshake.
export const api = hc<AppType>(apiBaseUrl, {
  init: { credentials: "include" },
});
