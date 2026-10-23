import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  countUsersWithRole,
  roleOfSessionOwner,
  roleOfUser,
} from "@repo/db/repositories/site-roles";
import {
  SUPERADMIN_ROLE,
  adminPathKind,
  grantedRoles,
  rankDenial,
  takesSuperadmin,
} from "../authorize";
import { authDb } from "../db-provider";

// The rank guard on the admin instance. `superadmin` owns the admin group, and the
// `admin()` plugin cannot say so: `adminAc` gives `admin` and `superadmin` the same
// `set-role`, so without this an `admin` could promote anyone to `superadmin` or demote
// the one that exists.
//
// It runs before every `/admin/*` endpoint and asks `rankDenial` in `../authorize.ts`,
// which holds the whole rule and its tests. This file only gathers what the rule needs:
// the caller's role, the target's role, the roles the call would grant, and the number of
// superadmins when the call would take that role away. A path the rule's table does not
// name is refused for anyone but a `superadmin`, so a better-auth bump that adds an
// endpoint fails closed until somebody reads it.
//
// The target reads go through `@repo/db/repositories/site-roles`, not the adapter. The
// adapter finds a session by token only on its own audience, and the guard has to know
// who owns a client session before an `admin` revokes it.
//
// A signed-out caller passes through: the `admin()` plugin's own middleware answers 401,
// which is the answer it would give with no guard at all.

/** Read a body field without trusting the body's shape. */
function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function rankGuard() {
  return {
    id: "rank-guard",
    hooks: {
      before: [
        {
          matcher: (context) => context.path?.startsWith("/admin/") ?? false,
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session) {
              return;
            }

            const kind = adminPathKind(ctx.path);
            const userId = stringField(ctx.body, "userId");
            const sessionToken = stringField(ctx.body, "sessionToken");
            const targetRole =
              kind === "user-write" && userId
                ? await roleOfUser(authDb, userId)
                : kind === "session-write" && sessionToken
                  ? await roleOfSessionOwner(authDb, sessionToken)
                  : null;
            const takes = takesSuperadmin(ctx.path, ctx.body);
            const superadmins =
              targetRole === SUPERADMIN_ROLE && takes
                ? await countUsersWithRole(authDb, SUPERADMIN_ROLE)
                : Number.POSITIVE_INFINITY;

            const denial = rankDenial({
              kind,
              callerRole: session.user.role,
              targetRole,
              granted: grantedRoles(ctx.path, ctx.body),
              takesSuperadmin: takes,
              superadmins,
            });
            if (denial) {
              throw APIError.from("FORBIDDEN", {
                code: "RANK_REQUIRED",
                message: denial.message,
              });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
