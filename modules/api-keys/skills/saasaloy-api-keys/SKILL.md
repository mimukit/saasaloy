---
name: saasaloy-api-keys
description: Runbook for the api-keys capability, which gives a machine caller a bearer credential owned by an organization (api-keys-organization) or by one user (api-keys-user). Use when picking or switching the owner, issuing or revoking a key, calling the api from a script or a pipeline, editing the key vocabulary in API_KEY_SCOPES, gating a route with requireCaller and requireScope, working on the bearer resolver or the scope guard, or removing either module.
---

# api-keys

`api-keys` gives a caller with no cookie a credential it presents as `Authorization: Bearer sk_…`. Who owns a key is a choice the project makes once, at `add` time, the way it picks a database driver (ADR 0055):

| Owner module | A key belongs to | Pulls in | Route gate |
| --- | --- | --- | --- |
| `api-keys-organization` | one organization | `multitenant`, `teams`, `admin` | `requireTenant` / `requirePermission` from `@repo/auth/tenant` and `@repo/auth/permissions` |
| `api-keys-user` | one user | `auth` only | `requireCaller` / `requireScope` from `@repo/auth/caller` |

## What the core holds and what each owner holds

The core, `api-keys`, holds what both owners share:

- the `@better-auth/api-key` line in `packages/auth/package.json`;
- `packages/auth/src/plugins/api-key-client.ts` and its patches into `authClientPlugins` and `adminAuthClientPlugins` in `client.ts`;
- the four `plugin-array` patches into `auth.ts` that call `apiKeyPlugin()` and `apiKeyScopeGuard()` on both instances, `auth` and `adminAuth` (ADR 0050);
- `packages/auth/src/plugins/api-key-options.ts`: the shared plugin options (`API_KEY_OPTIONS`), `GUARDED_PATHS`, `scopeOf`, the bearer parsing (`hasBearer`, `bearerKey`) and `INVALID_API_KEY`;
- this skill.

Each owner ships `packages/auth/src/plugins/api-key.ts` at the same path, so the `auth.ts` import line is the same in both modes. The owner's file adds `references` and the `schema.apikey` rename to the shared options, and it holds that owner's `apiKeyScopeGuard()`. Each owner also ships `packages/db/src/schema/api-keys.ts`, with `organization_id` or `user_id` as the owner column.

- `api-keys-organization` adds `packages/auth/src/resolvers/api-key.ts` (the bearer resolver, patched into `multitenant`'s `tenantResolvers`), the `/api-keys` screen in `apps/admin`, and its `NAV_ITEMS` entry.
- `api-keys-user` adds `packages/auth/src/caller.ts` (`requireCaller`, `requireScope`), `packages/auth/src/api-key-rules.ts` (the import-free rules `scopeDenial`, `keyAllows` and `ownerMayUseKeys`), and `packages/auth/src/api-key-scopes.ts` (the key vocabulary). It has no screen. Its one patch puts `apiKeyAdminGuard()` into `adminAuth.plugins`.

## Picking an owner

Name the owner, and its `dependsOn` pulls the core in:

```sh
saasaloy add api-keys-organization   # or: saasaloy add api-keys-user
```

A bare `saasaloy add api-keys` on a terminal asks `api-keys needs one of these — pick one`. With no terminal, it refuses with exit 2 and names both options:

```
Cannot add api-keys — unmet requirement:
  api-keys needs one of: api-keys-organization, api-keys-user, and none is installed. Run `saasaloy add api-keys-organization` first, or pick another from that list.
```

`--yes` does not answer this question. It means "do not ask me", not "pick an owner for me", so `add api-keys --yes` refuses the same way. Name the owner module instead.

The two owners name each other in `conflictsWith`, so `add` refuses the second one while the first is installed.

Pick `api-keys-organization` when the project already has organizations and roles. Pick `api-keys-user` when a key acts for one person and the project has no organizations to carry.

## Calling the api with a key

One header, and in both modes the routes do not change:

```sh
curl -s -H "Authorization: Bearer sk_a1b2c3..." https://api.example.com/projects
```

The bearer rule is the same in both modes, because both read `hasBearer` and `bearerKey` from `api-key-options.ts`:

- A bearer header is claimed first. A request that carries both a key and a cookie is answered as a key request.
- A claimed request never falls back to the cookie. A revoked key sent from a signed-in browser gets 401, not the browser user's access.
- Every failure is 401 `invalid api key`: no key after `Bearer`, not found, revoked, disabled, expired, or a hash that matches nothing. The message is the same on purpose. "That key exists but is expired" tells the caller the key exists.

## Organization mode (`api-keys-organization`)

A key belongs to one organization and resolves the same `Tenant` a cookie does, through `apiKeyTenant` in `multitenant`'s `tenantResolvers` table. `GET /tenant` shows what the server made of a key:

```sh
curl -s -H "Authorization: Bearer $KEY" https://api.example.com/tenant
# { "organizationId": "org_…", "principal": { "kind": "apiKey", "keyId": "…", "statements": { "project": ["read"] } } }
```

`x-organization-id` beside a bearer header is 403 `forbidden` whatever it says. A key is bound to one organization; the superadmin bypass is a cookie-path power, and it needs the admin session.

### Issuing a key

Use `/api-keys` in `apps/admin`, on the caller's active organization. From a browser client, the call the screen makes is:

```ts
const { data } = await auth.apiKey.create({
  name: "deploy pipeline",
  organizationId,
  metadata: { scope: { project: ["read"] } },
  expiresIn: 30 * 24 * 60 * 60, // seconds; omit for no expiry
});
data.key; // the plaintext, this once and never again
```

The scope travels as `metadata.scope` because the plugin refuses `permissions` on any request that carries headers (`SERVER_ONLY_PROPERTY`). The guard checks `metadata.scope`, and the plugin's `defaultPermissions` writes it to the `permissions` column. Read `permissions` on a stored row, never `metadata.scope`. The long note on `API_KEY_OPTIONS` in `api-key-options.ts` explains why (ADR 0036).

### Scopes are statements, and they cannot exceed the creator's

A key's scope is a permission map from `packages/auth/src/access.ts`, the same vocabulary a role uses. `can()` reads it the way it reads a member's statements, so a route needs no branch for machine callers:

```ts
.delete("/:id", async (c) => {
  const tenant = await requirePermission(c, { project: ["delete"] }); // key or cookie, one line
});
```

- **A key cannot out-scope its creator.** `apiKeyScopeGuard()` is a `before` hook on `/api-key/create`. It loads the creator's statements with the loader `requireTenant` uses and refuses a scope `can()` denies, with 403 `permission required: <resource>:<action>`. It runs before the plugin's own `apiKey: ["create"]` check, so holding that statement does not get past it. A superadmin passes.
- **A scope is a snapshot at issue time.** A later role edit changes the members and never a key. `/api-key/update` is not guarded because it cannot write a scope. To change what a key may do, revoke it and issue another.

The create form offers only the statements the caller holds. The form is a convenience. The guard is the gate.

### The `api_keys` table in organization mode

`apiKeyPlugin()` sets `references: "organization"` and renames `referenceId` to `organizationId`, so the table meets the tenant column convention. The rename in `packages/auth/src/plugins/api-key.ts` and the snapshot in `packages/db/src/schema/api-keys.ts` change together, or the adapter writes into a column that is not there.

## User mode (`api-keys-user`)

A key belongs to one user. `api_keys.user_id` references `users.id` with `onDelete: "cascade"`, so a deleted account deletes its keys. `references: "user"` makes the plugin take the owner from the session on create, and `get`, `update` and `delete` answer `KEY_NOT_FOUND` for a key another user owns.

### The key vocabulary

`packages/auth/src/api-key-scopes.ts` lists every resource-and-action pair a key may carry. The project owns this file and edits it. It ships empty:

```ts
export const API_KEY_SCOPES: Readonly<Record<string, readonly string[]>> = {};
```

While it is empty, every scoped create is refused with 403 `permission required: <resource>:<action>`. A create with no scope still issues a key, and that key holds nothing, so `requireScope` refuses it every demand. Declare the pairs your routes demand:

```ts
export const API_KEY_SCOPES: Readonly<Record<string, readonly string[]>> = {
  cards: ["read", "write"],
  reviews: ["read", "write"],
};
```

`apiKeyScopeGuard()` checks every create against this list, with or without a session. A server-side `auth.api.createApiKey` with `permissions` is held to the same list as a browser's `metadata.scope`. Removing a pair later stops new keys from carrying it and does not shrink a key that already holds it. Revoke and reissue those keys. It checks a server-side `auth.api.updateApiKey` that sets `permissions` against the same list. A browser cannot set `permissions` on update at all, because the plugin refuses that field from a request, and `metadata.scope` on an update changes no scope.

### Issuing, listing and revoking keys

Keys live on the client instance, under `/auth`, only. The core registers the plugin on `adminAuth` too, for the organization owner's screen, so this owner patches `apiKeyAdminGuard()` into `adminAuth.plugins`. It refuses every `/admin/auth/api-key/*` call with 403 `API_KEYS_ON_CLIENT_ONLY`, so an admin session can neither mint nor verify a user-owned key, and a credential counts only where it was issued (ADR 0050).

There is no key screen in user mode. Call the client plugin from the signed-in user's browser. `authClient` here is the client `createClient(baseURL)` from `@repo/auth/client` returns:

```ts
const { data, error } = await authClient.apiKey.create({
  name: "cli on my laptop",
  metadata: { scope: { cards: ["read"] } },
});
data.key; // the plaintext, this once and never again

const { data: keys } = await authClient.apiKey.list(); // the caller's own keys
await authClient.apiKey.delete({ keyId: keys[0].id });
```

Send the scope as `metadata.scope`, for the same `SERVER_ONLY_PROPERTY` reason as organization mode. Read a key's scope from `permissions`.

### Gating a route

A route opens with `requireCaller(c)` and states its demand with `requireScope(caller, demand)`:

```ts
import { requireCaller, requireScope } from "@repo/auth/caller";

export const cards = new Hono().get("/", async (c) => {
  const caller = await requireCaller(c);
  requireScope(caller, { cards: ["read"] });
  return c.json(await listCards(c, caller.userId), 200);
});
```

`requireCaller` returns `{ userId, principal }`. The principal is `{ kind: "user" }` for a session cookie, or `{ kind: "apiKey", keyId, statements }` for a key. With no bearer header and no session it throws 401 `sign in first`.

- **A session user passes every demand.** A scope narrows a key and never a person.
- **A key must hold every demanded action.** The 403 names the first missing pair: `permission required: cards:write`.
- **An empty demand is refused** for both kinds, with 403 `permission required`. A demand built from an empty loop fails closed.
- **A banned owner's keys stop working.** `requireCaller` loads the key's owner after the key verifies and answers 401 `invalid api key` while the owner is banned, the way the `admin()` plugin refuses their sign-in. A ban with a past `banExpires` no longer counts. The plugin itself never reads the user row, so this check is the only one.
- **Data ownership is the route's job.** `requireScope` says what a caller may do, never which rows are theirs. Filter every query on `caller.userId`.

Both functions throw `HTTPException`, so `apps/api`'s `onError` renders their refusals as the `{ error: { code, message } }` envelope.

### The `api_keys` table in user mode

`apiKeyPlugin()` sets `references: "user"` and renames `referenceId` to `userId`, which the snapshot stores as `user_id` with the index `api_keys_user_id_idx`. `requireCaller` still reads the plugin's own `referenceId` field off a verified key, because the adapter maps the column back to the model field.

## Shared by both modes

### The plaintext and expiry

The plaintext exists in the create response and nowhere else. Only a SHA-256 hash is stored, and the plugin has no endpoint that returns a key again. A lost key is reissued, not recovered.

`expiresIn` is in **seconds**, with a floor of one day and a ceiling of 365 days. Leave it out and the key stays valid until it is revoked.

### What is off, and why

- `enableSessionForAPIKeys: false`. A key never becomes a session, so `requireSession` never accepts one, and only the owner's bearer path turns a key into a caller. In organization mode the mocked session would also carry no `activeOrganizationId` and resolve to no tenant.
- `rateLimit: { enabled: false }`, with `remaining` and the refill columns unused. Limits belong to the `ratelimit` module, not to one credential type.
- `deferUpdates: false`. It needs `advanced.backgroundTasks.handler`, and Workers has no `waitUntil` behind that hook.

The columns stay in the snapshot because the plugin writes `requestCount` regardless, and a snapshot that drops a column the adapter knows about does not match what the adapter writes.

### One write per bearer call

`verifyApiKey` writes `lastRequest` on every request, synchronously. That is accepted by decision. A key busy enough for that write to matter needs a limiter in front of it, which is the job of `ratelimit`.

### `modelName` and the pinned version

Both owners set `schema.apikey.modelName: "apiKey"`. `auth.ts` passes `usePlural: true` to the Drizzle adapter, so the adapter asks for the `apiKeys` export, stored as the `api_keys` table. Without it the adapter asks for `apikeys`, finds no export, and every key call throws. Change the `modelName` and the export key together.

The snapshot is hand-authored against `@better-auth/api-key@1.7.7` and ships in two dialects, selected by `onlyWith`. A version bump means re-verifying every column against that version's `apiKeySchema()`. Each owner's `schema-version.test.ts` fails until its header and the range the core pins agree again.

## Failure codes

| Case | Mode | Status and body |
| --- | --- | --- |
| A claimed bearer header with no key, or a key not found, revoked, disabled or expired | both | 401 `invalid api key` |
| A valid key whose owner is banned | user | 401 `invalid api key` |
| Any `/admin/auth/api-key/*` call | user | 403 `API_KEYS_ON_CLIENT_ONLY` |
| No bearer header and no session on `requireCaller` | user | 401 `sign in first` |
| `x-organization-id` beside a bearer header | organization | 403 `forbidden` |
| A route demand the key does not hold | both | 403 `permission required: <resource>:<action>` |
| An empty demand on `requireScope` | user | 403 `permission required` |
| A create scope wider than the creator's statements | organization | 403 `permission required: <resource>:<action>` |
| A create scope, or a server-side update's `permissions`, outside `API_KEY_SCOPES` | user | 403 `permission required: <resource>:<action>` |

A route refusal comes through the api's `{ error: { code, message } }` envelope. The guard's 403 on `/auth/api-key/create` is a Better Auth `APIError`, so its body is Better Auth's `{ "message": "permission required: …" }` with no `code`, in both modes. A client that reads the create error must read `error.message`.

A deleted user takes every key they own with them (`onDelete: "cascade"`), so the next bearer call with one of those keys gets 401 `invalid api key`.

## Boundaries to honor

- **Do not add a second permission path for keys.** In organization mode the bearer principal carries statements and `can()` reads them. In user mode `requireScope` reads them. A route that asks Better Auth's `hasPermission` pays a query per check and answers from a different engine.
- **Do not mint a `TenantId` from a request.** In organization mode the resolver calls `asTenantId` on the verified key's organization, the only place on this path where that is allowed.
- **Do not widen the 401 message.** Each failure a caller can tell apart is a fact an attacker did not have.
- **Do not turn `enableSessionForAPIKeys` on.** In both modes it lets a key pass `requireSession`, which no route expects.
- **Do not read `metadata.scope` off a stored row.** `permissions` decides. The two copies drift after an update.

## Switching owners

No keys move between owners. The owner column changes, so a key issued under one owner means nothing under the other.

1. Revoke every key, and tell the machine callers that hold them.
2. Run `saasaloy remove api-keys-organization` (or `remove api-keys-user`).
3. Run `saasaloy add api-keys-user` (or `add api-keys-organization`).
4. Run `pnpm db:generate`, and read the migration. The table is empty, so a rebuild of `api_keys` with the new owner column is safe.
5. Apply the migration, then issue new keys.

The core stays installed across the switch, so its `auth.ts` patches stay too. Between steps 2 and 3, `auth.ts` imports a `plugins/api-key.ts` that no longer exists, so the project does not compile until step 3. When moving to user mode, also rewrite each route that uses `requirePermission` for a key caller to use `requireCaller` and `requireScope`.

## Removal

Remove the owner first. The owner depends on the core, so `remove api-keys` refuses while an owner is installed.

`saasaloy remove api-keys-organization` reverses the bearer resolver patch and the `/api-keys` nav entry, and deletes the owner's files. `saasaloy remove api-keys-user` reverses the `apiKeyAdminGuard()` patch on `adminAuth` and deletes its files, which include `caller.ts`, so every route that imports `@repo/auth/caller` stops compiling. For both owners, the `api_keys` table survives. Run `db:generate` and read the drop migration before you apply it. Tell the machine callers first, because every key stops working when the owner goes. Removing the last owner also warns that `api-keys` is left with none of its `requiresOneOf` installed and names the fix. It does not refuse, because switching owners is remove-then-add, and `doctor` reports the state until an owner is back.

`saasaloy remove api-keys` then reverses the core's six patches, the two server plugins on each of `auth` and `adminAuth` and the client plugin in each of `authClientPlugins` and `adminAuthClientPlugins`, and deletes `api-key-options.ts` and `api-key-client.ts`. The `@better-auth/api-key` line in `packages/auth/package.json` survives, because a `package-json-dependency` patch has no removal inverse. Drop it by hand and run `pnpm install`.

## Moving an existing `api-keys` project to the split

A project that installed `api-keys` before the split has organization-owned keys. Its new `api-keys` descriptor needs an owner, so `saasaloy update` refuses with exit 2 and changes nothing until one is installed:

```
Cannot update — unmet requirement:
  api-keys now needs one of: api-keys-organization, api-keys-user, and none is installed. Run one of:
    saasaloy add api-keys-organization
    saasaloy add api-keys-user
Then run `saasaloy update` again. Nothing was changed.
```

1. Upgrade the `saasaloy` CLI to 0.7.0 or later. `api-keys` and both owners declare `requires.saasaloy: ">=0.7.0"`, and an older CLI refuses them in `add` and `update` before it writes anything.
2. Run `saasaloy add api-keys-organization`. The schema, the resolver, the screen and the plugin keep their bytes, so `add` adopts them, moves their ownership to the new module, and records the resolver patch again under it.
3. Run `saasaloy update`. It writes the new `packages/auth/src/plugins/api-key-options.ts` under `api-keys`.
4. Run `pnpm db:generate`. It reports no schema changes, because the table is the same.

Do not pick `api-keys-user` for an existing project. Its keys are organization-owned, and no keys move between owners.

## Upgrading from singular table names

A project that installed `api-keys` before the tables became plural has an `apikey` table in its database. Move it to the new name like this:

1. Update `auth` first, because its schema rename and `usePlural: true` land together. Then follow "Moving an existing `api-keys` project to the split" above. The `add` and `update` steps there write the new schema file and the `modelName: "apiKey"` option.
2. Run `pnpm db:generate`.
3. drizzle-kit asks, for each new table, whether it is created or renamed from an existing table. Pick the rename from the old name: `apikey` → `api_keys`.
4. Read the generated SQL before you apply it. It must rename the table and its indexes (`ALTER TABLE ... RENAME TO ...`), and contain no `DROP TABLE` or `CREATE TABLE` for a table that holds data.
5. If it drops a table, delete that migration file and run `pnpm db:generate` again.
6. Apply the migration, then call the API once with an existing key to confirm the adapter finds the table.

## Next

Run `saasaloy-api` to accept a key on a route and read the caller it resolves to.
