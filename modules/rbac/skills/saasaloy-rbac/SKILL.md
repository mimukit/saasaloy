---
name: saasaloy-rbac
description: Runbook for the rbac feature, which gives an organization runtime-defined roles over a locked static base and gates a route with requireCan. Use when adding a permission-checked route, adding a resource to the permission vocabulary, creating or editing a custom role, hiding a control in apps/admin, or working on the base-role lock, the dangling-role rule, or removal behavior.
---

# rbac

The `rbac` feature answers the second of the three tenant questions: **what may this caller do here?** `multitenant` answered the first, which organization the request is for. This one gates the actions inside it.

It adds `requireCan(c, permissions)` to `packages/auth`, the import-free `can()` beside it, the `roleLockGuard()` plugin that keeps the three base roles read-only, and the `/roles` screen in `apps/admin`. It also replaces `multitenant`'s `/projects` example with the permission-gated copy of the same three routes.

## The route recipe

One line, and it replaces `requireTenant` rather than joining it.

```ts
// apps/api/src/routes/projects.ts
export const projects = new Hono<{ Bindings: AuthDbBindings }>()
  .get("/", async (c) => {
    const tenant = await requireTenant(c); // membership is the gate on a read
    // ...
  })
  .delete("/:id", async (c) => {
    const tenant = await requireCan(c, { project: ["delete"] });
    await withDb(c, (db) => deleteProject(db, tenant.organizationId, c.req.param("id")));
    return c.json({ id }, 200);
  });
```

`requireCan` **is** `requireTenant` plus `can`, and it returns the same `Tenant`. Never call both in one handler: the second call re-resolves the session and re-runs the `organizationRole` query for an answer it already has.

Reads usually stay on `requireTenant`. `member` holds `project: ["read"]` in `access.ts`, so gating a read is the same check written twice. Gate a read when some members must not see the rows at all, not by reflex.

`permissions` is typed by `Permissions` from `access.ts`. An undeclared resource or a misspelled action is a compile error, not a check that silently passes.

## Adding a resource

Edit `packages/auth/src/access.ts`, and nothing else.

```ts
export const statements = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete"],
  invoice: ["read", "refund"], // new
} as const;
```

Then decide which base roles hold it, in the same file. The `/roles` grid picks the new resource up with no change, a custom role can be given it immediately, and `requireCan(c, { invoice: ["refund"] })` starts typechecking.

No module patches `access.ts`. A project owns it outright.

## The base roles are locked

`owner`, `admin` and `member` are static, and they stay that way. Two things enforce it:

- `roleLockGuard()`, a Better Auth `before` hook on `/organization/create-role`, `/update-role` and `/delete-role`. It refuses any request naming a base role with 403 `base role is locked: <name>`, and it runs before the plugin's own `ac` check, so an owner holding every statement cannot get past it.
- The `/roles` screen renders base roles with no edit or delete control.

The reason is the merge. `dynamicAccessControl` makes `hasPermission` load an organization's stored rows and merge each one **over** the static role of the same name. A stored row called `admin` would widen the static `admin` invisibly, and a row called `member` would widen every ordinary member in that organization at once. Neither shows up in a code review, and both survive a deploy.

To change what a base role holds, edit `access.ts`. That is a code change, and it is reviewed.

## Custom roles

A custom role is a name plus a permission map picked from `statements`. Create one on `/roles`, or from code:

```ts
await auth.organization.createRole({
  organizationId,
  role: "viewer",
  permission: { project: ["read"], ac: ["read"] },
});
```

Assign it with `updateMemberRole`. It takes effect on the member's next request: `requireTenant` reads the `organizationRole` rows fresh each time.

Three rules the screen enforces and you should keep:

- **A held role cannot be deleted.** `deleteRole` does not check for holders in `better-auth@1.7.2`, and a member left holding a deleted name resolves to *no statements at all* — a silent lockout, not a demotion. The screen disables delete while anyone holds the role and names the holders.
- **A dangling role grants nothing.** That is the decision, not an accident: `resolveStatements` returns `{}` for a name that matches neither a base role nor a stored row. Failing back to `member` would hand a deleted role more power than the operator meant.
- **The last owner cannot be demoted.** Better Auth refuses it server-side; the screen disables the option so the operator does not have to read an error to learn it.

## `can()` is pure, and it runs in two places

`packages/auth/src/rbac-rules.ts` imports nothing at runtime. `requireTenant` already ran the one `organizationRole` query and merged the statements onto the principal, so `can(principal, permissions)` is a function over data the request already holds. A route with three permission checks still pays for one round trip.

`apps/admin` imports the same function from `@repo/auth/rbac-rules`, fetches `GET /tenant` once per page, and hides a control the caller may not use. Better Auth's `checkRolePermission` is deliberately not used: it knows the static roles only, so it answers wrongly for every custom role.

**The hide is cosmetic. The 403 is the gate.** A screen that hides a button and skips `requireCan` has no authorization at all. Write the route check first, then hide the control.

Three arms, and one of them is not about statements:

| Principal | Answer |
| --- | --- |
| `superadmin` | true, without reading statements at all |
| `member` | every demanded action must appear in the resolved statements |
| `apiKey` | the same rule, over the key's fixed scope |

An empty demand — `{}` — is refused, not allowed. It is a bug at the call site, and reading it as "no permission needed" would open a route.

## Three different questions

Do not reach for the wrong one.

| Helper | Question |
| --- | --- |
| `requireAdmin(c)` | may this session open `apps/admin`? |
| `requireSuperadmin(c)` | is this the one role that crosses organizations? |
| `requireTenant(c)` | which organization is this for, and as whom? |
| `requireCan(c, p)` | that, and may they do this here? |

A site `admin` is an ordinary member on every tenant route. The site role grants nothing to `can()`.

## Failure codes

| Case | Status and message |
| --- | --- |
| Signed out | 401 `sign in first` |
| No organization resolves | 403 `no active organization` |
| Permission missing | 403 `permission required: <resource>:<action>` |
| Base role write attempt | 403 `base role is locked: <name>` |

The permission message names the first missing pair, never the whole demand: a refusal listing every permission a route wants would describe the route to an attacker.

## Removal

`saasaloy remove rbac` reverses two patches (the `roleLockGuard` plugin and the `/roles` nav entry) and prints three warnings.

The one to read twice: this module **owns** `packages/api/src/routes/projects.ts`, the gated copy of `multitenant`'s example, so removing `rbac` deletes that file while the `/projects` mount in `apps/api/src/index.ts` stays. Run `saasaloy add multitenant` to restore the ungated copy (ADR 0031: a re-run is recovery).

Stored custom roles survive removal and nothing reads them afterwards, so their holders resolve to no permissions. Reassign those members to a base role first.
