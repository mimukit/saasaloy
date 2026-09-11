# 0036: An API-key scope travels as `metadata.scope`

`@better-auth/api-key` 1.7.2 refuses `permissions` on any request that carries a `Request` or headers, throwing `SERVER_ONLY_PROPERTY` from the `isClientRequest` check on `/api-key/create`. The `/api-keys` screen is a browser, so it can never set that field. The requested scope therefore travels as `metadata.scope`, which the plugin lets a client set, and `permissions.defaultPermissions` reads it back off the body and writes it to the `permissions` column after `apiKeyScopeGuard()` has checked it against the creator's own statements.

## Status

accepted

## Considered Options

- **A server-side mint route.** `POST /api-keys` in `apps/api` calling `auth.api.createApiKey` with no headers, which is the shape the plugin's guard assumes. It works, and it costs a new route file, a sixth `chained-route` patch, a rewrite of the admin screen's three mutations onto a second client, and a second place where "who may issue a key" is decided. Rejected: the plugin already runs the organization-membership and `apiKey: [action]` checks on its own endpoint, and going around that endpoint means re-implementing them.
- **Strip `permissions` in the `before` hook and re-apply it in an `after` hook.** One file, no new route. Rejected: it defeats an upstream guard by editing the body out from under it, and a reader of the hook cannot tell whether the scope that lands is the one that was checked.
- **Drop scopes and issue full-privilege keys.** Rejected outright. A key that holds everything its creator holds is the escalation `apiKeyScopeGuard()` exists to stop.

## Consequences

- The scope arrives on a field named for something else. `api-key.ts`'s `scopeOf` reads `permissions` first and `metadata.scope` second, so a server-side call still uses the plugin's own field and only the browser path takes the long way round.
- `enableMetadata` has to be on, and the transport is stored. The plugin defaults `metadata` to `null` on create and then copies the body's value over that default before the adapter writes the row, so a key created from the screen holds its scope twice: in `permissions`, which decides everything, and in `metadata.scope`, which decides nothing. Treat the stored `metadata.scope` as a record of what was asked for, never as the scope. Only `permissions` is authoritative: the bearer resolver reads it, `can()` decides on what the resolver returns, and the `/api-keys` screen renders it.
- `defaultPermissions` returns `{}` rather than nothing when the body asks for no scope. The option's type has no `undefined` arm, and `{}` is a key that `can()` denies for every pair, which is the same answer.
- `/api-key/update` is not covered, and `apiKeyScopeGuard()` does not list it. The plugin refuses `permissions` there for the same reason, `defaultPermissions` runs on create only, and the screen offers no edit, so a scope stays fixed at issue time. Revoke and re-issue is the supported change. An update may still overwrite the stored `metadata.scope`, which changes nothing, per the point above.
- This is pinned to 1.7.2. If a later release lets a client set `permissions` behind an option, the `metadata.scope` channel should go and `scopeOf` should read one field again.
