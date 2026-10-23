# QA Plan: the `config` capability

_Generated 2026-09-20 · rewritten 2026-10-23 for the rescoped PR #163 on top of main `da9c08c` (`packages/env` setup, the #191 landing page, the two auth instances) · covers `@repo/config` in the base, the `auth` and `billing` sections, the `add`-time section guard, and the two `doctor` checks_

## Summary

- `@repo/config` is a new base package holding the values a project checks into its repo: the product name, the locale and the legal paths. A capability adds a section; a project owner edits one file, `packages/config/src/project.ts`.
- Working means one rename in `project.ts` changes the name on every page, the admin roles have one home on the api and in the browser, and `saasaloy add` refuses two modules claiming one section key.
- The landing page's pricing is out of scope on purpose. It stays in `packages/ui/src/content/landing.ts`, unchanged from main.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-154-add-a-config-capability-for-shared-project-configuration`.
- Work from the repo root of this worktree. The playground is `.dev/playground`.
- No credentials and no vendor account. Every provider below is a local one.
- Every environment value goes into `packages/env/.env`, and `pnpm env:setup` writes each service's own `.env` from it. There is no `.dev.vars`.
- Dev ports: web on 3000, admin on 3001, api on 4000.
- A browser on your own machine for the visual checks. This box is headless, so open the pages over the tailnet, or run the scenario locally.

Set the two variables the plan uses:

```sh
export QA_ROOT="$PWD" && export PLAY="$PWD/.dev/playground"
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh scaffold, base only | A fresh scaffold ships as Saasaloy | 🔴 Critical |
| TC-1.2 | 1: fresh scaffold, base only | A rename in `project.ts` reaches every page | 🔴 Critical |
| TC-1.3 | 1: fresh scaffold, base only | The locale and the legal paths follow config | 🟡 Normal |
| TC-1.4 | 1: fresh scaffold, base only | A bad override fails `typecheck`, readably | 🟡 Normal |
| TC-1.5 | 1: fresh scaffold, base only | `doctor` reports no config finding on a fresh project | 🟡 Normal |
| TC-1.6 | 1: fresh scaffold, base only | The merge tests run and lint in the project | 🟡 Normal |
| TC-2.1 | 2: auth, admin and billing added | Two modules compose two sections | 🔴 Critical |
| TC-2.2 | 2: auth, admin and billing added | The admin roles have one home | 🔴 Critical |
| TC-2.3 | 2: auth, admin and billing added | `doctor` reports a stale `BILLING_APP_NAME` | 🟡 Normal |
| TC-2.4 | 2: auth, admin and billing added | `remove` takes a section back out | 🟡 Normal |
| TC-3.1 | 3: a registry with a colliding descriptor | `add` refuses a claimed section key, readably | 🟢 Low |

## Scenario 1: fresh scaffold, base only

**Setup.** Run once, for every case in this scenario. `play:reset` builds the CLI, scaffolds, installs and commits a baseline.

```sh
cd "$QA_ROOT" && pnpm play:reset
```

```sh
cd "$PLAY" && cp packages/env/.env.example packages/env/.env && pnpm env:setup
```

- [ ] Setup complete

### TC-1.1: A fresh scaffold ships as Saasaloy · 🔴 Critical

**Goal.** The default name is `"Saasaloy"`, so it agrees with the shipped landing copy, and the override file ships with every value commented out.

**Steps**

1. Read the override file and the base section.

   ```sh
   cd "$PLAY" && cat packages/config/src/project.ts && grep -n "name:" packages/config/src/sections/app.ts
   ```

   - [ ] `project.ts` has `// name:` and `// locale:` commented out, and no `{{PROJECT_NAME}}`
   - [ ] `sections/app.ts` sets `name: "Saasaloy"`
2. Confirm the landing copy is main's, untouched.

   ```sh
   cd "$QA_ROOT" && diff <(git show origin/main:packages/cli/templates/base/packages/ui/src/content/landing.ts) "$PLAY/packages/ui/src/content/landing.ts" && echo identical
   ```

   - [ ] The command prints `identical`
3. Start the site and open `http://localhost:3000`.

   ```sh
   cd "$PLAY" && ASTRO_DEV_BACKGROUND=1 pnpm --filter @repo/web dev
   ```

   - [ ] The browser tab, the navbar and the footer read `Saasaloy`
   - [ ] The pricing section shows the three hosting tiers from #191, unchanged
4. Open `/terms`, then `/privacy`.
   - [ ] Both pages render and name `Saasaloy`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A rename in `project.ts` reaches every page · 🔴 Critical

**Goal.** One edit in one file renames the product everywhere.

**Steps**

1. In `packages/config/src/project.ts`, uncomment `name` and set it to `"Ledgerly"`.
2. Build and count the names.

   ```sh
   cd "$PLAY" && pnpm --filter @repo/web build && for f in index terms/index privacy/index; do echo "$f Ledgerly=$(grep -o Ledgerly apps/web/dist/client/$f.html | wc -l) Saasaloy=$(grep -o Saasaloy apps/web/dist/client/$f.html | wc -l)"; done
   ```

   - [ ] Every page has `Saasaloy=0` and a non-zero `Ledgerly` count
3. Reload `http://localhost:3000` in the browser.
   - [ ] The browser tab, the navbar, the hero, the closing call to action and the footer read `Ledgerly`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The locale and the legal paths follow config · 🟡 Normal

**Goal.** `config.app.locale` drives `<html lang>`, and `config.app.legal` drives the footer's two links.

**Steps**

1. In `project.ts`, set `locale: "en-GB"` and `legal: { termsPath: "/legal/terms", privacyPath: "/legal/privacy" }` inside `app`.
2. Build and read the attributes.

   ```sh
   cd "$PLAY" && pnpm --filter @repo/web build && grep -o '<html lang="[^"]*"' apps/web/dist/client/index.html && grep -o 'href="/legal/[a-z]*"' apps/web/dist/client/index.html
   ```

   - [ ] `lang` reads `en-GB`
   - [ ] The footer links point at `/legal/terms` and `/legal/privacy`
3. In the browser, click the footer's Terms link.
   - [ ] It 404s, because the pages were not renamed. The comment in `apps/web/src/pages/terms.astro` warns about this coupling.
4. Remove the `locale` and `legal` lines again.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: A bad override fails `typecheck`, readably · 🟡 Normal

**Goal.** A typo in the one file a project owner edits is a compile error.

**Steps**

1. Stop the dev server. Add `nmae: "Ledgerly",` inside `app` in `project.ts`.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run fails, and the message names `project.ts` and `nmae`
2. Replace that line with a section nothing defines, at the top level: `billing: { appName: "x" },`.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run fails, because `billing` is not installed in this scenario
3. Delete the line.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run passes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: `doctor` reports no config finding on a fresh project · 🟡 Normal

**Goal.** `doctor` stays quiet about the deliberate default name and about the Astro `site`, whose job `PUBLIC_SITE_URL` now does.

**Steps**

1. Run the check.

   ```sh
   cd "$PLAY" && ./saasaloy doctor .
   ```

   - [ ] Nothing reports the product name or `apps/web/astro.config.mjs`
   - [ ] No Project state box appears, so a fresh project is clean
   - [ ] The Base box lists `packages/config/src/project.ts` under "seed, not checked"

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.6: The merge tests run and lint in the project · 🟡 Normal

**Goal.** `packages/config/src/define.test.ts` ships with the package, runs on the project's Vitest, and passes the project's type-aware lint.

**Steps**

1. Run the project's tests and lint.

   ```sh
   cd "$PLAY" && pnpm test && pnpm lint
   ```

   - [ ] Vitest collects `packages/config/src/define.test.ts` and all its cases pass
   - [ ] `pnpm lint` passes all four steps

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 2: auth, admin and billing added

**Setup.** Run once, for every case in this scenario. The build takes a few minutes.

```sh
cd "$QA_ROOT" && pnpm play:reset
```

```sh
cd "$PLAY" && for m in database-d1 auth admin billing billing-console; do ./saasaloy add $m --yes; done && pnpm install
```

Copy the key list, then fill in the keys this module set needs. `saasaloy env` prompts for them; the values below are local ones.

```sh
cd "$PLAY" && cp packages/env/.env.example packages/env/.env && sed -i 's/^BETTER_AUTH_SECRET=$/BETTER_AUTH_SECRET=qa-secret-0123456789abcdef0123456789abcdef/; s/^BILLING_PROVIDER=$/BILLING_PROVIDER=console/; s/^EMAIL_PROVIDER=$/EMAIL_PROVIDER=console/; s/^LOGGER_PROVIDER=$/LOGGER_PROVIDER=console/; s/^QUEUE_PROVIDER=$/QUEUE_PROVIDER=memory/; s/^EMAIL_FROM=$/EMAIL_FROM=qa@example.com/' packages/env/.env && pnpm env:setup
```

```sh
cd "$PLAY" && pnpm build && pnpm typecheck
```

- [ ] Setup complete

### TC-2.1: Two modules compose two sections · 🔴 Critical

**Goal.** Each module ships one section file and one patched line, and re-running an install changes nothing.

**Steps**

1. Read the registry and the section folder.

   ```sh
   cd "$PLAY" && sed -n '/export const sections/,/});/p' packages/config/src/sections.ts && ls packages/config/src/sections/
   ```

   - [ ] The array holds `app()`, `authConfig()` and `billingConfigSection()`
   - [ ] The folder holds `app.ts`, `auth.ts` and `billing.ts`, and each module file imports `@repo/config/define`
2. Add `auth` a second time.

   ```sh
   cd "$PLAY" && ./saasaloy add auth --force --yes && sed -n '/export const sections/,/});/p' packages/config/src/sections.ts
   ```

   - [ ] The array still holds `authConfig()` exactly once

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The admin roles have one home · 🔴 Critical

**Goal.** The api and the admin bundle both build `ADMIN_APP_ROLES` from `config.auth`, so a rename or a `support` role is one edit.

**Steps**

1. Search for a role literal in the code that decides access.

   ```sh
   cd "$PLAY" && grep -rn '"superadmin"' packages/auth/src apps/admin/src packages/config/src | grep -v test
   ```

   - [ ] Only `packages/config/src/sections/auth.ts` holds the literal as a value
   - [ ] `packages/db/src/seed/slices/users.ts` and `apps/admin/src/routes/users.tsx` read the role names from config, not as literals
2. Rename both roles and add a group role. In `project.ts`, add `auth: { adminRole: "staff", superadminRole: "owner", adminAppExtraRoles: ["support"] },`.

   ```sh
   cd "$PLAY" && pnpm typecheck && pnpm --filter @repo/admin build && grep -o 'adminAppExtraRoles:\[[^]]*\]' -r apps/admin/dist/assets | head -2
   ```

   - [ ] The typecheck passes
   - [ ] The admin bundle carries `adminAppExtraRoles:[`support`]` and builds the list from `config.auth`
   - [ ] `packages/auth/src/auth.ts` passes `siteRoleMap(...)` as the `admin()` plugin's `roles`, so `staff` and `owner` hold the admin statements
3. Start the api and the admin app, then open `http://localhost:3001` and sign in.

   ```sh
   cd "$PLAY" && pnpm --filter @repo/api dev
   ```

   ```sh
   cd "$PLAY" && pnpm --filter @repo/admin dev
   ```

   - [ ] A `support` account can sign in on the admin app and opens the shell
   - [ ] A `support` account gets 403 on an admin-only page, such as Users
4. Stop both servers. Remove the `auth` override.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: `doctor` reports a stale `BILLING_APP_NAME` · 🟡 Normal

**Goal.** The deprecated env var is no longer read, and `doctor` says so.

**Steps**

1. Confirm nothing reads it.

   ```sh
   cd "$PLAY" && grep -rn "BILLING_APP_NAME" apps/*/src packages/*/src
   ```

   - [ ] No source file reads the variable. `apps/api/src/billing-store.ts` reads `config.billing.appName || config.app.name`.
2. Set it in the values file, as an older project would have it, and distribute it.

   ```sh
   cd "$PLAY" && echo 'BILLING_APP_NAME="Acme Billing"' >> packages/env/.env && pnpm env:setup && ./saasaloy doctor .
   ```

   - [ ] One finding names `packages/env/.env`, the variable, and the config value that replaced it
   - [ ] No second finding names `apps/api/.env`, the copy `env:setup` made
3. Confirm the key is retired.

   ```sh
   cd "$QA_ROOT" && grep -c "BILLING_APP_NAME" modules/billing/registry-item.json modules/billing/files/src/env-preset.ts
   ```

   - [ ] Both counts are 0, and `packages/env/.env.example` in the playground has no `BILLING_APP_NAME` line
4. Delete the line you added to `packages/env/.env` and run `pnpm env:setup`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: `remove` takes a section back out · 🟡 Normal

**Goal.** A section is a module-owned file plus one reversible patch.

**Steps**

1. Remove the provider, then the module.

   ```sh
   cd "$PLAY" && ./saasaloy remove billing-console --yes && ./saasaloy remove billing --yes
   ```

   - [ ] The command reports it removed `packages/config/src/sections/billing.ts`
   - [ ] It warns that three `package-json-dependency` patches on `@repo/billing` are not reversed. This is existing `remove` behaviour, not part of this change.
2. Read the registry.

   ```sh
   cd "$PLAY" && sed -n '/export const sections/,/});/p' packages/config/src/sections.ts && head -3 packages/config/src/sections.ts && ls packages/config/src/sections/
   ```

   - [ ] `billingConfigSection()` and its import are gone, and `authConfig()` is untouched
   - [ ] Only `app.ts` and `auth.ts` remain
3. Hand-revert the `@repo/billing` dependency in `apps/api`, `packages/auth` and `packages/queue`, as the warning says. Then typecheck.

   ```sh
   cd "$PLAY" && pnpm install && pnpm typecheck
   ```

   - [ ] The run passes, so nothing left behind reads `config.billing`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 3: a registry with a colliding descriptor

**Setup.** Continue in the Scenario 2 playground, with `auth` installed. Copy the registry so the repo's own descriptors are never edited, and commit the playground so a stray write shows.

```sh
rm -rf /tmp/qa-registry && cp -r "$QA_ROOT/modules" /tmp/qa-registry
```

```sh
cd "$PLAY" && git add -A && git commit -qm "qa: before collision" --no-verify
```

- [ ] Setup complete

### TC-3.1: `add` refuses a claimed section key, readably · 🟢 Low

**Goal.** A second module claiming `config.auth` stops the install, and the refusal names both modules and the key.

**Steps**

1. Open `/tmp/qa-registry/waitlist/registry-item.json` and add this patch to its `patches` array.

   ```jsonc
   {
     "file": "packages/config/src/sections.ts",
     "kind": "plugin-array",
     "exportName": "sections",
     "arrayProp": "sections",
     "call": "waitlistConfig",
     "import": { "name": "waitlistConfig", "from": "./sections/auth" }
   }
   ```

2. Install `waitlist` from that registry. Call the built CLI directly: the `./saasaloy` shim always sets `SAASALOY_REGISTRY_DIR` to this worktree's `modules/`.

   ```sh
   cd "$PLAY" && SAASALOY_REGISTRY_DIR=/tmp/qa-registry node "$QA_ROOT/packages/cli/dist/index.js" add waitlist --yes; echo "exit=$?"
   ```

   - [ ] The run refuses with exit 2
   - [ ] The message names `auth` and `waitlist`, names `config.auth`, and says the two ways out
3. Confirm the project is untouched.

   ```sh
   cd "$PLAY" && git status --short && ls packages/config/src/sections/
   ```

   - [ ] `git status` prints nothing, and only `app.ts` and `auth.ts` are present

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.**

```sh
cd "$QA_ROOT" && pnpm play:destroy && rm -rf /tmp/qa-registry
```

## Automated verification (by AI agent)

_Checks the agent ran itself on 2026-10-23, on the rebased branch after the review fixes. No action needed from the tester._

- ✅ `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify:content`, `pnpm verify:pins`, `pnpm --filter saasaloy build`, `pnpm --filter saasaloy test:matrix` (991 tests) all pass.
- ✅ `pnpm --filter saasaloy test:e2e` → 44 passed, 4 failed. The four are the known failures on main (`apply.test.ts` x3, `partial-apply.test.ts` x1).
- ✅ `pnpm verify:e2e --driver=d1` and `--driver=postgres` → 4 flows pass on each, the admin login flows included.
- ✅ TC-1.1 to TC-1.4, from the built HTML and `pnpm typecheck`: "Saasaloy" by default, then `Saasaloy=0` and `Ledgerly` = 19, 4 and 4 after the rename, `lang="en-GB"`, the `/legal/*` hrefs, and TS2353 on both bad overrides.
- ✅ TC-1.5: "No problems found" on a fresh project.
- ✅ TC-1.6: 4 Vitest files and 111 tests pass, and `pnpm lint` is clean. Both runs first failed on a type assertion in `define.ts` and `define.test.ts`; commits `104941f` and `b213310` fixed them.
- ✅ TC-2.1 and TC-2.2 steps 1 and 2. With `adminRole: "staff"`, `superadminRole: "owner"` and `adminAppExtraRoles: ["support"]`, the project's own route tests pass (17 in `apps/api/src/routes/auth.test.ts`): the seeded `owner` signs in, a `staff` admin lists users and changes a client's role through `/admin/*`, and the rank guard still refuses a `staff` admin who touches an `owner`.
- ✅ TC-2.3: one finding for `packages/env/.env`, none for the service copy; a value typed into `apps/api/.env` alone is reported there. The fresh `.env.example` has no `BILLING_APP_NAME`.
- ✅ TC-3.1, plus two variants: a module claiming `config.app` is refused as "base and waitlist", and a section file calling `defineSection("signup")` under `./sections/waitlist` is refused with exit 2. Neither writes a file.
- ⏭ TC-2.4 was not re-run after the review fixes; `remove` and the section registry did not change.

## Not covered / needs human judgment

- **The visual checks.** TC-1.1 step 3, TC-1.2 step 3 and TC-1.3 step 3 need eyes on a real browser.
- **A `support` account in the admin app.** TC-2.2 step 3 needs a signed-in account with that role and a judgment on what the shell shows it.
- **A real billing email.** Confirming the app name in a sent message needs a provider account. TC-2.3 checks the reader instead.
- **Stored roles.** Renaming a role in config does not rewrite the `users.role` values already stored. The seed slice writes the configured names, but an existing project needs its own `update`.
- **`saasaloy update` across a released version.** The override file is a seed file, and `doctor` confirms it is not checked. A full update run is its own pass.
