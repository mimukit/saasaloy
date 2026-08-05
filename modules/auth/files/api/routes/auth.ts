import { Hono } from "hono";
import { auth } from "@repo/auth/server";

// Mounted at `/auth` by api's routes/*.ts glob (src/index.ts, untouched by this
// module). A thin forward — every method Better Auth handles arrives here and goes
// straight to `auth.handler`; this file never imports `better-auth` itself (ADR 0020,
// the vendor package stays inside `packages/auth`).
const authRoute = new Hono();

authRoute.on(["GET", "POST"], "/*", (c) => auth.handler(c.req.raw));

export default authRoute;
