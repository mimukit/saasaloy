import { zValidator } from "@hono/zod-validator";
import {
  ADMIN_ROLE,
  ADMIN_ROLES,
  SUPERADMIN_ROLE,
  adminAuth,
  adminGate,
  requireAdmin,
  withAuthScope,
} from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import { latestAuditEvents } from "@repo/db/repositories/audit";
import { lastAdminSignIns } from "@repo/db/repositories/members";
import { Hono } from "hono";
import { z } from "zod";

import { adminAuthWrite } from "../lib/admin-write";
import { authRefusal, splitMembers } from "../lib/members";
import type { GroupUser } from "../lib/members";

// The members routes, mounted at `/admin/members` by the admin module's second
// `chained-route` patch, so `hc<AppType>` types them for the admin app as
// `api.admin.members`. The mount is its own path because `/admin` already routes
// `admin-users`, and a `chained-route` patch skips a path the chain already routes.
//
// A member is an account in the admin group (`ADMIN_ROLES`). The routes:
//
// - GET    /                the group, split into active and removed, plus who is asking
// - POST   /                add a member                         `member.add`
// - PATCH  /:id             change your own name                 `member.profile.update`
// - POST   /:id/password    change your own password, or a superadmin sets another
//                           member's                             `member.password.set`
// - DELETE /:id             remove a member (a ban)              `member.remove`
// - POST   /:id/restore     restore a removed member (an unban)  `member.restore`
//
// Every route lists `adminGate` first, before its validator. Every write runs through
// `adminAuthWrite`, because Better Auth makes the change and no transaction of ours can
// hold it; the actions are in `../audit/admin.ts`.
//
// Every Better Auth call passes the caller's headers, so it runs as the caller: the
// `admin()` plugin checks the caller's permissions and the `rank-guard` plugin checks rank.
// The route's own 403s say the rule in the api's words first: only a superadmin adds a
// superadmin, removes, restores, or sets another member's password. Rank guard stands
// behind them, and it is stricter: it refuses an `admin` any change to an admin-group
// account, so an `admin` cannot add even an `admin`.
//
// Removing is a ban, never a delete. The account keeps its id, so its audit rows still
// name a real person, and a restore brings back the same account with its password.
//
// Route module contract: ONE chained expression under a NAMED export matching the file.

/** The reason a removed member's ban carries. */
const REMOVED_REASON = "Removed as an admin";

/** Rows per `listUsers` call. The route pages until it has the whole group. */
const PAGE = 100;

const name = z.string().trim().min(1).max(100);
const password = z.string().min(8).max(128);

const createBody = z.object({
  email: z.email().max(254),
  name,
  password,
  role: z.string().optional(),
});

const updateBody = z.object({ name });

const passwordBody = z.object({
  /** Required when a member changes their own password. */
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: password,
  /** Own change only: sign out every other session. Defaults to true. */
  revokeOtherSessions: z.boolean().optional(),
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

function invalid(message: string) {
  return { error: { code: "invalid_request", message } };
}

function refused(code: string, message: string) {
  return { error: { code, message } };
}

const validCreate = zValidator("json", createBody, (result, c) => {
  if (!result.success) {
    return c.json(invalid(issueMessage(result.error.issues)), 400);
  }
});

const validUpdate = zValidator("json", updateBody, (result, c) => {
  if (!result.success) {
    return c.json(invalid(issueMessage(result.error.issues)), 400);
  }
});

const validPassword = zValidator("json", passwordBody, (result, c) => {
  if (!result.success) {
    return c.json(invalid(issueMessage(result.error.issues)), 400);
  }
});

function inGroup(role: string | null | undefined): boolean {
  return ADMIN_ROLES.some((candidate) => candidate === role);
}

/** Every account in the admin group, page by page, so none is cut off at 100. */
async function groupUsers(headers: Headers): Promise<GroupUser[]> {
  const all: GroupUser[] = [];
  for (let offset = 0; ; offset += PAGE) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the count the one before answered
    const { users, total } = await adminAuth.api.listUsers({
      headers,
      query: {
        filterField: "role",
        filterOperator: "in",
        filterValue: [...ADMIN_ROLES],
        limit: PAGE,
        offset,
        sortBy: "name",
      },
    });
    all.push(...users);
    if (users.length < PAGE || all.length >= total) {
      return all;
    }
  }
}

/** One account by id, as the caller may read it, or `null` when there is none. */
async function findUser(headers: Headers, id: string) {
  try {
    return await adminAuth.api.getUser({ headers, query: { id } });
  } catch (error) {
    if (authRefusal(error)?.status === 404) {
      return null;
    }
    throw error;
  }
}

/** One account by email, or `null`. Exact match: Better Auth stores emails lowercased. */
async function findByEmail(headers: Headers, email: string) {
  const { users } = await adminAuth.api.listUsers({
    headers,
    query: {
      filterField: "email",
      filterOperator: "eq",
      filterValue: email.toLowerCase(),
      limit: 1,
    },
  });
  return users[0] ?? null;
}

export const adminMembers = new Hono<{ Bindings: AuthDbBindings }>()
  .get("/", adminGate, (c) =>
    withAuthScope(c, async () => {
      const session = await requireAdmin(c);
      const users = await groupUsers(c.req.raw.headers);
      const ids = users.map((user) => user.id);
      const banned = users
        .filter((user) => user.banned === true)
        .map((user) => user.id);
      // "Added by" and "Removed by" come from the audit log, the only place that knows.
      // `updatedAt` moves on any later write, so it is only the fallback for a removal
      // made outside this screen.
      const [added, removed, signedIn] = await withDb(c, (db) =>
        Promise.all([
          latestAuditEvents(db, "member.add", ids),
          latestAuditEvents(db, "member.remove", banned),
          lastAdminSignIns(db, ids),
        ])
      );
      const group = splitMembers(
        users,
        { added, removed, signedIn },
        ADMIN_ROLE
      );
      return c.json(
        {
          me: {
            id: session.user.id,
            role: session.user.role ?? ADMIN_ROLE,
          },
          members: group.members,
          removed: group.removed,
        },
        200
      );
    })
  )
  .post("/", adminGate, validCreate, (c) =>
    adminAuthWrite(c, async ({ actor, audit }) => {
      const { role = ADMIN_ROLE, ...input } = c.req.valid("json");
      const { headers } = c.req.raw;
      if (!inGroup(role)) {
        return c.json(invalid("role: not an admin-group role"), 400);
      }
      if (role === SUPERADMIN_ROLE && actor.role !== SUPERADMIN_ROLE) {
        return c.json(
          refused("forbidden", "Only a superadmin can add a superadmin."),
          403
        );
      }
      // The email may belong to a member removed earlier. Their account still exists,
      // banned, so the screen offers to restore it rather than make a second one.
      const existing = await findByEmail(headers, input.email);
      if (existing !== null) {
        if (existing.banned === true && inGroup(existing.role)) {
          const removal = await withDb(c, (db) =>
            latestAuditEvents(db, "member.remove", [existing.id])
          );
          return c.json(
            {
              ...refused(
                "member_removed",
                "This email belongs to a removed member."
              ),
              member: {
                email: existing.email,
                id: existing.id,
                name: existing.name,
                removedAt: new Date(
                  removal.get(existing.id)?.at ?? existing.updatedAt
                ).toISOString(),
              },
            },
            409
          );
        }
        return c.json(
          refused("conflict", "This email already has an account."),
          409
        );
      }
      try {
        const { user } = await adminAuth.api.createUser({
          body: { ...input, role },
          headers,
        });
        // The password is never logged.
        audit({
          action: "member.add",
          after: { email: user.email, name: user.name, role },
          target: { id: user.id, label: user.email },
        });
        return c.json(
          {
            member: { email: user.email, id: user.id, name: user.name, role },
          },
          201
        );
      } catch (error) {
        const refusal = authRefusal(error);
        if (refusal === null) {
          throw error;
        }
        return c.json(
          refused(
            refusal.status === 403 ? "forbidden" : "invalid_request",
            refusal.message
          ),
          refusal.status === 403 ? 403 : 400
        );
      }
    })
  )
  .patch("/:id", adminGate, validUpdate, (c) =>
    adminAuthWrite(c, async ({ actor, audit }) => {
      const id = c.req.param("id");
      if (id !== actor.id) {
        return c.json(
          refused("forbidden", "You can change only your own name."),
          403
        );
      }
      const { headers } = c.req.raw;
      const target = await findUser(headers, id);
      if (target === null) {
        return c.json(refused("not_found", "No such member."), 404);
      }
      const { name: next } = c.req.valid("json");
      // Better Auth's own `/update-user`, not the admin plugin's: a member changes their
      // own profile, which the rank guard has no say in.
      await adminAuth.api.updateUser({ body: { name: next }, headers });
      audit({
        action: "member.profile.update",
        after: { name: next },
        before: { name: target.name },
        target: { id, label: target.email },
      });
      return c.json({ member: { email: target.email, id, name: next } }, 200);
    })
  )
  .post("/:id/password", adminGate, validPassword, (c) =>
    adminAuthWrite(c, async ({ actor, audit }) => {
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const { headers } = c.req.raw;
      const target = await findUser(headers, id);
      if (target === null || !inGroup(target.role) || target.banned === true) {
        return c.json(refused("not_found", "No such member."), 404);
      }
      const label = { id, label: target.email };

      if (id === actor.id) {
        if (input.currentPassword === undefined) {
          return c.json(invalid("currentPassword: required"), 400);
        }
        try {
          // `returnHeaders`, because signing out the other sessions deletes this one too
          // and Better Auth sets a fresh session cookie. Passed on, the caller stays
          // signed in here.
          const result = await adminAuth.api.changePassword({
            body: {
              currentPassword: input.currentPassword,
              newPassword: input.newPassword,
              revokeOtherSessions: input.revokeOtherSessions ?? true,
            },
            headers,
            returnHeaders: true,
          });
          for (const cookie of result.headers.getSetCookie()) {
            c.header("set-cookie", cookie, { append: true });
          }
        } catch (error) {
          const refusal = authRefusal(error);
          if (refusal === null) {
            throw error;
          }
          return c.json(invalid(refusal.message), 400);
        }
        // Only that it was set. The password itself never reaches a row.
        audit({ action: "member.password.set", target: label });
        return c.json({ changed: true }, 200);
      }

      if (actor.role !== SUPERADMIN_ROLE) {
        return c.json(
          refused(
            "forbidden",
            "Only a superadmin can set another member's password."
          ),
          403
        );
      }
      await adminAuth.api.setUserPassword({
        body: { newPassword: input.newPassword, userId: id },
        headers,
      });
      // The reset ends the member's open sessions, as the dialog says.
      await adminAuth.api.revokeUserSessions({ body: { userId: id }, headers });
      audit({ action: "member.password.set", target: label });
      return c.json({ changed: true }, 200);
    })
  )
  .delete("/:id", adminGate, (c) =>
    adminAuthWrite(c, async ({ actor, audit }) => {
      const id = c.req.param("id");
      if (id === actor.id) {
        return c.json(invalid("You cannot remove yourself."), 400);
      }
      if (actor.role !== SUPERADMIN_ROLE) {
        return c.json(
          refused("forbidden", "Only a superadmin can remove a member."),
          403
        );
      }
      const { headers } = c.req.raw;
      const target = await findUser(headers, id);
      if (target === null || !inGroup(target.role)) {
        return c.json(refused("not_found", "No such member."), 404);
      }
      if (target.banned === true) {
        return c.json(invalid("This member is already removed."), 400);
      }
      try {
        // `banUser` also deletes every session the member holds.
        await adminAuth.api.banUser({
          body: { banReason: REMOVED_REASON, userId: id },
          headers,
        });
      } catch (error) {
        const refusal = authRefusal(error);
        if (refusal?.status !== 403) {
          throw error;
        }
        return c.json(refused("forbidden", refusal.message), 403);
      }
      audit({
        action: "member.remove",
        after: { removed: true },
        before: { removed: false },
        target: { id, label: target.email },
      });
      return c.json(
        { member: { email: target.email, id, name: target.name } },
        200
      );
    })
  )
  .post("/:id/restore", adminGate, (c) =>
    adminAuthWrite(c, async ({ actor, audit }) => {
      if (actor.role !== SUPERADMIN_ROLE) {
        return c.json(
          refused("forbidden", "Only a superadmin can restore a member."),
          403
        );
      }
      const id = c.req.param("id");
      const { headers } = c.req.raw;
      const target = await findUser(headers, id);
      if (target === null || !inGroup(target.role)) {
        return c.json(refused("not_found", "No such member."), 404);
      }
      if (target.banned !== true) {
        return c.json(invalid("This member is not removed."), 400);
      }
      // Unbanning keeps the account as it was: the same id, email, password and history.
      await adminAuth.api.unbanUser({ body: { userId: id }, headers });
      audit({
        action: "member.restore",
        after: { removed: false },
        before: { removed: true },
        target: { id, label: target.email },
      });
      return c.json(
        { member: { email: target.email, id, name: target.name } },
        200
      );
    })
  );
