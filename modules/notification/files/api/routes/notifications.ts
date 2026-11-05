import { zValidator } from "@hono/zod-validator";
import { config } from "@repo/config";
import { requireSession, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import {
  countUnread,
  listNotifications,
  listOptOuts,
  markAllRead,
  markRead,
  setPreferences,
} from "@repo/db/repositories/notifications";
import { errorBody } from "@repo/validators/common";
import {
  notificationListQuery,
  notificationParam,
  notificationPreferencesInput,
} from "@repo/validators/notifications";
import { Hono } from "hono";
import type { AuthDbBindings } from "@repo/auth/server";
import type { Db } from "@repo/db/client";
import type { NotificationRow } from "@repo/db/repositories/notifications";

// The signed-in user's notifications: six routes behind `requireSession`, for the bell,
// the sidebar badge and the page in `apps/app`. Nothing here writes a notification; a
// route that has news for a user calls `notify` from `../lib/notify`.
//
// **Every query goes through `@repo/db/repositories/notifications`**, and every one of
// them takes `session.user.id`. That is the whole boundary between two users' rows, so a
// raw `db.select()` in this file would remove it.
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file,
// built as ONE chained expression. Splitting the chain into statements empties the routes
// out of `AppType`. This module's `chained-route` patch mounts it at `/notifications`, so
// `get("/")` serves `GET /notifications`.
//
// No CORS and no `onError`: `modules/api`'s spine applies the credentialed `CORS_ORIGINS`
// allowlist before this sub-app is mounted, and an unset `onError` inherits api's, which
// renders the `HTTPException` `requireSession` throws as the shared error envelope.

// The three validators share one failure hook body, so a rejected input gets the
// `{ error: { code, message } }` envelope the rest of the api uses rather than Hono's
// default body.
const validateList = zValidator("query", notificationListQuery, (result, c) => {
  if (!result.success) {
    return c.json(errorBody("invalid_input", firstIssue(result)), 400);
  }
});

const validateId = zValidator("param", notificationParam, (result, c) => {
  if (!result.success) {
    return c.json(errorBody("invalid_input", firstIssue(result)), 400);
  }
});

const validatePreferences = zValidator(
  "json",
  notificationPreferencesInput,
  (result, c) => {
    if (!result.success) {
      return c.json(errorBody("invalid_input", firstIssue(result)), 400);
    }
  }
);

function firstIssue(result: {
  error: { issues: { path: PropertyKey[]; message: string }[] };
}): string {
  const [issue] = result.error.issues;
  return issue
    ? `${issue.path.join(".")}: ${issue.message}`
    : "invalid request";
}

/** One row as the client reads it. Dates are ISO strings, so the JSON type is honest. */
function toPayload(row: NotificationRow) {
  return {
    body: row.body,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    href: row.href,
    id: row.id,
    read: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    title: row.title,
  };
}

/** Every configured category, with whether this user has it on. */
async function preferencesOf(db: Db, userId: string) {
  const off = new Set(await listOptOuts(db, userId));
  return {
    categories: config.notification.categories.map((category) => ({
      description: category.description,
      // A required category reads as on even if an old opt-out row survives a config
      // change that made it required: `notify` writes it either way.
      enabled: category.required || !off.has(category.id),
      id: category.id,
      label: category.label,
      required: category.required,
    })),
  };
}

/**
 * Why a preferences body cannot be applied, or `undefined` when it can. An unknown id is
 * refused rather than ignored, so a stale client learns its list is out of date.
 */
function preferencesProblem(
  changes: Readonly<Record<string, boolean>>
): string | undefined {
  for (const [id, enabled] of Object.entries(changes)) {
    const category = config.notification.categories.find(
      (candidate) => candidate.id === id
    );
    if (!category) {
      return `categories.${id}: no notification category is named "${id}".`;
    }
    if (category.required && !enabled) {
      return `categories.${id}: "${category.label}" notifications are required and cannot be turned off.`;
    }
  }
  return undefined;
}

export const notifications = new Hono<{ Bindings: AuthDbBindings }>()
  // One page of the user's rows, newest first. Pass `nextCursor` back as `?cursor=` for
  // the next page; `null` means this was the last one.
  .get("/", validateList, (c) =>
    withAuthScope(c, async () => {
      const { user } = await requireSession(c);
      const { cursor } = c.req.valid("query");
      const page = await withDb(c, (db) =>
        listNotifications(db, user.id, cursor)
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          notifications: page.rows.map(toPayload),
        },
        200
      );
    })
  )
  // The bell's and the sidebar badge's number. It answers `{ count }`, the shape
  // `NAV_COUNTS` in `apps/app` reads.
  .get("/unread-count", (c) =>
    withAuthScope(c, async () => {
      const { user } = await requireSession(c);
      const unread = await withDb(c, (db) => countUnread(db, user.id));
      return c.json({ count: unread }, 200);
    })
  )
  // Mark every unread row read. Registered before `/:id/read` only for the reader; the two
  // paths have a different number of segments, so neither can shadow the other.
  .post("/read-all", (c) =>
    withAuthScope(c, async () => {
      const { user } = await requireSession(c);
      const marked = await withDb(c, (db) => markAllRead(db, user.id));
      return c.json({ marked, ok: true }, 200);
    })
  )
  // Mark one row read. A second call is a 200 that changes nothing. Another user's row
  // answers the same 404 as a row that does not exist, so an id reveals nothing.
  .post("/:id/read", validateId, (c) =>
    withAuthScope(c, async () => {
      const { user } = await requireSession(c);
      const { id } = c.req.valid("param");
      const found = await withDb(c, (db) => markRead(db, user.id, id));
      if (!found) {
        return c.json(errorBody("not_found", "No such notification."), 404);
      }
      return c.json({ ok: true }, 200);
    })
  )
  // Each configured category, with its copy and whether it is on for this user.
  .get("/preferences", (c) =>
    withAuthScope(c, async () => {
      const { user } = await requireSession(c);
      const body = await withDb(c, (db) => preferencesOf(db, user.id));
      return c.json(body, 200);
    })
  )
  // Turn categories on or off. The whole body is checked before anything is written, so
  // a refused body changes nothing. Answers the same shape as the GET.
  .put("/preferences", validatePreferences, (c) =>
    withAuthScope(c, async () => {
      const { user } = await requireSession(c);
      const { categories } = c.req.valid("json");
      const problem = preferencesProblem(categories);
      if (problem !== undefined) {
        return c.json(errorBody("invalid_input", problem), 400);
      }
      const body = await withDb(c, async (db) => {
        await setPreferences(db, user.id, categories);
        return preferencesOf(db, user.id);
      });
      return c.json(body, 200);
    })
  );
