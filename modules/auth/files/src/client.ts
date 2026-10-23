import { createAuthClient } from "better-auth/client";
import { adminClient } from "better-auth/client/plugins";

// Framework-agnostic client (`@auth/client`) — no new npm dep, `createAuthClient`
// ships inside `better-auth` itself. There are no React bindings and none are planned:
// `apps/admin` calls this client directly from its own `src/lib/auth.ts`, and so does any
// other vanilla JS/TS caller or non-React framework.
//
// `baseURL` is the API origin (e.g. https://api.x.com — same origin `BETTER_AUTH_URL`
// points the server at); `basePath` must match the server's (`/auth` or `/admin/auth`).
// `credentials: "include"` is required for the httpOnly session cookie to ride along on
// every request — the api spine's CORS (`modules/api`) must allow the calling origin with
// `credentials: true` for this to succeed cross-origin.
//
// There are two clients, one per Better Auth instance, and a browser bundle picks the one
// for its user group. `createClient` talks to the client instance at `/auth`, which every
// customer-facing app uses. `createAdminClient` talks to the admin instance at
// `/admin/auth`, which only `apps/admin` uses. Each holds its own cookie, so the two
// sessions never overwrite each other in one browser.
//
// `adminClient()` is the client half of the server's `admin()` plugin, and it rides on the
// admin client only: its endpoints answer only on `/admin/auth`. It types
// `session.user.role` (plus `banned`/`banReason`/`banExpires`) on everything the admin
// client returns, so a role guard reads a real field instead of casting. The server still
// authorizes every admin call, so shipping it to a browser grants nothing.
function definePlugins<T>(config: T): T {
  return config;
}

// Module-scope patch points, not values to move into the factories. The `plugin-array`
// codemod needs this exact `export const <name> = <fn>({ plugins: [...] })` shape so
// feature modules can add their client plugins. Keep each array literal here, and never
// omit one, even when no client plugin ships by default. A feature module that ships a
// client plugin patches both.
export const authClientPlugins = definePlugins({
  plugins: [],
});

export const adminAuthClientPlugins = definePlugins({
  plugins: [adminClient()],
});

/** The client-group client, for every app a customer signs in to. */
export function createClient(baseURL: string) {
  return createAuthClient({
    basePath: "/auth",
    baseURL,
    fetchOptions: { credentials: "include" },
    ...authClientPlugins,
  });
}

/** The admin-group client, for `apps/admin` only. */
export function createAdminClient(baseURL: string) {
  return createAuthClient({
    basePath: "/admin/auth",
    baseURL,
    fetchOptions: { credentials: "include" },
    ...adminAuthClientPlugins,
  });
}
