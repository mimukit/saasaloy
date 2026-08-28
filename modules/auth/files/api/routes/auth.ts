import { Hono } from "hono";
import { auth } from "@repo/auth/server";

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
// The export is named, not default: the codemod writes `import { authRoute } from
// "./routes/auth"` and refuses to wire a link whose binding is a default import.
export const authRoute = new Hono().on(["GET", "POST"], "/*", (c) => auth.handler(c.req.raw));
