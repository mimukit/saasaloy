---
title: The admin() plugin endpoints answer 404 over HTTP
---

## What update does

`adminAuthRoute` in `apps/api/src/routes/auth.ts` answers 404 on every `/admin/auth/admin/*` path, before it forwards to `adminAuth.handler`. That covers each endpoint of Better Auth's `admin()` plugin on the admin instance: `list-users`, `get-user`, `set-role`, `ban-user`, `unban-user`, `remove-user`, `impersonate-user` and the rest. The route decodes the path and folds case and repeated slashes, so an encoded path gets the same 404. It matches the prefix, so an endpoint that a Better Auth bump adds answers 404 too.

Over HTTP, `set-role` or `ban-user` was a staff write with no audit row (issue #310). The client instance already refuses the same endpoints under `/auth/admin/*` with 403 `ADMIN_SESSION_REQUIRED`, and that does not change.

`packages/auth/src/server.ts` also exports `adminGate`, Hono middleware that answers 401 or 403 before anything else on an admin route runs. List it before the validator on an admin route, so a signed-out caller with a bad body gets 401, not 400.

## What update merges

- `apps/api/src/routes/auth.ts`, if you edited it. Keep your edits and take `ADMIN_PLUGIN_PATH`, `isAdminPluginPath()` and the 404 branch in `adminAuthRoute`.
- `packages/auth/src/server.ts`, if you edited it. Keep your edits and take the `createMiddleware` import and the `adminGate` export.

## What you do

1. Find each caller of an `admin()` plugin endpoint over HTTP:

   ```sh
   grep -rn "auth\.admin\.\|/admin/auth/admin/" apps packages --include='*.ts' --include='*.tsx'
   ```

   A hit in `apps/admin` is browser code that calls `auth.admin.*` on the admin client. A hit anywhere else is a `fetch` of the raw path. After the update, each one gets 404.

2. Move each call to an api route under `/admin/` that calls `adminAuth.api.*` on the server. Pass the caller's headers, so the admin session check and the rank guard still run:

   ```ts
   .post("/members/:id/role", adminGate, validRoleBody, (c) =>
     adminAuthWrite(c, async ({ audit }) => {
       const { role } = c.req.valid("json");
       await adminAuth.api.setRole({
         body: { userId: c.req.param("id"), role },
         headers: c.req.raw.headers,
       });
       audit({ action: "member.role.set", target: { id: c.req.param("id") } });
       return c.json({ changed: true }, 200);
     })
   )
   ```

   `member.role.set` stands for an action your project names. Add it to an action file under `apps/api/src/audit/`, because the audit coverage test fails on a write route that no entry names. A route that only reads, such as `adminAuth.api.listUsers`, runs inside `withAuthScope(c, ...)` in place of `adminAuthWrite`. `adminAuthWrite` ships with the `admin` module; without it, wrap the call in `withAuthScope`. The `admin` module's `apps/api/src/routes/admin-members.ts` is a worked example.

3. Point the browser code at the new route through the typed `hc` client, and delete the `auth.admin.*` call.

4. Put `adminGate` first on each admin route you wrote, before its validator.

## Verify

```sh
pnpm typecheck
grep -n "isAdminPluginPath" apps/api/src/routes/auth.ts
grep -rn "auth\.admin\.\|/admin/auth/admin/" apps packages --include='*.ts' --include='*.tsx'
```

The typecheck passes, the first grep finds the 404 branch, and the second grep prints nothing.
