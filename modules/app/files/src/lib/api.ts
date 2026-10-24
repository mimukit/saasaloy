import { hc } from "hono/client";

import type { AppType } from "@repo/api/client";

import { apiBaseUrl } from "@app/lib/auth";

// The typed api client. A screen calls `api.<route>.$get()` and gets the route's own
// response type back, with no hand-written fetch.
//
// No `x-auth-audience` header: the api reads the client session by default, which is the
// one this app holds. The admin app sends `admin` instead.
//
// `credentials: "include"` sends the session cookie across origins (:3002 → :4000 in dev).
// The api's CORS spine allows it for the origins in `DEV_ORIGINS` or `CORS_ORIGINS`.
export const API_CREDENTIALS: RequestCredentials = "include";

export const api = hc<AppType>(apiBaseUrl, {
  init: { credentials: API_CREDENTIALS },
});
