# 0050: Client and admin sessions are two auth instances

A project has two user groups. Clients are the shoppers, customers and app users. The admin group is `superadmin`, `admin` and any role a project adds for its own staff. Until now both groups signed in on one Better Auth instance at `/auth` and held one cookie, `better-auth.session_token`. `deriveCookieDomain` scopes that cookie to `.x.com`, so it also goes with each request from `admin.x.com`, and in dev the cookie ignores the port. An admin sign-in in the admin app therefore replaced a client's cookie, and a client and an admin could not stay signed in together in one browser. The admin app also drew its whole shell around the refusal panel for a client. primeshopr found the fault as `brainaloylabs/primeshopr#88`. Settled on 2026-10-23 in the grill of `docs/plans/0079-plan-separate-client-and-admin-sessions-2026-10-23.md` for issue [#238](https://github.com/mimukit/saasaloy/issues/238).

## Status

accepted. Builds on [ADR 0004](0004-adr-httponly-cookies-and-subdomains-2026-07-22.md), whose httpOnly cookies and cookie domain stay as they are: the cookie names now keep the two groups apart. Keeps [ADR 0029](0029-adr-auth-holds-a-request-scoped-db-client-2026-08-31.md): both instances read the request-scoped `authDb`.

## The shape

- **Two instances in every project, on one set of tables.** `packages/auth/src/auth.ts` exports `auth` (client, `basePath: "/auth"`, cookie prefix `client`) and `adminAuth` (admin, `basePath: "/admin/auth"`, cookie prefix `admin`). Both read `users`, `sessions`, `accounts` and `verifications`, so one person is one user row and one password in both. `saasaloy add admin` and `remove admin` do not change auth: a project without the admin app has an unused `/admin/auth` route.
- **One shared options object.** `sharedOptions(group)` holds the adapter, the secret, the trusted origins, the first-user hook and `advanced`. Each `betterAuth({...})` spreads it and keeps its own literal `plugins: [...]`, so the `plugin-array` patch point keeps its shape with a second `exportName`.
- **A session belongs to one audience.** `sessions.audience` (`client` or `admin`, not null, default `client`) records which instance wrote the row. The `audience(name)` plugin declares and writes it. Each instance wraps its adapter (`scopeSessionsTo`) so that a session lookup by token also matches the audience. Better Auth finds every session through that one lookup, so a token copied into the other cookie is no session on any endpoint and in any `api.*` call. `decide` checks the audience again in the api gates.
- **A header picks the session for the generic gates.** `x-auth-audience: client | admin` names which of the caller's two cookies `getSession`, `requireSession` and `authFor(c)` read. No header means `client`, and any other value gets 400. The admin app's api client sends `admin`, so a teams or billing screen in the admin app acts as the admin signed in there. The header only picks between the caller's own cookies, so it grants nothing, and a cross-site page cannot send it without a preflight that CORS refuses. `requireAdmin`, `requireAdminApp`, `requireRole` and `requireSuperadmin` ignore it and always read the admin session.
- **Two role lists.** `ADMIN_APP_ROLES` is the group: who may sign in on the admin session and open the admin app (`requireAdminApp`). `ADMIN_ROLES` is the privilege: who may do admin-only work (`requireAdmin`). Both hold `superadmin` and `admin`. A project adds `support` to the group list only.
- **The admin session is closed.** `adminAuth` has no sign-up, and its `audience` plugin refuses to open a session for a user outside `ADMIN_APP_ROLES`, with the wrong-password answer. A client's credentials therefore open no admin session at all.
- **`superadmin` owns the admin group.** A rank guard on `adminAuth` refuses, unless the caller is `superadmin`, any `/admin/*` call that changes an admin-group account or grants an admin-group role. It refuses to take the role from the last `superadmin`. It refuses impersonation for everyone. A path its table does not name is superadmin-only, so an endpoint a Better Auth bump adds fails closed.
- **The client instance keeps `admin()` without its endpoints.** The plugin still writes the default role, types `user.role` and refuses a banned account at sign-in. A guard refuses every `/auth/admin/*` path with 403.
- **Feature plugins go on both instances.** `teams`, `rbac`, `api-keys` and `billing-stripe` each patch both `plugins` arrays and both client plugin arrays, because the admin app hosts their screens until the `app` module (#227) ships. A `plugin-array` patch whose export is missing now reports a refusal, and `update` keeps that module's lock entry so a later run applies it.
- **The refusal page drops the shell.** `RootError` renders `AccessDenied` alone on the login card. It shows only for a role removed after sign-in, because the admin session refuses a client at sign-in.

## Considered Options

- **A second instance only when `admin` is installed.** Rejected: every auth patch would need an `onlyWith: admin` twin, and `requireAdmin` would change its source on `add admin` and on `remove admin`.
- **A different signing key per instance in place of the column.** Rejected: anything Better Auth encrypts with the secret and both instances read would break between them. No module does that today, and an OAuth module would.
- **Cookie names only, no audience.** Rejected by the owner: a user who copies their own token into the other cookie gains no privilege, because the role checks stay, but the owner wants a token to count only where it was issued.
- **A plugin hook plus `decide` in place of the adapter scope.** Rejected after the spike: a hook runs only where Better Auth runs hooks and costs an extra read per request, while the scoped lookup covers every path at no cost. It stays the fallback if a Better Auth release moves the lookup.
- **Tenant routes on the client session only.** Rejected: the teams, roles and keys screens in the admin app would fail until #227 moves them.
- **Wait for the `app` module.** Rejected: the fault would stay in every new project until then.
- **`/admin-auth` as the admin path.** Rejected for `/admin/auth`, so one edge rule on `/admin/*` covers the whole admin group. The cost is a reserved prefix: a middleware on `/admin/*` must skip `/admin/auth/*`.

## Consequences

- Every existing session ends on the update, because both cookie names change. Clients and admins sign in again once.
- An existing project upgrades in order: `saasaloy update auth admin`, resolve `auth.ts`, `client.ts`, `server.ts` and the auth schema in the merge plan, run the migration that adds `sessions.audience`, then update each module that patches auth.
- The first account still signs up as a client on `/auth` and becomes `superadmin`, then signs in on the admin app with the same email and password.
- Impersonation is not available until a design covers both audiences.
- A password change that revokes other sessions, or "revoke all sessions" on a user, ends that user's sessions in both groups, because they share one table.
- Each instance carries every feature plugin, so each plugin's endpoints exist under both paths. A plugin that should answer for one group only needs a guard of its own.
- When `app` ships, its screens send no header and read the client session. The admin app keeps sending `admin`.

## References

Issue #238. Plan: `docs/plans/0079-plan-separate-client-and-admin-sessions-2026-10-23.md`. Found in `brainaloylabs/primeshopr#88`. Builds on ADR 0004 and ADR 0029.
