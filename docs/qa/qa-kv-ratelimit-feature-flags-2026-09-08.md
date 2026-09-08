# QA Plan: provider-agnostic `kv`, `ratelimit` and `feature-flags`

_Generated 2026-09-08 · against `afde583` · covers the `kv` capability, its `kv-cloudflare` and `kv-memory` providers, the `ratelimit` module and the `feature-flags` module_

## Summary

- The branch adds a vendor-blind `kv` capability, two providers behind it, per-route rate limiting on the capability's `consume` contract, and typed feature flags served from a published KV document.
- "Working" means a real Worker serves 429 from a rate-limited route, an admin toggle changes a route's answer with no redeploy, and a provider swap needs no code change outside `KV_PROVIDER`.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-129-provider-agnostic-kv-capability-with-ratelimit`, commit `afde583`.
- A scratch project scaffolded by the CLI on this branch. The run used `.dev/playground`. Use a fresh one if you want a clean record.
- Scenarios 1 and 2 need no Cloudflare account. Scenario 3 needs a Cloudflare account, a real KV namespace and three Rate Limiting bindings.
- The api runs on `http://localhost:8787` by default. The admin app runs on `http://localhost:4321` by default. Read the port each `vite dev` prints and use that if it differs.
- Set `BASE_URL` before you run any `curl` in this plan.

Build the CLI and scaffold the project:

```sh
cd <repo> && pnpm install && pnpm build && mkdir -p .dev && node packages/cli/dist/index.js init .dev/playground --yes
```

Set the base URL for every request in this plan:

```sh
export BASE_URL=http://localhost:8787
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: local Worker, `kv-memory`, `ratelimit` installed | A strict route answers 429 with `Retry-After` under `wrangler dev` | 🔴 Critical |
| TC-1.2 | 1: local Worker, `kv-memory`, `ratelimit` installed | An unset `KV_PROVIDER` fails loudly, not quietly | 🔴 Critical |
| TC-2.1 | 2: local Worker plus `feature-flags` and the admin app | The admin `/flags` page lists and toggles a flag | 🔴 Critical |
| TC-2.2 | 2: local Worker plus `feature-flags` and the admin app | An override delete for an unknown flag answers 404 | 🟡 Normal |
| TC-2.3 | 2: local Worker plus `feature-flags` and the admin app | Maintenance mode serves the 503 page and lets an admin through | 🟡 Normal |
| TC-3.1 | 3: deployed Worker, real KV namespace, `kv-cloudflare` | A toggle reaches a live route within about 70 s, with no redeploy | 🔴 Critical |
| TC-3.2 | 3: deployed Worker, real KV namespace, `kv-cloudflare` | A missing `RL_*` binding fails the request loudly, and `doctor` names it first | 🟡 Normal |
| TC-4.1 | 4: project on `database-postgres` | The flags schema migrates and reads on Postgres | 🟢 Low |

## Scenario 1: local Worker, `kv-memory` and `ratelimit` installed

**Setup.** Run once, for every case in this scenario.

1. Install the capability, the local provider and the rate limiter.

```sh
cd .dev/playground && node ../../packages/cli/dist/index.js add kv kv-memory ratelimit --yes
```

2. Add `rateLimit({ policy: "strict" })` to one POST route in `apps/api/src/index.ts`. The `saasaloy-ratelimit` skill shows the exact import and call.
3. Start the api.

```sh
cd .dev/playground/apps/api && pnpm dev
```

- [ ] Setup complete

### TC-1.1: A strict route answers 429 with `Retry-After` under `wrangler dev` · 🔴 Critical

**Goal.** The limiter works in a real Worker runtime, not only in the node test harness.

**Steps**

1. Send eleven requests to the rate-limited route inside ten seconds.

   ```sh
   for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " -X POST "$BASE_URL/auth/sign-in" -H 'content-type: application/json' -d '{"email":"qa@example.com","password":"wrong-on-purpose"}'; done; echo
   ```

   - [ ] The first ten answers are not 429, and the eleventh is 429
2. Read the refused response in full.

   ```sh
   curl -i -X POST "$BASE_URL/auth/sign-in" -H 'content-type: application/json' -d '{"email":"qa@example.com","password":"wrong-on-purpose"}'
   ```

   - [ ] The 429 carries `Retry-After` with a positive whole number of seconds
   - [ ] The body is the api error envelope with code `rate_limited` and a readable message
3. Wait for the period to pass, then send one more request.

   - [ ] The route answers normally again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: An unset `KV_PROVIDER` fails loudly, not quietly · 🔴 Critical

**Goal.** A missing provider selection is a visible 500, never a request let through unlimited.

**Steps**

1. Remove `KV_PROVIDER` from `apps/api/.dev.vars` (or set it to `nope`). Restart `pnpm dev`.
2. Send one request to the rate-limited route.

   ```sh
   curl -i -X POST "$BASE_URL/auth/sign-in" -H 'content-type: application/json' -d '{"email":"qa@example.com","password":"wrong-on-purpose"}'
   ```

   - [ ] The response is a 500, and the route does not answer normally
   - [ ] The `wrangler dev` console names `KV_PROVIDER` and lists the registered providers
3. Restore `KV_PROVIDER=memory` and restart.

   - [ ] The route answers normally again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd .dev/playground && git checkout -- apps/api/src/index.ts
```

## Scenario 2: local Worker plus `feature-flags` and the admin app

**Setup.** Run once, for every case in this scenario.

1. Install the flags module and apply the database migration.

```sh
cd .dev/playground && node ../../packages/cli/dist/index.js add feature-flags --yes && pnpm --filter @repo/db db:migrate
```

2. Register one boolean flag and one kill switch in `packages/feature-flags/src/index.ts`, following the `saasaloy-feature-flags` skill.
3. Start the api and the admin app in two terminals.

```sh
cd .dev/playground/apps/api && pnpm dev
```

```sh
cd .dev/playground/apps/admin && pnpm dev
```

4. Sign in to the admin app with an account that holds the admin role.

- [ ] Setup complete

### TC-2.1: The admin `/flags` page lists and toggles a flag · 🔴 Critical

**Goal.** An operator can read and change a flag from the admin app without touching the database.

**Steps**

1. Open `http://localhost:4321/flags`.
   - [ ] The page lists every registered flag, and each row reads clearly
     - the flag key and its type
     - the current global value
     - the control that changes it
   - [ ] `Flags` appears in the admin navigation, in a sensible position
2. Toggle the boolean flag off, then reload the page.
   - [ ] The new value survives the reload
3. Read the api route the flag guards.

   ```sh
   curl -s "$BASE_URL/health"
   ```

   - [ ] The route reflects the new value once the isolate cache TTL passes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: An override delete for an unknown flag answers 404 · 🟡 Normal

**Goal.** The delete route refuses a key nobody registered, the same way both PUT routes do. This is finding N4, and no automated test covers it.

**Steps**

1. Delete a tenant override for a flag key that does not exist. Replace `<token>` with the admin session token the admin app holds.

   ```sh
   curl -i -X DELETE "$BASE_URL/flags/not.a.real.flag/tenants/t_42" -H 'authorization: Bearer <token>'
   ```

   - [ ] The status is 404, and the body carries code `not_found` and names the key
2. Delete a tenant override for a flag key that does exist.

   ```sh
   curl -i -X DELETE "$BASE_URL/flags/<real.flag.key>/tenants/t_42" -H 'authorization: Bearer <token>'
   ```

   - [ ] The status is 200 and the body carries `publishedAt`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Maintenance mode serves the 503 page and lets an admin through · 🟡 Normal

**Goal.** The `system.maintenance` flag closes the app to normal traffic and keeps an operator's way in.

**Steps**

1. Turn `system.maintenance` on from the admin `/flags` page.
2. Open the web app in a private browser window with no session.
   - [ ] The page is the maintenance page, and its copy reads as intended
   - [ ] The response carries status 503 and a `Retry-After` header
3. Open the admin app in the signed-in window.
   - [ ] The admin app still loads, so the operator can turn the flag back off
4. Turn `system.maintenance` off.
   - [ ] The web app serves normally again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
cd .dev/playground && node ../../packages/cli/dist/index.js remove feature-flags --yes
```

## Scenario 3: deployed Worker, real KV namespace, `kv-cloudflare`

This scenario needs a Cloudflare account. Nothing on the build box could run it.

**Setup.** Run once, for every case in this scenario.

1. Swap the provider.

```sh
cd .dev/playground && node ../../packages/cli/dist/index.js remove kv-memory --yes && node ../../packages/cli/dist/index.js add kv-cloudflare feature-flags --yes
```

2. Create a KV namespace and put its id in `apps/api/wrangler.jsonc`, in place of `<replace-me>`.

```sh
cd .dev/playground/apps/api && npx wrangler kv namespace create KV
```

3. Set `KV_PROVIDER=cloudflare` in the Worker's variables.
4. Deploy the api.

```sh
cd .dev/playground/apps/api && pnpm deploy
```

- [ ] Setup complete

### TC-3.1: A toggle reaches a live route within about 70 s, with no redeploy · 🔴 Critical

**Goal.** Check C29. A flag change published to KV changes a deployed route's answer, and no deploy happens in between.

**Steps**

1. Read the flag-guarded route on the deployed Worker and record the answer.

   ```sh
   curl -s "https://<your-worker>.workers.dev/health"
   ```

   - [ ] The answer matches the flag's current value
2. Toggle the flag in the admin app. Start a timer.
   - [ ] The admin app reports the change saved, with a publish time
3. Poll the same route every ten seconds for two minutes.

   ```sh
   for i in $(seq 1 12); do date +%T; curl -s "https://<your-worker>.workers.dev/health"; sleep 10; done
   ```

   - [ ] The answer changes within about 70 seconds
   - [ ] No deploy ran between the toggle and the change

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: A missing `RL_*` binding fails the request loudly, and `doctor` names it first · 🟡 Normal

**Goal.** A broken deploy is reported before the traffic finds it.

**Steps**

1. Delete the `RL_STRICT` entry from `apps/api/wrangler.jsonc`. Run the doctor.

   ```sh
   cd .dev/playground && ./saasaloy doctor .
   ```

   - [ ] The report names `RL_STRICT` and the policy `strict`, and the exit is a problem, not `No problems found.`
2. Restore the entry, deploy, and send one request to the rate-limited route.

   ```sh
   curl -i -X POST "https://<your-worker>.workers.dev/auth/sign-in" -H 'content-type: application/json' -d '{"email":"qa@example.com","password":"wrong-on-purpose"}'
   ```

   - [ ] The route answers, and the eleventh request in the period answers 429
   - [ ] `RateLimit-Limit` and `RateLimit-Remaining` are absent on this provider, because the Cloudflare binding reports no count

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd .dev/playground/apps/api && npx wrangler delete --name <your-worker>
```

## Scenario 4: project on `database-postgres`

**Setup.** Run once, for the case in this scenario.

1. Scaffold a second project and install the Postgres driver, then the flags module.

```sh
node packages/cli/dist/index.js init .dev/pg --yes && cd .dev/pg && node ../../packages/cli/dist/index.js add database database-postgres feature-flags --yes
```

2. Point `DATABASE_URL` at a running Postgres instance.

- [ ] Setup complete

### TC-4.1: The flags schema migrates and reads on Postgres · 🟢 Low

**Goal.** `feature-flags.pg.ts` is a real schema, not a file nobody has run. The build box ran only `database-d1`.

**Steps**

1. Generate and apply the migration.

   ```sh
   cd .dev/pg && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate
   ```

   - [ ] The migration applies with no error
   - [ ] The flag table and the override table exist, with the columns the schema declares
2. Write a global value and a tenant override through the admin routes, then read the flag.
   - [ ] The tenant override wins over the global value
   - [ ] A tenant with no override falls through to the global value

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself, transcribed from `.afkkit/verified.md`. No action needed from the tester._

Commands run:

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm build
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test "modules/kv/files/**/*.test.ts" "modules/kv-memory/files/**/*.test.ts" "modules/kv-cloudflare/files/**/*.test.ts" "modules/ratelimit/files/**/*.test.ts" "modules/feature-flags/files/**/*.test.ts"
```

```sh
cd packages/cli && pnpm test
```

```sh
cd .dev/playground && pnpm typecheck
```

```sh
SAASALOY_REGISTRY_DIR=$PWD/modules node packages/cli/dist/index.js doctor modules
```

```sh
cd .dev/playground && ./saasaloy doctor .
```

- ✅ `pnpm test` → module suite `tests 207 / fail 0`; exit 0 (C36).
- ✅ `pnpm lint` → four passes green, `All matched files use Prettier code style!` (C36).
- ✅ `pnpm build` → `1 successful`; the CLI bundle builds (C36).
- ✅ `packages/cli` vitest → `50 files, 1188 tests` before the fix round; `doctor.test.ts` 55 tests after it (C25).
- ✅ `doctor modules` → 24 descriptors, `No problems found.` (C5, C13, C21).
- ✅ `createKv` with no `KV_PROVIDER`, an unknown value, and the wrong case → all three throw and name the env var. No fallback (C6).
- ✅ `buildKey` with a `:` in a part, a `:` in a namespace, an empty part, and a 603-byte key → `invalid_key` each time; a normal call yields `stg:ns:a:b` (C9).
- ✅ `set` with `ttlSeconds: 5` on the Cloudflare provider → `invalid_ttl` naming the 60-second floor, with no provider call; a 26 MiB value → `too_large` (C10).
- ✅ `consume({ policy: "nope" })` → `not_supported`, naming the registered policies (C8). A provider with no `consume` → `not_supported` on the first request, and module load alone throws nothing (C24).
- ✅ Missing `RL_STRICT` on the Cloudflare provider → `not_supported`, naming the binding and the file to add it to (C15).
- ✅ Eleven strict requests in the node harness → the eleventh answers 429 with a positive `Retry-After` (C20). Two routes on one policy keep separate budgets; an explicit `key` merges them (C22).
- ✅ `list` paged with the issued cursor collects 2,500 distinct keys, `complete: true` on the last page (C18). A one-second TTL expires on the memory provider (C17).
- ✅ `modules/kv/files/package.json` has an empty `dependencies`, and no core source file imports a vendor SDK (C11). The `KvError` code union holds exactly six members; `get` on an absent key resolves `null` (C12).
- ✅ `add kv-cloudflare` twice → the `kv_namespaces` entry appears once; `RL_STRICT`, `RL_DEFAULT`, `RL_LOOSE` land in `wrangler.jsonc` (C14, C16).
- ✅ `remove kv-cloudflare` leaves `wrangler.jsonc` and `packages/kv/src/index.ts` byte-identical; `remove kv` refuses while `ratelimit` is installed (C35).
- ✅ Flags: a tenant override beats a global row, a tenant with no override falls through (C28); a read issues zero writes on a hit (C31); `bucket` is stable and spreads evenly (C32); maintenance mode and the kill switch behave (C33, C34); the admin page reads through the database repository, not the cache (C30).
- ✅ `doctor` after the B2 fix → an inline `definePolicy({ name: "burst" })` with no binding now reports `policy "burst" has no RL_BURST entry …`; an element the check cannot read reports `the policy at index 3 … has no name this check can read` (C25).
- ✅ `modules/kv-memory/files/memory.ts` holds no raw control byte, and `git diff main...HEAD --numstat` reports it as text (`265 0`), not binary (finding B1).
- ❌ `cd .dev/playground && pnpm typecheck` → two inherited failures remain: `apps/api/src/index.ts(121,33)` and `(147,48)`, `Bindings` not assignable to `LoggerEnv`; and `packages/auth/src/auth.ts(49,22)`. Both exist on `main` and this branch touches neither `modules/api`, `modules/logger`, `modules/auth` nor the base template. `@repo/kv` and `@repo/feature-flags` typecheck clean.

## Not covered / needs human judgment

- `wrangler dev` and a deployed Worker. The build box has no Cloudflare account, so `cloudflare.ts`'s `limiter.limit` call and its `namespace.list` cursor handling were read against `@cloudflare/workers-types` only. Scenarios 1 and 3 cover this.
- The roughly 70-second toggle latency (C29). It needs a real KV namespace. TC-3.1 covers it.
- The admin app typecheck and the `/flags` page in a browser. Turbo stopped at `@repo/auth`'s inherited failure, and the route tree needs a `vite build` first. TC-2.1 covers the page.
- `feature-flags.pg.ts` under `database-postgres`. The playground runs `database-d1`. TC-4.1 covers it.
- The 404 on `DELETE /flags/:key/tenants/:tenantId` (finding N4). The route file ships no test on this branch. TC-2.2 covers it.
- `saasaloy remove feature-flags` and `saasaloy update` over a project with `kv` installed.
- Accessibility and compatibility of the admin `/flags` page beyond a single desktop browser. The page reuses the admin app's existing table and control components, so the risk sits with those, not with this change.
- Performance under load. The limiter's per-colo behaviour cannot be measured from one client.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
