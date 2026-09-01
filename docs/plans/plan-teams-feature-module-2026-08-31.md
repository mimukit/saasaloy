# Plan: teams feature module

Grilled: 2026-08-31

Tracks issue [#16](https://github.com/mimukit/saasaloy/issues/16), a child of #11 (Phase 2). The original blocker #12 (`auth`) and the later blocker #13 (`admin`) are both closed, so this is unblocked.

## Context

`saasaloy add teams` must give a generated project multi-tenant organizations backed by Better Auth's organization plugin. The build spec (`docs/plans/plan-saasaloy-build-spec-2026-07-21.md`, line 33 and line 61) names that plugin as a **feature module**, not part of the base, and names the plugin-array patch as the mechanism that installs it.

This is the first module to push into `modules/auth`'s plugin array. `modules/auth/files/src/auth.ts` was written for exactly this: its comment on `export const auth` says the module-scope `export const` shape exists so `billing`/`teams` can patch `plugins: [...]` with zero codemod changes. `billing` (#14) is not built yet, so `teams` is the first consumer and sets the pattern `billing` will copy. The grill found that the *client* half has no equivalent patch point, which is why Phase 0 exists.

Success means three things hold on a fresh project: `saasaloy add teams` pulls in `auth` and `admin` and applies cleanly, running it twice changes nothing the second time, and a site admin can create an org, copy its invitation ID, and switch the active org from the admin shell.

### Findings that reshaped this plan

The grill closed four questions with evidence rather than judgement. They are recorded here because each one deleted or added work.

- **No api route is needed.** `modules/auth/files/api/routes/auth.ts` mounts a catch-all `.on(["GET","POST"], "/*")` at `/auth`. Every organization endpoint already routes through it. No `chained-route` patch.
- **The client-side plugin array cannot be patched today.** `insertIntoPluginArray` reads `mod.exports[exportName].$args[0]` (`packages/cli/src/lib/patch/ts-module.ts:31-35`). In `modules/auth/files/src/client.ts` the `plugins: [adminClient()]` array sits inside the body of the exported *function* `createClient`, which has no `$args`. The codemod would hit `if (!callArg) return source` and silently change nothing. Phase 0 fixes the shape.
- **`apps/admin` is a hard site-admin gate.** `modules/admin/files/src/routes/__root.tsx` throws `NotAdminError` for any session without `user.role === "admin"`, before any child loader runs. A Teams screen there is site-admin-only by construction.
- **The auth schema snapshot is stale.** Commit `d63bb27` (a `deps:update` sweep) bumped `better-auth` to 1.7.2. `modules/auth/files/db/schema/auth.ts` has not changed since `589e485`, which predates it, so its header claim of 1.6.25 is unverified.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Plugin scope | Organizations, members, invitations, active-org switching. The plugin's nested `teams`-within-org sub-feature stays **off** (`teamSupport` false), so no `team`/`teamMember` tables and no `session.activeTeamId`. The module is still called `teams` because that is the product word; the glossary entry must say so. |
| Invitation delivery | Copy-ID. The admin UI labels and copies the returned `Invitation ID`. It tells the admin that a signed-in recipient application must call `auth.organization.acceptInvitation({ invitationId })`. `teams` declares **no** dependency on the `email` capability, so `saasaloy add teams` never forces a provider choice. A later `apps/web` issue adds the recipient page and can add `sendInvitationEmail` behind the email capability without changing this module's dependency graph. |
| Passing plugin options | `teams` drops `@auth/plugins/organization.ts`, which exports a zero-argument `organizationPlugin()` wrapping `organization({ ... })` with the options inline. The existing codemod calls `builders.functionCall(patch.call)` with no arguments, so this needs no CLI change, and the options land in a file the user can read and edit. |
| Client-side patch point (Q5) | Phase 0 reshapes `modules/auth/files/src/client.ts` to `export const authClientPlugins = definePlugins({ plugins: [adminClient()] })` at module scope, spread into `createClient`. This gives the existing codemod the `export const X = fn({ prop: [...] })` shape it requires, with no CLI change. `billing` reuses the same door. |
| `session.activeOrganizationId` | `modules/auth` pre-declares the column as nullable in `files/db/schema/auth.ts`, marked in a comment as the teams patch point. Same precedent as `admin()` shipping on by default so a session carries a role from the first sign-up. Cost is one unused nullable column when `teams` is absent. |
| Admin sidebar entry | A new `const-array` patch kind appends an object literal to a named `const` array in a TS/TSX file. `app-shell.tsx`'s own comment already frames the nav entry as the one manual step; every later admin-facing feature module needs this. |
| Idempotency key (Q3) | The descriptor names the identity property: `{ kind: "const-array", constName: "NAV_ITEMS", key: "to", entry: {...} }`. The codemod compares that one property across existing elements. Deep-equal was rejected because a user editing the label would make it stop matching and append a duplicate. |
| Screen audience (Q1) | Site-admin only. The existing root guard stands untouched. The end-user organization flow in `apps/web` is a separate issue. |
| Screen scope (Q8) | The screen lists the **caller's own memberships**, using `listOrganizations` and nothing else, titled "Your organizations". It is a first-org bootstrap tool, not an org browser. An all-orgs backoffice view needs its own api route and its own authorization argument, so it is out. |
| Invitation acceptance (Q6) | Out of scope for the UI. Issue #16's second acceptance criterion is rewritten to "a site admin can create an org, issue an invitation, and switch active org". QA drives `POST /auth/organization/accept-invitation` directly to prove the endpoint. The accept UI belongs to the `apps/web` follow-up. |
| Role model (Q2) | The plugin's `owner`/`admin`/`member` defaults, no `ac` statement set. `member.role` is a plain text column, so a fourth role later is an insert, not a migration. The wrapper file names `better-auth/plugins/organization/access` as the extension point. |
| Org slug (Q9) | Derived from the name by a slugify helper into an **editable** field, validated against `/organization/check-slug` on blur. The slug is required and globally unique, and nothing auto-generates it. |
| Version drift (Q4) | Re-verify the whole auth snapshot against `better-auth@1.7.2` inside Phase 2, in the same commit that adds `activeOrganizationId`. |
| Removal (Q7) | In scope, best-effort. Give `plugin-array` and `const-array` inverses in the `INVERSES` table (`packages/cli/src/lib/patch/index.ts`), so `remove teams` restores the auth plugin array and the sidebar. Delete the schema file. Add a generic `removeWarnings` string array to the registry descriptor and persist it by module name in the installed manifest. Print the stored warning before dry-run exit or confirmation. The `teams` warning names the surviving `organization`, `member`, and `invitation` tables and tells the user to review any drop migration before applying it. The CLI must not contain a `teams` branch. |

## Approach

A standard `saasaloy:feature` descriptor, `dependsOn: ["api", "database", "database-d1", "auth", "admin"]`. It reuses:

- **`plugin-array` patch kind** (`packages/cli/src/lib/patch/ts-module.ts`), already idempotent and proven by `email-console`, `email-cloudflare` and `sms-console`.
- **No new npm dependency.** `better-auth` is already a dependency of `packages/auth` and `apps/admin`; `better-auth/plugins/organization` and `better-auth/client/plugins` ship inside it.
- **The `@auth`, `@db` and `@admin` aliases**, registered by the `auth`, `database` and `admin` scaffolds. `applier.ts:353-373` collects scaffold aliases up front and persists them, so a later feature's `@admin/...` target resolves.
- **The hand-authored Drizzle snapshot convention** in `modules/auth/files/db/schema/auth.ts`: a column-for-column snapshot of the plugin's own schema, pinned to a stated `better-auth` version, never generated at `add` time.
- **The generated route tree.** `apps/admin` runs the TanStack Router vite plugin, so dropping `src/routes/teams.tsx` makes the screen reachable with no patch, and it inherits the root guard because it is a child route.
- **`defineEmail`'s precedent** for the `definePlugins` helper Phase 0 introduces: `modules/email/files/src/index.ts` already uses a `define*` call purely to give the codemod an array to push into, and documents it as such.

### Phase 0: give `packages/auth`'s client a patch point

Reshape `modules/auth/files/src/client.ts` so the plugin list is a module-scope `export const authClientPlugins = definePlugins({ plugins: [adminClient()] })`, and have `createClient` spread it into `createAuthClient`. Add the `definePlugins` helper next to it. Write the same load-bearing comment `auth.ts` carries above `export const auth`: this shape exists for the codemod, never hoist it, never omit the array. Confirm `apps/admin` still typechecks, since `AdminSession` is `typeof auth.$Infer.Session` and flows from this file.

### Phase 1: the `const-array` patch kind and removal warnings

Add it to `packages/cli/src/lib/patch/`, alongside `ts-module.ts`. It takes a file, a `constName`, a `key`, and an object literal to append, and it matches on the `key` property's value across existing elements. Wire it into the `Patch` union, `PATCH_KINDS`, the descriptor schema, and the no-op explanation table in `packages/cli/src/lib/patch/index.ts`. Add `INVERSES` entries for it and for `plugin-array`. Tests cover: append, second append is a no-op, no-op when the named const is absent, no-op when the user edited a non-key property, and output survives `prettier --check`.

Add an optional `removeWarnings` string array to the registry descriptor schema. Persist those strings as `manifest.removeWarnings[moduleName]` during add and refresh them after a clean update. The manifest loader supplies an empty map for old manifests. The removal plan reads the stored strings offline, prints them before dry-run exit or confirmation, and deletes the module entry only after successful removal. Add schema, manifest, applier, updater, remover, command-output, and backward-compatibility tests. Do not infer warning text from schema paths, and do not store it in the lock file.

### Phase 2: `modules/auth` schema work

Add `activeOrganizationId` to the session table as a nullable `text` column, commented as the teams patch point with a pointer to the plugin's schema block. In the same commit, re-verify the whole file column-for-column against `better-auth@1.7.2`'s `getAuthTables()` and the `admin` plugin's schema export, and correct the stale 1.6.25 header claim.

### Phase 3: the org schema file

Drop `files/db/schema/teams.ts` → `@db/schema/teams.ts`, a hand-authored snapshot of the organization plugin's three tables at `better-auth@1.7.2` with `teamSupport` off:

- `organization` — `id`, `name`, `slug` (unique), `logo`, `createdAt`, `metadata`
- `member` — `id`, `organizationId` → `organization.id`, `userId` → `user.id`, `role`, `createdAt`
- `invitation` — `id`, `organizationId` → `organization.id`, `email`, `role`, `status` (default `"pending"`), `expiresAt`, `createdAt`, `inviterId` → `user.id`

Follow the auth snapshot's conventions exactly: `timestamp_ms` for every date (never `timestamp`), the Drizzle *property* name is what the adapter matches, and indexes where the plugin marks `index: true` (`invitation.organizationId`, `invitation.email`).

### Phase 4: the plugin wrappers and the patches

Drop `files/auth/plugins/organization.ts` → `@auth/plugins/organization.ts`, exporting `organizationPlugin()`. Leave `sendInvitationEmail` unset, with a comment explaining the copy-ID decision and what to change once `email` is installed. Name `better-auth/plugins/organization/access` as the extension point for a custom role set. The descriptor declares the table-survival text in `removeWarnings`.

Two `plugin-array` patches:

- `packages/auth/src/auth.ts`, `exportName: "auth"`, `arrayProp: "plugins"`, `call: "organizationPlugin"`
- `packages/auth/src/client.ts`, `exportName: "authClientPlugins"`, `arrayProp: "plugins"`, `call: "organizationClient"`

The second depends on Phase 0 and is what types `session.activeOrganizationId` and exposes `auth.organization.*` to the admin SPA.

### Phase 5: the admin surface

Drop `files/admin/routes/teams.tsx` → `@admin/routes/teams.tsx` plus its components under `@admin/components/`. The screen covers exactly this:

- The caller's organizations from `listOrganizations`, with an active-org switcher calling `setActive`
- A create form with a name field and a slugified, editable slug field checked against `/organization/check-slug` on blur
- The active org's member list, with role, and remove
- An invite-by-email form that labels and copies the returned invitation ID, explains the recipient application call, and supports revoke

Then one `const-array` patch adding the `NAV_ITEMS` entry in `apps/admin/src/components/app-shell.tsx`.

### Phase 6: the module skill and the docs

Write `modules/teams/skills/saasaloy-teams/SKILL.md` in the shape the other module skills use. It must state that the screen is site-admin-only, it shows the caller's own memberships rather than every org, it copies an invitation ID, and it has no invitation-acceptance UI. Register the module wherever the registry index and the `wikikit` capability list live. Add the glossary entry separating the product word "team" from the plugin's off-by-default `teams` sub-feature.

### Phase 7: verify on a real project

In `.dev`, scaffold a project, run `saasaloy add teams` against a project with no `auth` and confirm the prerequisite resolves. Run it a second time and confirm a zero diff. Run `db:generate` and `db:migrate:local`. Then drive the flow: sign up, promote to admin, create an org, issue an invitation, copy its ID, accept it with a direct `POST /auth/organization/accept-invitation`, and switch the active org. Run `saasaloy remove teams` and confirm both patches reverse. Confirm the stored warning prints in normal and dry-run output before confirmation. Confirm the warning names the three surviving tables. Finish with the four-pass `pnpm lint` and `pnpm typecheck` on this repo and on the generated project.

### Rejected alternatives

- **Extend `plugin-array` to take arguments.** Puts plugin config inside descriptor JSON, where the user cannot comment or edit it, for something a wrapper file solves.
- **Teach the codemod to find an array inside a function body.** Avoids Phase 0, but widens a codemod whose current one-line contract is easy to reason about, and "the first array named `plugins`" is a much vaguer target than an export name.
- **Hard dependency on `email`.** Makes `saasaloy add teams` drag in a provider choice for a flow that works without one.
- **Ship a replacement `app-shell.tsx`.** Breaks the moment two feature modules both want a sidebar entry.
- **Relax the admin root guard for `/teams`.** Puts a hole in a gate whose entire design is default-deny.
- **List every org by querying `packages/db` directly.** Bypasses the plugin's authorization and needs an api route this module otherwise does not need.
- **Copy a future `apps/web` URL.** Every copied URL is broken until the recipient page ships.
- **Put invitation acceptance in `apps/admin`.** Normal recipients cannot pass the existing site-admin guard.
- **Hard-code a `teams` removal branch in the CLI.** It breaks the remote registry model and cannot support third-party modules.
- **Infer table warnings from schema paths.** A managed schema file does not prove which deployed tables survive.

## Open questions

None. The first grill closed the original nine questions. The issue grill on 2026-08-31 closed the invitation-output and removal-warning storage questions.

## Non-goals

- The plugin's nested `teams`-within-org sub-feature, and therefore `team`, `teamMember`, and `session.activeTeamId`.
- Any surface in `apps/web`, including the end-user organization flow and the invitation-acceptance page. Both belong to a follow-up issue.
- Sending invitation emails. No `email` capability dependency, no templates.
- An all-organizations backoffice browser. That needs its own api route and its own authorization argument.
- Per-org billing, seat counting, or any `billing` interaction. `billing` (#14) is not built.
- The general patch-reversal mechanism (#36). This plan adds two inverses to the existing table; it does not build the general system.
- Custom access-control statements or permission checks beyond what the plugin ships.

## Issue record

Issue #16 contains the corrected spec reference and acceptance criterion. The issue grill records two later decisions: the Teams screen copies an invitation ID instead of a URL, and the generic descriptor-to-manifest warning path supplies the removal warning. The issue comment is the tracker audit record. This plan remains the implementation source.
