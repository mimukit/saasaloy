# QA Plan: wrangler-native deploy (`pnpm deploy:production`)

_Generated 2026-10-18 · against `72f8c59` (uncommitted changes) · covers issue #198: `env-deploy`, the base `deploy:production` script, the module deploy steps, the `infra` removal, the doctor warning, and the upgrade runbook_

## Summary

- `pnpm deploy:production` checks every production value, then builds and deploys every Worker with wrangler, secrets included.
- Working means one command deploys a fresh project to an empty Cloudflare account, a second run changes no resource, and an old `infra` project moves across with its data.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Use a **throwaway Cloudflare account** with a Workers paid plan. Every scenario creates and deletes real resources.
- Create an API token for that account with these permissions: Workers Scripts edit, D1 edit, Workers KV Storage edit, Workers R2 Storage edit, Queues edit. The token must reach only the throwaway account.
- Work in the issue #198 worktree. Every project goes under `.dev/`, which git ignores.

Build the CLI from this branch:

```sh
pnpm install && pnpm --filter saasaloy build
```

Export the throwaway account's credentials in the shell you test from:

```sh
export CLOUDFLARE_API_TOKEN=<token for the throwaway account> CLOUDFLARE_ACCOUNT_ID=<throwaway account id>
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh landing-page project, empty account | First deploy ships the landing page with production values | 🔴 Critical |
| TC-1.2 | 1: Fresh landing-page project, empty account | Second deploy updates the same Worker | 🟡 Normal |
| TC-2.1 | 2: Project with api, auth, D1, KV and queues, empty account | One command deploys everything from an empty account | 🔴 Critical |
| TC-2.2 | 2: Project with api, auth, D1, KV and queues, empty account | Second deploy creates no new resource | 🔴 Critical |
| TC-2.3 | 2: Project with api, auth, D1, KV and queues, empty account | A removed secret stays until `wrangler secret delete` | 🟡 Normal |
| TC-2.4 | 2: Project with api, auth, D1, KV and queues, empty account | `wrangler rollback` returns the api to the previous version | 🟢 Low |
| TC-2.5 | 2: Project with api, auth, D1, KV and queues, empty account | The wiki teardown commands remove every resource | 🟡 Normal |
| TC-3.1 | 3: Project on the last `infra` release, deployed with Pulumi | The runbook moves the project and keeps its data | 🔴 Critical |

## Scenario 1: Fresh landing-page project, empty account

**Setup.** Run once, for every case in this scenario.

1. Scaffold a project and install it.

```sh
node packages/cli/dist/index.js init .dev/qa198-web --no-install && pnpm -C .dev/qa198-web install
```

2. Write the production values. Use a real-looking origin that differs from the dev value.

```sh
printf 'PUBLIC_SITE_URL=https://qa198.example.com\nPUBLIC_API_URL=https://api.qa198.example.com\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\n' > .dev/qa198-web/packages/env/.env.prod
```

3. Write the dev values, so a dev `.env` sits beside the web app.

```sh
cp .dev/qa198-web/packages/env/.env.example .dev/qa198-web/packages/env/.env && pnpm -C .dev/qa198-web env:setup
```

- [ ] Setup complete

### TC-1.1: First deploy ships the landing page with production values  ·  🔴 Critical

**Goal.** A fresh project deploys with one command and the page carries the production origin.

**Steps**

1. Run the deploy.

   ```sh
   pnpm -C .dev/qa198-web deploy:production
   ```

   - [ ] The output says every service has its production values, then prints a `workers.dev` URL for `qa198-web-web`
     - wrangler prints "Using redirected Wrangler configuration"
     - no line says a secrets file was used
2. Open the printed URL in a browser.
   - [ ] The landing page renders with its styles and images
3. View the page source and find the `canonical` link.
   - [ ] The canonical URL starts with `https://qa198.example.com/`, not `http://localhost:3000/`
4. Read the dev file.

   ```sh
   cat .dev/qa198-web/apps/web/.env
   ```

   - [ ] It still holds `PUBLIC_SITE_URL=http://localhost:3000` and no production value
5. Look for a leftover secrets folder.

   ```sh
   ls -d /tmp/env-deploy-* 2>/dev/null || echo none
   ```

   - [ ] The command prints `none`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Second deploy updates the same Worker  ·  🟡 Normal

**Goal.** A second run updates the existing Worker and creates no other one.

**Steps**

1. Change `PUBLIC_SITE_URL` in `.dev/qa198-web/packages/env/.env.prod` to `https://qa198-second.example.com`. Run the deploy again.

   ```sh
   pnpm -C .dev/qa198-web deploy:production
   ```

   - [ ] It prints the same `workers.dev` URL as TC-1.1
2. Reload the page and view its source.
   - [ ] The canonical URL now starts with `https://qa198-second.example.com/`
3. Open the Cloudflare dashboard, Workers & Pages, for the throwaway account.
   - [ ] One Worker named `qa198-web-web` exists, with two deployments in its history

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
pnpm -C .dev/qa198-web/apps/web exec wrangler delete --force
```

```sh
rm -rf .dev/qa198-web
```

## Scenario 2: Project with api, auth, D1, KV and queues, empty account

**Setup.** Run once, for every case in this scenario.

1. Scaffold the project and add the modules, one at a time.

```sh
node packages/cli/dist/index.js init .dev/qa198-full --no-install && cp scripts/saasaloy-shim.sh .dev/qa198-full/saasaloy && chmod +x .dev/qa198-full/saasaloy
```

```sh
cd .dev/qa198-full && for m in api database-d1 auth kv-cloudflare queue-cloudflare; do ./saasaloy add $m --yes; done && pnpm install && pnpm --filter @repo/db db:generate && cd ../..
```

2. Rename the api Worker, so it cannot collide with another project in the account. In `.dev/qa198-full/apps/api/wrangler.jsonc`, change `"name": "api"` to `"name": "qa198-api"`.
3. Add a probe route that reads KV and the database. Append this to `.dev/qa198-full/apps/api/src/routes/health.ts`:

   ```ts
   // oxlint-disable-next-line typescript/no-explicit-any
   export const probe = new Hono<{ Bindings: any }>().get("/", async (c) => {
     await c.env.KV.put("probe", "kv-ok");
     const kv = await c.env.KV.get("probe");
     const db = await c.env.DB.prepare("select count(*) as n from users").first();
     return c.json({ kv, db }, 200);
   });
   ```

4. In `.dev/qa198-full/apps/api/src/index.ts`, import `probe` beside `health`, and change `base.route("/health", health)` to `base.route("/health", health).route("/probe", probe)`.
5. Write the production values.

```sh
printf 'PUBLIC_SITE_URL=https://qa198.example.com\nPUBLIC_API_URL=https://api.qa198.example.com\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\nBETTER_AUTH_SECRET=qa198-prod-secret-0123456789abcdef0123456789\nBETTER_AUTH_URL=https://qa198-api.example.com\nKV_PROVIDER=cloudflare\nQUEUE_PROVIDER=cloudflare\nLOGGER_PROVIDER=console\nLOG_LEVEL=info\nQA_EXTRA_SECRET=extra\n' > .dev/qa198-full/packages/env/.env.prod
```

6. List `QA_EXTRA_SECRET` for the api. In `.dev/qa198-full/packages/env/.env.example`, add the line `QA_EXTRA_SECRET=` under the `# @services api` line.

- [ ] Setup complete

### TC-2.1: One command deploys everything from an empty account  ·  🔴 Critical

**Goal.** An empty account gets D1, KV, both queues and both Workers from one command, and the api reads KV and the database.

**Steps**

1. Run the deploy.

   ```sh
   pnpm -C .dev/qa198-full deploy:production
   ```

   - [ ] `db:migrate:prod` runs before `@repo/api#deploy`, prints "No D1 database named app-db yet. Creating it.", and applies the migrations
   - [ ] The api deploy provisions the KV namespace and both queues, then prints a `workers.dev` URL
     - the binding table lists `env.KV`, `env.JOBS`, `env.JOBS_DLQ`, `env.DB` and the three rate limits
   - [ ] The web deploy prints its own `workers.dev` URL
2. Call the probe route. Use the api URL from step 1.

   ```sh
   curl -s -w '\n%{http_code}\n' https://qa198-api.<your-subdomain>.workers.dev/probe
   ```

   - [ ] The response is `{"kv":"kv-ok","db":{"n":0}}` with status `200`
3. List the api Worker's secrets.

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler secret list
   ```

   - [ ] The list holds `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `QA_EXTRA_SECRET`, and no key that starts with `CLOUDFLARE_`
4. Read the dev files and look for a leftover secrets folder.

   ```sh
   grep -rl 'qa198-prod-secret' .dev/qa198-full/apps /tmp/env-deploy-* 2>/dev/null || echo none
   ```

   - [ ] The command prints `none`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: Second deploy creates no new resource  ·  🔴 Critical

**Goal.** A second run reuses every resource the first run created.

**Steps**

1. Run the deploy again.

   ```sh
   pnpm -C .dev/qa198-full deploy:production
   ```

   - [ ] `db:migrate:prod` creates no database and reports no migration to apply
   - [ ] The api deploy provisions nothing
2. List the resources in the account.

   ```sh
   cd .dev/qa198-full/apps/api && pnpm exec wrangler d1 list && pnpm exec wrangler kv namespace list && pnpm exec wrangler queues list && cd ../../../..
   ```

   - [ ] The account holds one `app-db`, one namespace titled `qa198-api-kv`, one `app-jobs` and one `app-jobs-dlq`
3. Call the probe route again.

   ```sh
   curl -s https://qa198-api.<your-subdomain>.workers.dev/probe
   ```

   - [ ] The response is still `{"kv":"kv-ok","db":{"n":0}}`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A removed secret stays until `wrangler secret delete`  ·  🟡 Normal

**Goal.** The deploy only adds secrets, and the wiki command removes one.

**Steps**

1. Delete the `QA_EXTRA_SECRET` line from both `.env.prod` and `.env.example`. Run the deploy.

   ```sh
   pnpm -C .dev/qa198-full deploy:production
   ```

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler secret list
   ```

   - [ ] `QA_EXTRA_SECRET` is still in the list
2. Delete it with the command from the deploy wiki.

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler secret delete QA_EXTRA_SECRET
   ```

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler secret list
   ```

   - [ ] `QA_EXTRA_SECRET` is no longer in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: `wrangler rollback` returns the api to the previous version  ·  🟢 Low

**Goal.** The rollback command in the deploy wiki works on a Worker this flow deployed.

**Steps**

1. Show the deployment history, then roll back.

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler deployments list
   ```

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler rollback
   ```

   - [ ] wrangler asks for a reason, then reports the previous version as active
2. Call the probe route.

   ```sh
   curl -s https://qa198-api.<your-subdomain>.workers.dev/probe
   ```

   - [ ] The response is still `{"kv":"kv-ok","db":{"n":0}}`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.5: The wiki teardown commands remove every resource  ·  🟡 Normal

**Goal.** Each teardown command in the deploy wiki runs as written and leaves the account empty.

**Steps**

1. Open `docs/wiki/how-to/deploy-to-cloudflare.md`, section "Tearing it down". Run each command from the root of `.dev/qa198-full`, in the order the wiki gives.
   - [ ] Every command runs as written, with only the KV namespace id filled in from the list command
2. Open the Cloudflare dashboard for the throwaway account.
   - [ ] No Worker, D1 database, KV namespace or queue from this scenario remains

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
rm -rf .dev/qa198-full
```

## Scenario 3: Project on the last `infra` release, deployed with Pulumi

**Setup.** Run once, for every case in this scenario.

1. Scaffold a project with the last published CLI that ships `infra`, and add the modules.

```sh
pnpm dlx saasaloy@0.5.2 init .dev/qa198-old && cd .dev/qa198-old && pnpm dlx saasaloy@0.5.2 add api && pnpm dlx saasaloy@0.5.2 add database-d1 && pnpm dlx saasaloy@0.5.2 add infra && pnpm install && cd ../..
```

2. In `.dev/qa198-old/apps/api/wrangler.jsonc`, change `"name": "api"` to `"name": "qa198-old-api"`.
3. Follow the `saasaloy-infra` skill in `.dev/qa198-old/.agents/skills/` to set `infra/.env` and run `stack:init` and `deploy`.
4. Write one row into the production database.

```sh
pnpm -C .dev/qa198-old/packages/db exec wrangler d1 execute app-db --remote --command "create table qa_marker(id text primary key); insert into qa_marker values ('QA-198');"
```

- [ ] Setup complete

### TC-3.1: The runbook moves the project and keeps its data  ·  🔴 Critical

**Goal.** A project deployed through Pulumi reaches `pnpm deploy:production` with the same Workers and the same data.

**Steps**

1. Run the doctor from this branch.

   ```sh
   cd .dev/qa198-old && node ../../packages/cli/dist/index.js doctor; cd ../..
   ```

   - [ ] The doctor reports that `infra/` is the Pulumi deploy that `pnpm deploy:production` replaced, warns against `pulumi destroy`, and names the runbook URL
2. Update the base from this branch.

   ```sh
   cd .dev/qa198-old && SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js update; cd ../..
   ```

   - [ ] The root `package.json` now has a `deploy:production` script
3. Follow `docs/wiki/runbooks/move-off-the-infra-module.md`, steps 1 to 6, as written.
   - [ ] Each step runs as written, with no command or file path that does not exist
   - [ ] Step 6 prints the same `workers.dev` URL the Pulumi deploy used for `qa198-old-api`
4. Read the marker row.

   ```sh
   pnpm -C .dev/qa198-old/packages/db exec wrangler d1 execute app-db --remote --command "select id from qa_marker;"
   ```

   - [ ] The result holds one row, `QA-198`
5. Open the Cloudflare dashboard for the throwaway account.
   - [ ] One `qa198-old-api` Worker and one `app-db` database exist, and no second copy of either

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd .dev/qa198-old/apps/api && pnpm exec wrangler delete --force && pnpm exec wrangler d1 delete app-db --skip-confirmation && cd ../../../..
```

```sh
rm -rf .dev/qa198-old
```

## Automated verification (by AI agent)

_Checks the agent ran itself on `72f8c59` with uncommitted changes. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

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
pnpm deps:check
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test packages/cli/templates/base/packages/env/src/deploy.test.ts
```

```sh
node packages/cli/dist/index.js init .dev/fresh198 --no-install && pnpm -C .dev/fresh198 install && cd .dev/fresh198 && pnpm lint && pnpm typecheck && pnpm test
```

```sh
env -u CLOUDFLARE_API_TOKEN HOME=/tmp/emptyhome XDG_CONFIG_HOME=/tmp/emptyhome/.config pnpm deploy:production
```

```sh
cd apps/web && CLOUDFLARE_API_TOKEN=dummy-not-real pnpm exec env-deploy web -- --dry-run
```

```sh
CLOUDFLARE_API_TOKEN=dummy-not-real PUBLIC_SITE_URL=https://shell-wins.example pnpm turbo run deploy --ui=stream -- -- --dry-run
```

```sh
cd apps/api && CLOUDFLARE_API_TOKEN=dummy-not-real pnpm exec env-deploy api -- --dry-run
```

```sh
pnpm turbo run deploy --dry=json
```

- ✅ `pnpm lint` → all four passes clean, Prettier reports every file formatted.
- ✅ `pnpm typecheck` → exit 0.
- ✅ `pnpm test` → 58 vitest files pass; node test runs pass 633, 90 and 302 with 0 failures.
- ✅ `deploy.test.ts` → 20 tests pass. Each new test went red under a deliberate break of the code it covers: the credential filter, the file cleanup, the assets-only skip, the missing-key check, the login gate, the shell override, the empty-key fill, and the dev-vars flag.
- ✅ Fresh `saasaloy init` project → its own `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (90 env tests).
- ✅ No `.env.prod` → `deploy:production` stops with "packages/env/.env.prod does not exist" before any build.
- ✅ Blank token, no wrangler login → `deploy:production` stops with "CLOUDFLARE_API_TOKEN has no value and wrangler holds no login", and `apps/web/dist` does not exist.
- ✅ `env-deploy web -- --dry-run` with a dev `apps/web/.env` present → the built canonical URL is the production origin, and `apps/web/.env` keeps its dev values.
- ✅ `turbo run deploy` with an exported `PUBLIC_SITE_URL` → the exported value reaches the bundle. Without `passThroughEnv`, turbo drops the exported token and the run stops.
- ✅ `env-deploy api -- --dry-run` → the upload lists the KV, D1, both queues, the rate limits and the six secrets, with no `CLOUDFLARE_*` key. No `/tmp/env-deploy-*` folder remains.
- ✅ `turbo run deploy --dry=json` → `@repo/db#db:migrate:prod` is a dependency of `@repo/api#deploy`.
- ✅ Local dev with no ids (`.dev/probe-198`) → `vite dev` served D1, KV, R2 and a queue, and `wrangler d1 execute --local` wrote to the same database.
- ✅ `pnpm db:setup` in a project with `database-d1` and no `database_id` → the local migrations applied.
- ❌ `pnpm deps:check` → 72 pins have newer releases upstream (for example `astro 7.3.5 → 7.4.0`, `wrangler 4.145.0 → 4.151.1`). No pin this branch added is on the list.
- ❌ Live `wrangler deploy` to a Cloudflare account → not run. The agent's permission rules blocked it, so every live answer in plan 0070's Phase 1 comes from the wrangler source. Scenarios 1 to 3 are the live check.

## Not covered / needs human judgment

- The live deploy itself. The agent did not upload anything to Cloudflare, so the provisioning and reuse behaviour rests on wrangler's source until TC-1.1, TC-2.1 and TC-2.2 pass.
- Queue dead-letter routing. TC-2.1 shows both queues exist; it does not force a message to the dead-letter queue.
- A known bug outside this branch. In the `.dev` project with `queue-cloudflare`, `vite dev` for the api stopped with "Cannot access 'PROVIDER_NAME' before initialization". If TC-2.1's Worker fails to start with the same error, record it in Notes, and run Scenario 2 again without `queue-cloudflare`.
- `env-infisical` as the value source. Every scenario uses `local`. The Infisical path loads through the same `EnvSource` contract and has unit tests, but no live Infisical project was used.
- Two projects in one account. The project-name prefix is issue #197. Scenario 2 renames the api Worker by hand for that reason.
- CI deploy. That is issue #199.
- Compatibility, accessibility and performance of the landing page. This change does not touch the page; TC-1.1 only checks that it renders.
- Windows. `env-deploy` spawns `pnpm` and `wrangler` by name, and no Windows host was used.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
