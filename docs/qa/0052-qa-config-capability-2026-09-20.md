# QA Plan: the `config` capability

_Generated 2026-09-20 · against `6cce5b5` plus the uncommitted working tree · covers `@repo/config` in the base, the `auth` and `billing` sections, the `add`-time section guard, and the three `doctor` checks_

## Summary

- `@repo/config` is a new base package holding the values a project checks into its repo: the product name, the locale, the currency symbol, the legal paths and the plan tier ids. A capability adds a section; a project owner edits one file.
- Working means one rename in `packages/config/src/project.ts` changes the name everywhere, the roles and tier ids have one home, and `saasaloy add` refuses two modules claiming one section key.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-154-add-a-config-capability-for-shared-project-configuration`, working tree included.
- Work from the repo root of this worktree. Every path below is relative to it.
- No credentials, no auth token, no feature flag.
- A browser on your own machine. This box is headless, so open `http://localhost:3000` from a machine that can reach it over the tailnet, or run the scenario locally.

Build the CLI and set the two variables the plan uses.

```sh
export QA_ROOT="$PWD" && export PLAY="$PWD/.dev/playground"
```

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh scaffold, base only | The scaffold names itself, everywhere | 🔴 Critical |
| TC-1.2 | 1: fresh scaffold, base only | A rename in `project.ts` reaches every surface | 🔴 Critical |
| TC-1.3 | 1: fresh scaffold, base only | The locale and the legal paths follow config | 🟡 Normal |
| TC-1.4 | 1: fresh scaffold, base only | A bad override fails `typecheck`, readably | 🟡 Normal |
| TC-1.5 | 1: fresh scaffold, base only | `doctor` names the two unedited values | 🟡 Normal |
| TC-2.1 | 2: auth, admin and billing added | Two modules compose two sections | 🔴 Critical |
| TC-2.2 | 2: auth, admin and billing added | The role strings have one home | 🔴 Critical |
| TC-2.3 | 2: auth, admin and billing added | A tier rename reaches the page and the biller | 🟡 Normal |
| TC-2.4 | 2: auth, admin and billing added | `doctor` reports a stale `BILLING_APP_NAME` | 🟡 Normal |
| TC-2.5 | 2: auth, admin and billing added | `remove` takes a section back out | 🟡 Normal |
| TC-3.1 | 3: a registry with a colliding descriptor | `add` refuses a claimed section key, readably | 🟢 Low |

## Scenario 1: fresh scaffold, base only

**Setup.** Run once, for every case in this scenario.

```sh
cd "$QA_ROOT" && pnpm play:reset && cd "$PLAY" && pnpm install
```

```sh
cd "$PLAY" && git init -q .
```

- [ ] Setup complete

### TC-1.1: The scaffold names itself, everywhere · 🔴 Critical

**Goal.** `saasaloy init` substitutes the project name into `config.app.name`, and every surface that used to hold its own copy reads it.

**Steps**

1. Read the override file.

   ```sh
   cd "$PLAY" && cat packages/config/src/project.ts
   ```

   - [ ] `app.name` is `"playground"`, not `{{PROJECT_NAME}}`
     - the comments above it say what belongs here and what belongs in `.env`
2. Start the site.

   ```sh
   cd "$PLAY" && pnpm --filter @repo/web dev
   ```

3. Open `http://localhost:3000` in a browser.
   - [ ] The name reads `playground` in the browser tab, the navbar and the footer
   - [ ] The page renders as it did before this change, with no missing block
     - navbar, hero, feature grid, pricing table, FAQ, closing call to action, footer
4. Open `http://localhost:3000/terms`, then `/privacy`.
   - [ ] Both pages render and name the project

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A rename in `project.ts` reaches every surface · 🔴 Critical

**Goal.** One edit in one file renames the product everywhere, which is the defect this capability exists to fix.

**Steps**

1. Set the name. Edit `packages/config/src/project.ts` and change `app.name` to `Ledgerly`.
2. Reload `http://localhost:3000`.
   - [ ] The navbar, the hero copy, the closing call to action and the footer all read `Ledgerly`
   - [ ] The browser tab reads `Ledgerly`
3. Reload `http://localhost:3000/terms`.
   - [ ] The heading and the body read `Ledgerly`
4. Search the tree for a second copy of the old name.

   ```sh
   cd "$PLAY" && grep -rn "playground" packages apps --include="*.ts" --include="*.tsx" --include="*.astro"
   ```

   - [ ] The search finds nothing, so no file kept its own copy of the name

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The locale and the legal paths follow config · 🟡 Normal

**Goal.** `config.app.locale` drives `<html lang>`, and `config.app.legal` drives the footer's two links.

**Steps**

1. Set `app.locale` to `"en-GB"` in `packages/config/src/project.ts`. Reload the page.
2. Open the browser's element inspector on the `<html>` tag.
   - [ ] `lang` reads `en-GB`
3. Set `app.legal` to `{ termsPath: "/legal/terms", privacyPath: "/legal/privacy" }` in the same file. Reload the page.
   - [ ] The footer's Terms and Privacy links point at `/legal/terms` and `/legal/privacy`
     - hover each link and read the status bar, or inspect the `href`
   - [ ] Both links 404, because the pages have not been renamed
     - this is the coupling the comment in `apps/web/src/pages/terms.astro` warns about
4. Put both values back to `/terms` and `/privacy`, and `locale` back to `"en"`. Reload.
   - [ ] Both links work again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: A bad override fails `typecheck`, readably · 🟡 Normal

**Goal.** A typo in the one file a project owner edits is a compile error, because `typecheck` is the only validation there is.

**Steps**

1. Stop the dev server.
2. Add a misspelled key to `packages/config/src/project.ts`, inside `app`: `nmae: "Ledgerly",`.
3. Run the typecheck.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run fails, and the message names `project.ts` and the key you misspelled
     - a reader who has never seen this package can tell what to fix
4. Delete the bad line. Add a whole section nothing defines instead: `billing: { appName: "x" },`.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run fails again, because `billing` is not installed in this scenario
5. Delete that line too.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run passes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: `doctor` names the two unedited values · 🟡 Normal

**Goal.** `doctor` tells a project owner which template values they have not set yet, in words that say what to do.

**Steps**

1. Run the check.

   ```sh
   cd "$PLAY" && "$QA_ROOT/packages/cli/dist/index.js" doctor .
   ```

   - [ ] The Project state box reports the unedited `site: "https://example.com"`, and the sentence says where to set it
   - [ ] The Base box lists `packages/config/src/project.ts` under "seed, not checked", so an update will not overwrite it
   - [ ] Nothing reports the product name, because `init` substituted it
2. Put the placeholder back. Set `app.name` to `"{{PROJECT_NAME}}"` in `packages/config/src/project.ts`.

   ```sh
   cd "$PLAY" && "$QA_ROOT/packages/cli/dist/index.js" doctor .
   ```

   - [ ] A second finding now names the placeholder and the file
3. Set the name back to `playground`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd "$QA_ROOT" && pnpm play:destroy
```

## Scenario 2: auth, admin and billing added

**Setup.** Run once, for every case in this scenario. The last command takes a few minutes.

```sh
cd "$QA_ROOT" && pnpm play:reset && cd "$PLAY" && git init -q .
```

```sh
cd "$PLAY" && for m in database-d1 auth admin billing; do ./saasaloy add $m --yes; done
```

```sh
cd "$PLAY" && pnpm install && pnpm build
```

- [ ] Setup complete

### TC-2.1: Two modules compose two sections · 🔴 Critical

**Goal.** Each module ships one section file and one patched line, and the composed object carries both keys.

**Steps**

1. Read the registry and the section folder.

   ```sh
   cd "$PLAY" && tail -3 packages/config/src/sections.ts && ls packages/config/src/sections/
   ```

   - [ ] The array holds four calls: `app()`, `plans()`, `authConfig()` and `billingConfigSection()`
   - [ ] The folder holds `app.ts`, `plans.ts`, `auth.ts` and `billing.ts`
   - [ ] Each of the two module files imports `@repo/config/define`, not a relative path
2. Add the same module a second time.

   ```sh
   cd "$PLAY" && ./saasaloy add auth --force --yes
   ```

   - [ ] The run succeeds, and the array still holds `authConfig()` exactly once
     - re-running an install must change nothing
3. Format the tree, because the patched line is now longer than Prettier's width.

   ```sh
   cd "$PLAY" && pnpm format
   ```

   - [ ] Prettier rewrites `packages/config/src/sections.ts` and the file still holds the four calls

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The role strings have one home · 🔴 Critical

**Goal.** The api and the browser read one copy of `admin` and `superadmin`, which is the second duplication this capability removes.

**Steps**

1. Search for a redeclared role literal.

   ```sh
   cd "$PLAY" && grep -rn '"admin"\|"superadmin"' packages/auth/src apps/admin/src packages/config/src
   ```

   - [ ] Only `packages/config/src/sections/auth.ts` holds the two literals
     - `packages/auth/src/authorize.ts` and `apps/admin/src/lib/auth.ts` both read `config.auth.*`
2. Rename both roles. In `packages/config/src/project.ts`, add `auth: { adminRole: "staff", superadminRole: "owner" },`.

   ```sh
   cd "$PLAY" && pnpm typecheck && grep -rn "staff" packages/config/src/project.ts
   ```

   - [ ] The typecheck passes, so both readers accept the new strings
3. Remove that override again.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The typecheck passes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A tier rename reaches the page and the biller · 🟡 Normal

**Goal.** One tier id and name serve the marketing page and `packages/billing`, so the two can no longer drift.

**Steps**

1. Rename the middle tier. In `packages/config/src/project.ts`, add:

   ```ts
   plans: {
     tiers: {
       free: { id: "free", name: "Starter" },
       pro: { id: "studio", name: "Studio" },
       enterprise: { id: "enterprise", name: "Enterprise" },
     },
   },
   ```

   - [ ] You had to write all three tiers, because an override replaces a nested record whole
2. Confirm both readers took it.

   ```sh
   cd "$PLAY" && pnpm typecheck && grep -rn "config.plans" packages/billing/src/plans.ts packages/ui/src/content/landing.ts
   ```

   - [ ] Both files read `config.plans.tiers.*`, and neither holds a tier id of its own
3. Start the site.

   ```sh
   cd "$PLAY" && pnpm --filter @repo/web dev
   ```

4. Open `http://localhost:3000` and look at the pricing table.
   - [ ] The three plans read `Starter`, `Studio` and `Enterprise`
   - [ ] The prices, the feature bullets and the buttons are unchanged, because only ids and names moved
5. Stop the server. Remove the `plans` override.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: `doctor` reports a stale `BILLING_APP_NAME` · 🟡 Normal

**Goal.** The deprecated env var is no longer read, and `doctor` says so rather than leaving it to look effective.

**Steps**

1. Confirm nothing reads it.

   ```sh
   cd "$PLAY" && grep -rn "BILLING_APP_NAME" apps packages
   ```

   - [ ] No source file reads the variable
     - `apps/api/src/billing-store.ts` reads `config.billing.appName || config.app.name`
2. Set it anyway.

   ```sh
   cd "$PLAY" && echo 'BILLING_APP_NAME="Acme Billing"' >> apps/api/.dev.vars
   ```

   ```sh
   cd "$PLAY" && "$QA_ROOT/packages/cli/dist/index.js" doctor .
   ```

   - [ ] A finding names `apps/api/.dev.vars`, the variable, and the config value that replaced it
3. Read the descriptor's own wording.

   ```sh
   cd "$QA_ROOT" && grep -n "BILLING_APP_NAME" modules/billing/registry-item.json
   ```

   - [ ] The description opens with `DEPRECATED:` and names the replacement
4. Delete the line you added.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.5: `remove` takes a section back out · 🟡 Normal

**Goal.** A section is an ordinary module-owned file plus one reversible patch, so uninstalling the module leaves no trace of it.

**Steps**

1. Remove the module that ships the `billing` section. Answer the prompts.

   ```sh
   cd "$PLAY" && ./saasaloy remove billing
   ```

   - [ ] The command reports it removed `packages/config/src/sections/billing.ts` and reversed the patch
2. Read the registry.

   ```sh
   cd "$PLAY" && tail -3 packages/config/src/sections.ts && ls packages/config/src/sections/
   ```

   - [ ] `billingConfigSection()` and its import are gone, and `authConfig()` is untouched
   - [ ] `billing.ts` is gone from the folder, and the other three files remain
3. Typecheck what is left.

   ```sh
   cd "$PLAY" && pnpm typecheck
   ```

   - [ ] The run passes, so nothing left behind reads `config.billing`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
cd "$QA_ROOT" && pnpm play:destroy
```

## Scenario 3: a registry with a colliding descriptor

**Setup.** Run once. It copies the registry so the repo's own descriptors are never edited.

```sh
cd "$QA_ROOT" && pnpm play:reset && cd "$PLAY" && git init -q . && pnpm install
```

```sh
rm -rf /tmp/qa-registry && cp -r "$QA_ROOT/modules" /tmp/qa-registry
```

- [ ] Setup complete

### TC-3.1: `add` refuses a claimed section key, readably · 🟢 Low

**Goal.** Two modules claiming one section key stop the install, and the refusal names both modules and the key.

**Steps**

1. Make a second module claim `config.auth`. Open `/tmp/qa-registry/waitlist/registry-item.json` and add this patch to its `patches` array.

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

2. Install both modules from that registry in one run.

   ```sh
   cd "$PLAY" && SAASALOY_REGISTRY_DIR=/tmp/qa-registry ./saasaloy add waitlist --yes
   ```

   - [ ] The run refuses and writes nothing
   - [ ] The message names `auth` and `waitlist`, names `config.auth`, and says the two ways out
     - a reader can act on it without opening the CLI source
3. Confirm the project is untouched.

   ```sh
   cd "$PLAY" && ls packages/config/src/sections/ && git status --short
   ```

   - [ ] Only `app.ts` and `plans.ts` are present, and the tree holds no partial install

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

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm verify:pins
```

```sh
pnpm verify:content
```

```sh
cd .dev/playground && pnpm install && pnpm build && pnpm typecheck
```

- ✅ `pnpm lint` → all four passes clean, including the type-aware pass over the new `collisions.ts`, `doctor.ts` and `scripts/` files, and Prettier over the whole tree.
- ✅ `pnpm typecheck` → the scripts project and every workspace compile, `scripts/config-shim.ts` included.
- ✅ `pnpm test` → 1311 CLI tests, 540 module-payload tests, 169 script tests, 0 failures. New coverage: 9 merge cases in `scripts/config-merge.test.ts` (leaf replace, nested record replaced whole, array replaced whole, explicit `undefined` ignored, freeze, no mutation of the declared section, duplicate key throws, unknown override throws), 15 in `collisions.test.ts` for the section guard, 4 in `applier.test.ts` for the refusal at plan time (same run, installed module, `--force` re-apply), 10 in `doctor.test.ts` for the three checks.
- ✅ `pnpm verify:pins` → both pin rules agree across their manifests, with the new `packages/config/package.json` in scope.
- ✅ `pnpm verify:content` → no prose literal escaped `content/landing.ts` when the tier ids moved.
- ✅ A scaffold with `database-d1`, `auth`, `admin` and `billing`: `pnpm build` and `pnpm typecheck` both green, 11 workspaces. The section registry holds all four calls and `packages/config/src/sections/` holds all four files.
- ✅ `saasaloy doctor .` on that scaffold → one finding, the unedited `site: "https://example.com"`, with `project.ts` correctly listed as a seed file.
- ❌ `pnpm deps:check` reports 69 pending bumps, and `pnpm -C .dev/playground build` fails on the base template's `wrangler` pin (4.129.0) against `@cloudflare/vite-plugin`'s `^4.135.0` peer range. **Both are pre-existing on `main` and unrelated to this change**; `pnpm deps:update` owns them.

## Not covered / needs human judgment

- **Every browser check.** This box is headless, so Scenario 1 and TC-2.3 need a real browser on the tester's own machine.
- **Dark mode, responsive layout and accessibility.** No block's markup changed — the footer's two `href` values and the layout's `lang` attribute are the whole visual diff — so the theme, the breakpoints and the focus order were considered and skipped.
- **The database.** No migration, no schema file and no query changed, so the data layer is out of scope. Renaming a role in config does **not** rewrite the `users.role` values already stored; an existing project needs its own `update`, which the `saasaloy-auth` skill now says.
- **Performance.** `config` is a frozen object built once at module load with no I/O, so there is nothing to measure.
- **A real billing email.** Confirming `config.billing.appName` in a sent message needs a provider account. TC-2.4 checks the reader instead.
- **`saasaloy update` over a project whose sections a module rewrote.** The override file is declared a seed, and `doctor` confirms it is not checked, but a full update run across a released version is its own pass.
- **The patched line's width.** After two modules patch it, `packages/config/src/sections.ts` is longer than Prettier's width until the project runs `pnpm format`. `packages/queue/src/index.ts` already behaves this way, so the codemod's output is consistent rather than newly wrong.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
