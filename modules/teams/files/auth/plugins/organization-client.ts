import { organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "../access";

// The client half of `./organization.ts`, and the reason it exists is the argument.
//
// The descriptor's `plugin-array` patch appends a zero-argument call to
// `authClientPlugins` in `packages/auth/src/client.ts`, and the patch engine records and
// reverses that exact shape. `organizationClient({ ac, roles })` is not that shape, so
// the options live in a wrapper here and the patch stays a bare
// `organizationClientPlugin()`.
//
// `ac` and `roles` must be the same two values the server plugin gets. Passing them here
// is what types `auth.organization.*` against this project's statements, so a screen
// asking about a resource nobody declared is a compile error.
//
// `checkRolePermission` still knows the static roles only. It cannot see a role a
// customer stored at runtime, which is why the admin screens read the resolved principal
// from `GET /tenant` and run `can()` instead.
export function organizationClientPlugin() {
  return organizationClient({
    ac,
    roles,

    // The client's own copy of the server's `dynamicAccessControl`. It adds nothing at
    // runtime; it decides whether `auth.organization.listRoles`, `createRole`,
    // `updateRole` and `deleteRole` exist on the inferred client type at all. Without it
    // the `/roles` screen in `rbac` does not compile. Keep the two flags in step with
    // `./organization.ts`.
    dynamicAccessControl: { enabled: true },
  });
}
