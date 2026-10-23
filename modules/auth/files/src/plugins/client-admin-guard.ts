import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

// The client instance keeps the `admin()` plugin for three things it does on every
// sign-in: it writes the default `"user"` role, it types `user.role`, and it refuses a
// banned account. It also registers its `/admin/*` endpoints (`list-users`, `set-role`,
// `ban-user` and the rest) under `/auth`, and those must not answer there: a superadmin's
// client session would otherwise run the back office from the client app.
//
// This guard refuses every `/admin/*` path of the client instance with 403. It matches the
// path prefix, not a list, so an endpoint a better-auth bump adds is refused too. The
// same endpoints answer on `/admin/auth`, behind the admin session and the rank guard.

export function clientAdminGuard() {
  return {
    id: "client-admin-guard",
    hooks: {
      before: [
        {
          matcher: (context) => context.path?.startsWith("/admin/") ?? false,
          handler: createAuthMiddleware(async () => {
            throw APIError.from("FORBIDDEN", {
              code: "ADMIN_SESSION_REQUIRED",
              message:
                "admin endpoints answer only on the admin session, under /admin/auth",
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
