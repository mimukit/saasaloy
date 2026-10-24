# QA Plan: Admin route tree stays current after add

_Generated 2026-10-24 · against `d52cb0bb` (clean), rebased with no code change onto the docs-only `53e9d332` as `d79c9de3` · covers issue #220: `tsr generate` before admin `tsc`, and the multitenant type test fix_

## Summary
- A module that adds an admin route no longer breaks `pnpm typecheck` before Vite has run.
- Working means a fresh project with `admin` and the route-adding modules passes every typecheck, and a failed loader still shows its message.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-220-keep-a-scaffolded-projects-typecheck-green-after` at `d52cb0bb`.
- The scaffold lives in `.dev/r220` inside the worktree. The api is not running, on purpose.
- The browser mock for the api is in `/tmp/qakit/0079-qa-admin-route-tree-typecheck-2026-10-24/mock-api.js`.

Build the CLI and set the registry, from the worktree root:

```sh
pnpm --filter saasaloy build && export SAASALOY_REGISTRY_DIR=$PWD/modules
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Scaffold with admin and the route-adding modules | The admin error screens read correctly | 🟡 Normal |

## Scenario 1: Scaffold with admin and the route-adding modules

**Setup.** Run once, for every case in this scenario.

1. Scaffold the project, from the worktree root.

```sh
node packages/cli/dist/index.js init .dev/r220 --no-install --no-git && cd .dev/r220 && node ../../packages/cli/dist/index.js add database-d1 admin billing feature-flags api-keys teams --with api-keys-organization --yes && pnpm install
```

2. Write the admin env file, then start the admin app.

```sh
echo 'PUBLIC_API_URL=http://localhost:4000' > apps/admin/.env && pnpm --filter @repo/admin dev
```

- [ ] Setup complete

### TC-1.1: The admin error screens read correctly  ·  🟡 Normal

**Goal.** A failed loader shows a clear screen that names the cause and the message.

**Steps**

1. Look at the screenshots that the agent took with the api mocked to answer 500.
   - [ ] Each error screen reads clearly, with the title, the cause, the message and the retry button in a sensible order
     - overview: "The api did not answer", then "The api answered 500."
     - users: "The user list did not load", then "The api answered 500."
     - teams: "Teams did not load", then "qa: forced failure"
     - screenshot: `/tmp/qakit/0079-qa-admin-route-tree-typecheck-2026-10-24/overview-error-1440.png` light 1440 px
     - screenshot: `/tmp/qakit/0079-qa-admin-route-tree-typecheck-2026-10-24/users-error-1440.png` light 1440 px
     - screenshot: `/tmp/qakit/0079-qa-admin-route-tree-typecheck-2026-10-24/users-error-375.png` light 375 px
     - screenshot: `/tmp/qakit/0079-qa-admin-route-tree-typecheck-2026-10-24/teams-error-1440.png` light 1440 px
2. Optional: start the api with a seeded admin account, sign in, then stop the api and click a nav entry.
   - [ ] The real failure shows the same screen as the screenshots

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above. Stop the dev server with Ctrl-C, then remove the scaffold from the worktree root.

```sh
rm -rf .dev/r220
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm verify:content && pnpm verify:pins
```

```sh
node packages/cli/dist/index.js init .dev/r220 --no-install --no-git && cd .dev/r220 && node ../../packages/cli/dist/index.js add database-d1 admin --yes && pnpm install && pnpm --filter @repo/admin typecheck
```

```sh
diff -q apps/admin/src/routeTree.gen.ts ../../modules/admin/files/src/routeTree.gen.ts
```

```sh
node ../../packages/cli/dist/index.js add billing feature-flags api-keys teams --with api-keys-organization --yes && pnpm install && pnpm --filter @repo/admin typecheck
```

```sh
pnpm typecheck
```

- ✅ Repo gate at `d52cb0bb` → `lint`, `typecheck`, `test`, `verify:content` and `verify:pins` all exit 0.
- ✅ C1 · `database-d1` + `admin` → `pnpm --filter @repo/admin typecheck` exits 0 (`tsr generate && tsc --noEmit`).
- ✅ `tsr generate` on that project writes `routeTree.gen.ts` byte for byte the same as the committed file, so the plugin and the CLI agree on style.
- ✅ C2 · plus `billing feature-flags api-keys teams`, no `vite` command run → admin typecheck exits 0. On `e3501d6`, without this branch, the same check failed with 5 × `TS2345` on the module routes.
- ✅ C3 · root `pnpm typecheck` in that project → 16 of 16 tasks pass, `@repo/db` included (the multitenant type test).

### Browser checks
_Driven with `playwright-cli` against `http://localhost:3001` at `d52cb0bb`, with `mock-api.js`: `get-session` returns an admin session, every other `http://localhost:4000` call returns 500. Screenshots in `/tmp/qakit/0079-qa-admin-route-tree-typecheck-2026-10-24/`._

- ✅ `/` with the api stopped and no mock → redirects to `/login?redirect=%2F`, the sign-in form renders.
- ✅ `/` · overview error screen → shows "The api answered 500."
- ✅ `/users` · users error screen → shows "The api answered 500."
- ✅ `/billing` · billing error screen → shows "The api answered 500."
- ✅ `/teams` · teams error screen → shows "qa: forced failure" (the Better Auth `message` field).
- ✅ Sidebar → lists Billing, Flags, Teams, Roles and API keys, so the generated route tree reaches the browser.
- ✅ `/users` at 375 px → message present, no horizontal overflow.

## Not covered / needs human judgment
- The `release:smoke` full-scaffold typecheck is out of scope since grill Q10. #268 carries it.
- The `full-database-postgres` scaffold was not run here. #268 covers it.
- A real api failure with a signed-in admin. The browser checks use a mocked api. TC-1.1 step 2 covers it as optional.
- Dark mode. This branch changes no UI, so the error screens are as on `main`.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
