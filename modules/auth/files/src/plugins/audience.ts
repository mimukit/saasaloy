import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import { hasRole } from "../authorize";
import type { Audience } from "../authorize";

// The plugin that marks each session with the group it belongs to. `./auth.ts` registers
// it on both instances, `audience("client")` on `auth` and `audience("admin")` on
// `adminAuth`, ahead of every other plugin in the array.
//
// It does two jobs and one more on the admin side:
//
// - It declares `sessions.audience`, so the adapter maps the field and `$Infer.Session`
//   types it. `input: false` keeps a client from writing it through any endpoint.
// - Its `session.create.before` hook writes this instance's name into every new row.
//   `../scoped-adapter.ts` then finds a row only on the instance that wrote it.
// - Given `roles`, the same hook refuses to open a session for a user who holds none of
//   them. `adminAuth` passes `ADMIN_APP_ROLES`, so a client's email and password, which
//   the shared `accounts` table also holds, open no admin session at all. The refusal
//   reads exactly like a wrong password, so the admin login tells an attacker nothing
//   about which addresses have accounts.
//
// A plugin's `init` hooks run before the instance's own `databaseHooks`, and after the
// `admin()` plugin's when that plugin comes first in the array. The ban check in `admin()`
// therefore still runs for every session this hook lets through.

/** What the admin sign-in refusal answers: Better Auth's own wrong-password error. */
const INVALID_CREDENTIALS = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
};

export interface AudienceOptions {
  /** When set, only a user holding one of these roles may open a session here. */
  roles?: readonly string[];
}

export function audience(name: Audience, options: AudienceOptions = {}) {
  return {
    id: `audience-${name}`,
    schema: {
      session: {
        fields: {
          audience: {
            type: "string",
            required: true,
            defaultValue: "client",
            input: false,
          },
        },
      },
    },
    init() {
      return {
        options: {
          databaseHooks: {
            session: {
              create: {
                async before(session, ctx) {
                  if (options.roles) {
                    // No endpoint context means no way to read the user, so the role
                    // check cannot pass. Fail closed rather than open a session unread.
                    const user = ctx
                      ? await ctx.context.internalAdapter.findUserById(
                          session.userId
                        )
                      : null;
                    // `role` comes from the `admin()` plugin's schema, which the core
                    // `User` type does not carry.
                    const role = (user as { role?: string | null } | null)
                      ?.role;
                    if (!user || !hasRole({ user: { role } }, options.roles)) {
                      throw APIError.from("UNAUTHORIZED", INVALID_CREDENTIALS);
                    }
                  }
                  return { data: { ...session, audience: name } };
                },
              },
            },
          },
        },
      };
    },
  } satisfies BetterAuthPlugin;
}
