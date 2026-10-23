# Plan: separate the client and admin sessions

Grilled: 2026-10-23

## Context

Every project made from saasaloy has one Better Auth instance at `/auth` for every account. `modules/auth/files/src/auth.ts` builds it, and every sign-in writes the same `better-auth.session_token` cookie. `deriveCookieDomain` in `modules/auth/files/src/env.ts` turns `api.x.com` into `.x.com`, so the cookie also goes with each request from `admin.x.com`. In dev, cookies ignore the port, so the web app and the admin app share it too. An admin sign-in on the admin app therefore replaces a client's cookie, and a client and an admin cannot stay signed in at the same time in two tabs of one browser.

The admin app also shows its whole shell to a refused account. `modules/admin/files/src/routes/__root.tsx` renders `AccessDenied` inside `AppShell`, so a signed-in client sees the sidebar and the menus. The api still refuses every admin call, so no data leaks.

The downstream project primeshopr found the fault: brainaloylabs/primeshopr#88. A separate primeshopr thread fixes it there. This plan fixes it in the framework, so that every new project gets the separation.

A project has two user groups:

- **Client.** The shopper, the customer, the app user. The only site role is `user`. Organization roles (`owner`, `admin`, `member` from `teams`) are per organization and are not site roles.
- **Admin.** `superadmin` and `admin` ship. A project adds `support` or `manager` through the group list.

Goal: a client session and an admin session are two separate sessions with two cookies, and neither session counts on the other side. There is no number to measure. The check is the observable list in Phase 5: two tabs stay signed in, a sign-out in one tab leaves the other, and the cross-audience route tests pass.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Group names | `client` and `admin`, everywhere: instance names, cookie prefixes, audience values, glossary. |
| Instances | Two in every project, both in `packages/auth/src/auth.ts`: `auth` (client, `basePath: "/auth"`) and `adminAuth` (admin, `basePath: "/admin/auth"`). `saasaloy add admin` and `saasaloy remove admin` do not change auth. A project without `admin` has an unused `/admin/auth` route. |
| Shared config | One `sharedOptions()` object holds the adapter, the secret, `trustedOrigins`, the first-user hook and `advanced`. Each `betterAuth({...})` spreads it and keeps its own literal `plugins: [...]`, so the `plugin-array` patch shape does not change. A test proves that the codemod finds `plugins` next to a spread. |
| Cookie names | `advanced.cookiePrefix` is `client` on `auth` and `admin` on `adminAuth`. The cookies are `client.session_token` and `admin.session_token`, with the `__Secure-` prefix in production. Every existing session ends on the update. |
| `/admin/auth` path | Chosen over `/admin-auth` so that one edge rule (WAF, Access, log filter) covers the whole admin group on the api. The `auth` module mounts it with a second `chained-route` patch on `base`, inside `withAuthScope`. The `saasaloy-api` and `saasaloy-auth` skills reserve `/admin/auth/*`: a prefix middleware on `/admin/*` must skip it. A route test proves that Better Auth answers on that path with `admin` and `payment` installed. |
| Audience column | `sessions.audience`, text, not null, default `'client'`, in both driver schemas. It is a Better Auth `session.additionalFields` entry with `input: false`, so a client cannot set it. The default makes an old row read as a client row. |
| Audience write | `packages/auth/src/plugins/audience.ts` exports `audience(name)`. Each instance registers it with its own name, and its `session.create.before` hook writes the column. |
| Audience enforcement | Each instance wraps its `drizzleAdapter` in `packages/auth/src/scoped-adapter.ts`, so a `session` lookup by `token` also matches `audience`. Better Auth finds every session through that one `findOne` in `findSession`, so each endpoint, each middleware and each `auth.api.*` call sees a session of the other audience as no session, with no extra read. Phase 2 opens with a spike that proves the wrapper also covers the transaction path. If it does not, the build stops, reports, and falls back to a `hooks.before` check plus `decide`. A route test pins the behaviour, so a Better Auth bump that changes the lookup fails the build. |
| Audience rule | `decide` in `authorize.ts` also takes the expected audience and returns `SIGNED_OUT` for a session of the other audience. The pure rule runs under `node --test`. This is the second check, behind the plugin. |
| Audience header | `x-auth-audience: client \| admin`. A missing header means `client`. An unknown value gets 400. The admin app's api client sends `admin`. Hono's `cors()` with no `allowHeaders` echoes the preflight's headers, so CORS needs no change. A cross-site page cannot send the header without a preflight, and the preflight fails for an origin that is not on the list. The header picks between the caller's own two cookies, so it grants nothing. |
| Gates | `getSession`, `requireSession` and a new `authFor(c)` read the instance that the header names. `requireAdmin`, `requireAdminApp`, `requireRole` and `requireSuperadmin` always read `adminAuth` and ignore the header. |
| Role lists | `ADMIN_APP_ROLES` (`superadmin`, `admin`) is the group list: the roles that may sign in on `adminAuth` and open the admin app. `requireAdminApp(c)` checks it. `ADMIN_ROLES` and `requireAdmin` stay the privilege list and gate for admin-only work. The two lists hold the same roles today. A project adds `support` to `ADMIN_APP_ROLES` only, with a statement set in `roles`. The `saasaloy-auth` skill gives that recipe. `apps/admin/src/lib/auth.ts` keeps its browser copy of `ADMIN_APP_ROLES`. |
| Rank | `superadmin` owns the admin group. A rank guard plugin on `adminAuth` refuses, unless the caller is `superadmin`: set-role, create-user, update-user, ban, unban, remove-user, set-user-password, impersonate-user and revoke-session calls whose target holds an `ADMIN_APP_ROLES` role, and any call that would give such a role. It also refuses to demote or remove the last `superadmin`. It fails closed: a non-superadmin may call only a known list of `/admin/*` endpoints, and any other path gets 403, so an endpoint that a Better Auth bump adds needs one line in the list. The rule is a pure `rankDenial()` in `authorize.ts`. |
| `admin()` on the client instance | Both instances keep `admin()`, for the default role, the role type and the ban check at sign-in. A guard plugin on `auth` refuses every `/admin/*` path of the client instance with 403, through a path-prefix check that keeps working when Better Auth adds an endpoint. |
| Admin sign-in | A `session.create.before` hook on `adminAuth` refuses a user whose role is not in `ADMIN_APP_ROLES`, with Better Auth's "invalid email or password" message, so the screen tells an attacker nothing. `emailAndPassword.disableSignUp` is `true` on `adminAuth`. Client sign-up on `auth` stays open. |
| First-user hook | It stays in `sharedOptions()`, so both instances carry it. It fires only on an empty `users` table, and `adminAuth` has no sign-up, so in practice it fires on `auth`. |
| Feature plugins | Both instances carry the same feature plugins, because the admin app hosts every self-service screen until #227 ships `app`. `teams` (`organization()`), `rbac` (`roleLockGuard`), `api-keys` (`apiKey()`, `apiKeyScopeGuard`) and `billing-stripe` (`stripe()`) each add a second `plugin-array` patch with `exportName: "adminAuth"`, and the client plugins add a second patch to `adminAuthClientPlugins`. The patch kind needs no change, because the codemod already takes any `exportName`. |
| Routes that read the session directly | `billing/files/api/routes/billing.ts`, `entitlements/files/api/require-feature.ts` and `multitenant/files/auth/tenant.ts` call `auth.api.*`. They change to `authFor(c).api.*`, so that a call from the admin app reads the admin session. |
| Superadmin `x-organization-id` bypass | It needs an admin-audience session. A client-audience `superadmin` gets the existing 403 `headerDenial`. |
| Maintenance bypass | `sessionIsAdmin` in `feature-flags/files/api/lib/flags.ts` reads `adminAuth` and checks `ADMIN_ROLES`, not `ADMIN_ROLE` alone. |
| Auth client | `createClient(baseURL)` stays the client factory, with `authClientPlugins` and no `adminClient()`. A new `createAdminClient(baseURL)` uses `basePath: "/admin/auth"` and its own `adminAuthClientPlugins` patch point, which holds `adminClient()`. `apps/admin/src/lib/auth.ts` builds its client with `createAdminClient` and keeps the export name `auth`, so the module screens that import `auth` from `@admin/lib/auth` need no change. |
| Refusal page | `RootError` renders `AccessDenied` alone, centered on the login screen's card layout, with no `AppShell`. `AccessDenied` changes from a `div` to the page's `<main>`, because no shell gives it one. |
| Mockup | Waived by the owner on 2026-10-23. The refusal page reuses the login card that is already approved. No new visual element ships. |
| Impersonation | Out of scope. `adminAuth` refuses `/admin/impersonate-user` with 403 and the message "impersonation is not available between the client and admin sessions". Without that refusal the admin sign-in hook would fail the call with a wrong-credentials message. `auth` already refuses every `/admin/*` path. The skill gives the reason. |
| Session revocation | One user has one sessions table. A password change with `revokeOtherSessions`, or "revoke all sessions" on a user, ends the sessions of both audiences. The skill states this. |
| Upgrade safety | `plugin-array` gets an insert refusal that names a missing export, so `add` and `update` warn when `adminAuth` does not exist yet, in place of a silent no-op. The migration note gives the order: update `auth`, resolve the merge plan, then update each module that patches auth. |
| Tests | Pure rules (`decide` with audience, `rankDenial`, `ADMIN_APP_ROLES`, the audience header parse) get `node:test` files next to `authorize.ts`, run by `pnpm test:modules`. The api route test template `modules/auth/files/api/routes/auth.vitest.ts` gets the cross-audience cases and runs in a scaffolded project. A CLI integration test checks that `add` and `remove` of `teams`, `rbac`, `api-keys` and `billing-stripe` patch and unpatch both instances. A second CLI test runs the upgrade order on a project made with the old modules and checks the refusal warning. The production two-tab check is a manual step for the owner in the QA plan, because this box cannot deploy. No new runner. |
| ADR and glossary | ADR 0050 records the split. CONTEXT.md gets entries for *client session*, *admin session*, *admin-app role* and *rank guard*. |
| Migration note | The `auth` commit carries a `BREAKING CHANGE:` footer, which release-please copies to the changelog. |
| Issues and PR | One issue, linked to brainaloylabs/primeshopr#88, and one PR from `feat/separate-customer-staff-auth`. No comment on the primeshopr repo. |
| Outward actions | Approved on 2026-10-23: file the issue, push this branch, open the PR and link it to the thread. No merge. |

## Approach

The design is the primeshopr #88 design, adjusted for a framework. Both instances live in one file and share one config object. Each module patches both instances. A column and a plugin enforce the audience, and the role checks stay.

It reuses:

- the `plugin-array` codemod in `packages/cli/src/lib/patch/ts-module.ts`, unchanged, with `exportName: "adminAuth"`
- the `chained-route` patch on `base`, the same shape as `/auth`
- `withAuthScope` and the request-scoped `authDb` (ADR 0029), for both instances
- `decide` in `authorize.ts` as the one pure rule, with audience and rank added
- the login card in `modules/admin/files/src/routes/login.tsx` for the refusal page layout

Rejected: an instance only with `admin` (each auth patch would need an `onlyWith` twin, and `requireAdmin` would change source on add and on remove); per-instance signing keys in place of a column (shared encrypted data would break); waiting for #227 (the fault would stay in every new project until then).

### Phase 1: the refusal page without the shell (#238) (built 2026-10-23)

- `RootError` in `modules/admin/files/src/routes/__root.tsx` renders `AccessDenied` alone, on the login card layout. Update the comments that explain why the deny path sits inside the shell.
- `modules/admin/files/src/components/access-denied.tsx` becomes a full page with its own `<main>`, and its comment says why it drops the shell.
- `NotAdminError` keeps the session, because the panel names the signed-in email.
- This phase is its own `fix(admin):` commit, so it reverts alone.

Done when: in a `.dev` project with `auth` and `admin`, a seeded plain user who opens the admin app sees the refusal card with the sign-out button and no sidebar, header or user menu, in light and dark, at 1280px and 360px.

### Phase 2: two instances in the auth module (#238) (built 2026-10-23)

- Spike first: wrap the adapter, then prove with a route test that a copied token fails on `getSession`, on an `/admin/*` endpoint and inside a transaction. Stop and report if the transaction path skips the wrapper.
- `auth.ts`: `sharedOptions()`, `auth` and `adminAuth`, cookie prefixes, `disableSignUp` on `adminAuth`, the admin sign-in hook, and both `plugins` arrays.
- `scoped-adapter.ts`, `plugins/audience.ts`, `plugins/client-admin-guard.ts` (403 on `/auth/admin/*`) and `plugins/rank-guard.ts` (fail closed, with the impersonation refusal).
- `authorize.ts`: `ADMIN_APP_ROLES`, the audience in `decide`, `rankDenial()`, and the header parse. Tests beside it.
- `server.ts`: `authFor(c)`, `getSession` and `requireSession` by header, `requireAdminApp`, and the staff gates on `adminAuth`. Export `adminAuth`.
- `client.ts`: `createAdminClient` and `adminAuthClientPlugins`. `adminClient()` moves there.
- Both driver schemas get `sessions.audience`. Update the schema header comments and `schema-version.test.ts` if it reads them.
- `api/routes/auth.ts` exports `adminAuthRoute`. `registry-item.json` adds the `/admin/auth` `chained-route` patch.
- `auth.vitest.ts`: sign-in on both paths writes two cookies; a client cookie gets 401 from `requireAdmin` routes; an admin cookie with no header gets 401 from a client route; a plain user cannot sign in on `/admin/auth`; an `admin` cannot set a role on a `superadmin`; an `admin` gets 403 from an `/admin/*` path not on the known list; `/auth/admin/list-users` gets 403; a client token sent in the admin cookie gets 401.

Done when: `pnpm test:modules` passes, and in a `.dev` project with `auth` the route tests above pass and `pnpm db:generate` writes one migration that adds `audience` with default `'client'`.

### Phase 3: the admin app on the admin session (#238) (built 2026-10-23)

- `apps/admin/src/lib/auth.ts` builds `auth` with `createAdminClient` and checks `ADMIN_APP_ROLES`.
- `apps/admin/src/lib/api.ts` sends `x-auth-audience: admin` on every request.
- `admin-users.ts` calls `adminAuth.api.listUsers` and opens with `requireAdminApp` or `requireAdmin`, whichever the route needs.

Done when: in a `.dev` project with `auth` and `admin`, a client signed in through `/auth` and an admin signed in on the admin app stay signed in together in two tabs of one browser, and a sign-out in one tab leaves the other signed in.

### Phase 4: the modules that patch or read auth (#238) (built 2026-10-23)

- `teams`, `rbac`, `api-keys` and `billing-stripe` add the `adminAuth` and `adminAuthClientPlugins` patches.
- `billing`, `entitlements` and `multitenant` use `authFor(c)`. The `x-organization-id` bypass needs an admin-audience session.
- `feature-flags` reads the maintenance bypass from `adminAuth` with `ADMIN_ROLES`.
- A CLI integration test adds and removes each of the four patching modules and checks both `plugins` arrays.
- The `plugin-array` insert refusal for a missing export, and a CLI test of the upgrade order.

Done when: both CLI tests pass, and in a `.dev` project with every auth-dependent module installed, the teams, roles, keys, billing and payments screens of the admin app load for a seeded admin, and `pnpm check` passes.

### Phase 5: docs, ADR and the full gate (#238) (built 2026-10-23)

- ADR 0050 and the CONTEXT.md entries.
- Skills: `saasaloy-auth` (two instances, the header, the role lists, the `support` recipe, rank, impersonation limit, reserved path), `saasaloy-admin`, `saasaloy-api`, `saasaloy-teams`, `saasaloy-rbac`, `saasaloy-api-keys`, `saasaloy-multitenant`, `saasaloy-billing` and `saasaloy-billing-stripe`.
- The `auth` registry `envVars` text: the first-user warning names the client sign-up, and the cookie names.
- The `BREAKING CHANGE:` footer: the cookie rename ends every session; run `saasaloy update auth admin` and each module that patches auth, resolve `auth.ts` and the schema in the merge plan, then run `pnpm db:generate` and `pnpm db:migrate`.

Done when: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass in the repo, `pnpm check` passes in the `.dev` project from Phase 4, and the two-tab check of Phase 3 passes again on the final build.

## Migration and rollback

The plan adds one column. An existing project gets it through `saasaloy update auth`, which sends `@db/schema/auth.ts` to the merge plan. `pnpm db:generate` then writes an `alter table sessions add column audience text not null default 'client'` migration for each driver. Existing rows read as client sessions, but the cookie rename already ends them, so no row is used again. To roll back, revert the commits and write a migration that drops the column. Better Auth ignores an extra column, so the old code also runs with the column in place.

## Open questions

None. The grill settled every decision on 2026-10-23.

## Non-goals

- Impersonation across the two audiences.
- A `support` or `manager` role. The skill gives the recipe.
- Moving the teams, roles, keys and billing screens from `admin` to `app`. #227 owns that.
- Primeshopr-only parts: the phone login and the shop tables.
- A cookie domain change. `deriveCookieDomain` stays as it is, because the cookie names now separate the groups.
