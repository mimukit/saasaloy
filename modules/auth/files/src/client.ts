import { createAuthClient } from "better-auth/client";

// Framework-agnostic client (`@auth/client`) — no new npm dep, `createAuthClient`
// ships inside `better-auth` itself. React bindings wait for `add admin`; until then
// any vanilla JS/TS caller (or a non-React framework) uses this directly.
//
// `baseURL` is the API origin (e.g. https://api.x.com — same origin `BETTER_AUTH_URL`
// points the server at); `basePath` must match the server's (`/auth`). `credentials:
// "include"` is required for the httpOnly session cookie to ride along on every
// request — the api spine's CORS (`modules/api`) must allow the calling origin with
// `credentials: true` for this to succeed cross-origin.
export function createClient(baseURL: string) {
  return createAuthClient({
    basePath: "/auth",
    baseURL,
    fetchOptions: { credentials: "include" },
  });
}
