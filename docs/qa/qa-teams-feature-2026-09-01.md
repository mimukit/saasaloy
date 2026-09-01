# QA Plan: teams feature module

_Generated 2026-09-01 · against `c32907f` · covers issue #16: the `teams` feature module, its Better Auth organization setup, its admin Teams screen, and its remove warning behavior_

## Summary

- `saasaloy add teams` installs the organization feature on top of `auth`, `admin`, `api`, `database`, and `database-d1`.
- "Working" means an admin can open `/teams`, create an organization, copy an Invitation ID, switch the active organization, and manage invitations and members.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-16-teams-feature`, at commit `c32907f`.
- Machine: use a workstation with a graphical browser.
- Test project: `.dev/teams-gate`.
- Admin app URL: `http://localhost:3001`.
- API URL: `http://localhost:4000`.
- Admin account: `qa-teams-admin@example.com`.
- Password: `TestPassword123!`.
- Term used in this plan: the organization is the Better Auth organization shown by the Teams screen.

Start the API Worker in one terminal.

```sh
pnpm -C .dev/teams-gate --filter @repo/api dev
```

Start the admin app in a second terminal.

```sh
pnpm -C .dev/teams-gate --filter @repo/admin dev
```

Create the QA account. Continue if the response says the account already exists.

```sh
curl -sS -c /tmp/qa-teams-admin.cookies -H 'content-type: application/json' -H 'origin: http://localhost:3001' -d '{"name":"QA Teams Admin","email":"qa-teams-admin@example.com","password":"TestPassword123!"}' http://localhost:4000/auth/sign-up/email
```

Promote the QA account to site admin.

```sh
pnpm -C .dev/teams-gate --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "UPDATE user SET role = 'admin' WHERE email = 'qa-teams-admin@example.com'; SELECT email, role FROM user WHERE email = 'qa-teams-admin@example.com';"
```

- [ ] Environment ready: the API answers, the admin app loads, and the QA account has role `admin`

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: admin signed in, no active organization required | The Teams route loads in the admin shell | 🔴 Critical |
| TC-1.2 | 1: admin signed in, no active organization required | The create form handles a valid and a duplicate slug | 🔴 Critical |
| TC-1.3 | 1: admin signed in, no active organization required | The active organization switcher changes the workspace | 🔴 Critical |
| TC-2.1 | 2: active organization selected | The invite form exposes a copyable Invitation ID | 🔴 Critical |
| TC-2.2 | 2: active organization selected | Invitation revoke and member removal update the lists | 🟡 Normal |
| TC-3.1 | 3: browser-only screen check | The Teams screen stays usable across width, keyboard, and colour modes | 🟡 Normal |

## Scenario 1: admin signed in, no active organization required

**Setup.** Run once, for every case in this scenario.

1. Open a private browser window.
2. Go to `http://localhost:3001/login`.
3. Sign in with `qa-teams-admin@example.com` and `TestPassword123!`.

- [ ] Setup complete: the admin shell appears with the sidebar

### TC-1.1: The Teams route loads in the admin shell · 🔴 Critical

**Goal.** The admin can reach the Teams screen from the generated sidebar.

**Steps**

1. Read the sidebar.
   - [ ] The sidebar has a `Teams` entry.
2. Click `Teams`.
   - [ ] The address bar shows `http://localhost:3001/teams`.
   - [ ] The screen title reads `Teams`.
   - [ ] The page shows `Your organizations` and `Create an organization`.
3. Press F5.
   - [ ] The Teams screen loads again without returning to login.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The create form handles a valid and a duplicate slug · 🔴 Critical

**Goal.** The admin can create an organization, and the form blocks a slug already in use.

**Steps**

1. Enter `QA Teams Alpha` in the Name field.
   - [ ] The Slug field becomes `qa-teams-alpha`.
2. Leave the Slug field.
   - [ ] The slug status says the slug is available.
3. Click `Create organization`.
   - [ ] The form clears.
   - [ ] `QA Teams Alpha` appears in `Your organizations`.
4. Enter `QA Teams Duplicate` in the Name field.
5. Replace the Slug value with `qa-teams-alpha`.
6. Leave the Slug field.
   - [ ] The slug status says the slug is in use.
   - [ ] The create button does not create a second organization with that slug.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The active organization switcher changes the workspace · 🔴 Critical

**Goal.** The admin can select the organization that member and invitation actions use.

**Steps**

1. Create a second organization named `QA Teams Beta` with slug `qa-teams-beta`.
   - [ ] Both organizations appear in `Your organizations`.
2. Click `Use organization` for `QA Teams Alpha`.
   - [ ] The Alpha row shows `Active`.
   - [ ] The Members card names `QA Teams Alpha`.
3. Click `Use organization` for `QA Teams Beta`.
   - [ ] The Beta row shows `Active`.
   - [ ] The Members card names `QA Teams Beta`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Keep one organization active before Scenario 2.

## Scenario 2: active organization selected

**Setup.** Run once, for every case in this scenario.

1. Stay signed in as `qa-teams-admin@example.com`.
2. Open `http://localhost:3001/teams`.
3. Select `QA Teams Alpha` as the active organization.

- [ ] Setup complete: the Members and Invitations cards are visible

### TC-2.1: The invite form exposes a copyable Invitation ID · 🔴 Critical

**Goal.** The admin can issue an invitation and copy the returned Invitation ID.

**Steps**

1. Enter `qa-teams-member@example.com` in the invitation Email field.
2. Click `Issue invitation`.
   - [ ] The page shows a section titled `Invitation ID`.
   - [ ] The section shows a non-empty ID value.
   - [ ] The helper text names `auth.organization.acceptInvitation({ invitationId })`.
3. Click `Copy invitation ID`.
   - [ ] The page says `Invitation ID copied.`
4. Paste into a temporary editor field.
   - [ ] The pasted value exactly matches the ID shown on the screen.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: Invitation revoke and member removal update the lists · 🟡 Normal

**Goal.** The admin can cancel a pending invitation and remove a member from the active organization.

**Steps**

1. In the pending invitation list, find `qa-teams-member@example.com`.
   - [ ] The row shows role `member` and status `pending`.
2. Click `Revoke`.
   - [ ] The row changes to a confirmation state.
3. Click `Confirm revoke`.
   - [ ] The invitation disappears from the pending invitation list.
4. Read the Members list.
   - [ ] The current admin account appears with an owner or admin role.
5. If a removable test member exists, click `Remove` for that member.
   - [ ] The row changes to a confirmation state.
6. Click `Keep member`.
   - [ ] The row returns to its normal state.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Sign out before Scenario 3 if you want to test the login path again.

## Scenario 3: browser-only screen check

**Setup.** Run once, for every case in this scenario.

1. Sign in as `qa-teams-admin@example.com`.
2. Open `http://localhost:3001/teams`.

- [ ] Setup complete: the Teams screen is visible

### TC-3.1: The Teams screen stays usable across width, keyboard, and colour modes · 🟡 Normal

**Goal.** The screen remains readable and operable in the browser states a human must judge.

**Steps**

1. Resize the browser to a mobile width near 390 px.
   - [ ] No text overlaps another control.
   - [ ] The create, switch, invite, revoke, and remove controls remain reachable.
2. Resize the browser to a desktop width near 1280 px.
   - [ ] The organization list and create form use the two-column layout.
   - [ ] The cards keep readable spacing.
3. Use Tab from the address bar through the Teams screen.
   - [ ] Focus reaches each input and button in a logical order.
   - [ ] Each focused control has a visible focus style.
4. Switch the operating system or browser to dark mode if the app follows it.
   - [ ] Text remains legible on the page, the cards, and the button states.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification by AI agent

Checks the agent ran itself. No action needed from the tester.

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm deps:check
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/patch/index.test.ts src/lib/patch/const-array.test.ts src/lib/schema.test.ts src/lib/teams-module.test.ts src/commands/remove.test.ts
```

```sh
SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-16-teams-feature/modules node /home/dev/worktrees/saasaloy/issue-16-teams-feature/packages/cli/dist/index.js add teams --yes --force
```

```sh
SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-16-teams-feature/modules node /home/dev/worktrees/saasaloy/issue-16-teams-feature/packages/cli/dist/index.js remove teams --dry-run
```

```sh
SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-16-teams-feature/modules node /home/dev/worktrees/saasaloy/issue-16-teams-feature/packages/cli/dist/index.js remove teams --yes
```

- ✅ `pnpm test` passed with 31 CLI test files, 546 CLI tests, and 37 module tests.
- ✅ `pnpm lint` passed in the repository.
- ✅ `pnpm typecheck` passed in the repository.
- ❌ `pnpm deps:check` failed with 19 pending dependency updates. The conductor confirmed the same failure on `main`.
- ✅ The focused patch and teams tests passed with 5 files and 51 tests.
- ✅ A forced second `add teams` changed no target files, manifest records, or lock records.
- ✅ `remove teams --dry-run` printed both plugin-array reversals, the const-array reversal, and the table-survival warning.
- ✅ `remove teams --yes` deleted the teams-owned files, reverted both plugin arrays, reverted the navigation patch, and left the local D1 organization tables present.
- ✅ API probes created an organization, issued an invitation, accepted the invitation by ID, set the active organization, listed organizations, canceled an invitation, removed a member, and rejected an active-organization switch for a removed member.

## Not covered / needs human judgment

- The browser flow for `/teams` needs a human with a graphical browser.
- The plan does not test production D1 or a deployed Worker.
- The plan does not test email delivery because the feature deliberately sends no invitation email.
- The plan does not test the future recipient page in `apps/web`.
- The plan does not test concurrency beyond the UI double-confirm controls.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
