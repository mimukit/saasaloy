import { requireAdmin, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import {
  SMS_LOG_PAGE_SIZE,
  listSmsMessages,
} from "@repo/db/repositories/sms-messages";
import { maskCodes } from "@repo/sms/mask-codes";
import { Hono } from "hono";

// The admin api behind the SMS screen: the message log, newest first, 50 rows a page.
// Read only. This module's `chained-route` patch mounts it at `/admin/sms`, so
// `get("/")` serves `GET /admin/sms`, and `hc<AppType>` types it.
//
// The log stores no body, but a provider's error text can echo the message it refused,
// so every `error` passes through `maskCodes()` before it leaves the api.
//
// No CORS and no `onError`: api's spine applies both, and its `onError` renders the
// `HTTPException` `requireAdmin` throws as the shared error envelope.

const STATUSES = new Set(["sent", "failed"] as const);

function invalid(message: string) {
  return { error: { code: "invalid_input", message } } as const;
}

export const adminSms = new Hono<{ Bindings: AuthDbBindings }>().get(
  "/",
  async (c) => {
    // First, before anything reads the log: 401 with no admin session, 403 for a
    // session without an admin role.
    await withAuthScope(c, () => requireAdmin(c));

    const rawPage = c.req.query("page") ?? "1";
    const page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1) {
      return c.json(invalid("page: expected a whole number from 1"), 400);
    }
    const rawStatus = c.req.query("status");
    const status = [...STATUSES].find((value) => value === rawStatus);
    if (rawStatus !== undefined && status === undefined) {
      return c.json(invalid('status: expected "sent" or "failed"'), 400);
    }

    // `withDb`, not `authDb`: the route then needs no `auth` newer than the one a project
    // already has, so `saasaloy update sms` alone still typechecks.
    const { rows, total } = await withDb(c, (db) =>
      listSmsMessages(db, { page, status })
    );

    return c.json(
      {
        messages: rows.map((row) => ({
          createdAt: row.createdAt.toISOString(),
          error: row.error === null ? null : maskCodes(row.error),
          id: row.id,
          provider: row.provider,
          providerRef: row.providerRef,
          purpose: row.purpose,
          status: row.status,
          template: row.template,
          toPhone: row.toPhone,
          userId: row.userId,
        })),
        page,
        pageSize: SMS_LOG_PAGE_SIZE,
        total,
      },
      200
    );
  }
);
