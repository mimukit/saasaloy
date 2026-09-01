import { Hono } from "hono";
import { auth, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";

// Mounted at `/auth` by this module's `chained-route` patch. The patch targets `base`,
// the pre-chain binding in `apps/api/src/index.ts`, not the exported chain: a catch-all
// answers every path under `/auth` with whatever Better Auth decides, so there is no
// per-path request or response type for `hc` to read. Mounting it on the annotated
// `base` keeps it out of `AppType` instead of widening the client's surface with a
// wildcard it cannot describe. It also lands after api's credentialed CORS middleware,
// which cookie-based sessions need.
//
// A thin forward — every method Better Auth handles arrives here and goes straight to
// `auth.handler`; this file never imports `better-auth` itself (ADR 0020, the vendor
// package stays inside `packages/auth`).
//
// `withAuthScope` is the one thing that is not forwarding. `auth` is a module-scope
// singleton and its database client is not, so the handler runs inside a scope holding
// this request's client. This route is where the scope is opened for every auth
// endpoint: it is the only place that holds both `c.env` and `c.executionCtx`, which are
// what the driver needs to open the client and to close it after the response. Under
// `database-postgres` that close is what stops a socket outliving the request; under
// `database-d1` there is nothing to close and the wrapper only enters the scope. One
// file, both drivers — `AuthDbBindings` is whichever binding shape the installed driver
// declares. See packages/auth/src/db-scope.ts.
//
// The export is named, not default: the codemod writes `import { authRoute } from
// "./routes/auth"` and refuses to wire a link whose binding is a default import.
export const authRoute = new Hono<{ Bindings: AuthDbBindings }>().on(
  ["GET", "POST"],
  "/*",
  (c) => withAuthScope(c, () => auth.handler(c.req.raw))
);
