import type { AuthDbBindings } from "@repo/auth/server";
import { requireCan } from "@repo/auth/rbac";
import { requireTenant } from "@repo/auth/tenant";
import { withDb } from "@repo/db/client";
import {
  createProject,
  deleteProject,
  listProjects,
} from "@repo/db/repositories/projects";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

// The worked example, with permissions on. `multitenant` ships the same three routes
// gated by membership alone; this module replaces the file so the writes are gated by
// `requireCan` too. The overwrite is legal because `rbac` declares `dependsOn:
// ["multitenant", ...]` — that edge is the CLI's rule for "I am built on top of that
// module and I know what it ships" — and `saasaloy add rbac` installs `multitenant`
// first, so this copy always lands last.
//
// REMOVING `rbac` DELETES THIS FILE, because the manifest records `rbac` as its owner.
// The `/projects` mount in `apps/api/src/index.ts` is `multitenant`'s patch and stays.
// Re-run `saasaloy add multitenant` to put the ungated copy back (ADR 0031: re-run is
// recovery). The module's `removeWarnings` says so at the prompt.
//
// THE RECIPE IS TWO LINES PER HANDLER, and on a write the first line changes:
//
//   const tenant = await requireCan(c, { project: ["delete"] });  // who, and may they
//   deleteProject(db, tenant.organizationId, id)                  // scoped query
//
// `requireCan` IS `requireTenant` plus `can`, and it returns the same `Tenant`. Never
// call both in one handler: the second call re-resolves the session and re-runs the
// `organization_roles` query for an answer it already has.
//
// Read is left on `requireTenant`. `member` holds `project: ["read"]` in `access.ts`, so
// gating the read would be the same check written twice, and a route that lists nothing
// a member may see is a worse failure than one that lists what they may.
//
// The 403 body is `permission required: project:delete`, from `rbac-rules.ts`. The
// `/roles` screen hides the button for a caller `can()` refuses, and that hide is
// cosmetic — this line is the gate.

export const projects = new Hono<{ Bindings: AuthDbBindings }>()
  .get("/", async (c) => {
    const tenant = await requireTenant(c);
    const rows = await withDb(c, (db) =>
      listProjects(db, tenant.organizationId)
    );
    return c.json({ projects: rows }, 200);
  })
  .post("/", async (c) => {
    const tenant = await requireCan(c, { project: ["create"] });
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
    const tenant = await requireCan(c, { project: ["delete"] });
    const id = c.req.param("id");
    await withDb(c, (db) => deleteProject(db, tenant.organizationId, id));
    return c.json({ id }, 200);
  });
