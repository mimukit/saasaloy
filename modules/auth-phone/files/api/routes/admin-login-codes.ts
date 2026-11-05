import { authDb, requireAdmin, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { config } from "@repo/config";
import {
  LOGIN_CODE_WINDOW_MINUTES,
  listLoginCodes,
} from "@repo/db/repositories/login-codes";
import { maskCodes } from "@repo/sms/mask-codes";
import { Hono } from "hono";

// The admin api behind the login codes screen: every code the api sent in the last 30
// minutes, newest first, with its state and the tries left. Read only. This module's
// `chained-route` patch mounts it at `/admin/login-codes`, so `get("/")` serves
// `GET /admin/login-codes`, and `hc<AppType>` types it.
//
// The answer never holds a code. The repository reads the tries from the stored value and
// drops the digits, and a provider's error text passes through `maskCodes()`, because a
// provider can echo the message it refused.
//
// No CORS and no `onError`: api's spine applies both, and its `onError` renders the
// `HTTPException` `requireAdmin` throws as the shared error envelope.

export const adminLoginCodes = new Hono<{ Bindings: AuthDbBindings }>().get(
  "/",
  (c) =>
    withAuthScope(c, async () => {
      // First, before anything reads a code: 401 with no admin session, 403 for a
      // session without an admin role.
      await requireAdmin(c);

      const rules = config["auth-phone"];
      // `authDb` is the client the scope above opened, so the read takes no second
      // connection under `database-postgres`.
      const rows = await listLoginCodes(authDb, {
        attemptsAllowed: rules.codeAttempts,
        lifeSeconds: rules.codeTtlSeconds,
      });

      return c.json(
        {
          codes: rows.map((row) => ({
            account: row.account,
            error: row.error === null ? null : maskCodes(row.error),
            id: row.id,
            phone: row.phone,
            purpose: row.purpose,
            sendStatus: row.sendStatus,
            sentAt: row.sentAt.toISOString(),
            state: row.state,
            triesLeft: row.triesLeft,
          })),
          windowMinutes: LOGIN_CODE_WINDOW_MINUTES,
        },
        200
      );
    })
);
