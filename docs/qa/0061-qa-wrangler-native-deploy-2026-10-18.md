# QA Plan: wrangler-native deploy (`pnpm deploy:production`)

_Generated 2026-10-18, updated 2026-10-21 · against `45fd794` (clean) · covers issue #198: `env-deploy`, the base `deploy:production` script, the module deploy steps, the `infra` removal, the doctor warning, and the upgrade runbook_

## Summary

- `pnpm deploy:production` checks every production value, then builds and deploys every Worker with wrangler, secrets included.
- Working means one command deploys a fresh project to an empty Cloudflare account, a second run creates no resource, and an old `infra` project moves across with its data.

The agent ran every check that needs no Cloudflare account. The results are in **Automated verification** at the end.

On 2026-10-21 the agent also ran Scenarios 1 and 2 live on `0eab263`, which changes only this plan after `45fd794`. The target was the Brainaloy Personal account, declared disposable for resources whose names start with `qa198-` only. The token reached that one account. Before the run, the account held no Worker, D1 database, KV namespace or queue. Every resource in the run had a `qa198-` name, and after the run the account held none of them again. The result is TC-1.1 pass, TC-2.1 pass, TC-2.2 pass and TC-2.3 fail. Scenario 3 is not run.

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
| TC-1.1 | 1: Fresh landing-page project, empty account | Two deploys ship the landing page and update one Worker | 🔴 Critical |
| TC-2.1 | 2: Project with api, auth, D1, KV and queues, empty account | Two deploys build the whole project and create each resource once | 🔴 Critical |
| TC-2.2 | 2: Project with api, auth, D1, KV and queues, empty account | Secrets and rollback work as the deploy wiki says | 🟡 Normal |
| TC-2.3 | 2: Project with api, auth, D1, KV and queues, empty account | The wiki teardown commands empty the account | 🟢 Low |
| TC-3.1 | 3: Project on the last `infra` release, deployed with Pulumi | The runbook moves the project and keeps its data | 🔴 Critical |

## Scenario 1: Fresh landing-page project, empty account · run by the agent on Brainaloy Personal at `0eab263`

**Setup.** Run once, for every case in this scenario.

1. Scaffold a project and install it.

```sh
node packages/cli/dist/index.js init .dev/qa198-web --no-install && pnpm -C .dev/qa198-web install
```

2. Write the production values.

```sh
printf 'PUBLIC_SITE_URL=https://qa198.example.com\nPUBLIC_API_URL=https://api.qa198.example.com\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\n' > .dev/qa198-web/packages/env/.env.prod
```

- [x] Setup complete

### TC-1.1: Two deploys ship the landing page and update one Worker  ·  🔴 Critical

**Goal.** A fresh project deploys with one command, carries the production origin, and a second run updates the same Worker.

**Steps**

1. Run the deploy. Then read the canonical URL from the live page. Use the `workers.dev` URL that the deploy prints.

   ```sh
   pnpm -C .dev/qa198-web deploy:production
   ```

   ```sh
   curl -s https://qa198-web-web.<your-subdomain>.workers.dev/ | grep -o '<link rel="canonical" href="[^"]*"'
   ```

   - [x] The deploy prints a `workers.dev` URL for `qa198-web-web`, and the canonical URL is `https://qa198.example.com/`
2. Open the URL in a browser.
   - [x] The page looks the same as the screenshot the agent took of the local production build
     - screenshot: `/tmp/qakit/0061-qa-wrangler-native-deploy-2026-10-18/web-1440.png` light 1440 px
     - screenshot: `/tmp/qakit/0061-qa-wrangler-native-deploy-2026-10-18/web-375.png` light 375 px
     - screenshot: `/tmp/qakit/0061-qa-wrangler-native-deploy-2026-10-18/live-1440.png` light 1440 px, the live page
3. Change `PUBLIC_SITE_URL` in `.dev/qa198-web/packages/env/.env.prod` to `https://qa198-second.example.com`. Deploy again, read the canonical URL, and list the deployments.

   ```sh
   pnpm -C .dev/qa198-web deploy:production
   ```

   ```sh
   curl -s https://qa198-web-web.<your-subdomain>.workers.dev/ | grep -o '<link rel="canonical" href="[^"]*"'
   ```

   ```sh
   pnpm -C .dev/qa198-web/apps/web exec wrangler deployments list
   ```

   - [x] The deploy prints the same URL, the canonical URL is `https://qa198-second.example.com/`, and the list shows two deployments

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** The agent ran the deploys with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` unset in the shell, so the credentials came from `.env.prod`.

```text
Every service has its production values (source: local).
@repo/web:deploy: Using redirected Wrangler configuration.
@repo/web:deploy: ✨ Success! Uploaded 12 files (2.18 sec)
@repo/web:deploy: Uploaded qa198-web-web (6.70 sec)
@repo/web:deploy:   https://qa198-web-web.brainaloy-personal.workers.dev
```

- The first deploy served status `200` with `<link rel="canonical" href="https://qa198.example.com/"`. The live page had 3 stylesheets, 0 console messages and no overflow at 1440 px. No `/tmp/env-deploy-*` folder remained.
- The second deploy printed the same URL. The canonical URL changed to `https://qa198-second.example.com/`, and `wrangler deployments list` showed 2 deployments.
- The reset printed "Successfully deleted qa198-web-web", and the account then held no Worker.

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
pnpm -C .dev/qa198-web/apps/web exec wrangler delete --force
```

```sh
rm -rf .dev/qa198-web
```

## Scenario 2: Project with api, auth, D1, KV and queues, empty account · run by the agent on Brainaloy Personal at `0eab263`

_In the agent's run, every resource had a `qa198-` name: the api Worker `qa198-api`, the database `qa198-app-db`, and the queues `qa198-jobs` and `qa198-jobs-dlq`, set in `apps/api/wrangler.jsonc`. The web Worker was `qa198-full-web`. `PUBLIC_API_URL` and `BETTER_AUTH_URL` were `https://qa198-api.brainaloy-personal.workers.dev`. On a throwaway account, use the names below._

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
printf 'PUBLIC_SITE_URL=https://qa198.example.com\nPUBLIC_API_URL=https://api.qa198.example.com\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\nBETTER_AUTH_SECRET=qa198-prod-secret-0123456789abcdef0123456789\nBETTER_AUTH_URL=https://qa198-api.example.com\nCORS_ORIGINS=https://qa198.example.com\nKV_PROVIDER=cloudflare\nKV_KEY_PREFIX=qa198\nQUEUE_PROVIDER=cloudflare\nLOGGER_PROVIDER=console\nLOG_LEVEL=info\nQA_EXTRA_SECRET=extra\n' > .dev/qa198-full/packages/env/.env.prod
```

6. List `QA_EXTRA_SECRET` for the api. In `.dev/qa198-full/packages/env/.env.example`, add the line `QA_EXTRA_SECRET=` under the `# @services api` line.

- [x] Setup complete

### TC-2.1: Two deploys build the whole project and create each resource once  ·  🔴 Critical

**Goal.** An empty account gets D1, KV, both queues and both Workers from one command, the api reads KV and the database, and a second run creates nothing.

**Steps**

1. Run the deploy, then call the probe route. Use the api URL that the deploy prints.

   ```sh
   pnpm -C .dev/qa198-full deploy:production
   ```

   ```sh
   curl -s -w '\n%{http_code}\n' https://qa198-api.<your-subdomain>.workers.dev/probe
   ```

   - [x] `db:migrate:prod` prints "No D1 database named app-db yet. Creating it." before the api deploys, and both Workers print a `workers.dev` URL
   - [x] The probe returns `{"kv":"kv-ok","db":{"n":0}}` with status `200`
2. Run the deploy again, then list the resources in the account.

   ```sh
   pnpm -C .dev/qa198-full deploy:production
   ```

   ```sh
   cd .dev/qa198-full/apps/api && pnpm exec wrangler d1 list && pnpm exec wrangler kv namespace list && pnpm exec wrangler queues list && cd ../../../..
   ```

   - [x] The second run creates no database and provisions nothing, and the account holds one `app-db`, one `qa198-api-kv`, one `app-jobs` and one `app-jobs-dlq`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** First deploy, trimmed to the lines that prove the checkpoints:

```text
@repo/db:db:migrate:prod: No D1 database named qa198-app-db yet. Creating it.
@repo/db:db:migrate:prod: ✅ Successfully created DB 'qa198-app-db' in region APAC
@repo/db:db:migrate:prod: │ 0000_wise_bloodstrike.sql │
@repo/web:deploy:   https://qa198-full-web.brainaloy-personal.workers.dev
@repo/api:deploy: Provisioning KV (KV Namespace)...
@repo/api:deploy: Provisioning JOBS (Queue)...
@repo/api:deploy: Provisioning JOBS_DLQ (Queue)...
@repo/api:deploy: Uploaded qa198-api (13.29 sec)
@repo/api:deploy:   https://qa198-api.brainaloy-personal.workers.dev
```

- The api upload listed `KV`, `JOBS`, `JOBS_DLQ`, `DB`, the three rate limits and nine secrets, `QA_EXTRA_SECRET` included, with no `CLOUDFLARE_*` key.
- The probe returned `{"kv":"kv-ok","db":{"n":0}}` with status `200`.
- The second deploy printed 0 "Provisioning" or "Creating" lines and "✅ No migrations to apply!". The lists held one each of `qa198-app-db`, `qa198-api-kv`, `qa198-jobs` and `qa198-jobs-dlq`, and the probe returned the same body.
- The queue bug in *Not covered* did not appear. The api Worker with `queue-cloudflare` started and served the probe.

### TC-2.2: Secrets and rollback work as the deploy wiki says  ·  🟡 Normal

**Goal.** The deploy only adds secrets, `wrangler secret delete` removes one, and `wrangler rollback` returns the api to the previous version.

**Steps**

1. Delete the `QA_EXTRA_SECRET` line from both `.env.prod` and `.env.example`. Deploy, then list the secrets. Delete the secret, then list them again.

   ```sh
   pnpm -C .dev/qa198-full deploy:production && pnpm -C .dev/qa198-full/apps/api exec wrangler secret list
   ```

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler secret delete QA_EXTRA_SECRET && pnpm -C .dev/qa198-full/apps/api exec wrangler secret list
   ```

   - [x] The first list holds `QA_EXTRA_SECRET` and no `CLOUDFLARE_*` key, and the second list does not hold `QA_EXTRA_SECRET`
2. Roll the api back, then call the probe route.

   ```sh
   pnpm -C .dev/qa198-full/apps/api exec wrangler rollback
   ```

   ```sh
   curl -s https://qa198-api.<your-subdomain>.workers.dev/probe
   ```

   - [x] wrangler reports the previous version as active, and the probe still returns `{"kv":"kv-ok","db":{"n":0}}`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

- List after the deploy without `QA_EXTRA_SECRET`: `BETTER_AUTH_SECRET BETTER_AUTH_URL CORS_ORIGINS KV_KEY_PREFIX KV_PROVIDER LOGGER_PROVIDER LOG_LEVEL QA_EXTRA_SECRET QUEUE_PROVIDER`.
- `wrangler secret delete` printed "✨ Success! Deleted secret QA_EXTRA_SECRET", and the next list held the same keys without `QA_EXTRA_SECRET`.
- The agent ran `wrangler rollback --message "qa198 rollback check" -y`, because its shell has no prompt. It printed "Worker Version 6c61e334-4f76-4cf2-86a7-5ef7b92d7258 has been deployed to 100% of traffic." The probe then returned `{"kv":"kv-ok","db":{"n":0}}` with status `200`.

### TC-2.3: The wiki teardown commands empty the account  ·  🟢 Low

**Goal.** Each teardown command in the deploy wiki runs as written and removes every resource of this scenario.

**Steps**

1. Open `docs/wiki/how-to/deploy-to-cloudflare.md`, section "Tearing it down". Run each command from the root of `.dev/qa198-full`, in the order the wiki gives. Then list the resources again.

   ```sh
   cd .dev/qa198-full/apps/api && pnpm exec wrangler d1 list && pnpm exec wrangler kv namespace list && pnpm exec wrangler queues list && cd ../../../..
   ```

   - [ ] Every wiki command runs as written, with only the KV namespace id filled in, and the lists show no resource from this scenario

**Result**

- [ ] Pass
- [x] Fail
- [ ] Skipped

**Notes.** The wiki order fails when `queue-cloudflare` is installed. The first command, `wrangler delete` for the api Worker, stopped with this error:

```text
Cannot delete this Worker as it is a consumer for a Queue. Remove it from the Queue's consumers first, then retry. [code: 10064]
```

The queue delete commands also stopped:

```text
Cannot delete queue 'qa198-jobs' that is still referenced by a binding in a Worker. Unbind queue 'qa198-jobs' from the Workers 'qa198-api'; then try again. [code: 11005]
```

- The web Worker, the D1 database and the KV namespace commands passed as written.
- This order cleared the deadlock: `wrangler queues consumer remove qa198-jobs qa198-api`, then `wrangler delete --force` for the api Worker, then `wrangler queues delete` for each queue. Each one printed success.
- The lists then showed no Worker, D1 database, KV namespace or queue in the account.
- The fix is a wiki change: in "Tearing it down", remove the queue consumer before the api Worker delete.

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

1. Update the base from this branch.

   ```sh
   cd .dev/qa198-old && SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js update; cd ../..
   ```

2. Follow `docs/wiki/runbooks/move-off-the-infra-module.md`, steps 1 to 6, as written.
   - [ ] Each step runs as written, and step 6 prints the same `workers.dev` URL that the Pulumi deploy used for `qa198-old-api`
3. Read the marker row, then list the databases. Open Workers & Pages in the dashboard.

   ```sh
   pnpm -C .dev/qa198-old/packages/db exec wrangler d1 execute app-db --remote --command "select id from qa_marker;"
   ```

   ```sh
   pnpm -C .dev/qa198-old/apps/api exec wrangler d1 list
   ```

   - [ ] The result holds one row, `QA-198`, and the account has one `app-db` and one `qa198-old-api`

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

_Checks the agent ran itself on `45fd794` (clean), in `.dev/qa198`, a fresh project with `api`, `database-d1`, `auth`, `kv-cloudflare` and `queue-cloudflare`. The project uses fake production values and a fake token. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint && pnpm typecheck && pnpm test
```

```sh
pnpm deps:check
```

```sh
pnpm --filter saasaloy build && node packages/cli/dist/index.js init .dev/qa198 --no-install
```

```sh
pnpm deploy:production
```

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID HOME=/tmp/emptyhome198 XDG_CONFIG_HOME=/tmp/emptyhome198/.config pnpm deploy:production
```

```sh
node packages/env/src/deploy.ts --check
```

```sh
cd apps/web && CLOUDFLARE_API_TOKEN=dummy-not-real pnpm exec env-deploy web -- --dry-run
```

```sh
cd apps/api && CLOUDFLARE_API_TOKEN=dummy-not-real pnpm exec env-deploy api -- --dry-run
```

```sh
CLOUDFLARE_API_TOKEN=dummy-not-real PUBLIC_SITE_URL=https://shell-wins.example pnpm turbo run deploy --filter @repo/web --ui=stream -- -- --dry-run
```

```sh
pnpm turbo run deploy --dry=json
```

```sh
mkdir -p infra/state && node ../../packages/cli/dist/index.js doctor
```

```sh
pnpm db:setup
```

- ✅ `pnpm lint`, `pnpm typecheck`, `pnpm test` → reused from the sync on `45fd794` (clean) on 2026-10-21: all pass, node test runs 633, 90 and 324 with 0 failures.
- ✅ `deploy.test.ts` → 20 tests pass in that run. On 2026-10-18 each new test went red under a deliberate break of the code it covers.
- ✅ No `.env.prod` → `deploy:production` stops with "packages/env/.env.prod does not exist" before any build.
- ✅ Blank token, no wrangler login → `deploy:production` stops with "CLOUDFLARE_API_TOKEN has no value and wrangler holds no login", and `apps/web/dist` does not exist.
- ✅ `--check` with `.env.prod` → "Every service has its production values (source: local)."
- ✅ `env-deploy web -- --dry-run` → wrangler prints "Using redirected Wrangler configuration.", the built canonical URLs are `https://qa198.example.com/`, `/404/` and `/500/`, and the SHA-256 of `apps/web/.env` is the same before and after.
- ✅ `env-deploy api -- --dry-run` → the upload lists `KV`, `JOBS`, `JOBS_DLQ`, `DB`, three rate limits and eight secrets, with 0 `CLOUDFLARE_*` keys.
- ✅ After both dry runs → no `/tmp/env-deploy-*` folder exists, and no file under `apps/` or `/tmp` holds the production auth secret.
- ✅ Exported `PUBLIC_SITE_URL` → the built canonical URL is `https://shell-wins.example/`.
- ✅ `turbo run deploy --dry=json` → `@repo/api#deploy` depends on `@repo/db#db:migrate:prod`.
- ✅ `saasaloy doctor` → no infra line without `infra/`. With `infra/`, it warns "infra/ is the Pulumi deploy that pnpm deploy:production replaced", warns against `pulumi destroy`, and links the runbook.
- ✅ `pnpm db:setup` with no `database_id` and no KV `id` in `apps/api/wrangler.jsonc` → migration `0000_powerful_odin.sql` applies to the local D1 database.
- ❌ `pnpm deps:check` → 72 outdated, 66 up to date. No pin this branch adds is outdated. The bump is left for a separate PR.
- ✅ Live `wrangler deploy` to a Cloudflare account → the agent ran Scenarios 1 and 2 on 2026-10-21. Their results are in the cases above. Scenario 3 is not run.

### Browser checks

_Driven with `playwright-cli` against `http://127.0.0.1:4398/`, a static server over `.dev/qa198/apps/web/dist/client` built by `env-deploy web` with the production values, at `45fd794`. Screenshots in `/tmp/qakit/0061-qa-wrangler-native-deploy-2026-10-18/`._

- ✅ `/` · canonical link → `https://qa198.example.com/`
- ✅ `/` · stylesheets loaded → 3, and the `h1` reads "Ship the SaaS, not the scaffolding."
- ✅ `/` · console → 0 errors, 0 warnings, and the server log has no 4xx or 5xx response
- ✅ `/` · horizontal overflow → none at 1440 px and none at 375 px

## Not covered / needs human judgment

- Scenario 3, the move from the Pulumi `infra` module. It needs a project deployed with the old CLI and Pulumi, and the agent did not run it.
- R2 provisioning. Scenario 2 has no `storage-cloudflare`, so no bucket was created.
- Queue dead-letter routing. TC-2.1 shows both queues exist; it does not force a message to the dead-letter queue.
- A known bug outside this branch. In a `.dev` project with `queue-cloudflare`, `vite dev` for the api stopped with "Cannot access 'PROVIDER_NAME' before initialization". The deployed api Worker with `queue-cloudflare` did not show it in TC-2.1.
- `env-infisical` as the value source. Every scenario uses `local`. The Infisical path loads through the same `EnvSource` contract and has unit tests, but no live Infisical project was used.
- Two projects in one account. The project-name prefix is issue #197. Scenario 2 renames the api Worker by hand for that reason.
- CI deploy. That is issue #199.
- Dark mode, accessibility and performance of the landing page. This change does not touch the page.
- Windows. `env-deploy` spawns `pnpm` and `wrangler` by name, and no Windows host was used.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
