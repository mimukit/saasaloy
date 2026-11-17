---
title: adminWrite takes the roles its gate admits
---

## What update does

`apps/api/src/lib/admin-write.ts` gives `adminWrite(c, body, options)` an optional third argument, `{ roles }`. Unset, the gate is `requireAdmin` as before: admin or superadmin. A route every admin-app user may call passes `{ roles: ADMIN_APP_ROLES }`, so a role a project adds to `auth.adminAppExtraRoles` passes the gate too. `ecommerce` is the first caller: its `/admin/shop` writes are open to `ADMIN_APP_ROLES` (plan 0106, "Admin"). The file also exports the `AdminWriteOptions` type.

No route of this module changes. No row changes.

## What the merge plan gets

`apps/api/src/lib/admin-write.ts`, if you edited it. Keep your edits, import `requireRole` and the `RoleDemand` type from `@repo/auth/server`, add the `options` parameter to `adminWrite` and `actorOf`, and call `requireRole(c, roles)` in `actorOf` when `roles` is set.

## What you do

Nothing, unless you want one of your own admin write routes open to `ADMIN_APP_ROLES`. Then pass `{ roles: ADMIN_APP_ROLES }` as its third argument.

## Verify

```sh
pnpm typecheck
pnpm test
```

Both pass. A shop write as an admin-session user whose role is outside `ADMIN_APP_ROLES` still answers 403 (`apps/api/src/routes/admin-ecommerce.test.ts`, when ecommerce is installed).
