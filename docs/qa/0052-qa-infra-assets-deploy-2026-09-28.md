# QA Plan: infra deploys assets-only Workers

_Generated 2026-09-28 · against `5438886` plus the uncommitted #180 change · covers `modules/infra` (plan 0067, Phases 1 and 2, and the Phase 3 live checks)_

## Summary

- The `infra` module deploys a Worker that has an `assets` block and no `main`, such as the base's `apps/web` and the `admin` app.
- Working means `preview` and `deploy` run with no prompt, the site serves with its 404 page and cache headers, and no private build file is public.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Run on a machine with the Pulumi CLI and network access to Cloudflare. The devaloy box has no Pulumi CLI.
- Use a Cloudflare account that you can deploy test Workers to.
- For Scenario 1, create an API token with only the "Workers Scripts: Edit" permission. Scenario 2 needs a second token that also has "D1: Edit".
- A fresh base does not build today, because `@cloudflare/vite-plugin` needs a newer wrangler than the template pins. Each scenario setup bumps wrangler in the playground only. The separate `fix(template)` issue removes this step.
- Find your `workers.dev` subdomain in the Cloudflare dashboard, under Workers & Pages. The examples below use `example`.

Check out the branch and build the CLI, from the repo root:

```sh
git checkout issue-180-deploy-assets-only-workers && pnpm install && pnpm --filter saasaloy build
```

Set the deploy credentials. Use the Workers-only token first:

```sh
export CLOUDFLARE_API_TOKEN=<workers-scripts-edit-token> CLOUDFLARE_DEFAULT_ACCOUNT_ID=<account-id> PULUMI_CONFIG_PASSPHRASE=dev-passphrase
```

Set the live URLs. Replace `example` with your subdomain:

```sh
export WEB_URL=https://playground-web.example.workers.dev ADMIN_URL=https://admin.example.workers.dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh playground with infra, never deployed | First preview runs with no prompt and lists the web Worker | 🔴 Critical |
| TC-1.2 | 1: Fresh playground with infra, never deployed | Deploy with a Workers-only token serves the site | 🔴 Critical |
| TC-1.3 | 1: Fresh playground with infra, never deployed | Private build files are not public | 🔴 Critical |
| TC-1.4 | 1: Fresh playground with infra, never deployed | Preview shows a diff only when a page changes | 🟡 Normal |
| TC-1.5 | 1: Fresh playground with infra, never deployed | Destroy removes the web Worker | 🟡 Normal |
| TC-2.1 | 2: Playground with infra, admin and api | Admin deploys and serves deep routes | 🔴 Critical |
| TC-2.2 | 2: Playground with infra, admin and api | The api Worker still deploys from its bundle | 🟡 Normal |
| TC-2.3 | 2: Playground with infra, admin and api | Destroy removes every Worker | 🟡 Normal |

## Scenario 1: Fresh playground with infra, never deployed

**Setup.** Run once, for every case in this scenario. Start from the repo root.

1. Create a fresh playground and commit it, so `saasaloy add` starts from a clean tree.

```sh
pnpm play:reset && cd .dev/playground && git init -q && git add -A && git commit -qm base
```

2. Add `infra`, then install.

```sh
./saasaloy add infra --yes && pnpm install
```

3. Bump wrangler in `apps/web`, so the base builds.

```sh
pnpm --filter @repo/web add -D wrangler@4.141.0
```

- [ ] Setup complete

### TC-1.1: First preview runs with no prompt and lists the web Worker  ·  🔴 Critical

**Goal.** A new clone reaches a working `preview` with two commands and no interactive prompt.

**Steps**

1. Create the stack.

   ```sh
   pnpm --filter @repo/infra run stack:init
   ```

   - [ ] The command creates the `prod` stack and asks no question
2. Run the preview.

   ```sh
   pnpm --filter @repo/infra run preview
   ```

   - [ ] The preview asks no question and ends with no error
     - it plans one `cloudflare:index:WorkersScript` named `playground-web`
     - it plans one `WorkersScriptSubdomain` named `playground-web-subdomain`
     - it plans nothing else
   - [ ] The log shows `infra: playground-web has no Worker script — skipping secrets.`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Deploy with a Workers-only token serves the site  ·  🔴 Critical

**Goal.** A token with only "Workers Scripts: Edit" deploys the web Worker, and the Worker serves the site, its 404 page and its cache headers.

**Steps**

1. Deploy.

   ```sh
   pnpm --filter @repo/infra run deploy -- --yes
   ```

   - [ ] The deploy ends with no error and no permission failure
2. Open `$WEB_URL` in a browser.
   - [ ] The landing page shows with its styles and scripts loaded
3. Request an unknown path.

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' "$WEB_URL/no-such-page"
   ```

   - [ ] The status is `404`
4. Open `$WEB_URL/no-such-page` in the browser.
   - [ ] The browser shows the site's own 404 page, not an empty Cloudflare page
5. Find one `/_astro/` file name. Open the landing page source and copy a `src` or `href` that starts with `/_astro/`. Request its headers.

   ```sh
   curl -sI "$WEB_URL/_astro/<file-from-page-source>" | grep -i cache-control
   ```

   - [ ] The header is `cache-control: public, max-age=31536000, immutable`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Private build files are not public  ·  🔴 Critical

**Goal.** The files the Astro build leaves beside the site never reach Cloudflare.

**Steps**

1. Request each private file and print its status.

   ```sh
   for p in wrangler.json .dev.vars .assetsignore _headers; do printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "$WEB_URL/$p"; done
   ```

   - [ ] Every line shows `404`
2. Open `$WEB_URL/wrangler.json` in the browser.
   - [ ] The browser shows the site's 404 page, with no JSON on it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: Preview shows a diff only when a page changes  ·  🟡 Normal

**Goal.** Change detection follows the asset contents: no change shows no diff, and one changed page shows a diff on that Worker.

**Steps**

1. Run the preview with no change.

   ```sh
   pnpm --filter @repo/infra run preview -- --diff
   ```

   - [ ] The preview shows no change to `playground-web`
2. Change one page. Add a word to the heading text in `apps/web/src/pages/privacy.astro`. Run the preview again.

   ```sh
   pnpm --filter @repo/infra run preview -- --diff
   ```

   - [ ] The preview shows an update to `playground-web` only, and no replacement
3. Undo the edit to `privacy.astro`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: Destroy removes the web Worker  ·  🟡 Normal

**Goal.** Pulumi owns the assets-only Worker, so `destroy` removes it.

**Steps**

1. Destroy.

   ```sh
   pnpm --filter @repo/infra run destroy -- --yes
   ```

   - [ ] The destroy ends with no error
2. Open the Workers list in the Cloudflare dashboard.
   - [ ] `playground-web` is not in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before you move to Scenario 2. Start from the repo root.

```sh
pnpm play:destroy
```

## Scenario 2: Playground with infra, admin and api

**Setup.** Run once, for every case in this scenario. Start from the repo root.

1. Create a fresh playground and commit it.

```sh
pnpm play:reset && cd .dev/playground && git init -q && git add -A && git commit -qm base
```

2. Add `admin`, which also adds `api` and `auth`, then add `infra`, then install.

```sh
./saasaloy add admin --yes && ./saasaloy add infra --yes && pnpm install
```

3. Bump wrangler in every app, so each one builds.

```sh
pnpm --filter "./apps/*" add -D wrangler@4.141.0
```

4. Switch to the token that also has "D1: Edit", because `api` declares a D1 database.

```sh
export CLOUDFLARE_API_TOKEN=<workers-and-d1-edit-token>
```

5. Create the stack.

```sh
pnpm --filter @repo/infra run stack:init
```

- [ ] Setup complete

### TC-2.1: Admin deploys and serves deep routes  ·  🔴 Critical

**Goal.** The SPA's `single-page-application` handling survives the deploy, so a hard reload on a client route works.

**Steps**

1. Run the preview.

   ```sh
   pnpm --filter @repo/infra run preview
   ```

   - [ ] The preview ends with no error and plans a `WorkersScript` and a subdomain for each of `admin`, `api` and `playground-web`
2. Deploy.

   ```sh
   pnpm --filter @repo/infra run deploy -- --yes
   ```

   - [ ] The deploy ends with no error
3. Request a deep route.

   ```sh
   curl -s -w '\n%{http_code}\n' "$ADMIN_URL/some/deep/route" | tail -3
   ```

   - [ ] The status is `200` and the body is the admin `index.html`
4. Open `$ADMIN_URL/some/deep/route` in the browser.
   - [ ] The admin app loads, and its router handles the path

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The api Worker still deploys from its bundle  ·  🟡 Normal

**Goal.** A Worker with `main` keeps the old path: bundle upload, D1 binding and secrets.

**Steps**

1. Read the deploy log from TC-2.1.
   - [ ] The log shows secret handling for `api` (a push, or `no .env found`), and the skip line for `admin` and `playground-web` only
2. Request the api health route.

   ```sh
   curl -s -w '\n%{http_code}\n' https://api.example.workers.dev/health
   ```

   - [ ] The api Worker itself answers, not a Cloudflare "no such Worker" page
     - a `500` is acceptable here: `auth` fails closed when `BETTER_AUTH_SECRET` is unset, and this plan sets no secrets

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Destroy removes every Worker  ·  🟡 Normal

**Goal.** One `destroy` removes both assets-only Workers and the api Worker with its database.

**Steps**

1. Destroy.

   ```sh
   pnpm --filter @repo/infra run destroy -- --yes
   ```

   - [ ] The destroy ends with no error
2. Open the Workers list and the D1 list in the Cloudflare dashboard.
   - [ ] `admin`, `api` and `playground-web` are gone, and the api D1 database is gone

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. Start from the repo root.

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm test
```

```sh
pnpm typecheck
```

```sh
pnpm lint
```

```sh
pnpm build
```

```sh
pnpm deps:check
```

```sh
cd .dev/playground && ./saasaloy add infra --yes && pnpm install && pnpm --filter @repo/infra typecheck
```

```sh
mkdir -p .dev/playground/infra/.stage/x && pnpm -C .dev/playground --filter @repo/infra clean
```

- ✅ `pnpm test` → 547 module tests and 160 script tests pass, with the 7 new `stageAssets` cases in `modules/infra/files/src/stage.test.ts`.
- ✅ `pnpm typecheck`, `pnpm lint` (all four passes) and `pnpm build` → clean.
- ❌ `pnpm deps:check` → 76 outdated pins. The same pins are outdated on `main`. The two new pins, `ignore` 7.0.10 and `rimraf` 6.1.3, are current.
- ✅ `saasaloy add infra` → writes `infra/.gitignore` (lists `.stage/`), `infra/src/stage.ts`, and the `stack:init` and `clean` scripts. The scaffolded `tsc --noEmit` passes.
- ✅ `clean` → removes `infra/.stage/`.
- ✅ Pulumi runtime mocks, real Astro build in the playground → one `WorkersScript` (`playground-web`, `assets.directory` `.stage/playground-web`, `headers` from `_headers`, `notFoundHandling` `404-page`, no `content`) and one `WorkersScriptSubdomain`. The staged copy holds the pages and `_astro/*`, and no `wrangler.json`, `.dev.vars`, `.assetsignore` or `_headers`.
- ✅ Pulumi runtime mocks, fixture repo → `admin` gets `notFoundHandling` `single-page-application`. An `api` fixture with `main` gets inputs identical to the old `translate.ts`.
- ✅ Refusals → `assets` plus `main` throws `infra doesn't support 'assets' on a Worker with 'main' yet`. Two services with one name throw and name both paths.
- ✅ `index.ts` under mocks → logs the secrets skip for each assets-only service and calls `pushSecrets` for `api`.

## Not covered / needs human judgment

- The live checks need the Pulumi CLI and a Cloudflare account. The agent had neither, so every case above is manual.
- The fresh-base build break is out of scope. Each setup bumps wrangler in the playground only; the `fix(template)` issue owns the real fix.
- UI dimensions (compatibility, accessibility, UX) do not apply. The change adds no screen.
- The data layer is not touched. There is no database check beyond TC-2.3's D1 removal.
- Concurrency does not apply. The file state backend has no lock, and ADR 0021 already records that.
- The CLI release that carries this change is a later step. It is not part of this run.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
