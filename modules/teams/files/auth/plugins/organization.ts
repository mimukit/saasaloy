import { organization } from "better-auth/plugins/organization";

// This wrapper keeps the organization options in project code while the descriptor's
// plugin-array patch only has to append a zero-argument function call.
export function organizationPlugin() {
  return organization({
    // The product calls organizations "teams". Better Auth's nested teams feature is
    // a separate model and stays off, so no team, teamMember, or activeTeamId exists.
    teams: { enabled: false },

    // sendInvitationEmail stays unset for the copy-ID flow. After the email capability
    // is installed, connect it here and keep the recipient acceptance screen separate.
    // Custom roles belong here too. Build them with the exports from
    // `better-auth/plugins/organization/access`.
  });
}
