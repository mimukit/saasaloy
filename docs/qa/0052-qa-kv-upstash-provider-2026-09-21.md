# QA Plan: kv-upstash, the Upstash Redis provider

_Generated 2026-09-21 · against `89fbb8c` plus the uncommitted work of issue #135 · covers `saasaloy add kv-upstash`, the four store methods, the globally exact limiter, and the swap proof._

## Summary

- `kv-upstash` is a third `kv` provider. It stores entries in an Upstash Redis database over HTTPS and counts one global rate limit budget.
- "Working" means `KV_PROVIDER=upstash` moves a project onto Upstash with no edit to `packages/kv`, `ratelimit` or `feature-flags`, and a limited route then answers with `RateLimit-Remaining`.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-135-upstash-redis-provider-with-a-globally-exact`.
- You need a free Upstash account. Create a Redis database at <https://console.upstash.com>, open the REST API panel, and copy the URL and the **read-write** token.
- The plan runs against `wrangler dev` in the playground at `.dev/playground`. No Cloudflare account is needed.
- This plan has no database client. `kv` writes no SQL table, so `$DB_CMD` is not defined and no query below uses one.

Build the CLI and create the playground:

```sh
pnpm run play:init
```

Enter the playground. Every later command in this plan runs from there:

```sh
cd .dev/playground
```

Set the base URL the `curl` calls use:

```sh
export BASE_URL=http://localhost:8787
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|----------|-----------|----------|
| TC-1.1 | 1: playground with `kv-upstash` installed | The install writes one file and two patches | 🔴 Critical |
| TC-1.2 | 1: playground with `kv-upstash` installed | The swap touches no core file | 🔴 Critical |
| TC-2.1 | 2: Worker running against a real Upstash database | A value round trips, with a TTL and without | 🔴 Critical |
| TC-2.2 | 2: Worker running against a real Upstash database | `list` pages, and it returns only this project's keys | 🔴 Critical |
| TC-2.3 | 2: Worker running against a real Upstash database | A limited route sends `RateLimit-Remaining` and then 429s | 🔴 Critical |
| TC-2.4 | 2: Worker running against a real Upstash database | The one-second TTL floor holds | 🟡 Normal |
| TC-3.1 | 3: Worker running with a broken configuration | An empty `KV_KEY_PREFIX` throws and names the variable | 🔴 Critical |
| TC-3.2 | 3: Worker running with a broken configuration | A wrong token fails without a retry loop | 🟡 Normal |
| TC-3.3 | 3: Worker running with a broken configuration | A read-only token refuses a write clearly | 🟢 Low |

## Scenario 1: playground with `kv-upstash` installed

**Setup.** Run once, for every case in this scenario.

1. Install the capability, the limiter and the provider.

```sh
./saasaloy add kv --yes && ./saasaloy add ratelimit --yes && ./saasaloy add kv-upstash --yes
```

2. Install the new dependency.

```sh
pnpm install
```

- [ ] Setup complete

### TC-1.1: The install writes one file and two patches · 🔴 Critical

**Goal.** The descriptor lands the provider file, the SDK pin and the registration, and nothing else.

**Steps**

1. Read the provider registration.

   ```sh
   head -3 packages/kv/src/index.ts && grep -n "providers: \[" packages/kv/src/index.ts
   ```

   - [ ] The file imports `upstash` from `./providers/upstash`, and the `providers` array holds `upstash()`

2. Read the dependency the patch added.

   ```sh
   grep -n "@upstash/redis" packages/kv/package.json
   ```

   - [ ] The pin is exactly `1.38.4`, with no `^` and no `~`

3. Confirm the provider wrote no Worker binding.

   ```sh
   grep -n "upstash\|UPSTASH" apps/api/wrangler.jsonc
   ```

   - [ ] The command prints nothing, because an HTTP provider has no binding

4. Typecheck the capability against the real SDK.

   ```sh
   pnpm -F @repo/kv exec tsc --noEmit -p tsconfig.json
   ```

   - [ ] The command prints no error

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The swap touches no core file · 🔴 Critical

**Goal.** Moving a project onto Upstash costs one env var, not an edit to the capability.

**Steps**

1. List every file the three installs changed.

   ```sh
   git -C . status --short
   ```

   - [ ] `packages/kv/src/providers/upstash.ts` is new
   - [ ] No file under `packages/kv/src/` is modified except `index.ts`, whose only change is the import and the `providers` entry
   - [ ] No file of `ratelimit` or `feature-flags` is modified

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. Scenario 2 continues from this state.

## Scenario 2: Worker running against a real Upstash database

**Setup.** Run once, for every case in this scenario.

1. Write the two secrets and the provider selection into `apps/api/.dev.vars`. Paste your own URL and read-write token.

```sh
printf 'KV_PROVIDER=upstash\nKV_KEY_PREFIX=qa:\nUPSTASH_REDIS_REST_URL=https://<name>-<id>.upstash.io\nUPSTASH_REDIS_REST_TOKEN=<read-write-token>\n' >> apps/api/.dev.vars
```

2. Add one route that stores a value and one that is rate limited. Write this file as `apps/api/src/routes/qa-kv.ts`.

```sh
cat > apps/api/src/routes/qa-kv.ts <<'ROUTE'
import { createKv } from "@repo/kv";
import { Hono } from "hono";
import { rateLimit } from "../middleware/ratelimit";

export const qaKv = new Hono<{ Bindings: Env }>()
  .put("/entry/:id", async (c) => {
    const store = createKv(c.env);
    const key = store.key({ namespace: "qa", parts: [c.req.param("id")] });
    const ttl = c.req.query("ttl");
    await store.set(key, await c.req.json(), ttl ? { ttlSeconds: Number(ttl) } : {});
    return c.json({ key }, 200);
  })
  .get("/entry/:id", async (c) => {
    const store = createKv(c.env);
    const key = store.key({ namespace: "qa", parts: [c.req.param("id")] });
    return c.json({ value: await store.get(key) }, 200);
  })
  .delete("/entry/:id", async (c) => {
    const store = createKv(c.env);
    const key = store.key({ namespace: "qa", parts: [c.req.param("id")] });
    await store.delete(key);
    return c.json({ ok: true }, 200);
  })
  .get("/list", async (c) => {
    const store = createKv(c.env);
    const cursor = c.req.query("cursor");
    return c.json(
      await store.list({
        limit: 100,
        prefix: "qa:",
        ...(cursor ? { cursor } : {}),
      }),
      200
    );
  })
  .get("/limited", rateLimit({ policy: "strict" }), (c) => c.json({ ok: true }, 200));
ROUTE
```

3. Mount the route. Open `apps/api/src/index.ts` and add `.route("/qa-kv", qaKv)` to the app chain, with the matching import.

4. Start the Worker. Leave it running for every case in this scenario.

```sh
pnpm dev
```

- [ ] Setup complete

### TC-2.1: A value round trips, with a TTL and without · 🔴 Critical

**Goal.** `get`, `set` and `delete` reach the real database, and the core still owns the JSON.

**Steps**

1. Read a key that does not exist.

   ```sh
   curl -s "$BASE_URL/qa-kv/entry/a1"
   ```

   - [ ] The body is `{"value":null}`, because a miss is not an error

2. Write a value with no TTL.

   ```sh
   curl -s -X PUT "$BASE_URL/qa-kv/entry/a1" -H 'content-type: application/json' -d '{"count":2,"name":"hello"}'
   ```

   - [ ] The body reports the key `qa:qa:a1`

3. Read it back.

   ```sh
   curl -s "$BASE_URL/qa-kv/entry/a1"
   ```

   - [ ] The body is `{"value":{"count":2,"name":"hello"}}`, an object and not a string of JSON

4. Open the Upstash console, go to the Data Browser, and look at the key `qa:qa:a1`.

   - [ ] The stored value is the text `{"count":2,"name":"hello"}`, and the key carries the `qa:` prefix
   - [ ] The key shows no expiry

5. Write the same key again with a one-hour TTL.

   ```sh
   curl -s -X PUT "$BASE_URL/qa-kv/entry/a1?ttl=3600" -H 'content-type: application/json' -d '{"count":3}'
   ```

   - [ ] The Data Browser now shows a TTL near 3600 seconds on that key

6. Delete it, then delete it a second time.

   ```sh
   curl -s -X DELETE "$BASE_URL/qa-kv/entry/a1" && curl -s -X DELETE "$BASE_URL/qa-kv/entry/a1"
   ```

   - [ ] Both calls answer `{"ok":true}`, because deleting an absent key succeeds

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `list` pages, and it returns only this project's keys · 🔴 Critical

**Goal.** The `SCAN` glob carries `KV_KEY_PREFIX`, so a foreign key never reaches the caller.

**Steps**

1. Write a key that belongs to another project. Use the Upstash console's CLI panel.

   ```sh
   SET other:not-mine "foreign"
   ```

   - [ ] The console reports `OK`

2. Write 250 entries through the route.

   ```sh
   for i in $(seq -w 1 250); do curl -s -o /dev/null -X PUT "$BASE_URL/qa-kv/entry/k$i" -H 'content-type: application/json' -d "\"v$i\""; done
   ```

   - [ ] The loop finishes with no error printed

3. Read the first page.

   ```sh
   curl -s "$BASE_URL/qa-kv/list"
   ```

   - [ ] The body holds `keys`, a `cursor` and `complete`
   - [ ] Every key starts with `qa:qa:`, and `other:not-mine` is absent

4. Page to the end. Paste the `cursor` from the previous answer into each call, and repeat until `complete` is `true`.

   ```sh
   curl -s "$BASE_URL/qa-kv/list?cursor=<cursor-from-the-previous-answer>"
   ```

   - [ ] The pages together hold all 250 keys, with no duplicate
   - [ ] `cursor` is present on every page where `complete` is `false`, and absent on the last one
   - [ ] At least one page is smaller than 100 keys, or empty, while `complete` is still `false`

5. Delete the foreign key in the console.

   ```sh
   DEL other:not-mine
   ```

   - [ ] The console reports `1`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A limited route sends `RateLimit-Remaining` and then 429s · 🔴 Critical

**Goal.** `consume` counts globally and reports a real number, which is the gap `kv-cloudflare` cannot close.

**Steps**

1. Call the limited route once.

   ```sh
   curl -s -i "$BASE_URL/qa-kv/limited"
   ```

   - [ ] The status is 200
   - [ ] The response carries `RateLimit-Limit: 10` and `RateLimit-Remaining: 9`

2. Call it nine more times.

   ```sh
   for i in $(seq 1 9); do curl -s -o /dev/null -w '%{http_code} ' "$BASE_URL/qa-kv/limited"; done; echo
   ```

   - [ ] All nine answer 200

3. Call it once more.

   ```sh
   curl -s -i "$BASE_URL/qa-kv/limited"
   ```

   - [ ] The status is 429
   - [ ] The body carries the code `rate_limited`
   - [ ] The response carries `Retry-After` in whole seconds, and `RateLimit-Remaining: 0`

4. Open the Upstash Data Browser and look for the bucket key.

   - [ ] A key `qa:rl:strict:<your-ip>` exists, holds a count, and carries a TTL at or under 10 seconds

5. Wait 11 seconds, then call the route again.

   ```sh
   sleep 11 && curl -s -i "$BASE_URL/qa-kv/limited"
   ```

   - [ ] The status is 200 again, because the window expired

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: The one-second TTL floor holds · 🟡 Normal

**Goal.** The provider declares a floor of 1, and the core refuses anything under it without rounding.

**Steps**

1. Write a value with a one-second TTL.

   ```sh
   curl -s -X PUT "$BASE_URL/qa-kv/entry/short?ttl=1" -H 'content-type: application/json' -d '"here"'
   ```

   - [ ] The call succeeds, because one second is legal on this provider

2. Wait two seconds and read it.

   ```sh
   sleep 2 && curl -s "$BASE_URL/qa-kv/entry/short"
   ```

   - [ ] The body is `{"value":null}`

3. Write a value with a zero TTL.

   ```sh
   curl -s -i "$BASE_URL/qa-kv/entry/zero?ttl=0" -X PUT -H 'content-type: application/json' -d '"no"'
   ```

   - [ ] The call fails, and the Worker's log names `invalid_ttl` and the `upstash` floor of 1

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3. Delete the keys this scenario wrote. Run this in the Upstash console's CLI panel.

```sh
SCAN 0 MATCH qa:* COUNT 1000
```

```sh
FLUSHDB
```

## Scenario 3: Worker running with a broken configuration

**Setup.** Run once, for every case in this scenario. Stop the Worker from Scenario 2 first.

1. Keep `apps/api/.dev.vars` from Scenario 2. Each case below changes one line in it and restarts the Worker.

- [ ] Setup complete

### TC-3.1: An empty `KV_KEY_PREFIX` throws and names the variable · 🔴 Critical

**Goal.** The provider refuses to run unprefixed, because an unprefixed `list` reads keys the project does not own.

**Steps**

1. Set `KV_KEY_PREFIX=` in `apps/api/.dev.vars`, leaving the value empty. Restart the Worker.

   ```sh
   pnpm dev
   ```

2. Read any key.

   ```sh
   curl -s -i "$BASE_URL/qa-kv/entry/a1"
   ```

   - [ ] The call fails, and the Worker's log names `KV_KEY_PREFIX` and says why the provider requires it

3. Look at the Upstash console's usage graph for the last minute.

   - [ ] The request count did not rise, because the provider threw before any request left

4. Restore `KV_KEY_PREFIX=qa:` and restart the Worker.

   - [ ] The same call answers 200 again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: A wrong token fails without a retry loop · 🟡 Normal

**Goal.** A bad credential is a deploy fault, so the provider reports it once rather than retrying.

**Steps**

1. Change the last character of `UPSTASH_REDIS_REST_TOKEN` in `apps/api/.dev.vars`. Restart the Worker.

   ```sh
   pnpm dev
   ```

2. Read any key.

   ```sh
   curl -s -i "$BASE_URL/qa-kv/entry/a1"
   ```

   - [ ] The call fails, and the Worker's log shows `provider_error` with `providerCode` `401`
   - [ ] The log shows one failed attempt, not a burst of them

3. Restore the real token and restart the Worker.

   - [ ] The same call answers 200 again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.3: A read-only token refuses a write clearly · 🟢 Low

**Goal.** The commonest setup mistake reads as a configuration fault, not as a lost write.

**Steps**

1. Copy the **read-only** token from the Upstash REST API panel into `apps/api/.dev.vars`. Restart the Worker.

   ```sh
   pnpm dev
   ```

2. Read a key, then write one.

   ```sh
   curl -s "$BASE_URL/qa-kv/entry/a1" && curl -s -i -X PUT "$BASE_URL/qa-kv/entry/a1" -H 'content-type: application/json' -d '"x"'
   ```

   - [ ] The read succeeds
   - [ ] The write fails, and the log names a `provider_error` a reader can act on

3. Restore the read-write token and restart the Worker.

   - [ ] The write succeeds again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. Remove the playground and the QA route with it.

```sh
cd .. && cd .. && pnpm run play:destroy
```

Delete the QA database in the Upstash console, and revoke its token.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
node --import ./scripts/ts-resolve-hook.ts --test "modules/kv-upstash/files/*.test.ts"
```

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm verify:pins
```

```sh
cd .dev/playground/packages/kv && npx tsc --noEmit -p tsconfig.json
```

```sh
npm view @upstash/redis@1.38.4 version
```

- ✅ `modules/kv-upstash` tests → 26 pass, 0 fail. They cover the SCAN cursor over 2,500 keys, an empty page with a live cursor, glob escaping, the `KV_KEY_PREFIX` scoping, `ex` present only with a TTL, the limiter counting down, the bucket key, seven error rows, and four preconditions.
- ✅ `pnpm test` → 566 pass in the workspace suites, 160 pass in the script suites, 0 fail.
- ✅ `pnpm lint` → all four passes clean: oxlint type-aware, oxlint plain, Stylelint, and `prettier --check`.
- ✅ `pnpm verify:pins` → 2 pin rules agree across their manifests.
- ✅ playground typecheck → `packages/kv` compiles against the real `@upstash/redis` types after `saasaloy add kv-upstash`. This is what proves the dynamic import's cast matches the SDK.
- ✅ `npm view` → `1.38.4` exists on npm, and `latest` is `1.39.0`, which is inside the cooldown. `pnpm deps:update` owns that bump.
- ❌ `pnpm deps:verify` → red before this branch, and for an unrelated reason: the playground's `@cloudflare/vite-plugin@1.56.0` wants `wrangler@^4.135.0` and the template pins `4.129.0`. `pnpm deps:check` reports 71 outdated pins repo-wide. Neither number moves with `kv-upstash`.

## Not covered / needs human judgment

- **Every case above needs an Upstash account.** No CI job has one, which is why the swap proof is this document rather than a test.
- **Accessibility, compatibility and usability.** This change ships no UI. It is a provider file behind an existing contract.
- **Concurrency.** The limiter's atomicity comes from one Lua `EVAL`, which Redis runs to completion. Proving that by hand needs a load generator, and a passing hand test would prove nothing about the race.
- **Performance.** Every call is one HTTPS round trip to one region, so latency is the network's and not the provider's. Measure it from the region you deploy in, not from a laptop.
- **Data layer.** `kv` writes no SQL table and ships no migration, so the plan defines no `$DB_CMD` and runs no database introspection.
- **The 1 MB record cap.** Reaching it needs a payload over the free plan's limit but under the core's 25 MiB, which is slow to drive by hand. The error path is covered by a test instead.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
