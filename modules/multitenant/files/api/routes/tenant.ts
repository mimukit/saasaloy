import type { AuthDbBindings } from "@repo/auth/server";
import { requireTenant } from "@repo/auth/tenant";
import { Hono } from "hono";

// `GET /tenant` — who this request is acting as, and for which organization.
//
// One reader today: `apps/admin` fetches it once per page and runs the same `can()` the
// server runs, so a control the caller may not use is not rendered. That hide is
// cosmetic. The 403 on the route itself is the gate, and every screen assumes so.
//
// It is also the debugging entry point. A `curl` here answers "which organization does
// the server think I am in, and what may I do there" in one call, on the cookie path and
// on the bearer path alike, which is why `api-keys` resolves through the same helper
// rather than adding a second route.
//
// Route module contract, from `modules/admin/files/api/routes/admin-users.ts`: a NAMED
// export built as ONE chained expression, or the exported type forgets the route and it
// empties out of `AppType`. This module's `chained-route` patch mounts it at `/tenant`,
// so `get("/")` serves `GET /tenant`.

export const tenantRoute = new Hono<{ Bindings: AuthDbBindings }>().get(
  "/",
  async (c) => {
    // 401 when signed out, 403 with `no active organization` when the caller belongs to
    // none, 403 `forbidden` when they sent `x-organization-id` without being superadmin.
    const tenant = await requireTenant(c);

    // The whole resolved tenant, principal included. The statements are the caller's own,
    // so nothing here leaks another member's permissions. Pass the status explicitly:
    // `hc` keys the response type by status code.
    return c.json(tenant, 200);
  }
);
