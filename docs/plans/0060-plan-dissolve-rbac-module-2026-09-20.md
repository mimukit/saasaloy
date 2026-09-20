# Plan: dissolve the `rbac` module into `teams` and `multitenant`

Grilled: 2026-09-20

Issue: [#165](https://github.com/mimukit/saasaloy/issues/165), Phase 3. Phase 2 of that issue is absorbed here and needs no separate work.

## Context

Role code is split across three modules and the split does not follow ownership. `teams` owns the permission vocabulary (`access.ts`), the `organization_roles` table and the `dynamicAccessControl` switch. `multitenant` owns the repository that reads that table and the request path that resolves statements onto a principal. `rbac` owns the pure decision (`can`), the throwing gate (`requireCan`), the lock that keeps the three base roles read-only (`role-lock.ts`), and the `/roles` screen.

Four faults follow.

1. `role-lock.ts` guards a switch that `teams` turns on, but it ships in `rbac`. A project with `teams` and no `rbac` enables the feature and not the guard. A stored role row named `admin` then widens the static `admin` silently.
2. `multitenant` and `rbac` both declare `@api/routes/projects.ts` as a file target. The two copies differ by two lines of code. `modules/rbac/skills/saasaloy-rbac/SKILL.md:129` documents the consequence: removing `rbac` deletes the file while the `/projects` mount stays, and the user runs `saasaloy add multitenant` to repair it.
3. `multitenant` already runs the one `organization_roles` query and merges statements onto the principal (`loadStatements`, `files/auth/tenant.ts:124`). A project with `multitenant` and no `rbac` therefore pays for the role data and gets no gate. Tenant scoping without permission checking is not a configuration this repo actually offers.
4. `api-keys` declares `dependsOn: ["rbac"]` but imports `can`, `allows` and `PrincipalLike` from `@repo/auth/rbac-rules` and `tenantQuery` from `@admin/lib/tenant`. The dependency is on those files, not on the module name.

Success: every role file sits in the module that owns the data or the request it acts on, `@api/routes/projects.ts` has exactly one owner, `modules/rbac/` is gone, the files are named after what they do, and no scaffolded project loses a capability.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where `rbac` goes | Two ways. The pure rule and the base-role lock go to `teams`; the request path, the worked example and the `/roles` screen go to `multitenant`. |
| Why not `auth` | `auth` already ships site-role authorization in `authorize.ts` and `server.ts`. This is organization permission checking, and its input `access.ts` imports `better-auth/plugins/organization/access`, which `auth` does not install. |
| Why not `multitenant` alone, as the issue states | `role-lock.ts` guards `dynamicAccessControl`, which `teams` turns on. A full merge puts the guard two modules away from the switch. |
| Why the `/roles` screen goes to `multitenant`, not `teams` | `roles.tsx` imports `tenantQuery`, which fetches `GET /tenant`. `multitenant` mounts that route. Shipping the screen from `teams` would put a 404 on the screen in a `teams`-only project. |
| `multitenant` and `apps/admin` | `multitenant` adds `"admin"` to `dependsOn`. It already requires `admin` transitively, because `teams` declares it, so the graph does not change. The comment at `modules/rbac/files/admin/lib/tenant.ts:13` claiming `multitenant` cannot ship an `apps/admin` file is wrong and gets rewritten. |
| `modules/rbac/` | Deleted. With the screen in `multitenant` it would ship nothing. |
| `projects.ts` | Stays a real file target with one owner, `multitenant`, and the gated copy is the only copy. A skill snippet is never type-checked. |
| File names | Renamed. `rbac-rules.ts` becomes `permission-rules.ts` in `teams`; `rbac.ts` becomes `permissions.ts` in `multitenant`. Subpaths become `@repo/auth/permission-rules` and `@repo/auth/permissions`. The pair mirrors `tenant-rules.ts` / `tenant.ts`. |
| `requireCan` | Renamed to `requirePermission`. |
| `can`, `allows` | Unchanged. They are short by design at a call site, and `hasPermission` would collide with Better Auth's own, which `rbac-rules.ts:97` exists to argue against. |
| The lock vocabulary | Unchanged. `roleLockGuard`, `findLockedRole`, `roleLockDenial` and `BASE_ROLE_LOCKED` all name the lock, not the module. |
| Rename sequencing | Its own phase, after the move lands and type-checks. A failure in the rename must not be confusable with a failure in the move. |
| The word `rbac` | Retires as a module name, survives as the model's name. `CONTEXT.md` takes one entry with the headword `permissions` and `rbac` stated as a synonym in the body. |
| Existing installs | A release note and a CHANGELOG entry. No alias map and no tombstone descriptor. |
| Issue Phase 2 | Absorbed. `role-lock.ts` reaches `teams` through Phase 1. |

## Approach

The split follows the line this repo already draws three times: a pure rules file next to the api-facing file that throws on it. `authorize.ts`/`server.ts`, `tenant-rules.ts`/`tenant.ts` and `rbac-rules.ts`/`rbac.ts` are the same shape. This plan applies the rule to module boundaries as well: **the rule ships with the data, the request path ships with the request.**

Reused as-is, with no logic rewrite: `can`, `allows`, `findLockedRole`, `roleLockDenial`, `roleLockGuard`, `requireCan`, `loadStatements`, `resolveStatements`, and every admin component. Phases 1 to 3 are a move. Phase 4 is a rename. Neither changes behaviour.

Rejected, recorded so it stays rejected: move nothing and turn `projects.ts` into a skill snippet. It removes the duplicate file target and fixes fault 2 alone. Faults 1, 3 and 4 survive it, and a snippet drifts because nothing type-checks it.

### Phase 1: move the rule and the lock into `teams` (built 2026-09-20)

Move these files from `modules/rbac/files/` to `modules/teams/files/`, targets unchanged:

| File | Target |
|---|---|
| `auth/rbac-rules.ts` | `@auth/rbac-rules.ts` |
| `auth/rbac-rules.test.ts` | co-located test, moves with it |
| `auth/plugins/role-lock.ts` | `@auth/plugins/role-lock.ts` |

Move the `plugin-array` patch that registers `roleLockGuard` into `packages/auth/src/auth.ts` from `modules/rbac/registry-item.json` to `modules/teams/registry-item.json`.

`rbac-rules.ts` imports `Denial` from `./authorize` and `role-lock.ts` imports `BASE_ROLES` from `../access`. `teams` already declares `dependsOn: ["api", "database", "auth", "admin"]` and ships `access.ts`, so both resolve with no dependency change.

Verify on a `.dev` project with `teams` alone: it type-checks, `roleLockGuard` is in the plugin array, and `node --test` runs the moved rules test.

Also confirm here, as the issue asks: does Better Auth refuse a stored role named `admin` on its own? If it does, `role-lock.ts` is defence in depth rather than the only guard. Record the answer either way; it does not change the move.

### Phase 2: move the request path, the example and the screen into `multitenant` (built 2026-09-20)

Move from `modules/rbac/files/` to `modules/multitenant/files/`:

| File | Target |
|---|---|
| `auth/rbac.ts` | `@auth/rbac.ts` |
| `admin/routes/roles.tsx` | `@admin/routes/roles.tsx` |
| `admin/components/role-workspace.tsx` | `@admin/components/role-workspace.tsx` |
| `admin/components/permission-grid.tsx` | `@admin/components/permission-grid.tsx` |
| `admin/lib/tenant.ts` | `@admin/lib/tenant.ts` |

Add `"admin"` to `multitenant`'s `dependsOn`. Move the `const-array` patch that adds `{ to: "/roles", label: "Roles" }` to `NAV_ITEMS`.

Replace `modules/multitenant/files/api/routes/projects.ts` with the gated copy from `modules/rbac/files/api/routes/projects.ts`, then delete the `rbac` copy. Merge the two header comments: keep `multitenant`'s recipe text, keep the note that a read stays on `requireTenant`, and delete the paragraph about the overwrite and the `saasaloy add multitenant` repair, which no longer happens.

Rewrite the header comment in `admin/lib/tenant.ts`. It claims `rbac` ships the file because `multitenant` cannot reach `apps/admin`. The new reason is that `multitenant` mounts the `GET /tenant` endpoint this query calls.

Verify on a `.dev` project with `multitenant`: `POST /projects` is gated by `requireCan(c, { project: ["create"] })`, and `/roles` loads and lists the base roles.

### Phase 3: retire `modules/rbac/` (built 2026-09-20)

- Delete `modules/rbac/`.
- Fold `modules/rbac/skills/saasaloy-rbac/SKILL.md` into two skills. Adding a resource, custom roles, the base-role lock and the dangling-role rule go to `saasaloy-teams`. The route recipe, `requireCan`, the 403 table and the `/roles` screen go to `saasaloy-multitenant`.
- Move `rbac`'s `removeWarnings`. The dangling-custom-role warning goes to `teams`, which owns the table. The `requireCan`-stops-compiling warning goes to `multitenant`. The third warning, about `projects.ts` being deleted on removal, is deleted outright: the fault it describes is gone.
- Update `multitenant`'s existing `requireTenant`/`forTenant` warning to name `requireCan` in the same sentence rather than adding a fourth line.
- Repoint `api-keys`: `dependsOn: ["rbac"]` becomes `dependsOn: ["multitenant"]`. One edge covers both halves, because `multitenant` depends on `teams`.
- Update the `//exports` comment in `modules/auth/files/package.json:9`. It names `rbac` as the filler for `./rbac` and `./rbac-rules`; the fillers are now `multitenant` and `teams`.
- Update the module counts. 37 modules, 8 features.

Verify: `pnpm lint` and the descriptor tests pass, and no descriptor names `rbac`.

### Phase 4: rename the files, the subpaths and `requireCan` (built 2026-09-20)

One reviewable commit on top of a working tree.

| Old | New |
|---|---|
| `teams` `@auth/rbac-rules.ts` | `@auth/permission-rules.ts` |
| its test | `permission-rules.test.ts` |
| `multitenant` `@auth/rbac.ts` | `@auth/permissions.ts` |
| `@repo/auth/rbac-rules` | `@repo/auth/permission-rules` |
| `@repo/auth/rbac` | `@repo/auth/permissions` |
| `requireCan` | `requirePermission` |

`can`, `allows`, `PrincipalLike`, `PermissionDemand`, `PermissionDecision`, `roleLockGuard`, `findLockedRole`, `roleLockDenial` and `BASE_ROLE_LOCKED` keep their names.

Callers to update: the `exports` map and `//exports` comment in `modules/auth/files/package.json`, `projects.ts`, `role-lock.ts`, `roles.tsx`, `role-workspace.tsx`, `api-keys`' `admin/routes/api-keys.tsx`, `admin/components/api-key-workspace.tsx`, `auth/plugins/api-key.ts` and `auth/resolvers/api-key.ts`, plus the three skills' example code.

Verify: a `.dev` project with `api-keys` installed type-checks and no source file contains the string `rbac`.

### Phase 5: vocabulary, removal behaviour and migration (built 2026-09-20)

- `CONTEXT.md` gets one entry, headword `permissions`. The body opens with "the role-based access control (RBAC) model this project runs" and states that `rbac` named a module until this change and now names only the model. Hand this to `domainkit`.
- Rewrite the live prose: `README.md`, `modules/README.md`, `docs/wiki/modules.md`. Leave `docs/plans/` and `docs/qa/` untouched as written history.
- Add a CHANGELOG entry and a release note. It says: run `saasaloy remove rbac`, then `saasaloy add multitenant`. `remove` builds its plan from the local manifest and lock (`packages/cli/src/lib/remover.ts:196`), so it works with the module gone from the registry. `saasaloy update rbac` fails with `Unknown module "rbac"` (`packages/cli/src/lib/registry.ts:163`), and that error is the intended answer.
- Check ADR 0031. This plan removes the one worked example of "re-run is recovery" that the `rbac` skill documents. Confirm the record still has live examples, or note that this one retired.
- Confirm `saasaloy remove teams` and `saasaloy remove multitenant` print the right warnings, and that removing `multitenant` from a project that keeps `teams` does not strand `@repo/auth/permissions` imports.

## Open questions

None. Every branch settled in the grill of 2026-09-20.

## Non-goals

- Phases 1, 2 and 4 of issue #165 (the `entitlements` merge, and the `validators` and `README` cleanups). They are independent and need no plan.
- Any change to `can`, `requireCan`/`requirePermission`, `roleLockGuard` or the permission model itself. Phases 1 to 3 move files; Phase 4 renames them.
- Splitting `teams`. It grows by two files here, so it stays one module.
- A CLI alias or rename map for retired modules.
- Patch reversal ([#36](https://github.com/mimukit/saasaloy/issues/36)).
