import { organization } from "better-auth/plugins/organization";
import { ac, roles } from "../access";

// This wrapper keeps the organization options in project code while the descriptor's
// plugin-array patch only has to append a zero-argument function call.
export function organizationPlugin() {
  return organization({
    // The product calls organizations "teams". Better Auth's nested teams feature is
    // a separate model and stays off, so no team, teamMember, or activeTeamId exists.
    teams: { enabled: false },

    // The permission vocabulary and the three base roles, from `@repo/auth/access`.
    // `packages/auth/src/plugins/organization-client.ts` passes the same two values to
    // the client plugin, and both halves have to agree or a control the browser shows is
    // refused by the server (or worse, the other way round).
    ac,
    roles,

    // Runtime-defined roles, stored per organization in the `organizationRole` table
    // (`packages/db/src/schema/teams.ts` carries the snapshot). `hasPermission` loads
    // that organization's rows and merges each one over the static role of the same
    // name, so a customer defines a role without a deploy.
    //
    // A stored row named `owner`, `admin` or `member` would therefore extend a base role
    // silently. `rbac`'s `roleLockGuard()` refuses those three names on create, update
    // and delete, which is what keeps the base locked. The cap on how many roles an
    // organization may store stays at the plugin default, unlimited.
    dynamicAccessControl: { enabled: true },

    // sendInvitationEmail stays unset for the copy-ID flow. After the email capability
    // is installed, connect it here and keep the recipient acceptance screen separate.
  });
}
