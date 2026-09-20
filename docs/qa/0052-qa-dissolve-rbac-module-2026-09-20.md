# QA Plan: dissolve the `rbac` module into `teams` and `multitenant`

_Generated 2026-09-20 · against `fe07e92` plus the uncommitted working tree · covers the module move, the `projects.ts` merge, the rename to `permission-rules` / `permissions` / `requirePermission`, and the new removal behaviour_

## Summary

- The `rbac` module is gone. `teams` now ships the permission rule and the base-role lock. `multitenant` now ships the permission gate, the `/roles` screen and the one copy of the `projects.ts` example.
- Working means a scaffolded project installs the same capability under the new owners, the permission gate still refuses a caller who lacks the permission, and no file or import names `rbac`.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-167-dissolve-rbac-into-teams-and-multitenant`.
- Work in this worktree. Do not run the plan in the main checkout.
- The playground is the app under test. The plan builds it from the registry in this worktree.
- The api runs at `http://localhost:8787`. The admin app runs at `http://localhost:5173`.
- No account and no secret are needed. The plan uses the D1 driver and a local SQLite file.

Set the base URL once. Every request below uses it.

```sh
export BASE_URL=http://localhost:8787
```

Set the database client once. Every query below runs through it.

```sh
export DB_CMD='pnpm --filter @repo/db exec drizzle-kit'
```

Build the CLI and create an empty playground:

```sh
pnpm run play:init
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|----------|-----------|----------|
| TC-1.1 | 1: fresh playground, `teams` only | The lock ships with the switch that needs it | 🔴 Critical |
| TC-1.2 | 1: fresh playground, `teams` only | Better Auth refuses a base role name end to end | 🔴 Critical |
| TC-2.1 | 2: playground with `multitenant` and `api-keys` | The gated `projects.ts` is the only copy | 🔴 Critical |
| TC-2.2 | 2: playground with `multitenant` and `api-keys` | A member without `project:create` gets 403 | 🔴 Critical |
| TC-2.3 | 2: playground with `multitenant` and `api-keys` | The `/roles` screen loads and lists the base roles | 🟡 Normal |
| TC-2.4 | 2: playground with `multitenant` and `api-keys` | A custom role takes effect on the next request | 🟡 Normal |
| TC-3.1 | 3: installed playground, about to remove | Removing `multitenant` leaves `teams` compiling | 🟡 Normal |
| TC-3.2 | 3: installed playground, about to remove | `saasaloy update rbac` fails with the intended error | 🟢 Low |

## Scenario 1: fresh playground, `teams` only

This scenario proves fault 1 of the plan is closed. A project with `teams` and no other tenancy module must get the base-role lock.

**Setup.** Run once, for every case in this scenario.

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add teams --yes
```

```sh
pnpm install && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
```

- [ ] Setup complete

### TC-1.1: The lock ships with the switch that needs it · 🔴 Critical

**Goal.** A `teams`-only project holds the guard that `dynamicAccessControl` needs.

**Steps**

1. Open `.dev/playground/packages/auth/src/auth.ts`.
   - [ ] The `plugins` array holds both `organizationPlugin()` and `roleLockGuard()`
   - [ ] The file imports `roleLockGuard` from `./plugins/role-lock`
2. List the auth source files.

   ```sh
   ls .dev/playground/packages/auth/src .dev/playground/packages/auth/src/plugins
   ```

   - [ ] `permission-rules.ts` and `plugins/role-lock.ts` are both present
   - [ ] No file is named `rbac.ts`, `rbac-rules.ts` or `permissions.ts`
3. Read `.dev/playground/packages/auth/package.json`.
   - [ ] The `exports` map declares `./permission-rules` and `./permissions`
   - [ ] The `//exports` comment names `teams` and `multitenant` as the fillers, and never `rbac`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Better Auth refuses a base role name end to end · 🔴 Critical

**Goal.** A stored role row named `admin` cannot be created, so the static `admin` cannot widen in silence.

**Steps**

1. Start the api and the admin app.

   ```sh
   pnpm dev
   ```

2. Open `http://localhost:5173` in a browser. Sign up with a new email and password.
   - [ ] The sign-up succeeds and the admin app loads
3. Open `/teams`. Create an organization named `QA Org`.
   - [ ] The organization appears in the list and becomes the active organization
4. Create a role named `admin` through the api.

   ```sh
   curl -i -X POST "$BASE_URL/api/auth/organization/create-role" -H 'content-type: application/json' -b cookies.txt -d '{"role":"admin","permission":{"project":["read"]}}'
   ```

   - [ ] The response status is 403
   - [ ] The body names the lock, with the message `base role is locked: admin`
5. Repeat step 4 with the role name `viewer`.
   - [ ] The response status is 200 and the role is created

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _use the browser devtools network tab to copy the session cookie into `cookies.txt` before step 4_

**Reset.** Run after every case above, before moving to Scenario 2. This scenario continues into Scenario 2, so run the reset only if you stop here.

```sh
pnpm run play:destroy
```

## Scenario 2: playground with `multitenant` and `api-keys`

This scenario continues from Scenario 1's playground. It proves faults 2, 3 and 4 of the plan are closed.

**Setup.** Run once, for every case in this scenario.

```sh
cd .dev/playground && ./saasaloy add multitenant --yes && ./saasaloy add api-keys --yes
```

```sh
pnpm install && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
```

- [ ] Setup complete

### TC-2.1: The gated `projects.ts` is the only copy · 🔴 Critical

**Goal.** One module owns `apps/api/src/routes/projects.ts`, and that copy carries the permission gate.

**Steps**

1. Read `.dev/playground/apps/api/src/routes/projects.ts`.
   - [ ] `POST /` and `DELETE /:id` both call `requirePermission`
   - [ ] `GET /` still calls `requireTenant`
   - [ ] The header comment carries the recipe and the read-stays-on-`requireTenant` note
   - [ ] The header comment says nothing about an overwrite or about running `saasaloy add multitenant` to repair the file
2. Read `.dev/playground/.saasaloy/manifest.json`.
   - [ ] `apps/api/src/routes/projects.ts` is recorded once, owned by `multitenant`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A member without `project:create` gets 403 · 🔴 Critical

**Goal.** The gate refuses a caller whose role lacks the demanded permission, and it names only the missing pair.

**Steps**

1. Start the api and the admin app.

   ```sh
   pnpm dev
   ```

2. Sign in as the owner of `QA Org`. Create a project.

   ```sh
   curl -i -X POST "$BASE_URL/projects" -H 'content-type: application/json' -b cookies.txt -d '{"name":"QA Project"}'
   ```

   - [ ] The response status is 201 and the body carries the project and its `organizationId`
3. Open `/roles`. Create a role named `reader` that holds `project: ["read"]` only.
4. Invite a second user into `QA Org`. Accept the invitation. Assign the second user the `reader` role.
   - [ ] The member list shows the second user holding `reader`
5. Sign in as the second user. Repeat the request in step 2 with that user's cookie.
   - [ ] The response status is 403
   - [ ] The body message is `permission required: project:create`
   - [ ] The body names no other permission the route wants
6. List the projects as the second user.

   ```sh
   curl -i "$BASE_URL/projects" -b cookies.txt
   ```

   - [ ] The response status is 200 and the list holds `QA Project`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The `/roles` screen loads and lists the base roles · 🟡 Normal

**Goal.** The screen ships from `multitenant`, and the `GET /tenant` endpoint it calls is mounted in the same project.

**Steps**

1. Open `http://localhost:5173/roles` as the owner of `QA Org`.
   - [ ] The screen renders, with no 404 and no error panel
   - [ ] The base roles `owner`, `admin` and `member` are listed
   - [ ] Each base role carries no edit control and no delete control
   - [ ] The permission grid shows a column for every resource in `access.ts`, including `project` and `apiKey`
2. Read the browser devtools network tab for the page load.
   - [ ] `GET /tenant` answers 200
   - [ ] The page makes exactly one `GET /tenant` request
3. Select the custom role `viewer` created in TC-1.2.
   - [ ] The edit control and the delete control are both enabled, because nobody holds the role

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: A custom role takes effect on the next request · 🟡 Normal

**Goal.** The one `organization_roles` query still resolves a stored role onto the principal after the move.

**Steps**

1. On `/roles`, widen the `reader` role to hold `project: ["read", "create"]`. Save.
   - [ ] The screen shows the widened permission map
2. As the second user, repeat the create request from TC-2.2 step 2.
   - [ ] The response status is 201
3. On `/roles`, try to delete the `reader` role while the second user holds it.
   - [ ] The delete control is disabled
   - [ ] The screen names the second user as a holder

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3. Scenario 3 continues from this state, so run the reset only if you stop here.

```sh
pnpm run play:destroy
```

## Scenario 3: installed playground, about to remove

This scenario continues from Scenario 2's playground. Stop `pnpm dev` first.

**Setup.** Run once, for every case in this scenario.

```sh
cd .dev/playground && ./saasaloy remove api-keys --yes
```

- [ ] Setup complete

### TC-3.1: Removing `multitenant` leaves `teams` compiling · 🟡 Normal

**Goal.** A project that keeps `teams` and drops `multitenant` strands no `@repo/auth/permissions` import.

**Steps**

1. Remove `multitenant` and read the prompt before you confirm.

   ```sh
   cd .dev/playground && ./saasaloy remove multitenant
   ```

   - [ ] One warning names `requireTenant`, `forTenant` and `requirePermission` in the same sentence
   - [ ] No warning mentions `saasaloy add multitenant` as a repair
2. Confirm the removal.
   - [ ] The command deletes `packages/auth/src/permissions.ts`, `apps/admin/src/routes/roles.tsx` and `apps/api/src/routes/projects.ts`
   - [ ] The command leaves `packages/auth/src/permission-rules.ts` and `packages/auth/src/plugins/role-lock.ts` in place
3. Rebuild the admin route tree, then typecheck.

   ```sh
   cd .dev/playground/apps/admin && pnpm exec vite build && cd ../.. && pnpm typecheck --force
   ```

   - [ ] The typecheck passes with no error
4. Remove `teams` and read the prompt before you confirm.

   ```sh
   cd .dev/playground && ./saasaloy remove teams
   ```

   - [ ] One warning names the surviving tables, including `organization_roles`
   - [ ] A second warning names the surviving custom roles and `permission-rules.ts`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: `saasaloy update rbac` fails with the intended error · 🟢 Low

**Goal.** The retired module name answers with a clear error rather than a crash.

**Steps**

1. Ask the CLI to update the retired module.

   ```sh
   cd .dev/playground && ./saasaloy update rbac
   ```

   - [ ] The command fails with `Unknown module "rbac"`
   - [ ] The command prints no stack trace
2. List the modules the registry offers.

   ```sh
   cd .dev/playground && ./saasaloy list
   ```

   - [ ] `rbac` is absent from the list
   - [ ] `teams` and `multitenant` are both present

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd /home/dev/worktrees/saasaloy/issue-167-dissolve-rbac-into-teams-and-multitenant && pnpm run play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm typecheck
```

```sh
pnpm run play:init && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add teams --yes && ./saasaloy add multitenant --yes && ./saasaloy add api-keys --yes && pnpm install && pnpm typecheck
```

```sh
grep -rn "rbac\|requireCan" modules/ README.md docs/wiki/
```

- ✅ `pnpm lint` → four passes green: oxlint type-aware, oxlint plain, stylelint, prettier.
- ✅ `pnpm test` → 55 test files, 1287 vitest tests, 160 node tests. All pass. The moved `permission-rules.test.ts` runs in its new home under `test:modules`.
- ✅ `pnpm typecheck` → clean, including `tsconfig.scripts.json`.
- ✅ Playground install of `teams` + `multitenant` + `api-keys` → typechecks clean across all seven workspaces.
- ✅ `teams` alone → `roleLockGuard()` lands in the `plugins` array of `packages/auth/src/auth.ts`, and `permission-rules.ts` plus `plugins/role-lock.ts` land in `packages/auth/src`.
- ✅ `saasaloy remove multitenant` refused while `api-keys` was installed, which proves the new `api-keys` → `multitenant` edge.
- ✅ `saasaloy remove multitenant` from a project keeping `teams` → no stranded `@repo/auth/permissions` import, and the project still typechecks.
- ✅ `saasaloy remove teams` → both warnings print, including the custom-role warning that moved over from `rbac`.
- ✅ `grep` for `rbac` and `requireCan` over `modules/`, `README.md` and `docs/wiki/` → no match.
- ✅ Better Auth `1.7.3` source read → `createRole` and `updateRole` call `checkIfRoleNameIsTakenByPreDefinedRole`, and `deleteRole` answers `CANNOT_DELETE_A_PRE_DEFINED_ROLE`. The library refuses a base role name on its own, so `roleLockGuard()` is defence in depth. The answer is recorded in `modules/teams/skills/saasaloy-teams/SKILL.md`.

## Not covered / needs human judgment

- **The nav entry for `/roles` does not appear.** The admin template exports `NAV_AREAS`, and the `const-array` patch targets `NAV_ITEMS`. The patch is a no-op. This predates the change: the `/teams` and `/api-keys` entries are missing the same way on `main`. The screen still loads at its URL. File it separately.
- **The browser cases.** No browser runs on the build box, so TC-1.2, TC-2.2, TC-2.3 and TC-2.4 need a human at a real browser.
- **The Postgres driver.** Every case runs on `database-d1`. The `teams` and `projects` schemas ship in two dialects, and this change edits only a comment in each. A Postgres pass is optional.
- **Deployment.** No case deploys a Worker. The change edits no binding and no env var.
- **Accessibility and compatibility.** The `/roles` screen moved between modules with no markup change, so its keyboard order, contrast and responsive layout are unchanged. Skipped on that ground.
- **Performance.** The change moves files. It adds no query and removes none.
- **An upgrade from an existing install.** The release note tells an existing project to run `saasaloy remove rbac`, then `saasaloy add multitenant`. Testing it needs a project scaffolded from a published release, which this worktree cannot produce.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
