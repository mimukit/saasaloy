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
import { can } from "../rbac-rules";
import { loadStatements } from "../tenant";
import type { AuthRequestContext } from "../server";

// Organization-owned API keys, in two plugins.
//
// `apiKeyPlugin()` is `@better-auth/api-key` with this project's options fixed in one
// place, so the descriptor's `plugin-array` patch only has to append a zero-argument
// call. `apiKeyScopeGuard()` is the rule the plugin has no option for: a key may not be
// issued with more permission than the member issuing it holds.
//
// Both go into `auth.plugins`, and the order in the array is the order they were patched
// in. It does not matter here: the guard matches on a path, and the plugin owns that
// path whichever way round they sit.

/**
 * The API-key plugin, configured.
 *
 * Every option below is a decision, not a default worth restating:
 *
 * - `references: "organization"` makes `referenceId` an organization id, so a key is
 *   owned by an organization and never by a user. The plugin then checks the caller's
 *   membership and an `apiKey: [action]` permission through the organization plugin's own
 *   access control on create, get, update, delete and list. That is the same vocabulary
 *   `access.ts` declares, so a role that holds `apiKey: ["create"]` may mint one.
 * - `schema.apikey.fields.referenceId: "organizationId"` renames the field the Drizzle
 *   adapter looks for. It is the only reason `packages/db/src/schema/api-keys.ts` meets
 *   the tenant column convention, so the rename and the snapshot change together.
 * - `enableSessionForAPIKeys: false`. The plugin's mocked session carries no
 *   `activeOrganizationId`, so it would resolve to no tenant at all. The bearer resolver
 *   in `../resolvers/api-key.ts` turns a verified key into a `Tenant` instead, and that
 *   is the one path a machine caller takes.
 * - `rateLimit.enabled: false`, and with it `remaining` and the refill columns unused.
 *   Limits belong to the `ratelimit` module, not to one credential type.
 * - `keyExpiration.defaultExpiresIn: null`. A key with no expiry stays valid until it is
 *   revoked, which is what an operator issuing one for a deploy pipeline expects. An
 *   expiry is offered on the create form and it is theirs to set.
 * - `requireName: true`. A key list of eight unnamed rows is a key list nobody dares
 *   revoke from.
 * - `defaultPrefix: "sk_"` and `startingCharactersConfig.charactersLength: 8`, so the
 *   screen shows `sk_a1b2c` and a reader can tell two keys apart without holding either.
 *
 * `deferUpdates` stays off. It needs `advanced.backgroundTasks.handler`, and there is no
 * `waitUntil` behind that hook on Workers, so the `lastRequest` write stays synchronous.
 * One write per bearer call, accepted by decision.
 */
export function apiKeyPlugin() {
  return apiKey({
    defaultPrefix: "sk_",
    enableSessionForAPIKeys: false,
    keyExpiration: { defaultExpiresIn: null },
    rateLimit: { enabled: false },
    references: "organization",
    requireName: true,
    schema: { apikey: { fields: { referenceId: "organizationId" } } },
    startingCharactersConfig: { charactersLength: 8 },
  });
}

/** The two endpoints that write a key's scope. `get`, `list` and `delete` write none. */
const GUARDED_PATHS = new Set(["/api-key/create", "/api-key/update"]);

/** Read one property off an unknown body without asserting the whole shape. */
function field(source: unknown, name: string): unknown {
  return typeof source === "object" && source !== null
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The requested scope, or `null` when the body asks for none.
 *
 * `null` means "do not check": create without `permissions` mints a key holding nothing,
 * and update with `permissions: null` clears one. Neither can exceed anything. A value
 * that is not a permission map falls through to the plugin's own validation.
 */
function requestedScope(body: unknown): Record<string, string[]> | null {
  const permissions = field(body, "permissions");
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions)
  ) {
    return null;
  }
  const scope: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(permissions)) {
    if (Array.isArray(actions)) {
      scope[resource] = actions.filter(
        (action): action is string => typeof action === "string"
      );
    }
  }
  return Object.keys(scope).length > 0 ? scope : null;
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
 * the demand — the same function `requireCan` runs on a route, over the same statements
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
            const scope = requestedScope(ctx.body);
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

            // The caller's membership role. There is no Hono context in a hook and no
            // `auth` to call without an import cycle, so the row is read through the
            // adapter the plugin itself uses.
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
