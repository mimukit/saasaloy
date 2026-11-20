import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { adminAuth, auth, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { declare } from "../contract";
import { authRouteGuards } from "./auth-guards.generated";

/** Identity, so `authGuards` reads as a registry call like every other table. */
function defineGuards(config: { guards: MiddlewareHandler[] }) {
  return config;
}

// The guard table. A feature module adds a factory call as a row of the `auth.routeGuards`
// table, which the CLI writes into `./auth-guards.generated.ts`, and the call
// returns a Hono middleware that runs ahead of Better Auth on `/auth` only, never on
// `/admin/auth`. A guard owns a few paths: on every other path it calls `next()` and
// returns. It runs inside `withAuthScope`, so `authDb` from `@repo/auth/server` is this
// request's client. A guard of your own goes after the spread.
//
// The array is read once, when this module loads, so a guard cannot be added at runtime.
export const authGuards = defineGuards({ guards: [...authRouteGuards] });

// Two forwards, one per Better Auth instance: `authRoute` at `/auth` for the client group
// and `adminAuthRoute` at `/admin/auth` for the admin group. This module's two
// `api.baseRoutes` rows mount them. Both rows land on `base`, the pre-chain binding
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
// The export is named, not default: `apps/api/src/routes.generated.ts` imports it as
// `import { authRoute } from "./routes/auth"`.
export const authRoute = new Hono<{ Bindings: AuthDbBindings }>().on(
  ["GET", "POST"],
  "/*",
  declare({
    name: "auth_handler",
    description:
      "Better Auth's endpoints for the app's users: sign-up, sign-in, sessions.",
    agent: {
      callable: false,
      reason: "Sign-in runs in a browser, not through an agent.",
    },
  }),
  // The scope opens first and stays open across the guards, so a guard reads the
  // database through `authDb` on the same client the handler uses.
  (c, next) => withAuthScope(c, () => next()),
  ...authGuards.guards,
  (c) => auth.handler(c.req.raw)
);

const ADMIN_PLUGIN_PATH = /^\/+admin\/+auth\/+admin(?:\/|$)/i;

/**
 * Whether a request path names an `admin()` plugin endpoint on the admin instance. It
 * decodes the path, folds case and repeated slashes, and matches the prefix rather than a
 * list, so an encoded or oddly written path is refused too, and so is an endpoint a
 * better-auth bump adds.
 */
function isAdminPluginPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: match the raw path, which Better Auth would refuse anyway.
  }
  return ADMIN_PLUGIN_PATH.test(path);
}

// The admin group's forward, mounted at `/admin/auth`. Everything said above holds for
// it. The path sits under `/admin` on purpose, so one edge rule covers the whole admin
// group on the api, which reserves the prefix: a middleware a project adds on `/admin/*`
// must skip `/admin/auth/*`, or the sign-in endpoint itself needs a session.
//
// It forwards everything except the `admin()` plugin's own endpoints,
// `/admin/auth/admin/*`, which answer 404 here, reads and impersonation included. No
// browser code calls them, and `set-role` or `ban-user` over HTTP would be a staff write
// with no audit row, under `/admin/auth/*` where the audit coverage test cannot see it
// (issue #310). A staff write that needs one goes through an api route under `/admin/`
// that calls `adminAuth.api.*` with the caller's headers inside `adminAuthWrite`, so the
// rank guard still runs and the change leaves its row. The client instance refuses the
// same endpoints under `/auth/admin/*` through `clientAdminGuard()`.
export const adminAuthRoute = new Hono<{ Bindings: AuthDbBindings }>().on(
  ["GET", "POST"],
  "/*",
  declare({
    name: "admin_auth_handler",
    description: "Better Auth's endpoints for the admin console's staff.",
    agent: { callable: false, reason: "Admin routes are never callable." },
  }),
  (c) =>
    isAdminPluginPath(new URL(c.req.url).pathname)
      ? c.notFound()
      : withAuthScope(c, () => adminAuth.handler(c.req.raw))
);
