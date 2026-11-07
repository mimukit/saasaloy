import { zValidator } from "@hono/zod-validator";
import {
  ADMIN_ROLES,
  adminGate,
  requireAdmin,
  withAuthScope,
} from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import {
  countAuditEventsByAction,
  listAuditActors,
  listAuditEvents,
} from "@repo/db/repositories/audit";
import type { AuditFilter } from "@repo/db/repositories/audit";
import { Hono } from "hono";
import { z } from "zod";

import {
  actionsOfArea,
  areaOfAction,
  auditAreas,
  labelOfAction,
} from "../lib/audit-actions";
import { areaCounts, decodeCursor, encodeCursor } from "../lib/audit-query";

// The admin audit log's read side, mounted at `/admin/audit-events` by the admin module's
// third `chained-route` patch, so the admin app calls it as `api.admin["audit-events"]`.
// Any admin reads it. `adminWrite` and `adminAuthWrite` write the rows, and nothing
// changes one.
//
// - GET /         one page, newest first, 50 rows, with the chip counts and the areas
// - GET /people   everyone the person filter lists, removed admins marked
//
// The api sends each row's words (`label`) and each area's words with the page. The words
// live beside the action in the module's action file, so the module that owns an action
// owns its words, and the admin app needs no second registry. A row whose action no module
// registers any more reads as its key.
//
// Both routes list `adminGate` first, before the validator, so a signed-out caller with a
// bad cursor still gets 401.
//
// Route module contract: ONE chained expression under a NAMED export matching the file.

const isoTime = z.iso.datetime({ offset: true });

const listQuery = z.object({
  /** One admin's changes, by user id. */
  actor: z.string().min(1).max(200).optional(),
  /** One area, such as `payments`. An area no module names matches nothing. */
  area: z.string().min(1).max(50).optional(),
  /** Part of a target's label, in any case. */
  q: z.string().trim().max(100).optional(),
  from: isoTime.optional(),
  to: isoTime.optional(),
  /** The `nextCursor` of the page before. */
  cursor: z.string().max(200).optional(),
  /** Fewer rows than a full page, such as the three a member's panel shows. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** `field: problem` for the first issue, so the 400 names what to fix. */
function issueMessage(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): string {
  const [issue] = issues;
  return issue
    ? `${issue.path.map(String).join(".") || "input"}: ${issue.message}`
    : "invalid input";
}

const validListQuery = zValidator("query", listQuery, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: issueMessage(result.error.issues),
        },
      },
      400
    );
  }
});

export const adminAudit = new Hono<{ Bindings: AuthDbBindings }>()
  .get("/", adminGate, validListQuery, async (c) => {
    await withAuthScope(c, () => requireAdmin(c));
    const query = c.req.valid("query");
    const cursor =
      query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === null) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "cursor: not a cursor this api gave",
          },
        },
        400
      );
    }
    // The chips count across every area, so their filter is the page's minus the area.
    const base: AuditFilter = {
      actorUserId: query.actor,
      from: query.from === undefined ? undefined : new Date(query.from),
      search: query.q,
      to: query.to === undefined ? undefined : new Date(query.to),
    };
    const areas = auditAreas();
    return withDb(c, async (db) => {
      const [page, byAction] = await Promise.all([
        listAuditEvents(
          db,
          {
            ...base,
            actions:
              query.area === undefined ? undefined : actionsOfArea(query.area),
          },
          cursor,
          query.limit
        ),
        countAuditEventsByAction(db, base),
      ]);
      return c.json(
        {
          areas,
          counts: areaCounts(
            byAction,
            areas.map((area) => area.id),
            (action) => areaOfAction(action)
          ),
          events: page.rows.map((row) => ({
            action: row.action,
            actor: {
              email: row.actorEmail,
              id: row.actorUserId,
              name: row.actorName,
              role: row.actorRole,
            },
            after: row.after,
            area: areaOfAction(row.action),
            before: row.before,
            createdAt: row.createdAt.toISOString(),
            id: row.id,
            label: labelOfAction(row.action),
            target: {
              id: row.targetId,
              label: row.targetLabel,
              type: row.targetType,
            },
          })),
          nextCursor:
            page.nextCursor === null ? null : encodeCursor(page.nextCursor),
        },
        200
      );
    });
  })
  .get("/people", adminGate, async (c) => {
    await withAuthScope(c, () => requireAdmin(c));
    return withDb(c, async (db) =>
      c.json({ people: await listAuditActors(db, ADMIN_ROLES) }, 200)
    );
  });
