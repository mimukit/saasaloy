import type { AuthDbBindings } from "@repo/auth/server";
import { requireTenant } from "@repo/auth/tenant";
import { withDb } from "@repo/db/client";
import {
  createProject,
  deleteProject,
  listProjects,
} from "@repo/db/repositories/projects";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

// The worked example: three scoped routes, written the way every scoped route in this
// project should be written. Read it as the recipe, then delete it once your own tables
// exist. `remove multitenant` names the `projects` table in its warning.
//
// THE RECIPE IS TWO LINES PER HANDLER:
//
//   const tenant = await requireTenant(c);            // who is asking, and for whom
//   listProjects(db, tenant.organizationId)           // a repository that scopes
//
// Neither line is optional. `requireTenant` mints the only `TenantId` in the project, and
// every function in `packages/db/src/repositories/projects.ts` takes one, so a handler
// that skips the first cannot call the second. The queries themselves live in that
// repository rather than here: `drizzle-orm` belongs to `@repo/db` and no other workspace
// imports it (ADR 0020), and `forTenant` is applied there, once per query.
//
// The gap to know about: a handler that reaches for a raw `db.select().from(project)`
// still compiles. Code review and the `saasaloy-multitenant` skill cover that until the
// lint rule lands.
//
// `rbac` opens `POST` and `DELETE` below with `requireCan` when it is installed. Until
// then membership is the only gate on a write, which is why the example ships with `rbac`
// one `saasaloy add` away.
//
// Route module contract, from `modules/admin/files/api/routes/admin-users.ts`: a NAMED
// export built as ONE chained expression, or the exported type forgets the route and it
// empties out of `AppType`. This module's `chained-route` patch mounts it at `/projects`.

export const projects = new Hono<{ Bindings: AuthDbBindings }>()
  .get("/", async (c) => {
    const tenant = await requireTenant(c);
    const rows = await withDb(c, (db) =>
      listProjects(db, tenant.organizationId)
    );
    return c.json({ projects: rows }, 200);
  })
  .post("/", async (c) => {
    const tenant = await requireTenant(c);
    const body = await c.req.json<{ name?: unknown }>();
    if (typeof body.name !== "string" || body.name.trim() === "") {
      // 400 through api's `onError`, so the body is the same envelope every other failure
      // uses. A real route validates its input with `@repo/validators` instead.
      throw new HTTPException(400, { message: "name is required" });
    }

    const row = { id: crypto.randomUUID(), name: body.name.trim() };
    await withDb(c, (db) => createProject(db, tenant.organizationId, row));
    return c.json(
      { project: { ...row, organizationId: tenant.organizationId } },
      201
    );
  })
  .delete("/:id", async (c) => {
    const tenant = await requireTenant(c);
    const id = c.req.param("id");
    await withDb(c, (db) => deleteProject(db, tenant.organizationId, id));
    return c.json({ id }, 200);
  });
