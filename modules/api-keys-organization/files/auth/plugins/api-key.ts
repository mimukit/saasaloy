import { apiKey } from "@better-auth/api-key";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { env } from "cloudflare:workers";
import { SUPERADMIN_ROLE } from "../authorize";
import type { AuthDbBindings } from "../db-provider";
import { can } from "../permission-rules";
import { loadStatements } from "../statements";
import type { AuthRequestContext } from "../server";
import {
  API_KEY_OPTIONS,
  GUARDED_PATHS,
  field,
  scopeOf,
} from "./api-key-options";

// Organization-owned API keys, in two plugins.
//
// `apiKeyPlugin()` is `@better-auth/api-key` with this project's options fixed in one
// place, so the core's `plugin-array` patch only has to append a zero-argument call. The
// options both owners share come from `./api-key-options.ts`, which `api-keys` ships.
// `apiKeyScopeGuard()` is the rule the plugin has no option for: a key may not be issued
// with more permission than the member issuing it holds.
//
// Both go into `auth.plugins`, and the order in the array is the order they were patched
// in. It does not matter here: the guard matches on a path, and the plugin owns that
// path whichever way round they sit.

/**
 * The API-key plugin, configured for organization-owned keys.
 *
 * The options every owner shares live in `./api-key-options.ts`, each with its reason.
 * This owner adds the three that make a key an organization's:
 *
 * - `references: "organization"` makes `referenceId` an organization id, so a key is
 *   owned by an organization and never by a user. The plugin then checks the caller's
 *   membership and an `apiKey: [action]` permission through the organization plugin's own
 *   access control on create, get, update, delete and list. That is the same vocabulary
 *   `access.ts` declares, so a role that holds `apiKey: ["create"]` may mint one.
 * - `schema.apikey.fields.referenceId: "organizationId"` renames the field the Drizzle
 *   adapter looks for. It is the only reason `packages/db/src/schema/api-keys.ts` meets
 *   the tenant column convention, so the rename and the snapshot change together.
 * - `schema.apikey.modelName: "apiKey"`. `auth.ts` passes `usePlural: true` to the
 *   Drizzle adapter, so the adapter asks the schema object for `<modelName>s`. That
 *   resolves to the `apiKeys` export, stored as the `api_keys` table. Without it the
 *   adapter appends `s` to the plugin's own model name `apikey` and asks for `apikeys`,
 *   which is not a word and not an export.
 *
 * The bearer resolver in `../resolvers/api-key.ts` turns a verified key into a `Tenant`,
 * and `apiKeyScopeGuard()` below is the check that lets `metadata.scope` through.
 */
export function apiKeyPlugin() {
  return apiKey({
    ...API_KEY_OPTIONS,
    references: "organization",
    schema: {
      apikey: {
        modelName: "apiKey",
        fields: { referenceId: "organizationId" },
      },
    },
  });
}

/**
 * The context `loadStatements` reads, built inside a Better Auth hook.
 *
 * A hook has no Hono context, and `AuthRequestContext` is structural for exactly this
 * reason. Only `env` is load-bearing: `loadStatements` hands the context to `withDb`,
 * which reads `c.env` to open a client and `c.executionCtx.waitUntil` to schedule its
 * close. `cloudflare:workers`' importable `env` is the same object `./auth.ts` reads at
 * module scope, so this is the Worker's real binding set rather than a stand-in.
 *
 * `waitUntil` is a no-op. Under Postgres the close still runs the moment the query
 * settles; nothing is scheduled to hold the isolate open for it, which is the case
 * `withDb` already catches when Hono has no execution context to give.
 */
function guardContext(request: Request): AuthRequestContext {
  return {
    env: env as unknown as AuthDbBindings,
    executionCtx: {
      waitUntil: () => {
        // Nothing to keep the isolate alive for. See the note above.
      },
    },
    req: { raw: request },
  };
}

/** A member row, narrowed to the one field the guard needs. */
interface MemberRow {
  role: string;
}

/**
 * Refuse a key whose scope exceeds the statements its creator holds.
 *
 * Without this, `apiKey: ["create"]` is a privilege escalation in one call: a member who
 * may read projects and mint keys would mint a key scoped `project: ["delete"]` and then
 * use it. The plugin has no option for this, because it does not know that a key's
 * `permissions` and a member's statements are the same vocabulary. In this project they
 * are, both declared in `access.ts`, so the check is `can()` with the requested scope as
 * the demand — the same function `requirePermission` runs on a route, over the same statements
 * `requireTenant` resolves.
 *
 * The guard runs BEFORE the plugin's own `apiKey: [action]` check, so holding that
 * statement does not get past it.
 *
 * What it deliberately does not do:
 *
 * - It does not refuse a signed-out or organization-less caller. The plugin refuses both
 *   itself, with its own codes, and a second refusal here would answer a different body
 *   for the same failure.
 * - It does not narrow a scope. Silently trimming a request is worse than refusing it:
 *   the operator would get a key that reads less than the screen said it would.
 * - It does not re-check on every later request. A key's scope is a snapshot at issue
 *   time, by decision, so demoting the creator afterwards does not shrink the key. Revoke
 *   the key.
 *
 * A `superadmin` passes without a statement check, the one arm `can()` also short-circuits
 * on. They already cross organizations by design.
 */
export function apiKeyScopeGuard(): BetterAuthPlugin {
  return {
    id: "api-key-scope-guard",
    hooks: {
      before: [
        {
          // An undefined path matches nothing. Fail closed the safe way round: no path
          // means no guard to run, not a guard that runs on every endpoint.
          matcher: (context) =>
            context.path !== undefined && GUARDED_PATHS.has(context.path),
          handler: createAuthMiddleware(async (ctx) => {
            const scope = scopeOf(ctx.body);
            if (!scope) {
              return;
            }

            const session = await getSessionFromCtx(ctx);
            if (!session) {
              return;
            }
            if (session.user.role === SUPERADMIN_ROLE) {
              return;
            }

            const organizationId =
              field(ctx.body, "organizationId") ??
              session.session.activeOrganizationId;
            if (typeof organizationId !== "string") {
              return;
            }

            // The caller's membership role, read through the adapter the plugin itself
            // uses. `auth.api.getActiveMember` is not an option here: it wants request
            // headers and a Hono context to open a database client from, and a Better Auth
            // hook has neither. The adapter is already bound to this request.
            const membership = await ctx.context.adapter.findOne<MemberRow>({
              model: "member",
              where: [
                { field: "organizationId", value: organizationId },
                { field: "userId", value: session.user.id },
              ],
            });
            if (!membership) {
              return;
            }

            // The same loader `requireTenant` runs, so the merge rule for a base role, a
            // widened base role and a custom role lives in exactly one place.
            const statements = await loadStatements(
              guardContext(ctx.request ?? new Request("http://localhost/")),
              organizationId,
              membership.role
            );

            const { denial } = can({ kind: "member", statements }, scope);
            if (denial) {
              // 403, and the message names the first pair the creator does not hold, in
              // the `permission required: <resource>:<action>` format every other refusal
              // uses. The `/api-keys` screen only offers statements the caller holds, so
              // reaching this is either a direct API call or a role changed mid-session.
              throw new APIError("FORBIDDEN", { message: denial.message });
            }
          }),
        },
      ],
    },
  };
}
