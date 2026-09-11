---
name: saasaloy-api-keys
description: Runbook for the api-keys feature, which gives an organization bearer credentials that resolve the same tenant and pass through the same can() a browser session does. Use when issuing or revoking a key, calling the api from a script or a pipeline, working on the bearer resolver, the scope guard, key expiry and last-used, or removal behavior.
---

# api-keys

The `api-keys` feature answers the third tenant question: **how does a caller with no cookie get the same answers?** `multitenant` resolves which organization a request is for, `rbac` gates what may be done in it, and this ships the credential a machine presents.

It adds `@better-auth/api-key` to `packages/auth`, the `apikey` snapshot to `packages/db`, a bearer resolver into `multitenant`'s `tenantResolvers` table, the `apiKeyScopeGuard()` plugin, and the `/api-keys` screen in `apps/admin`.

## Calling the api with a key

One header, and the routes do not change.

```sh
curl -s -H "Authorization: Bearer sk_a1b2c3..." https://api.example.com/projects
```

`GET /tenant` is the fastest way to see what the server made of a key:

```sh
curl -s -H "Authorization: Bearer $KEY" https://api.example.com/tenant
# { "organizationId": "org_…", "principal": { "kind": "apiKey", "keyId": "…", "statements": { "project": ["read"] } } }
```

The header takes the request off the session path for good. A key that fails does **not** fall back to a cookie that happened to ride along, and a request carrying both is answered as a key request.

`x-organization-id` beside a bearer header is 403 `forbidden` whatever it says. A key is bound to one organization; the superadmin bypass is a cookie-path power.

## Where a key comes from

`/api-keys` in `apps/admin`, on the caller's active organization. Or from code:

```ts
const { data } = await auth.apiKey.create({
  name: "deploy pipeline",
  organizationId,
  permissions: { project: ["read"] },
  expiresIn: 30 * 24 * 60 * 60, // seconds; omit for no expiry
});
data.key; // the plaintext, this once and never again
```

**The plaintext exists in the create response and nowhere else.** Only a SHA-256 hash is stored, and the plugin has no endpoint that returns a key again. The screen shows it in a copy box that clears when you navigate away. A lost key is reissued, not recovered.

`expiresIn` is in **seconds**, with a floor of one day and a ceiling of 365. Leave it out and the key stays valid until it is revoked.

## Scopes are statements, and they cannot exceed the creator's

A key's scope is a permission map picked from `packages/auth/src/access.ts`, the same vocabulary a role uses. `can()` reads it exactly as it reads a member's resolved statements, so a route needs no branch for machine callers:

```ts
.delete("/:id", async (c) => {
  const tenant = await requireCan(c, { project: ["delete"] }); // key or cookie, one line
});
```

Two rules govern what may go in one:

- **A key cannot out-scope its creator.** `apiKeyScopeGuard()` is a `before` hook on `/api-key/create` and `/api-key/update`. It resolves the caller's statements with the same loader `requireTenant` uses and refuses a scope `can()` denies, with 403 `permission required: <resource>:<action>`. Without it, `apiKey: ["create"]` would be a privilege escalation in one call. The guard runs before the plugin's own `apiKey: [action]` check, so holding that statement does not get past it.
- **A scope is a snapshot at issue time.** Editing a role later changes its members and never a key. That is the decision, and the key list says so on screen. To change what a key may do, revoke it and issue another.

The create form offers only the statements the caller holds. That filter is a courtesy; the guard is the gate.

## Failure codes

| Case | Status and message |
| --- | --- |
| No key, revoked, disabled, expired, or a hash matching nothing | 401 `invalid api key` |
| `x-organization-id` beside a bearer header | 403 `forbidden` |
| A scope the key does not hold | 403 `permission required: <resource>:<action>` |
| A requested scope wider than the creator's | 403 `permission required: <resource>:<action>` |

The four 401 cases share one message on purpose. Telling a caller "that key exists but is expired" tells them the key exists.

## What is off, and why

The plugin ships a rate limiter, a `remaining` quota and a refill schedule. All three are **off** here:

- `rateLimit: { enabled: false }`. Limits belong to one place, and that place is the `ratelimit` module (#129), not one credential type.
- `enableSessionForAPIKeys: false`. The mocked session carries no `activeOrganizationId`, so it would resolve to no tenant at all.
- `deferUpdates: false`. It needs `advanced.backgroundTasks.handler`, and Workers has no `waitUntil` behind that hook.

The columns stay in the snapshot because the plugin writes `requestCount` regardless, and a snapshot that drops a column the adapter knows about is a snapshot that lies.

## One write per bearer call

`verifyApiKey` writes `lastRequest` on every request, synchronously. That is accepted by decision and it is the cost of the "last used" column on the screen. A key hot enough for that write to matter wants a limiter in front of it, which is `ratelimit`'s job.

## The `apikey` table

It meets the tenant column convention like every other scoped table, and it gets there through a rename rather than a hand-written column: `apiKeyPlugin()` sets `schema.apikey.fields.referenceId: "organizationId"`, and `references: "organization"` makes that id an organization id. The Drizzle property name is what the adapter matches, so the rename in `packages/auth/src/plugins/api-key.ts` and the snapshot in `packages/db/src/schema/api-keys.ts` change together or the adapter writes into a column that is not there.

The snapshot is hand-authored against `@better-auth/api-key@1.7.2` and ships in two dialects, selected by `onlyWith`. A version bump means re-verifying every column against that version's `apiKeySchema()`; the repo's `schema-version.test.ts` fails the build until the header and the pinned range agree again.

## Boundaries to honor

- **Do not add a second permission path for keys.** The bearer principal carries statements and `can()` reads them. A route that asks Better Auth's `hasPermission` on the machine path pays a query per check and answers from a different engine.
- **Do not mint a `TenantId` from a request.** The resolver calls `asTenantId` on the verified key's organization, and that is the only place on this path where it is allowed.
- **Do not widen the 401 message.** Four distinguishable failures are four facts an attacker did not have.
- **Do not turn `enableSessionForAPIKeys` on.** It looks like a shortcut and it resolves to no tenant.

## Removal

`saasaloy remove api-keys` reverses five patches: the two server plugins, the client plugin, the bearer resolver, and the `/api-keys` nav entry.

Two things it does not do. The `apikey` table survives, so run `db:generate` and read the drop migration before applying it — and tell the machine callers first, because every key stops working the moment the resolver goes. The `@better-auth/api-key` line in `packages/auth/package.json` also survives, because a `package-json-dependency` patch has no removal inverse; drop it by hand and run `pnpm install`.
