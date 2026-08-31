import { auth, requireAdmin } from "@repo/auth/server";
import { Hono } from "hono";

// The worked example of the server half of the admin gate. `apps/admin`'s root route
// denies a non-admin in the browser, and its own comment says why that is not enough:
// the guard stops the SPA from asking, and the server still has to authorize every
// request. `requireAdmin` is the half that does.
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file,
// built as ONE chained expression. Split it into separate `adminUsers.get(...)`
// statements and the exported type forgets the route, which empties it out of `AppType`.
// The name has to be an `export const`: the `chained-route` codemod writes
// `import { adminUsers } from "./routes/admin-users"` and refuses to wire a binding that
// resolves to a default import.
//
// This module's `chained-route` patch mounts it at `/admin` on the exported chain, so
// `get("/users")` serves `GET /admin/users` and `hc<AppType>` types it. Paths here are
// relative to that mount.
//
// No CORS here, and no `onError`. `modules/api`'s spine applies the credentialed
// `CORS_ORIGINS` allowlist to `*` before this sub-app is mounted, and a sub-app that
// sets no `onError` inherits api's — which is what turns the `HTTPException` below into
// `{ "error": { "code": "forbidden", "message": "role required: admin" } }` with a 403.
export const adminUsers = new Hono().get("/users", async (c) => {
  // First line of the handler, before anything reads the database. It throws 401 when
  // nobody is signed in and 403 when the session's role is not "admin", so the body
  // below only ever runs for an admin.
  await requireAdmin(c.req.raw);

  // better-auth's `admin()` plugin owns the query. Going through `auth.api` rather than
  // Drizzle keeps the vendor package inside `packages/auth` (ADR 0020) and keeps the
  // shape in step with the plugin across a bump. It re-checks the caller's role itself;
  // `requireAdmin` runs first so the refusal is api's envelope, not the plugin's.
  const { users, total } = await auth.api.listUsers({
    headers: c.req.raw.headers,
    query: { limit: 100 },
  });

  // Pass the status explicitly. `hc` keys the response type by status code, so an
  // omitted `200` leaves the caller with a looser type than the route actually has.
  return c.json({ users, total }, 200);
});
