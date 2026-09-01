# QA Plan: dialect-neutral auth and waitlist payloads

_Generated 2026-09-01 · against `e9be464` · covers issue #99, the `onlyWith` per-file condition and the split of the `auth` and `waitlist` payloads into sqlite and pg variants_

## Summary

- `saasaloy add auth` and `saasaloy add waitlist` now install against either database driver. One `onlyWith` condition on a descriptor file entry picks the sqlite variant or the pg variant, and the `dependsOn: ["database-d1"]` stopgap is gone.
- Working means a project on either driver signs a user in and then serves a **second** request to a protected route on the same running Worker, and the waitlist form stores a row through the same neutral route file.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Worktree `/home/dev/worktrees/saasaloy/issue-99-make-auth-and-waitlist-payloads-dialect-neutral`, branch `issue-99-make-auth-and-waitlist-payloads-dialect-neutral`, commit `e9be464`.
- Node 24 or later, and pnpm 11 or later.
- Docker, for the Postgres server in Scenario 2. There is no `psql` client on the box, so every Postgres query in this plan runs through `docker exec`.
- Ports 3000, 3001 and 4000 must be free. Each dev server pins its port with `strictPort`. The api Worker is 4000, `apps/web` is 3000, `apps/admin` is 3001.
- A browser you can reach `http://localhost:3000` and `http://localhost:3001` with. Scenario 3 needs no browser and no running app.
- No feature flags apply.

Install the workspace once, from the worktree root.

```sh
pnpm install
```

Every `saasaloy` command runs inside `.dev/playground`, through the `./saasaloy` shim. The shim points the built CLI at this worktree's `modules/`. `.dev` is gitignored, so nothing you edit there reaches a commit.

- [ ] Environment ready

## Two pre-existing defects you will hit

Read this before Scenario 1. Both defects are on `main` too. Both live in files this branch does not touch. Neither is this branch's to fix. Each scenario's setup applies the mask below, and the mask stays inside `.dev/playground`.

**Defect 1 — `apps/api/src/index.ts` fails typecheck.** Any scaffolded project reports two errors:

```
src/index.ts(120,33): error TS2345: Argument of type 'Bindings' is not assignable to parameter of type 'LoggerEnv'.
src/index.ts(146,48): error TS2345: Argument of type 'Bindings' is not assignable to parameter of type 'LoggerEnv'.
```

The mask adds one line to `interface Bindings` in `.dev/playground/apps/api/src/index.ts`:

```ts
[key: string]: string | undefined;
```

**Defect 2 — sign-up returns 500 without an `issuer` column.** `better-auth@1.7.2` declares an `issuer` column on `account`. The shipped schema omits it, because the snapshot was verified against `1.6.25`. Both schema variants now carry a KNOWN DRIFT comment about it. Unmasked, sign-up fails before any SQL runs:

```
[Better Auth]: The field "issuer" does not exist in the "account" Drizzle schema.
```

The mask adds one column to `account` in `.dev/playground/packages/db/src/schema/auth.ts`:

```ts
issuer: text("issuer"),
```

Apply this mask **before** you generate and apply migrations, so the emitted SQL carries the column. Without it you cannot create the account the auth cases need, and TC-1.2 and TC-2.1 dead-end at the first request.

The waitlist route needs no mask. Scenario 1 and Scenario 2 still apply both masks, because auth and waitlist share one project.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| #      | Scenario                            | Test case                                              | Priority    |
| ------ | ----------------------------------- | ------------------------------------------------------ | ----------- |
| TC-1.1 | 1: D1 project, driver only          | The plan and the diff name the chosen variant           | 🟢 Low      |
| TC-1.2 | 1: D1 project, driver only          | Two requests on one D1 Worker                           | 🔴 Critical |
| TC-1.3 | 1: D1 project, driver only          | The waitlist form stores a row under the sqlite variant | 🟡 Normal   |
| TC-2.1 | 2: Postgres project, container up   | Two requests on one Postgres Worker                     | 🔴 Critical |
| TC-2.2 | 2: Postgres project, container up   | The waitlist form stores a row under the pg variant     | 🟡 Normal   |
| TC-2.3 | 2: Postgres project, container up   | The admin app signs in against Postgres                 | 🟢 Low      |
| TC-3.1 | 3: Repository only, nothing running | The skills guide a driver choice without a dead end     | 🟡 Normal   |
| TC-3.2 | 3: Repository only, nothing running | ADR 0029 and ADR 0026 tell one story                    | 🟢 Low      |

## Scenario 1: D1 project, driver only

**Setup.** Run once, for every case in this scenario. Run each command from the worktree root unless the step says otherwise.

1. Build the CLI and scaffold a fresh playground.

```sh
pnpm play:reset
```

2. Install the D1 driver.

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes
```

3. Open `.dev/playground/apps/api/src/index.ts`. Add the defect 1 mask line to `interface Bindings`.

4. Write the auth dev origin. `BETTER_AUTH_URL` on a loopback host is what lets the Worker start without a signing secret.

```sh
printf 'BETTER_AUTH_URL="http://localhost:4000"\n' > .dev/playground/apps/api/.dev.vars
```

- [ ] Setup complete

### TC-1.1: The plan and the diff name the chosen variant · 🟢 Low

**Goal.** A person reading the plan can tell which schema variant the CLI picked, and an unconditional line still reads as it did before.

**Steps**

1. Print the plan for `waitlist` without writing anything.

   ```sh
   cd .dev/playground && ./saasaloy add waitlist --dry-run
   ```

   - [ ] The line for `packages/db/src/schema/waitlist.ts` also carries the source path `files/db/schema/waitlist.sqlite.ts`, and you can read both in your terminal
     - the source path is dimmed and appended to the same label
     - the clack note box may wrap it onto the next line; judge whether the wrap is still readable at your terminal width
   - [ ] The line for `apps/api/src/routes/waitlist.ts` carries no source path, because that file is unconditional

2. Print the same plan with the file contents.

   ```sh
   cd .dev/playground && ./saasaloy add waitlist --diff
   ```

   - [ ] The heading above the schema diff names the chosen variant inline, and the diff body is the sqlite table

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Two requests on one D1 Worker · 🔴 Critical

**Goal.** A signed-in user reaches a protected route, and reaches it **again** on the same running Worker. The second request is the one the issue exists for. One sign-in passes on a broken build too.

**Steps**

1. Install both modules. Neither refuses now that the D1 pin is gone.

   ```sh
   cd .dev/playground && ./saasaloy add auth --yes && ./saasaloy add waitlist --yes && pnpm install
   ```

   - [ ] Both commands exit 0, and neither prints a refusal about a missing driver
   - [ ] `.dev/playground/packages/db/src/schema/auth.ts` imports from `drizzle-orm/sqlite-core`, and `.dev/playground/packages/auth/src/db-provider.ts` declares `export const provider = "sqlite" as const;`

2. Open `.dev/playground/packages/db/src/schema/auth.ts`. Add the defect 2 mask column to `account`.

3. Emit the migration and apply it to local D1.

   ```sh
   cd .dev/playground && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
   ```

   - [ ] Both commands exit 0, and the emitted SQL under `packages/db/migrations/` creates `user`, `session`, `account`, `verification` and `waitlist`

4. Create the protected route. Write this file exactly, from the `saasaloy-auth` skill recipe.

   ```sh
   cat > .dev/playground/apps/api/src/routes/widgets.ts <<'EOF'
   import { Hono } from "hono";
   import { getSession } from "@repo/auth/server";
   import type { AuthDbBindings } from "@repo/auth/server";

   export const widgets = new Hono<{ Bindings: AuthDbBindings }>().get("/", async (c) => {
     const session = await getSession(c);
     if (!session) return c.json({ error: { code: "unauthorized", message: "sign in first" } }, 401);
     return c.json({ userId: session.user.id }, 200);
   });
   EOF
   ```

5. Open `.dev/playground/apps/api/src/index.ts`. Import `widgets` from `./routes/widgets` and mount it on the exported chain at `/widgets`, beside the `auth` and `waitlist` routes already there.

6. Start the Worker. Leave it running for the rest of this scenario.

   ```sh
   cd .dev/playground/apps/api && pnpm dev
   ```

   - [ ] The Worker serves on `http://localhost:4000` and prints no startup error

7. In a second terminal, create the account. This is the request the defect 2 mask makes possible.

   ```sh
   curl -s -i -c /tmp/qa-d1-jar.txt -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-d1@example.com","password":"qa-pass-9911","name":"QA D1"}'
   ```

   - [ ] The response status is 200
     - a 500 naming `issuer` means the defect 2 mask is missing or the migration ran before you added it

8. **Assertion 1 of 2.** Sign in, and keep the cookie.

   ```sh
   curl -s -i -c /tmp/qa-d1-jar.txt -b /tmp/qa-d1-jar.txt -X POST http://localhost:4000/auth/sign-in/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-d1@example.com","password":"qa-pass-9911"}'
   ```

   - [ ] The response status is 200, and `/tmp/qa-d1-jar.txt` now holds a session cookie

9. **Assertion 2 of 2.** Request the protected route on the **same** Worker, without restarting it.

   ```sh
   curl -s -i -b /tmp/qa-d1-jar.txt http://localhost:4000/widgets -H 'Origin: http://localhost:3000'
   ```

   - [ ] The response status is 200 and the body carries a `userId`
   - [ ] The Worker terminal prints no `Cannot perform I/O on behalf of a different request`

10. Request it a third time, still on the same Worker.

    ```sh
    curl -s -i -b /tmp/qa-d1-jar.txt http://localhost:4000/widgets -H 'Origin: http://localhost:3000'
    ```

    - [ ] The status is 200 and the `userId` is the same value as in step 9

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The waitlist form stores a row under the sqlite variant · 🟡 Normal

**Goal.** The one neutral route file stores a row through the sqlite schema variant, and a repeat address is a silent success rather than an error the visitor sees.

**Steps**

1. Keep the Worker from TC-1.2 running. In a third terminal, start the web app.

   ```sh
   cd .dev/playground/apps/web && pnpm dev
   ```

2. Open `http://localhost:3000` in the browser. Scroll to the waitlist section.

   - [ ] The waitlist section renders with a labelled email field and a submit button, and nothing overlaps or is cut off

3. Enter `qa-form-d1@example.com` and submit.

   - [ ] The form shows a success state, and the browser console reports no CORS error

4. Submit the **same** address a second time.

   - [ ] The form shows the same success state, and it does not report a conflict or leak that the address is already on the list

5. Read the stored row.

   ```sh
   cd .dev/playground && pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select id, email, created_at from waitlist"
   ```

   - [ ] Exactly one row holds `qa-form-d1@example.com`, and `created_at` is a millisecond integer that matches the time you submitted

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

Stop the Worker and the web dev server in their own terminals. Then confirm nothing survives.

```sh
pkill -f "vite.js dev"; pkill -9 -f "workerd serve"; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/health
```

The last command must print `000`.

## Scenario 2: Postgres project, container up

**Setup.** Run once, for every case in this scenario. This scenario starts from a new playground, so nothing from Scenario 1 carries over.

1. Start Postgres.

```sh
docker run -d --name saasaloy-qa-pg -e POSTGRES_PASSWORD=qapass -e POSTGRES_DB=appdb -p 127.0.0.1:5432:5432 postgres:17-alpine
```

2. Wait for it to accept connections.

```sh
docker exec saasaloy-qa-pg pg_isready -U postgres
```

3. Scaffold a fresh playground and install the Postgres driver, then both modules.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes && ./saasaloy add auth --yes && ./saasaloy add waitlist --yes && pnpm install
```

4. Open `.dev/playground/apps/api/src/index.ts`. Add the defect 1 mask line to `interface Bindings`.

5. Open `.dev/playground/packages/db/src/schema/auth.ts`. Add the defect 2 mask column to `account`.

6. Write both dev vars. `drizzle.config.ts` reads the same file, so the migration and the Worker agree on one URL.

```sh
printf 'BETTER_AUTH_URL="http://localhost:4000"\nDATABASE_URL="postgres://postgres:qapass@127.0.0.1:5432/appdb"\n' > .dev/playground/apps/api/.dev.vars
```

7. Emit and apply the migration.

```sh
cd .dev/playground && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate
```

8. Create `.dev/playground/apps/api/src/routes/widgets.ts` with the same contents as TC-1.2 step 4, and mount it at `/widgets` on the exported chain in `apps/api/src/index.ts`.

- [ ] Setup complete

### TC-2.1: Two requests on one Postgres Worker · 🔴 Critical

**Goal.** A signed-in user reaches a protected route, and reaches it **again** on the same running Worker. Postgres opens a real socket per request, so this is where a shared client throws `Cannot perform I/O on behalf of a different request`. One sign-in passes on a broken build too.

**Steps**

1. Confirm the installed payload is the pg variant.

   - [ ] `.dev/playground/packages/db/src/schema/auth.ts` imports from `drizzle-orm/pg-core`, and `.dev/playground/packages/auth/src/db-provider.ts` declares `export const provider = "pg" as const;`

2. Start the Worker. Leave it running for the rest of this scenario.

   ```sh
   cd .dev/playground/apps/api && pnpm dev
   ```

   - [ ] The Worker serves on `http://localhost:4000` and prints no startup error

3. In a second terminal, create the account.

   ```sh
   curl -s -i -c /tmp/qa-pg-jar.txt -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-pg@example.com","password":"qa-pass-9911","name":"QA PG"}'
   ```

   - [ ] The response status is 200
     - a 500 naming `issuer` means the defect 2 mask is missing or the migration ran before you added it

4. **Assertion 1 of 2.** Sign in, and keep the cookie.

   ```sh
   curl -s -i -c /tmp/qa-pg-jar.txt -b /tmp/qa-pg-jar.txt -X POST http://localhost:4000/auth/sign-in/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"qa-pg@example.com","password":"qa-pass-9911"}'
   ```

   - [ ] The response status is 200, and `/tmp/qa-pg-jar.txt` now holds a session cookie

5. **Assertion 2 of 2.** Request the protected route on the **same** Worker, without restarting it. This step is the reason the issue exists. Do not merge it into step 4.

   ```sh
   curl -s -i -b /tmp/qa-pg-jar.txt http://localhost:4000/widgets -H 'Origin: http://localhost:3000'
   ```

   - [ ] The response status is 200 and the body carries a `userId`
   - [ ] The Worker terminal prints no `Cannot perform I/O on behalf of a different request`

6. Request it a third time, still on the same Worker.

   ```sh
   curl -s -i -b /tmp/qa-pg-jar.txt http://localhost:4000/widgets -H 'Origin: http://localhost:3000'
   ```

   - [ ] The status is 200 and the `userId` is the same value as in step 5

7. Read the session row the Worker wrote.

   ```sh
   docker exec saasaloy-qa-pg psql -U postgres -d appdb -c 'select count(*) from "session";'
   ```

   - [ ] The count is 1 or more, which proves the requests reached the real database and not a cache

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The waitlist form stores a row under the pg variant · 🟡 Normal

**Goal.** The same neutral route file stores a row through the pg schema variant, and the `timestamptz` column holds the same instant the sqlite variant would.

**Steps**

1. Keep the Worker from TC-2.1 running. In a third terminal, start the web app.

   ```sh
   cd .dev/playground/apps/web && pnpm dev
   ```

2. Open `http://localhost:3000` in the browser. Scroll to the waitlist section. Enter `qa-form-pg@example.com` and submit.

   - [ ] The form shows a success state, and the browser console reports no CORS error

3. Submit the **same** address a second time.

   - [ ] The form shows the same success state, and it does not report a conflict

4. Read the stored row.

   ```sh
   docker exec saasaloy-qa-pg psql -U postgres -d appdb -c 'select id, email, created_at from waitlist;'
   ```

   - [ ] Exactly one row holds `qa-form-pg@example.com`, `id` is 1, and `created_at` is a timestamp with a time zone that matches the time you submitted

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The admin app signs in against Postgres · 🟢 Low

**Goal.** A second consumer of `@repo/auth` still works when the driver is Postgres. `modules/admin` is outside this issue's scope, so a failure here is a separate issue, not a blocker.

**Steps**

1. Stop the web dev server. Install the admin app.

   ```sh
   cd .dev/playground && ./saasaloy add admin --yes && pnpm install
   ```

   - [ ] The command exits 0
     - if it refuses, tick Skipped and record the refusal in Notes; this case is out of the issue's scope

2. Promote the TC-2.1 account to admin.

   ```sh
   docker exec saasaloy-qa-pg psql -U postgres -d appdb -c "update \"user\" set role = 'admin' where email = 'qa-pg@example.com';"
   ```

3. Start the admin app.

   ```sh
   cd .dev/playground/apps/admin && pnpm dev
   ```

4. Open `http://localhost:3001` in the browser. Sign in as `qa-pg@example.com` with password `qa-pass-9911`.

   - [ ] The sign-in succeeds and the guarded view renders rather than a denied screen

5. Reload the page once, without restarting the Worker.

   - [ ] The guarded view renders again, and the Worker terminal prints no `Cannot perform I/O on behalf of a different request`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

Stop the Worker, the web dev server and the admin dev server in their own terminals. Then remove the container and confirm nothing survives.

```sh
pkill -f "vite.js dev"; pkill -9 -f "workerd serve"; docker stop saasaloy-qa-pg && docker rm saasaloy-qa-pg; docker ps -a
```

`docker ps -a` must list no `saasaloy-qa-pg` row.

## Scenario 3: Repository only, nothing running

**Setup.** Run once. Nothing needs to be installed, built or started. Read from the worktree root.

- [ ] Setup complete

### TC-3.1: The skills guide a driver choice without a dead end · 🟡 Normal

**Goal.** A person picking a driver, or switching one, can follow the five rewritten skills without hitting a command that only fits D1.

**Steps**

1. Read `modules/waitlist/skills/saasaloy-waitlist/SKILL.md` and `modules/auth/skills/saasaloy-auth/SKILL.md` end to end, as a person installing the module for the first time.

   - [ ] Each file states plainly that the module installs against either driver, and neither tells you to run a migration command that belongs to one driver
     - the variant table names both schema files and the condition that picks each
     - the apply step points at the installed driver's own skill rather than naming a command
   - [ ] The protected-route recipe in the auth skill matches the signature the code ships, `getSession(c)` rather than `getSession(c.req.raw)`

2. Read `modules/database/skills/saasaloy-database/SKILL.md`, `modules/database-d1/skills/saasaloy-database-d1/SKILL.md` and `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md`.

   - [ ] All three teach one call shape, `withDb(c, async (db) => …)` and `getDb(c.env)`, with no leftover `getDb(c.env.DB)`
   - [ ] The split between the core skill and a driver skill is clear, so you can tell which file owns the migrate command

3. Read the waitlist skill's note on `created_at` for a project that installed before the split.

   - [ ] The note tells such a project what to do, and you can follow it without guessing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: ADR 0029 and ADR 0026 tell one story · 🟢 Low

**Goal.** The two records agree with each other and with the code that shipped.

**Steps**

1. Read `docs/adr/adr-0029-auth-holds-a-request-scoped-db-client-2026-08-31.md`.

   - [ ] It states both halves of the decision, that the module-scope `auth` singleton stays and that the database client behind it is request-scoped, and that every `auth.handler` and `auth.api.*` call runs inside `withAuthScope` on both drivers
   - [ ] Its consequences name the two-request assertion that TC-1.2 and TC-2.1 run

2. Read the amendment in `docs/adr/adr-0026-database-driver-split-2026-08-28.md`.

   - [ ] The amendment retracts the D1 pin rather than restating it, keeps the correction to the "no branch needed" consequence, and links ADR 0029
   - [ ] Nothing in either record contradicts what you saw in Scenario 1 or Scenario 2

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

These outcomes are transcribed from the run against commit `b91ee07` plus fix round 1. The three commits since then change only comments, a plan document and a skill document, so the record still describes `e9be464`. They were not re-run to write this plan.

The result over the 29 acceptance checks is **24 clean passes, 4 passes that needed a mask, 1 fail**. The one fail is the missing QA document, which is this file.

The repository gate, run cold and in full from the worktree root:

```sh
pnpm build
```

```sh
pnpm test
```

```sh
pnpm lint
```

The CLI suite alone:

```sh
pnpm --filter saasaloy test
```

The module suite alone:

```sh
pnpm run test:modules
```

The two-request flow, on one running Worker, with one cookie jar, against the Postgres project:

```sh
curl -s -c jar.txt -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"verify@example.com","password":"verify-pass-9911","name":"Pos"}'
```

```sh
curl -s -c jar.txt -b jar.txt -X POST http://localhost:4000/auth/sign-in/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"email":"verify@example.com","password":"verify-pass-9911"}'
```

```sh
curl -s -b jar.txt http://localhost:4000/widgets -H 'Origin: http://localhost:3000'
```

### Phase 1, the `onlyWith` mechanism

- ✅ P1-1 `onlyWith` on both file-entry shapes → the schema declares it twice, at lines 90 and 260, inside the top-level `files[]` item and inside the `scaffolds[].files[]` item. Both keep `additionalProperties: false`, so a typo is rejected. `schema.test.ts:79-126` pins accept and reject.
- ✅ P1-2 the condition is enforced in one shared path → `selectModuleFiles` at `applier.ts:203` takes the install set and filters inside `record()` at `applier.ts:216-234`. Neither `buildPlan` nor `buildUpdatePlan` holds a second filter.
- ✅ P1-3 two disjoint variants for one target are legal → `applier.test.ts:1974` and `:1994` each select one variant per driver and assert the map holds one entry per target.
- ✅ P1-4 an all-conditional target with no match is a hard plan-time error → a scratch descriptor made `add` exit **2**, the repo's `EXIT_REFUSED`, naming the target, the source path and the `onlyWith` value. Nothing was written.
- ✅ P1-5 the plan and the diff name the chosen variant → the plan line appends `(files/db/schema/waitlist.sqlite.ts)` and the diff heading carries it inline. `fileLabel` at `add.ts:155-158` returns the target unchanged when `onlyWith` is absent, so unconditional lines are byte-identical to before.
- ✅ P1-6 unit tests cover the four named cases → selection per driver, a scaffold file, the no-match error, and `update` seeing exactly the set `add` wrote.

### Phase 2, the D1 client contract

- ✅ P2-1 `database-d1` exports `getDb(env)` → `client.ts:33`, reading `env.DB` inside. No shipped caller passes a bare `D1Database`.
- ✅ P2-2 `database-d1` exports a pass-through cleanup wrapper → both drivers export `DbBindings`, `getDb`, `Db`, `DbRequestContext` and `withDb` with the same parameter order. D1's `withDb` reads no `executionCtx`.
- ⚠️ P2-3 one route body type-checks under both drivers → the same bytes land under both drivers, and both diffs are empty. The typecheck half passes **only with pre-existing defect 1 masked**. Every package this branch owns compiles clean on its own.
- ✅ P2-4 the three driver skills document one call shape → six `getDb(` hits, all `getDb(c.env)` or `getDb(env)`, no `getDb(c.env.DB)`.

### Phase 3, waitlist

- ✅ P3-1 the waitlist schema ships two variants → `waitlist.pg.ts` and `waitlist.sqlite.ts`, both mapped to `@db/schema/waitlist.ts`, one landing per project.
- ✅ P3-2 the pg id and timestamp are idiomatic and semantically equal → `generatedAlwaysAsIdentity()` and `defaultNow()`, no `serial`. The emitted SQL creates `timestamp with time zone DEFAULT now()`, and sqlite keeps millisecond integers.
- ✅ P3-3 the waitlist route is one neutral file → no `c.env.DB`, no `sqlite-core`, no `pg-core`, one descriptor entry with no `onlyWith`.
- ✅ P3-4 the waitlist skill is driver-neutral → no `db:migrate:local`, no `wrangler d1`, no hard-requirement claim. The apply step points at the installed driver's skill.

### Phase 4, auth

- ✅ P4-1 the auth schema ships two variants → both declare all five admin-plugin columns, `role`, `banned`, `banReason`, `banExpires` and `impersonatedBy`.
- ✅ P4-2 `db-provider.ts` ships in two variants → each exports `provider`, `AuthDbBindings`, `authDb` and `withAuthScope`. The diff between them is confined to the import, the `provider` literal, the comments and one statement inside `withAuthScope`.
- ✅ P4-3 `auth.ts` keeps its module-scope export and its patch point → the codemod ran against the real shipped file and produced `plugins: [admin(), stripe()]`. A regression case in `ts-module.test.ts` now reads that file off disk and guards it.
- ✅ P4-4 the D1 binding type is gone from the neutral auth config → no `D1Database`, no `DB:`. `AuthEnv` declares four optional strings and nothing else.
- ⚠️ P4-5 `getSession` takes the request context and scopes internally → `server.ts:44` declares a structural parameter type and wraps the call in `withAuthScope`. No `hono` import anywhere under `modules/auth/files/src/`. The whole-project typecheck needs **pre-existing defect 1 masked**.
- ✅ P4-6 the auth route wraps its handler in the scope → one chained `.on(["GET", "POST"], "/*", …)` expression, named `export const authRoute`, importing only `hono` and `@repo/auth/server`.
- ✅ P4-7 a unit test pins the scoped-client contract → `db-scope.test.ts` runs 9 cases under `node --test`, including the two-scope case. The file is absent from the descriptor, so `add auth` never copies it.
- ✅ P4-8 the auth skill is driver-neutral and the recipe matches → no `wrangler d1`, no `db:migrate:local`, and the recipe calls `getSession(c)`.

### Phase 5

- ✅ P5-1 the stopgap is gone → `auth` is `["api", "database"]` and `waitlist` is `["api", "database", "validators"]`.
- ✅ P5-2 a new ADR records the request-scoped db client → `adr-0029-auth-holds-a-request-scoped-db-client-2026-08-31.md`, with Status, Considered Options, Consequences and References.
- ✅ P5-3 ADR 0026's amendment is cut down → the pin is retracted, the "no branch needed" correction is kept, and ADR 0029 is linked twice.
- ⚠️ P5-4 both modules install and type-check under `database-d1` → the three `add` runs and `pnpm install` all exit 0 with no refusal, and the installed schema uses `sqliteTable`. The typecheck half passes **only with pre-existing defect 1 masked**.
- ⚠️ P5-5 both modules install and type-check under `database-postgres` → the same three runs exit 0, the installed schema uses `pgTable`, and `db:generate` then `db:migrate` succeed against the container on the unmasked schema. The typecheck half passes **only with pre-existing defect 1 masked**.
- ❌ P5-6 the auth QA case asserts two requests, not one → **the written document was missing**. This file closes it, at TC-1.2 and TC-2.1. The flow itself was executed on both drivers and passed: `signup 200`, `signin 200`, `widgets 200`, `widgets-again 200`, plus `waitlist 201` twice on the same address. Sign-up needed **pre-existing defect 2 masked**.
- ✅ P5-7 the repository gate passes → `pnpm build`, `pnpm test` and `pnpm lint` each exit 0, run cold. `turbo run test` reports 29 test files and 538 tests passed; `test:modules` reports 46 tests, 0 failed.

### Two findings from the run worth carrying

- **A negative control proved the fix is load-bearing.** Reverting `withAuthScope` to cache one module-scope client, in the scratch playground only, made the **second** request return 500 with `Cannot perform I/O on behalf of a different request. … (I/O type: Writable)`. Restoring the file returned it to 200. This is exactly what TC-1.2 step 9 and TC-2.1 step 5 guard.
- **A `turbo` cache gap reported a false green, and is now closed.** The `test` task declared no `inputs`, so a module-descriptor edit never busted the hash and the gate replayed an older run. `turbo.json` now declares `"inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/modules/**"]`. The same gap remains on the `typecheck` task, and no test under it reads outside its own package today. Any `pnpm typecheck` result taken from `.dev/playground` without `--force` is not evidence.

## Not covered / needs human judgment

- **`saasaloy remove` after a conditional install.** ADR 0026's amendment tells a driver-switching project to remove and re-add `auth` and `waitlist`. `remover.ts` does not call the shared file lister, so whether `remove` deletes a conditionally chosen file is unverified. This is the sequence most likely to surprise a user, and it is worth its own issue.
- **`saasaloy update` end to end.** The property that `update` sees exactly the set `add` wrote is proved by unit test only. Nobody ran `./saasaloy update` against a real project.
- **D1 in production.** Only `db:migrate:local` against `.wrangler/state` ran. `db:migrate:prod` needs a Cloudflare account and a real `database_id`.
- **Hyperdrive.** The Postgres client reads `HYPERDRIVE?.connectionString ?? DATABASE_URL`. Only the `DATABASE_URL` branch was exercised. Hyperdrive is a paid feature.
- **Compatibility and accessibility.** This change adds no new UI. The waitlist form and the admin sign-in page are unchanged by this branch, so no browser matrix, responsive sweep, dark-mode pass or keyboard-navigation pass is in this plan. TC-1.3 and TC-2.2 look at the form only to confirm the route behind it stores a row.
- **Performance and concurrency.** The per-request Postgres socket is a plausible load concern, but this branch changes only where the client is created, not how many. No load test is in scope. TC-2.1 step 6 covers the sequential repeat, which is the failure the issue names.
- **Content quality of ADR 0029 and the five rewritten skills.** TC-3.1 and TC-3.2 ask a human to judge it. The agent checked only the required strings, headings and claims.
- **The two pre-existing defects themselves.** Both reproduce on `main`. Fixing either is out of this issue's scope, and each needs its own issue. Adding `issuer: text("issuer")` to `account` in both schema variants is a two-line change.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
