import { apiKey } from "@better-auth/api-key";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { scopeDenial } from "../api-key-rules";
import { API_KEY_SCOPES } from "../api-key-scopes";
import { API_KEY_OPTIONS, GUARDED_PATHS, scopeOf } from "./api-key-options";

// User-owned API keys, in two plugins.
//
// `apiKeyPlugin()` is `@better-auth/api-key` with this project's options fixed in one
// place, so the core's `plugin-array` patch only has to append a zero-argument call. The
// options both owners share come from `./api-key-options.ts`, which `api-keys` ships.
// `apiKeyScopeGuard()` is the rule the plugin has no option for: a key may carry only the
// pairs the project declared in `../api-key-scopes.ts`.
//
// Both go into `auth.plugins`, and the order in the array is the order they were patched
// in. It does not matter here: the guard matches on a path, and the plugin owns that
// path whichever way round they sit.

/**
 * The API-key plugin, configured for user-owned keys.
 *
 * The options every owner shares live in `./api-key-options.ts`, each with its reason.
 * This owner adds the three that make a key a user's:
 *
 * - `references: "user"` makes `referenceId` a user id. A create that carries a request
 *   takes it from the session user, and `get`, `update` and `delete` answer
 *   `KEY_NOT_FOUND` for a key another user owns, so one user can never reach another's
 *   key through the plugin's own endpoints.
 * - `schema.apikey.fields.referenceId: "userId"` renames the field the Drizzle adapter
 *   looks for, so `packages/db/src/schema/api-keys.ts` carries a `user_id` column with a
 *   foreign key to `users`. The rename and the snapshot change together.
 * - `schema.apikey.modelName: "apiKey"`. `auth.ts` passes `usePlural: true` to the
 *   Drizzle adapter, so the adapter asks the schema object for `<modelName>s`. That
 *   resolves to the `apiKeys` export, stored as the `api_keys` table. Without it the
 *   adapter appends `s` to the plugin's own model name `apikey` and asks for `apikeys`,
 *   which is not a word and not an export.
 *
 * `requireCaller` in `../caller.ts` turns a verified key into its owner's caller, and
 * `apiKeyScopeGuard()` below is the check that lets `metadata.scope` through.
 */
export function apiKeyPlugin() {
  return apiKey({
    ...API_KEY_OPTIONS,
    references: "user",
    schema: {
      apikey: {
        modelName: "apiKey",
        fields: { referenceId: "userId" },
      },
    },
  });
}

/**
 * Refuse a key whose scope names a pair outside the key vocabulary.
 *
 * In organization mode the ceiling is the creator's role statements. User mode has no
 * roles, so without a ceiling a user could mint a key scoped to anything at all, and the
 * scope would be a label rather than a limit. The ceiling here is `API_KEY_SCOPES`, the
 * one list the project edits, checked by `scopeDenial()` in `../api-key-rules.ts`.
 *
 * It checks every create, with or without a session. The vocabulary is a property of the
 * project, not of the caller, so there is nothing to look up and no caller it should
 * skip: a server-side `auth.api.createApiKey` with `permissions` is held to the same list
 * as the browser's `metadata.scope`.
 *
 * What it deliberately does not do:
 *
 * - It does not refuse a signed-out caller. The plugin refuses that itself, with its own
 *   code, and a second refusal here would answer a different body for the same failure.
 * - It does not narrow a scope. Silently trimming a request is worse than refusing it:
 *   the user would get a key that does less than they asked for.
 * - It does not re-check on later requests. A key's scope is a snapshot at issue time, so
 *   removing a pair from the vocabulary does not shrink a key that holds it. Revoke it.
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

            const denial = scopeDenial(scope, API_KEY_SCOPES);
            if (denial) {
              // 403, and the message names the first pair outside the vocabulary, in the
              // `permission required: <resource>:<action>` format every other refusal
              // uses. Thrown before the plugin's handler, so no row is written.
              throw new APIError("FORBIDDEN", { message: denial.message });
            }
          }),
        },
      ],
    },
  };
}
