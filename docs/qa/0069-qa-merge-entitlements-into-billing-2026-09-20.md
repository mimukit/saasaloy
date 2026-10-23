# QA Plan: merge `entitlements` into `billing`

_Generated 2026-09-20 · against `fe07e92c633f669870f7d01269b38598494cdafc` · covers the `entitlements` module merge, the "plan feature" rename, and the `validators` and `modules/README.md` cleanups_

## Summary

- The `entitlements` module is gone. `billing` now ships `packages/billing/src/entitlements.ts`, `apps/api/src/middleware/require-feature.ts`, and one merged skill.
- Working means a project installs `billing` alone and still gets the plan resolver, the 402 gate and the runbook, and an existing project that already holds `entitlements` can reach the same state.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-165-merge-entitlements-into-billing`.
- Repository root: `/home/dev/worktrees/saasaloy/issue-165-merge-entitlements-into-billing`.
- The registry is this repository. `SAASALOY_REGISTRY_DIR` points the CLI at a checkout.
- Ports: web 3000, admin 3001, api 4000.
- No database client is needed. The change adds no table, no column and no migration.

Set the repository root once. Every block below runs through it.

```sh
export REPO=/home/dev/worktrees/saasaloy/issue-165-merge-entitlements-into-billing
```

Build the CLI and create the playground.

```sh
cd "$REPO" && pnpm play:init
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1: fresh playground, nothing installed | `saasaloy add billing` lands the entitlement files and the merged skill | 🔴 Critical |
| TC-1.2 | 1: fresh playground, nothing installed | The merged `saasaloy-billing` skill reads as one runbook | 🟡 Normal |
| TC-1.3 | 1: fresh playground, nothing installed | `saasaloy add validators` still leaves `zod` and `@hono/zod-validator` in `apps/api` | 🟡 Normal |
| TC-2.1 | 2: playground on `billing` + `billing-console`, app running | A free-plan user meets 402 on a gated route, and a Pro subscription opens it | 🔴 Critical |
| TC-2.2 | 2: playground on `billing` + `billing-console`, app running | `saasaloy remove billing` names the `requireFeature` risk | 🟡 Normal |
| TC-3.1 | 3: project installed from the pre-change registry | An existing `entitlements` install upgrades with no lost file | 🔴 Critical |
| TC-4.1 | 4: documentation, read only | `modules/README.md` and the wiki match the shipped registry | 🟢 Low |

## Scenario 1: fresh playground, nothing installed

**Setup.** Run once, for every case in this scenario.

```sh
cd "$REPO" && pnpm play:init
```

```sh
cd "$REPO/.dev/playground" && ./saasaloy add database-d1 --yes
```

- [ ] Setup complete

### TC-1.1: `saasaloy add billing` lands the entitlement files and the merged skill · 🔴 Critical

**Goal.** One `add` of `billing` gives a project everything the two modules used to give it together.

**Steps**

1. Add `billing`.

   ```sh
   cd "$REPO/.dev/playground" && ./saasaloy add billing --yes
   ```

   - [ ] The run finishes with no error and reports the applied modules.

2. List the two files the merge moved.

   ```sh
   ls -1 "$REPO/.dev/playground/packages/billing/src/entitlements.ts" "$REPO/.dev/playground/apps/api/src/middleware/require-feature.ts"
   ```

   - [ ] Both paths exist.

3. List the installed skills.

   ```sh
   ls -1 "$REPO/.dev/playground/.agents/skills/"
   ```

   - [ ] `saasaloy-billing` is present and `saasaloy-entitlements` is absent.

4. Try to add the retired module.

   ```sh
   cd "$REPO/.dev/playground" && ./saasaloy add entitlements --yes
   ```

   - [ ] The CLI refuses and names the unknown module. It does not crash and it writes no file.

5. Confirm the subpath export resolves.

   ```sh
   grep -n '"./entitlements"' "$REPO/.dev/playground/packages/billing/package.json"
   ```

   - [ ] The export points at `./src/entitlements.ts`, and that file now exists.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The merged `saasaloy-billing` skill reads as one runbook · 🟡 Normal

**Goal.** An agent reading the billing skill finds the entitlement answers in place, in the project's own words.

**Steps**

1. Open the installed skill.

   ```sh
   ${EDITOR:-less} "$REPO/.dev/playground/.agents/skills/saasaloy-billing/SKILL.md"
   ```

   - [ ] The "Entitlements — what a plan allows" section sits after "The plan file" and before "The routes".
     - the resolution-rule table lists all five states
     - the read example, the gate example and the 402 bodies are present
     - the per-request memo section explains why the cache is an argument
   - [ ] No sentence still calls `entitlements` a module of its own, or sends the reader to a `saasaloy-entitlements` skill.

2. Search the skill for the retired term.

   ```sh
   grep -n -i "feature flag" "$REPO/.dev/playground/.agents/skills/saasaloy-billing/SKILL.md"
   ```

   - [ ] The only hit is the sentence that tells the reader not to use the term. A plan's boolean is called a **plan feature** everywhere else.

3. Read the frontmatter `description`.

   - [ ] The description names the entitlement triggers, so an agent asked "gate this route behind a plan" would select this skill.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: `saasaloy add validators` still leaves `zod` and `@hono/zod-validator` in `apps/api` · 🟡 Normal

**Goal.** Deleting the two duplicate patches costs `apps/api` neither dependency.

**Steps**

1. Add `validators` to a clean playground.

   ```sh
   cd "$REPO" && pnpm play:init && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add validators --yes
   ```

   - [ ] The run finishes with no error.

2. Read the api dependencies.

   ```sh
   grep -n -E '"(zod|@hono/zod-validator|@repo/validators)"' "$REPO/.dev/playground/apps/api/package.json"
   ```

   - [ ] All three are present. `zod` is `4.6.5` and `@hono/zod-validator` is `0.9.1`.

3. Install and typecheck.

   ```sh
   cd "$REPO/.dev/playground" && pnpm install && pnpm --filter @repo/api typecheck
   ```

   - [ ] `tsc` reports no error.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
rm -rf "$REPO/.dev/playground"
```

## Scenario 2: playground on `billing` + `billing-console`, app running

**Setup.** Run once, for every case in this scenario.

```sh
cd "$REPO" && pnpm play:init && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add billing --yes && ./saasaloy add billing-console --yes && ./saasaloy add email-console --yes && ./saasaloy add queue-memory --yes && pnpm install
```

`billing` pulls in `email` and `queue` but no provider for either, so the api throws at construction without `email-console` and `queue-memory`.

Fill the environment. Every value goes through `packages/env`, and nothing writes `.dev.vars`.

```sh
cd "$REPO/.dev/playground" && sed -e 's/^BETTER_AUTH_SECRET=$/BETTER_AUTH_SECRET=qa-secret-0123456789abcdef0123456789abcdef/' -e 's/^BILLING_PROVIDER=$/BILLING_PROVIDER=console/' -e 's#^BILLING_APP_URL=$#BILLING_APP_URL=http://localhost:3001/billing#' -e 's/^EMAIL_FROM=$/EMAIL_FROM=qa@example.com/' -e 's/^EMAIL_PROVIDER=$/EMAIL_PROVIDER=console/' -e 's/^QUEUE_PROVIDER=$/QUEUE_PROVIDER=memory/' packages/env/.env.example > packages/env/.env && pnpm env:setup
```

Generate and apply the local migrations, then start the app.

```sh
cd "$REPO/.dev/playground" && pnpm --filter @repo/db db:generate && pnpm db:setup
```

```sh
cd "$REPO/.dev/playground" && pnpm dev
```

- [ ] Setup complete

### TC-2.1: A free-plan user meets 402 on a gated route, and a Pro subscription opens it · 🔴 Critical

**Goal.** The moved resolver and the moved middleware still gate a real request end to end, with no payment provider.

**Steps**

1. Add one gated route, so the middleware has a caller. Create `apps/api/src/routes/qa-export.ts`.

   ```ts
   import { Hono } from "hono";
   import type { AuthDbBindings } from "@repo/auth/server";
   import { requireFeature } from "../middleware/require-feature";
   import type { EntitlementVariables } from "../middleware/require-feature";

   export const qaExportRoute = new Hono<{
     Bindings: AuthDbBindings;
     Variables: EntitlementVariables;
   }>().post("/", requireFeature("export"), (c) => c.json({ ok: true }));
   ```

2. Mount it in `apps/api/src/index.ts`, beside the `/billing` route, at the path `/qa-export`.

   - [ ] The dev server reloads and reports no type error.

3. Open the admin app and create an account.

   ```sh
   open http://localhost:3001 || xdg-open http://localhost:3001
   ```

   - [ ] The sign-up form accepts a new email and password, and the app lands on a signed-in screen.

4. Open the `/billing` screen in the admin app.

   - [ ] The screen shows the Free plan as the current plan, with no subscription row.

5. Call the gated route with the browser session. Run this in the browser devtools console, on the admin tab.

   ```js
   await (await fetch("http://localhost:4000/qa-export", { method: "POST", credentials: "include" })).json()
   ```

   - [ ] The response status is **402** and the body is `{"error":{"code":"feature_required","feature":"export","message":"…"}}`.
   - [ ] The message names the `export` feature and points at the billing page, so a plan picker could act on it with no second call.

6. Subscribe to Pro from the `/billing` screen. The console provider completes the checkout with no card and no network.

   - [ ] The screen shows Pro as the current plan after the redirect.

7. Call the same route again, in the devtools console.

   ```js
   await (await fetch("http://localhost:4000/qa-export", { method: "POST", credentials: "include" })).json()
   ```

   - [ ] The response status is **200** and the body is `{"ok":true}`.

8. Sign out, then call the route with no session.

   ```sh
   curl -i -X POST http://localhost:4000/qa-export
   ```

   - [ ] The response status is **401** with code `unauthorized`, not 402. An anonymous caller has no plan to be short of.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `saasaloy remove billing` names the `requireFeature` risk · 🟡 Normal

**Goal.** The warning the retired module used to carry now reaches a person removing `billing`.

**Steps**

1. Stop the dev server.

2. Remove the provider first, then dry-run the core removal.

   ```sh
   cd "$REPO/.dev/playground" && ./saasaloy remove billing-console --yes && ./saasaloy remove billing --dry-run
   ```

   - [ ] The output lists three warnings: the surviving tables, the uncancelled vendor subscriptions, and the routes still wrapped in `requireFeature()` or `requireWithinLimit()`.
   - [ ] The planned removal names `apps/api/src/middleware/require-feature.ts` and `packages/billing/src/entitlements.ts`.
   - [ ] Nothing is deleted, because `--dry-run` was passed.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
rm -rf "$REPO/.dev/playground"
```

## Scenario 3: project installed from the pre-change registry

**Setup.** Run once, for every case in this scenario. This scenario needs a second checkout at `origin/main`, so the CLI can install the module that this branch deletes. The main checkout already holds `main`, so the second one is detached. The `./saasaloy` wrapper always sets `SAASALOY_REGISTRY_DIR` to this worktree's own `modules/`, so the old-registry calls run the built CLI directly.

```sh
git -C "$REPO" worktree add --detach /tmp/saasaloy-main origin/main
```

```sh
cd "$REPO" && pnpm play:init && cd .dev/playground && ./saasaloy add database-d1 --yes && SAASALOY_REGISTRY_DIR=/tmp/saasaloy-main/modules node "$REPO/packages/cli/dist/index.js" add entitlements --yes
```

- [ ] Setup complete

### TC-3.1: An existing `entitlements` install upgrades with no lost file · 🔴 Critical

**Goal.** A project that already holds the retired module reaches the merged layout without losing a file or holding a duplicate.

**Steps**

1. Record the starting state.

   ```sh
   cd "$REPO/.dev/playground" && ls -1 packages/billing/src/entitlements.ts apps/api/src/middleware/require-feature.ts .agents/skills/
   ```

   - [ ] Both files exist and `saasaloy-entitlements` is installed beside `saasaloy-billing`.

2. Remove the retired module, now using this branch's registry.

   ```sh
   cd "$REPO/.dev/playground" && ./saasaloy remove entitlements --yes
   ```

   - [ ] The removal succeeds. `remove` builds its plan from the local manifest, so a module the registry no longer carries still uninstalls cleanly.
   - [ ] The `saasaloy-entitlements` skill folder is gone.

3. Re-add `billing` from this branch, forcing the new files in.

   ```sh
   cd "$REPO/.dev/playground" && ./saasaloy add billing --yes --force
   ```

   - [ ] The run finishes with no error.

4. Compare the result against a clean install.

   ```sh
   cd "$REPO/.dev/playground" && ls -1 packages/billing/src/entitlements.ts apps/api/src/middleware/require-feature.ts .agents/skills/
   ```

   - [ ] Both files are back, and only `saasaloy-billing` remains in the skills folder.

5. Install and typecheck.

   ```sh
   cd "$REPO/.dev/playground" && pnpm install && pnpm --filter @repo/billing typecheck && pnpm --filter @repo/api typecheck
   ```

   - [ ] Both typechecks report no error.

6. Read the manifest.

   ```sh
   grep -c '"entitlements"' "$REPO/.dev/playground/.saasaloy/manifest.json"
   ```

   - [ ] The count is `0`. The manifest still tracks `packages/billing/src/entitlements.ts`, under `"module": "billing"`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before moving to Scenario 4.

```sh
rm -rf "$REPO/.dev/playground" && git -C "$REPO" worktree remove /tmp/saasaloy-main
```

## Scenario 4: documentation, read only

**Setup.** No setup. Read the files in the repository.

- [ ] Setup complete

### TC-4.1: `modules/README.md` and the wiki match the shipped registry · 🟢 Low

**Goal.** A reader counting modules in the documentation reaches the number the registry actually holds.

**Steps**

1. Count the directories in the registry.

   ```sh
   ls -1d "$REPO"/modules/*/ | wc -l
   ```

   - [ ] The count is **43**: 44 on `main`, minus `entitlements`.

2. Read the provider paragraph in `modules/README.md`.

   - [ ] The provider list names all 17 provider modules, including `kv-cloudflare`, `kv-memory`, `kv-upstash`, `storage-cloudflare`, `storage-memory`, `payment-console` and `payment-manual`.
   - [ ] `kv`, `storage`, `ratelimit` and `feature-flags` each have a paragraph, and each paragraph matches what that module's descriptor declares.

3. Read the `billing` row of `docs/wiki/modules.md`.

   - [ ] The row mentions the plan entitlements and the 402 gate, and no `entitlements` row is left behind.

4. Search the documentation for the retired module name.

   ```sh
   grep -rn "entitlements" "$REPO/README.md" "$REPO/modules/README.md" "$REPO/docs/wiki/" "$REPO/CONTEXT.md" "$REPO/AGENTS.md"
   ```

   - [ ] Every remaining hit describes a file or a concept inside `billing`, never a module to install. Hits inside `docs/plans/`, `docs/adr/`, `docs/qa/` and `docs/research/` are historical records and are out of scope.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

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
pnpm build
```

```sh
cd .dev/playground && pnpm --filter @repo/billing typecheck
```

```sh
cd .dev/playground && pnpm --filter @repo/api typecheck
```

```sh
cd .dev/playground && ./saasaloy add billing --yes && ./saasaloy add billing-console --yes
```

```sh
cd .dev/playground && ./saasaloy remove billing --dry-run
```

```sh
cd .dev/playground && ./saasaloy add entitlements --yes
```

```sh
cd .dev/playground && ./saasaloy add validators --yes
```

Results:

- ✅ `pnpm lint` → all four passes green: oxlint type-aware, oxlint plain, Stylelint, `prettier --check .`.
- ✅ `pnpm test` → 540 module tests and 160 script tests pass, 0 fail. The moved `entitlements.test.ts` runs in its new home at `modules/billing/files/src/`.
- ✅ `pnpm build` → the CLI builds.
- ✅ `@repo/billing` and `@repo/api` typecheck clean in a generated playground that holds `billing` + `billing-console`, so `packages/billing/src/entitlements.ts` and `apps/api/src/middleware/require-feature.ts` both compile at their new targets.
- ✅ `saasaloy add billing` → `packages/billing/src/entitlements.ts` and `apps/api/src/middleware/require-feature.ts` land. `.agents/skills/` holds `saasaloy-billing` only.
- ✅ `saasaloy remove billing --dry-run` → prints all three warnings, including "Any route still wrapped in requireFeature() or requireWithinLimit() …".
- ✅ `saasaloy add entitlements` → refused with `Unknown module "entitlements" — no entitlements/registry-item.json in the registry.` No file written.
- ✅ `saasaloy add validators` → `apps/api/package.json` still holds `zod` 4.5.4 and `@hono/zod-validator` 0.9.1, both from the `api` template, after the two duplicate patches were deleted.

Two typecheck failures appeared in the generated playground. Both predate this branch and neither is caused by this change:

- ❌ `packages/billing/src/providers/console.ts:129` → `error TS2322: Type 'Date | null | undefined' is not assignable to type 'Date | null'`. The source is `modules/billing-console/files/console.ts`, last changed in `c355f93`. The playground copy was patched by hand to let the rest of the typecheck run.
- ❌ `apps/admin/src/routes/billing.tsx:59` → `error TS2345: Argument of type '"/billing"' is not assignable to parameter of type 'keyof FileRoutesByPath'`. The TanStack route tree is not generated before `typecheck` runs.

### Re-run after the rebase onto `186d42d` (2026-10-23)

The branch was rebased onto `origin/main` at `186d42d`, and the agent re-ran every case it can check in `.dev/playground` with the setup above.

- ✅ Repository gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify:content`, `pnpm verify:pins`, `pnpm --filter saasaloy build` and `pnpm --filter saasaloy test:matrix` (947 tests) pass. `pnpm --filter saasaloy test:e2e` fails only the four known pre-existing cases in `apply.test.ts` and `partial-apply.test.ts`. `pnpm verify:e2e --driver=d1` and `--driver=postgres` pass.
- ✅ TC-1.1: both files land, `.agents/skills/` holds `saasaloy-billing` and no `saasaloy-entitlements`, `add entitlements` exits 2 with `Unknown module "entitlements"`, and `./entitlements` points at `./src/entitlements.ts`.
- ✅ TC-1.2, the checks an agent can make: the "Entitlements — what a plan allows" section sits between "The plan file" and "The routes", the only "feature flag" hit is the sentence that forbids the term, the skill never names `saasaloy-entitlements`, and the description names `requireFeature` and `requireWithinLimit`.
- ✅ TC-1.3: `apps/api/package.json` holds `zod` 4.6.5, `@hono/zod-validator` 0.9.1 and `@repo/validators`, and `@repo/api` typechecks clean.
- ✅ TC-2.1, over HTTP with `curl` instead of the browser: anonymous gives 401 `unauthorized`, a new free-plan user gives 402 `feature_required` naming `export`, `POST /billing/checkout` for `pro` on the console provider moves `/billing/subscription` to Pro, and the same call then gives 200 `{"ok":true}`. `@repo/api` typechecks with the QA route mounted. The `billing-console` and admin-route typecheck failures listed above no longer occur.
- ✅ TC-2.2: the dry run prints all three warnings and plans the delete of both moved files. Nothing is deleted.
- ✅ TC-3.1: the old registry installs `entitlements` beside `saasaloy-billing`, this branch's `remove entitlements` deletes its 3 files and the skill, `add billing --yes --force` restores both files, both typechecks pass, and the manifest holds no `entitlements` module.
- ✅ TC-4.1: 43 module directories, 17 providers listed, no `entitlements` row in the wiki, and every remaining doc hit describes a concept inside `billing`.

## Not covered / needs human judgment

- **Concurrency and timing.** The per-request cache is unchanged by this branch. Its existing unit tests cover the shared-promise behaviour, so no manual race case is written.
- **Performance.** No query, no index and no hot path changed. Only file locations and a descriptor moved.
- **Accessibility and compatibility.** No UI file changed. The `/billing` admin screen is untouched.
- **Database schema.** No migration, no table and no column changed, so no introspection check and no data-integrity case is written. TC-2.1 still exercises the projection read path, because that is what the resolver reads.
- **Security.** The middleware's auth and subject resolution are byte-identical to the shipped version; only the comment block moved. TC-2.1's 401 step is the one check kept, because it proves the middleware is still wired to the session.
- **Stripe.** `billing-stripe` is untouched and needs a vendor account. The whole plan runs on `billing-console`.
- **A real upgrade of an existing customer project.** TC-3.1 simulates one with a `main` worktree as the old registry. A project pinned to a published registry ref is not tested here.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
