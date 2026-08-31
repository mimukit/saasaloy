import { createAuthClient } from "better-auth/client";
import { adminClient } from "better-auth/client/plugins";

// Framework-agnostic client (`@auth/client`) — no new npm dep, `createAuthClient`
// ships inside `better-auth` itself. There are no React bindings and none are planned:
// `apps/admin` calls this client directly from its own `src/lib/auth.ts`, and so does any
// other vanilla JS/TS caller or non-React framework.
//
// `baseURL` is the API origin (e.g. https://api.x.com — same origin `BETTER_AUTH_URL`
// points the server at); `basePath` must match the server's (`/auth`). `credentials:
// "include"` is required for the httpOnly session cookie to ride along on every
// request — the api spine's CORS (`modules/api`) must allow the calling origin with
// `credentials: true` for this to succeed cross-origin.
//
// `adminClient()` is the client half of the server's `admin()` plugin, and the two must
// stay paired: it is what types `session.user.role` (plus `banned`/`banReason`/
// `banExpires`) on everything this client returns, so a role guard reads a real field
// instead of casting. It also exposes the admin endpoints (`client.admin.listUsers`,
// `setRole`, `banUser`, `impersonateUser`); the server still authorizes every one of
// them, so shipping it to a non-admin browser grants nothing.
function definePlugins<T>(config: T): T {
  return config;
}

// Module-scope patch point, not a value to move into `createClient`. The
// `plugin-array` codemod needs this exact `export const <name> = <fn>({ plugins: [...] })`
// shape so feature modules can add their client plugins. Keep the array literal here,
// and never omit it, even when no client plugin ships by default.
export const authClientPlugins = definePlugins({ plugins: [adminClient()] });

export function createClient(baseURL: string) {
  return createAuthClient({
    basePath: "/auth",
    baseURL,
    fetchOptions: { credentials: "include" },
    ...authClientPlugins,
  });
}
