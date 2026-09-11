# QA Plan: tenant scoping, RBAC and API keys

_Generated 2026-09-09 · against `865809a` · covers the `multitenant`, `rbac` and `api-keys` modules and the `auth`, `admin`, `database` and `teams` groundwork under them (issue #128)_

## Summary

- The three new modules scope every query to one organization, gate every write on a permission the caller holds, and let an organization issue bearer API keys that carry a fixed scope.
- Working means: no request reads another organization's rows, no member acts past their role, and every refusal renders as the api's one error envelope.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-128-add-tenant-scoping-rbac-and-api-keys`, commit `865809a`.
- The scaffolded project is `.dev/playground`. It runs on `database-d1`.
- The api base URL is `http://localhost:4000`. The admin SPA base URL is `http://localhost:4001`.
- Three accounts. The first sign-up becomes `superadmin`. Call it `u1`. The second and third are ordinary users, `u2` and `u3`.
- Two organizations. Call them A and B. `u1` and `u3` belong to A. `u2` belongs to B.
- No feature flag gates any of this. `saasaloy add api-keys` installs the whole chain.

Start the api on a clean database:

```sh
bash scripts/qa-tenant-scoping-serve.sh
```

Start the admin SPA in a second terminal:

```sh
pnpm -C .dev/playground/apps/admin dev --port 4001
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: signed in as the owner of organization A | The `/roles` grid reads correctly | 🔴 Critical |
| TC-1.2 | 1: signed in as the owner of organization A | A custom role is created, edited and deleted | 🔴 Critical |
| TC-1.3 | 1: signed in as the owner of organization A | The screen hides what the caller may not do | 🟡 Normal |
| TC-2.1 | 2: signed in as the owner of A, one role assigned | The `/api-keys` list reads correctly | 🔴 Critical |
| TC-2.2 | 2: signed in as the owner of A, one role assigned | A key is issued and the plaintext shows once | 🔴 Critical |
| TC-2.3 | 2: signed in as the owner of A, one role assigned | The scope picker offers no statement the caller lacks | 🟡 Normal |
| TC-2.4 | 2: signed in as the owner of A, one role assigned | Revoke removes the key from the list | 🟡 Normal |

## Scenario 1: signed in as the owner of organization A

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:4001` in the browser.
2. Sign in as `u1`.
3. Confirm the shell shows organization A as the active organization.
4. Open `http://localhost:4001/roles`.

- [ ] Setup complete

### TC-1.1: The `/roles` grid reads correctly · 🔴 Critical

**Goal.** The screen shows the active organization's roles as a resource-by-action grid, and the three base roles carry no edit or delete control.

**Steps**

1. Read the role list top to bottom.
   - [ ] Every role of organization A appears, and no role of organization B does
   - [ ] `owner`, `admin` and `member` render read-only, with no edit control and no delete control
     - the grid shows one row per resource and one column per action
     - a held action is marked; an unheld action is not
2. Open the member list on the same screen.
   - [ ] Each member of A shows with a role select
   - [ ] No member of B appears

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A custom role is created, edited and deleted · 🔴 Critical

**Goal.** An owner manages a custom role end to end, and the delete control refuses a role a member still holds.

**Steps**

1. Create a role named `auditor` holding `project: ["read"]`.
   - [ ] The new role appears in the grid with exactly that one action marked
2. Try to create a role named `admin`.
   - [ ] The screen refuses it, and the message names the base-role lock rather than a generic error
3. Edit `auditor` to add `apiKey: ["read"]`.
   - [ ] The grid marks both actions after the save
4. Assign `auditor` to `u3` through the member list.
   - [ ] The member row shows `auditor`
5. Try to delete `auditor`.
   - [ ] The delete control is disabled, and the screen names `u3` as a holder
6. Set `u3` back to `member`, then delete `auditor`.
   - [ ] The role leaves the grid

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The screen hides what the caller may not do · 🟡 Normal

**Goal.** The controls a caller's `can()` denies are absent, and the api refuses the same action anyway.

**Steps**

1. Sign out. Sign in as `u3`, who holds `member` in organization A.
2. Open `http://localhost:4001/roles`.
   - [ ] The grid renders, and the create control is absent
   - [ ] Every edit and delete control is absent
3. Read the member list.
   - [ ] The role select is absent or disabled

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** The hide is cosmetic. The api gates the same action with a 403, which the automated run already confirmed. _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
bash scripts/qa-tenant-scoping-serve.sh
```

## Scenario 2: signed in as the owner of A, one role assigned

**Setup.** Run once, for every case in this scenario.

1. Sign in as `u1` in the browser.
2. Confirm organization A is active.
3. Create a role `keymaker` on `/roles` holding `apiKey: ["create", "read"]` and `project: ["read"]`.
4. Open `http://localhost:4001/api-keys`.

- [ ] Setup complete

### TC-2.1: The `/api-keys` list reads correctly · 🔴 Critical

**Goal.** The list shows every column an operator needs to decide whether to revoke a key, and it shows only organization A's keys.

**Steps**

1. Read the list.
   - [ ] Each row carries the name, the `start` prefix, the expiry, the last-used time and the enabled state
   - [ ] No key of organization B appears
2. Read the screen's copy around the create form.
   - [ ] The screen states that a scope is fixed at issue time

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A key is issued and the plaintext shows once · 🔴 Critical

**Goal.** The create form returns the plaintext key one time, and the plaintext leaves the screen on navigation.

**Steps**

1. Create a key named `deploy` with the scope `project: ["read"]` and no expiry.
   - [ ] The screen shows the plaintext key in a copy box
   - [ ] The copy control puts the plaintext on the clipboard
2. Navigate to `/roles`, then back to `/api-keys`.
   - [ ] The copy box is gone, and the plaintext appears nowhere on the screen
3. Reload `/api-keys`.
   - [ ] The `deploy` row shows only the `start` prefix, never the full key

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The scope picker offers no statement the caller lacks · 🟡 Normal

**Goal.** A member may not mint a key holding more than they hold, and the screen never offers the option.

**Steps**

1. Sign out. Sign in as `u3`.
2. Assign `keymaker` to `u3` first if the setup has not. Use `u1` for that, then sign back in as `u3`.
3. Open `http://localhost:4001/api-keys` and open the create form.
   - [ ] The scope picker offers `apiKey: create`, `apiKey: read` and `project: read` only
   - [ ] It offers no `project: delete` and no `project: create`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** The api refuses an over-scoped create with 403 whatever the screen sends. The automated run confirmed that. _what actually happened on a fail; why it was skipped_

### TC-2.4: Revoke removes the key from the list · 🟡 Normal

**Goal.** Revoking a key takes it out of the list, and the key stops working.

**Steps**

1. Sign in as `u1`. Open `/api-keys`. Revoke the `deploy` key.
   - [ ] The row leaves the list without a reload
2. Call the api with the revoked key. Replace `<plaintext>` with the key from TC-2.2.

   ```sh
   curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer <plaintext>" http://localhost:4000/projects
   ```

   - [ ] The status is `401` and the body message is `invalid api key`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
bash scripts/qa-tenant-scoping-serve.sh
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. Transcribed from `.afkkit/verified.md`; nothing was re-run to write this document._

Commands run:

```sh
pnpm lint && pnpm typecheck && pnpm test
```

```sh
pnpm test:modules
```

```sh
bash scripts/qa-tenant-scoping-serve.sh && DRIVER=d1 bash scripts/qa-tenant-scoping.sh
```

```sh
node packages/cli/dist/index.js init .dev/pg --force --no-install && cp scripts/saasaloy-shim.sh .dev/pg/saasaloy && chmod +x .dev/pg/saasaloy
```

```sh
cd .dev/pg && ./saasaloy add database-postgres --yes && ./saasaloy add api-keys --yes && pnpm install && pnpm typecheck
```

```sh
cd .dev/playground && ./saasaloy remove api-keys --yes && ./saasaloy add api-keys --yes
```

Results:

- ✅ `pnpm lint` → all four passes clean: oxlint type-aware, oxlint plain, Stylelint, `prettier --check`.
- ✅ `pnpm typecheck` → `tsc --noEmit`, exit 0.
- ✅ `pnpm test` → `tests 82, fail 0`.
- ✅ `pnpm test:modules` → `tests 143, fail 0`, covering `tenant-rules.test.ts`, `rbac-rules.test.ts`, `server.test.ts` and `schema-version.test.ts`.
- ✅ `DRIVER=d1 bash scripts/qa-tenant-scoping.sh` → `d1: 49 passed, 0 failed`. This is the whole api-side acceptance list on `database-d1`.
- ✅ P1-1 the two site roles → `SUPERADMIN_ROLE` in `authorize.ts`, `adminRoles` on the admin plugin, `requireSuperadmin` in `server.ts`, the first-user hook writing `superadmin`.
- ✅ P1-2 the package export maps → `@repo/db` exports `./client ./schema/* ./repositories/* ./tenant ./tenant-column`; `@repo/auth` exports `./server ./client ./access ./tenant ./rbac ./rbac-rules`.
- ✅ P1-3 the `teams` groundwork → `BASE_ROLES`, `dynamicAccessControl`, `organizationClientPlugin`, and the `organizationRole` table in both dialects with its two indexes.
- ✅ P2-1, P2-2, P2-5 tenant resolution → `u1` and `u3` resolve to A; no active organization is `403 no active organization`; the body carries a principal.
- ✅ P2-3 the header contract → a superadmin crosses into B; a member sending the header is `403 forbidden`; a superadmin naming an organization that does not exist is `404 unknown organization`.
- ✅ P2-4 the resolver table → `tenantResolvers` takes `apiKeyTenant` through the `plugin-array` patch, and a remove takes it back out.
- ✅ P2-6 `TenantId` refuses the wrong input → `packages/db` typechecks with seven `@ts-expect-error` directives holding.
- ✅ P2-7 the tenant column convention → `member`, `invitation` and `organizationRole` carry `organization_id` with an index; `project` and `apikey` declare it through `tenantColumn()`.
- ✅ P2-8 tenant isolation on `/projects` → A sees its two rows, B sees its one.
- ✅ P3-1 to P3-3 the RBAC gates → `requireCan` refuses a member's delete and create with `permission required: project:delete`; `roleLockGuard` refuses `owner`, `admin` and `member` on create, update and delete; a custom name passes.
- ✅ P4-1 to P4-6 the API keys → the plaintext returns once and the row holds a 43-character base64url SHA-256; the scope round-trips; a revoked, disabled or expired key is `401 invalid api key`; a bearer request resolves the key's organization and gets `403` on a delete it lacks; `x-organization-id` beside a bearer is `403`.
- ✅ P5-1 the ADR 0029 isolate assertion → three bearer requests A, B, A into one live isolate each resolve their own tenant.
- ✅ P5-2 removal behaviour → `remove api-keys` reverses five patches and re-adding restores all four patched files byte-identical (`md5sum -c` OK); `remove multitenant` refuses while `rbac` is installed.
- ✅ P5-4 the docs → `CONTEXT.md` carries tenant, `TenantId`, principal, credential resolver, base role and custom role; the three modules appear in `modules/README.md` and `docs/wiki/modules.md`; follow-ups #140, #141 and #142 are filed and now linked both ways.
- ✅ The Postgres compile half → a fresh `database-postgres` project scaffolded into `.dev/pg`, and `packages/db` typechecked clean. This is the first time the `select` builder cast in `db/tenant.ts` compiled under the Postgres driver.
- ❌ The playground project typecheck fails on three errors that also fail on `origin/main`, so they are not from this branch: `packages/auth/src/auth.ts(53,22)` TS18046 `'authDb.select' is of type 'unknown'`, and `apps/api/src/index.ts(122,33)` and `(148,48)` TS2345 `Argument of type 'Bindings' is not assignable to parameter of type 'LoggerEnv'`.
- ❌ The playground lint stops on the same pre-existing set: `oxlint --type-aware packages/ui/src` reports `No files found to lint`, `lint:css` reports an `@apply` prelude error in the base template CSS, and `format:check` flags `apps/api/src/index.ts` and `packages/auth/src/auth.ts` from unchanged patch output.

## Not covered / needs human judgment

- The two screens in a browser. TC-1.1 to TC-2.4 above are exactly that gap; this box has no display and no browser driver.
- Anything on the Postgres **runtime**. The compile half ran; no Postgres container was started, so the Postgres run of the QA script and the Postgres tenant-isolation check are open.
- `saasaloy remove teams`, and the reversal of the two `teams` patches.
- The negative half of the `TenantId` typecheck, that deleting one `@ts-expect-error` line makes `tsc` fail.
- An expiry set through the api with a real future value and watched to lapse. The plugin refuses an `expiresIn` under its own minimum, so the expired-key check forced the column instead.
- The rate of `lastRequest` writes, and any concurrency past three sequential bearer calls.
- Compatibility, accessibility and performance. Nothing in this change adds a new layout primitive or a new data volume, so the two screens inherit the shell's existing behaviour. A tester with time should still run TC-1.1 by keyboard alone.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
