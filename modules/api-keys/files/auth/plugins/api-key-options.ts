import type { ApiKeyConfigurationOptions } from "@better-auth/api-key";

// What every API-key owner shares, whoever a key belongs to.
//
// `api-keys` is the core, and it ships no `apiKeyPlugin()` of its own. An owner module
// (`api-keys-organization` or `api-keys-user`) ships `./api-key.ts` at one fixed path, so
// the core's `plugin-array` patches into `auth.ts`, on both instances, import from the
// same place in every mode.
// That owner builds its plugin from `API_KEY_OPTIONS` below and adds the two things that
// differ per owner: `references` and the `schema.apikey` rename.
//
// The rest of this file is the request-side vocabulary both modes read: how a scope
// travels on a create body, which endpoint writes one, how a bearer key is presented,
// and the one message every failed key gets. One copy, so the two modes cannot drift.
//
// It imports nothing at runtime, so `pnpm test:modules` runs `./api-key-options.test.ts`
// against it with no scaffolded project behind it.

/**
 * The plugin options both owners share.
 *
 * Every option below is a decision, not a default worth restating:
 *
 * - `enableSessionForAPIKeys: false`. A key never becomes a session, so `requireSession`
 *   never accepts one. In organization mode the plugin's mocked session would also carry
 *   no `activeOrganizationId`, so it would resolve to no tenant at all. The owner's bearer
 *   path turns a verified key into its caller instead, and that is the one path a machine
 *   caller takes.
 * - `rateLimit.enabled: false`, and with it `remaining` and the refill columns unused.
 *   Limits belong to the `ratelimit` module, not to one credential type.
 * - `keyExpiration.defaultExpiresIn: null`. A key with no expiry stays valid until it is
 *   revoked, which is what an operator issuing one for a deploy pipeline expects. An
 *   expiry is offered on the create form and it is theirs to set.
 * - `requireName: true`. A key list of eight unnamed rows is a key list nobody dares
 *   revoke from.
 * - `defaultPrefix: "sk_"` and `startingCharactersConfig.charactersLength: 8`, so the
 *   screen shows `sk_a1b2c` and a reader can tell two keys apart without holding either.
 * - `enableMetadata: true` and `permissions.defaultPermissions`, together, are how a
 *   scope reaches the row from a browser at all. `@better-auth/api-key` 1.7.2 refuses
 *   `permissions` on any request that carries a `Request` or headers — it throws
 *   `SERVER_ONLY_PROPERTY` (`dist/index.mjs`, the `isClientRequest` check on
 *   `/api-key/create`), because the plugin has no idea whether the caller is allowed to
 *   ask for that scope. This project does know: the owner's `apiKeyScopeGuard()` in
 *   `./api-key.ts` is exactly that check. So the screen sends the requested scope as
 *   `metadata.scope`, which is not a server-only field, the guard validates it, and
 *   `defaultPermissions` reads it back off the body and writes it to the `permissions`
 *   column. Nothing is stripped and nothing is smuggled: the scope travels on a field the
 *   plugin lets a client set, and it is only applied after the guard has passed it.
 *
 *   `metadata.scope` is a request-time transport, and its stored value is not
 *   authoritative. The plugin does persist it: it defaults `metadata` to `null` and then
 *   copies the body's value over that default before the adapter `create`, and
 *   `/api-key/update` overwrites the column whenever `enableMetadata` is on. So a created
 *   key holds two copies of its scope, and only `permissions` decides anything — the
 *   owner's bearer resolver reads `verified.permissions`, and the `/api-keys` screen
 *   renders `row.permissions`.
 *   `defaultPermissions` runs on create only, so a `metadata.scope` written later never
 *   reaches `permissions` and the two copies drift apart with no effect on authorization.
 *   Read `permissions`. Never read `metadata.scope` off a stored row.
 *
 * `deferUpdates` stays off. It needs `advanced.backgroundTasks.handler`, and there is no
 * `waitUntil` behind that hook on Workers, so the `lastRequest` write stays synchronous.
 * One write per bearer call, accepted by decision.
 */
export const API_KEY_OPTIONS = {
  defaultPrefix: "sk_",
  enableMetadata: true,
  enableSessionForAPIKeys: false,
  keyExpiration: { defaultExpiresIn: null },
  permissions: {
    // An empty map when the body asks for nothing. The option's type has no `undefined`
    // arm, and `{}` is the same answer said in the type's own vocabulary: a key that
    // holds no statement, which `can()` denies for every pair.
    defaultPermissions: (_referenceId, ctx) => scopeOf(ctx.body) ?? {},
  },
  rateLimit: { enabled: false },
  requireName: true,
  startingCharactersConfig: { charactersLength: 8 },
} satisfies ApiKeyConfigurationOptions;

/**
 * The one endpoint that writes a key's scope.
 *
 * `/api-key/update` is deliberately not here, and adding it would be reachable code that
 * protects nothing. `permissions` on update is a server-only property, so a request
 * carrying headers is refused by the plugin before any scope lands, and a server-side call
 * carrying none has no session for the guard to read. `defaultPermissions` runs on create
 * only, so a `metadata.scope` sent to update never reaches the `permissions` column
 * either. In organization mode a guard there would also read the wrong organization: the
 * update body has no `organizationId` field, so it would fall back to the caller's active
 * organization rather than the key's. A scope is a snapshot at issue time — revoke and
 * re-issue (ADR 0036).
 *
 * `get`, `list` and `delete` write no scope.
 */
export const GUARDED_PATHS = new Set(["/api-key/create"]);

/** Read one property off an unknown body without asserting the whole shape. */
export function field(source: unknown, name: string): unknown {
  return typeof source === "object" && source !== null
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The requested scope, or `null` when the body asks for none.
 *
 * Two places carry it, and they are read in that order. `permissions` is the plugin's own
 * field, which only a server-side `auth.api.createApiKey` call may set. `metadata.scope`
 * is the browser's channel, described on `API_KEY_OPTIONS` above. A request never sets
 * both, because the one that can set `permissions` has no reason to go the long way round.
 *
 * `null` means "do not check": create with no scope mints a key holding nothing, and
 * update with `permissions: null` clears one. Neither can exceed anything. A value that is
 * not a permission map falls through to the plugin's own validation.
 */
export function scopeOf(body: unknown): Record<string, string[]> | null {
  const permissions =
    field(body, "permissions") ?? field(field(body, "metadata"), "scope");
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

/** The header a machine caller presents its key in. */
export const AUTHORIZATION_HEADER = "authorization";

/** The scheme, with its trailing space. Case-insensitive, per RFC 7235. */
export const BEARER_PREFIX = "bearer ";

/** The one method of a request's headers the bearer parsing reads. */
interface HeaderSource {
  get(name: string): string | null;
}

/**
 * Whether the request presents a bearer credential at all.
 *
 * The cheap half: it answers "is this a key", not "is it valid". A caller that sees
 * `true` commits the request to the key path, so a rejected key cannot quietly fall back
 * to whatever cookie rode along with it.
 *
 * The bare scheme counts too. A Fetch `Headers` object trims its values, so a client that
 * sends `Bearer ` with no key arrives here as `Bearer`, and that is still a claim.
 */
export function hasBearer(headers: HeaderSource): boolean {
  // `Bearer` then any whitespace, or `Bearer` alone. A tab after the scheme claims the key
  // path the same as a space, so it never falls through to the session cookie.
  const header = headers.get(AUTHORIZATION_HEADER);
  return (
    header !== undefined && header !== null && /^bearer(?:\s|$)/i.test(header)
  );
}

/**
 * The key the request presents, or `null` when it presents none.
 *
 * `Bearer` with nothing after it is `null` too. A caller that has already committed to the
 * key path through `hasBearer` answers that with `INVALID_API_KEY`, the same as any other
 * key that does not verify.
 */
export function bearerKey(headers: HeaderSource): string | null {
  if (!hasBearer(headers)) {
    return null;
  }
  const header = headers.get(AUTHORIZATION_HEADER) ?? "";
  const key = header.slice(BEARER_PREFIX.length).trim();
  return key === "" ? null : key;
}

/**
 * The message every failed key gets, whatever went wrong: not found, revoked, disabled,
 * expired, or a hash that matches nothing. Exported and fixed, because a machine caller
 * matches on it, and because the four failures must not be distinguishable — telling a
 * caller "that key existed but is expired" tells them the key existed.
 */
export const INVALID_API_KEY = "invalid api key";
