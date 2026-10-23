import { Hono } from "hono";
import { adminAuth, auth, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";

// Two forwards, one per Better Auth instance: `authRoute` at `/auth` for the client group
// and `adminAuthRoute` at `/admin/auth` for the admin group. This module's two
// `chained-route` patches mount them. Each patch targets `base`, the pre-chain binding
// in `apps/api/src/index.ts`, not the exported chain: a catch-all answers every path
// under its prefix with whatever Better Auth decides, so there is no
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

// The admin group's forward, mounted at `/admin/auth`. Everything said above holds for
// it. The path sits under `/admin` on purpose, so one edge rule covers the whole admin
// group on the api, which reserves the prefix: a middleware a project adds on `/admin/*`
// must skip `/admin/auth/*`, or the sign-in endpoint itself needs a session.
export const adminAuthRoute = new Hono<{ Bindings: AuthDbBindings }>().on(
  ["GET", "POST"],
  "/*",
  (c) => withAuthScope(c, () => adminAuth.handler(c.req.raw))
);
