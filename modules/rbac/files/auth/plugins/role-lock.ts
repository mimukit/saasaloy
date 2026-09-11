import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { BASE_ROLES } from "../access";
import { findLockedRole, roleLockDenial } from "../rbac-rules";

// The lock on the three base roles, as a Better Auth plugin.
//
// `teams` turns on `dynamicAccessControl`, so an organization stores its own roles in the
// `organization_roles` table and `hasPermission` merges each stored row OVER the static
// role of the same name. That merge is the hole this plugin closes: a row named `admin`
// would silently widen the static `admin` in `packages/auth/src/access.ts`, and a row
// named `member` would widen every ordinary member in that organization at once. Neither
// change is visible in project code, and both survive a deploy.
//
// So `owner`, `admin` and `member` are read-only. Only custom roles are created, edited
// and deleted, and a project that wants different base statements edits `access.ts`,
// where the change is reviewable.
//
// The guard runs BEFORE the plugin's own `ac` permission check, so holding `ac: ["create"]`
// does not get past it. That ordering is the point: an owner holds every statement and
// would otherwise be free to overwrite the base roles.

/**
 * The three endpoints that write the `organization_roles` table. `list-roles` and
 * `get-role` are absent on purpose — reading a base role is fine, and the `/roles` screen
 * lists all of them.
 */
const GUARDED_PATHS = new Set([
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
]);

/** Read one property off an unknown body without asserting the whole shape. */
function field(source: unknown, name: string): unknown {
  return typeof source === "object" && source !== null
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

/**
 * Refuse `createRole`, `updateRole` and `deleteRole` for any name in `BASE_ROLES`.
 *
 * The three endpoints do not agree on one field, checked against `better-auth@1.7.2`:
 * `create-role` carries `role`, `delete-role` and `update-role` carry `roleName`, and
 * `update-role` carries a second name in `data.roleName` when it is a rename. All four
 * are checked, so renaming a custom role TO `admin` is refused as well as editing the
 * base `admin` itself.
 *
 * `delete-role` also accepts a `roleId` instead of a name, and that form needs no check:
 * an id names a stored row, base roles have no stored row, and this plugin is what keeps
 * it that way.
 */
export function roleLockGuard(): BetterAuthPlugin {
  return {
    id: "role-lock-guard",
    hooks: {
      before: [
        {
          // `context.path` is optional on the hook context, and an undefined path matches
          // nothing here. Fail closed the safe way round: no path means no guard to run,
          // not a guard that runs on every endpoint.
          matcher: (context) =>
            context.path !== undefined && GUARDED_PATHS.has(context.path),
          handler: createAuthMiddleware(async (ctx) => {
            const body: unknown = ctx.body;
            const locked = findLockedRole(
              [
                field(body, "role"),
                field(body, "roleName"),
                field(field(body, "data"), "roleName"),
              ],
              BASE_ROLES
            );
            if (locked) {
              // 403, not 400: the request is well formed and the caller may well hold the
              // `ac` permission. It is the name that is off limits. `apps/admin` matches
              // on `BASE_ROLE_LOCKED` to explain why the control was missing.
              throw new APIError("FORBIDDEN", {
                message: roleLockDenial(locked).message,
              });
            }
          }),
        },
      ],
    },
  };
}
