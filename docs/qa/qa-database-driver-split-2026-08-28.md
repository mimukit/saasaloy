# QA Plan: database core plus the D1 and Postgres drivers

_Generated 2026-08-28 · against `9e2d2e0` · covers issue #85, the split of the `database` capability into a neutral core plus `database-d1` and `database-postgres`_

## Summary

- `saasaloy add database` now scaffolds only the tables, the schema barrel, the repository layer and `db:generate`; a driver module supplies the client, the dialect config and the migrate commands.
- Working means a project on either driver reads rows from a real database through a Worker route, and `add` refuses the second driver.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Repository: `saasaloy`. Branch under test: `issue-85-split-database-into-a-neutral-core-with-d1`. Commit `9e2d2e0`.
- Node 24 or later, and pnpm 11 or later.
- Docker, for the Postgres server in Scenario 2.
- A Cloudflare account with Workers and D1 enabled. TC-2.3 also needs Hyperdrive, which is a paid feature.
- Local API base URL: `http://localhost:4000`. The API dev server pins port 4000 with `strictPort`.
- No feature flags apply.

Check out the branch.

```sh
git switch issue-85-split-database-into-a-neutral-core-with-d1
```

Install the repository dependencies.

```sh
pnpm install
```

Authenticate wrangler once. Scenarios 1 and 2 both deploy.

```sh
pnpm dlx wrangler login
```

Every `saasaloy` command in this plan runs inside `.dev/playground`, through the `./saasaloy` shim. The shim points the built CLI at this worktree's `modules/`. `pnpm play:init` builds the CLI, scaffolds the playground and copies the shim.

- [x] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| #      | Scenario                            | Test case                                            | Priority   |
| ------ | ----------------------------------- | ---------------------------------------------------- | ---------- |
| TC-1.1 | 1: D1 project, local miniflare only | A route reads local D1 through `c.env.DB`             | 🔴 Critical |
| TC-1.2 | 1: D1 project, local miniflare only | A real D1 database, remote migrations and a deploy    | 🔴 Critical |
| TC-1.3 | 1: D1 project, local miniflare only | The runbook's driver-removal recovery                 | 🟡 Normal   |
| TC-2.1 | 2: Postgres project, local Postgres | A route reads Postgres under the Workers runtime      | 🔴 Critical |
| TC-2.2 | 2: Postgres project, local Postgres | The production secret and a deployed Worker           | 🔴 Critical |
| TC-2.3 | 2: Postgres project, local Postgres | A real Hyperdrive binding wins over `DATABASE_URL`    | 🟡 Normal   |
| TC-2.4 | 2: Postgres project, local Postgres | The schema barrel merges two tables under real Vite   | 🟡 Normal   |
| TC-3.1 | 3: Runbooks only, no project state  | The three runbooks match what the commands really do  | 🟡 Normal   |

## Scenario 1: D1 project, local miniflare only

**Setup.** Run once, for every case in this scenario.

1. Create a clean playground on the D1 driver.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 --yes && pnpm install
```

2. Add a table file. Write `packages/db/src/schema/probe.ts` with this content.

```ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const probe = sqliteTable("probe", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note").notNull(),
});
```

3. Add a repository. Write `packages/db/src/repositories/probe.ts` with this content.

```ts
import { probe } from "../schema/probe";

export async function listProbe(db: any) {
  return db.select().from(probe);
}

export async function insertProbe(db: any, note: string) {
  return db.insert(probe).values({ note }).returning();
}
```

4. Add a route. Write `apps/api/src/routes/probe.ts` with this content. It is the example from the `saasaloy-database-d1` runbook.

```ts
import { Hono } from "hono";
import { getDb, type DbBindings } from "@repo/db/client";
import { insertProbe, listProbe } from "@repo/db/repositories/probe";

const probe = new Hono<{ Bindings: DbBindings }>();

probe.get("/", async (c) => c.json(await listProbe(getDb(c.env.DB))));
probe.post("/", async (c) => c.json(await insertProbe(getDb(c.env.DB), "hello-d1")));

export default probe;
```

5. Generate the migration SQL.

```sh
pnpm --filter @repo/db db:generate
```

- [x] Setup complete

### TC-1.1: A route reads local D1 through `c.env.DB` · 🔴 Critical

**Goal.** The D1 driver serves a real query from the local miniflare database with no Cloudflare account.

**Steps**

1. Apply the migration to the local database.

   ```sh
   pnpm --filter @repo/db db:migrate:local
   ```

   - [x] The command exits 0 and names the migration file it applied
   - [x] `apps/api/.wrangler/state` now exists

2. Start the API dev server. Leave it running.

   ```sh
   pnpm --filter @repo/api dev
   ```

   - [x] The server starts on `http://localhost:4000` with no binding error in the log

3. Insert a row through the route, in a second terminal.

   ```sh
   curl -i -X POST http://localhost:4000/probe
   ```

   - [x] The response is `200` and the JSON body holds one row with `note` set to `hello-d1`

4. Read the rows back.

   ```sh
   curl -s http://localhost:4000/probe
   ```

   - [x] The body holds the row the previous step inserted

5. Stop the dev server. Start it again with the same command. Repeat step 4.

   - [x] The row survives the restart, so the migrated file is the one the app reads

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A real D1 database, remote migrations and a deploy · 🔴 Critical

**Goal.** The placeholder `database_id` flow in the runbook produces a working remote D1 database.

**Steps**

1. Confirm the shipped placeholder before you change it.

   ```sh
   grep -n 'database_id' apps/api/wrangler.jsonc
   ```

   - [x] The value is the string `"local"`

2. Create the real database.

   ```sh
   pnpm dlx wrangler d1 create app-db
   ```

   - [x] The command prints a `database_id`

3. Replace `"local"` in `apps/api/wrangler.jsonc` with the printed id. Save the file.

   - [x] The file now holds the real id and nothing else changed

4. Apply the migration to the remote database.

   ```sh
   pnpm --filter @repo/db db:migrate:prod
   ```

   - [x] The command exits 0 and reports the migration applied to the remote database

5. Deploy the Worker.

   ```sh
   pnpm --filter @repo/api deploy
   ```

   - [x] The deploy succeeds and prints the Worker URL

6. Insert and read through the deployed Worker. Replace `<worker-url>` with the printed URL.

   ```sh
   curl -s -X POST <worker-url>/probe && curl -s <worker-url>/probe
   ```

   - [x] The POST returns the inserted row and the GET returns it back

7. Run `wrangler d1 create app-db` again.

   ```sh
   pnpm dlx wrangler d1 create app-db
   ```

   - [x] The command fails and reports the name is taken, so it does not clobber the database

8. Delete the remote database when you finish, so the account stays clean.

   ```sh
   pnpm dlx wrangler d1 delete app-db
   ```

   - [x] The delete succeeds

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The runbook's driver-removal recovery · 🟡 Normal

**Goal.** The `saasaloy-database-d1` runbook tells the truth about the broken state `remove` leaves and about how to repair it.

Run this case last. It breaks the project on purpose.

**Steps**

1. Remove the driver.

   ```sh
   ./saasaloy remove database-d1 --yes
   ```

   - [x] The command warns once per patch it cannot reverse, naming `apps/api/wrangler.jsonc` and `packages/db/package.json`
   - [x] `packages/db/tsconfig.json`, `packages/db/src/client.ts` and `packages/db/drizzle.config.ts` are gone

2. Typecheck the project.

   ```sh
   pnpm typecheck
   ```

   - [x] The run fails at `@repo/db` and tsc prints its option help, exactly as the runbook says

3. Open `modules/database-d1/skills/saasaloy-database-d1/SKILL.md` in the repository. Read the "Switching drivers" section.

   - [x] The section states that `tsconfig.json` is the core's file, not the driver's
   - [x] The section states that `pnpm typecheck` fails until you add the other driver

4. Copy the `packages/db/tsconfig.json` block from that section into the playground at the same path. Typecheck again.

   ```sh
   pnpm typecheck
   ```

   - [x] The run passes, so the runbook's hand-repair works as written

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd ../.. && pnpm play:destroy
```

## Scenario 2: Postgres project, local Postgres

**Setup.** Run once, for every case in this scenario.

1. Start a Postgres server.

```sh
docker run -d --name app-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18
```

2. Create a clean playground on the Postgres driver.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes && pnpm install
```

3. Write the local connection string to `apps/api/.dev.vars`.

```sh
printf 'DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"\n' > apps/api/.dev.vars
```

4. Add a table file. Write `packages/db/src/schema/probe.ts` with this content.

```ts
import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const probe = pgTable("probe", {
  id: serial("id").primaryKey(),
  note: text("note").notNull(),
});
```

5. Add a repository. Write `packages/db/src/repositories/probe.ts` with this content.

```ts
import { probe } from "../schema/probe";

export async function listProbe(db: any) {
  return db.select().from(probe);
}

export async function insertProbe(db: any, note: string) {
  return db.insert(probe).values({ note }).returning();
}
```

6. Add a route. Write `apps/api/src/routes/probe.ts` with this content. It copies the example from the `saasaloy-database-postgres` runbook, including the `try` and `finally` order.

```ts
import { Hono } from "hono";
import { getDb, type DbBindings } from "@repo/db/client";
import { insertProbe, listProbe } from "@repo/db/repositories/probe";

const probe = new Hono<{ Bindings: DbBindings }>();

probe.get("/", async (c) => {
  const db = getDb(c.env);
  try {
    return c.json(await listProbe(db));
  } finally {
    c.executionCtx.waitUntil(db.$client.end());
  }
});

probe.post("/", async (c) => {
  const db = getDb(c.env);
  try {
    return c.json(await insertProbe(db, "hello-pg"));
  } finally {
    c.executionCtx.waitUntil(db.$client.end());
  }
});

export default probe;
```

7. Generate and apply the migration.

```sh
pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate
```

- [x] Setup complete

### TC-2.1: A route reads Postgres under the Workers runtime · 🔴 Critical

**Goal.** `getDb(c.env)` opens and closes a postgres.js connection correctly inside a real Worker request.

This case is the one an agent could not run. It proves that `nodejs_compat` lets postgres.js run in workerd, and that the runbook's `finally` order serves every request rather than the first one only.

**Steps**

1. Start the API dev server. It serves the Worker on the real workerd runtime. Leave it running.

   ```sh
   pnpm --filter @repo/api dev
   ```

   - [x] The server starts on `http://localhost:4000` and the log shows no `nodejs_compat` error

2. Insert a row, in a second terminal.

   ```sh
   curl -i -X POST http://localhost:4000/probe
   ```

   - [x] The response is `200` and the body holds one row with `note` set to `hello-pg`

3. Read the rows back.

   ```sh
   curl -s http://localhost:4000/probe
   ```

   - [x] The body holds the row the previous step inserted

4. Send twenty requests in a row. This is the check the misordered example failed.

   ```sh
   for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code} ' http://localhost:4000/probe; done; echo
   ```

   - [x] All twenty responses are `200`, with no `CONNECTION_ENDED` and no `Cannot perform I/O on behalf of a different request` in the server log

5. Read the server log for the whole run.

   - [x] No unhandled rejection and no socket warning appears

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The production secret and a deployed Worker · 🔴 Critical

**Goal.** A deployed Worker reads `DATABASE_URL` from a Workers secret, not from `.dev.vars`.

This case needs a Postgres server the Cloudflare edge can reach. Use a managed instance, such as Neon or Supabase. Skip the case if you have none, and say so in the notes.

**Steps**

1. Apply the migration to the reachable database. Replace `<remote-url>` with its connection string.

   ```sh
   DATABASE_URL="<remote-url>" pnpm --filter @repo/db db:migrate
   ```

   - [x] The command exits 0 and reports the migration applied

2. Set the secret. Paste the same connection string at the prompt.

   ```sh
   pnpm dlx wrangler secret put DATABASE_URL --config apps/api/wrangler.jsonc
   ```

   - [x] Wrangler confirms it stored the secret

3. Confirm the plaintext block stays empty.

   ```sh
   grep -n 'DATABASE_URL' apps/api/wrangler.jsonc
   ```

   - [x] The file holds no `DATABASE_URL`, so the password never reaches git

4. Deploy the Worker.

   ```sh
   pnpm --filter @repo/api deploy
   ```

   - [x] The deploy succeeds and prints the Worker URL

5. Insert and read through the deployed Worker. Replace `<worker-url>` with the printed URL.

   ```sh
   curl -s -X POST <worker-url>/probe && curl -s <worker-url>/probe
   ```

   - [x] The POST returns the inserted row and the GET returns it back

6. Read the live Worker log while you repeat the GET.

   ```sh
   pnpm dlx wrangler tail --config apps/api/wrangler.jsonc
   ```

   - [x] No log line prints the connection string, so the secret does not leak

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A real Hyperdrive binding wins over `DATABASE_URL` · 🟡 Normal

**Goal.** Adding the `HYPERDRIVE` binding moves the deployed Worker onto the pooled path with no code change.

Run TC-2.2 first. This case builds on the deployed Worker. Hyperdrive is a paid feature; skip the case if the account does not have it.

**Steps**

1. Create the Hyperdrive configuration. Use the same `<remote-url>` as TC-2.2.

   ```sh
   pnpm dlx wrangler hyperdrive create app-db --connection-string="<remote-url>"
   ```

   - [ ] The command prints a Hyperdrive id

2. Add the binding to `apps/api/wrangler.jsonc`, exactly as the runbook's "Hyperdrive: the opt-in" section shows. Use `"binding": "HYPERDRIVE"` and the printed id. Save the file.

   - [ ] The file holds the new `hyperdrive` array and the code is untouched

3. Deploy again and read the route.

   ```sh
   pnpm --filter @repo/api deploy && curl -s <worker-url>/probe
   ```

   - [ ] The route still returns the same rows, so the pooled path serves the same database

4. Rename the binding to `HYPER` in `apps/api/wrangler.jsonc`. Deploy again and read the route.

   ```sh
   pnpm --filter @repo/api deploy && curl -s <worker-url>/probe
   ```

   - [ ] The route still returns rows, and nothing warns about the renamed binding, which is the silent fallback the runbook names

5. Restore the binding name to `HYPERDRIVE`. Delete the Hyperdrive configuration when you finish.

   ```sh
   pnpm dlx wrangler hyperdrive delete app-db
   ```

   - [ ] The delete succeeds

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: The schema barrel merges two tables under real Vite · 🟡 Normal

**Goal.** `src/schema.ts` merges every table file into one object when Vite bundles it, so `db.query.<table>` works for each table.

**Steps**

1. Add a second table file. Write `packages/db/src/schema/note.ts` with this content.

   ```ts
   import { pgTable, serial, text } from "drizzle-orm/pg-core";

   export const note = pgTable("note", {
     id: serial("id").primaryKey(),
     body: text("body").notNull(),
   });
   ```

2. Generate and apply the migration.

   ```sh
   pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate
   ```

   - [x] The generate step reports two tables and the migrate step exits 0

3. Add a route that reads the barrel by name. Write `apps/api/src/routes/barrel.ts` with this content.

   ```ts
   import { Hono } from "hono";
   import { getDb, type DbBindings } from "@repo/db/client";

   const barrel = new Hono<{ Bindings: DbBindings }>();

   barrel.get("/", async (c) => {
     const db = getDb(c.env);
     try {
       return c.json({ tables: Object.keys((db as any)._.schema ?? {}) });
     } finally {
       c.executionCtx.waitUntil(db.$client.end());
     }
   });

   export default barrel;
   ```

4. Start the dev server and read the route.

   ```sh
   curl -s http://localhost:4000/barrel
   ```

   - [x] The body names both `probe` and `note`, so the glob merged both table files

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
cd ../.. && pnpm play:destroy && docker rm -f app-pg
```

## Scenario 3: Runbooks only, no project state

**Setup.** Run once, for every case in this scenario.

1. Open the three runbooks in the repository. No playground is needed.

- `modules/database/skills/saasaloy-database/SKILL.md`
- `modules/database-d1/skills/saasaloy-database-d1/SKILL.md`
- `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md`

- [ ] Setup complete

### TC-3.1: The three runbooks match what the commands really do · 🟡 Normal

**Goal.** An agent that follows a runbook without running anything first gets working code.

These files are the product of this change, and two of the four review findings were defects in them. A human reading them against the runs from Scenarios 1 and 2 is the only check that catches the next one.

**Steps**

1. Read the core runbook, `saasaloy-database/SKILL.md`, top to bottom.

   - [ ] The file describes the tables, the schema barrel, the repository layer and `db:generate`, and it names both driver skills
   - [ ] The file never claims the core supplies a client, a dialect or a migrate command
   - [ ] The "Migrations" section warns that `db:generate` needs a driver installed

2. Read the D1 runbook, `saasaloy-database-d1/SKILL.md`, against what you ran in Scenario 1.

   - [ ] Every command in the file matches the command you ran, with the same flags
   - [ ] The `database_id` placeholder section matches what step TC-1.2.2 printed

3. Read the Postgres runbook, `saasaloy-database-postgres/SKILL.md`, against what you ran in Scenario 2.

   - [ ] The route example carries the `try` and `finally` shape, and the prose says the order is what matters
   - [ ] The `.dev.vars` and secret sections match the paths you used

4. Compare the split of responsibility across all three files.

   - [ ] Each fact appears in one file only, with no rule stated twice in two wordings
   - [ ] A reader with no prior context could tell which file owns which decision

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The agent ran all thirteen acceptance checks against commit `9e2d2e0` in a throwaway playground, then destroyed the playground. Thirteen passed, none failed.

Scaffold a core-only playground (C1, C3).

```sh
pnpm play:init && cd .dev/playground && ./saasaloy add database --yes
```

Assert the core scaffolds no client, no migrate script and no wrangler devDependency (C1).

```sh
node -e 'const p=require("./packages/db/package.json");const s=Object.keys(p.scripts);console.log("client.ts:",require("fs").existsSync("packages/db/src/client.ts"),"scripts:",s,"migrate:",s.filter(k=>k.startsWith("db:migrate")),"wrangler:",p.devDependencies&&p.devDependencies.wrangler)'
```

Assert the core runbook stays driver-neutral (C2).

```sh
S=modules/database/skills/saasaloy-database/SKILL.md && grep -c 'saasaloy-database-d1' $S && grep -c 'saasaloy-database-postgres' $S && grep -c 'schema barrel' $S && ! grep -qi 'D1Database\|c\.env\.DB\|wrangler d1' $S
```

Assert `.dev.vars` is ignored in a scaffolded project (C3).

```sh
grep -n '\.dev\.vars' packages/cli/templates/base/_gitignore && cd .dev/playground && touch .dev.vars apps/api/.dev.vars && git check-ignore -v .dev.vars apps/api/.dev.vars
```

Compare the two-module result against the pre-split baseline (C4).

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes && cd - && diff -r -x node_modules -x .git -x saasaloy -x '*skills*' -x 'saasaloy-lock.json' -x 'saasaloy.json' .afkkit/baseline .dev/playground
```

Assert the driver exclusion refuses the second driver and writes nothing (C5).

```sh
cd .dev/playground && cp saasaloy.json /tmp/before.json && ./saasaloy add database-postgres --yes; echo "exit=$?"; diff /tmp/before.json saasaloy.json
```

Assert the D1 runbook content and the installed skill link (C6).

```sh
S=modules/database-d1/skills/saasaloy-database-d1/SKILL.md && for t in d1_databases 'c\.env\.DB' database_id 'wrangler d1 create' 'db:migrate:local' 'db:migrate:prod'; do grep -c "$t" $S; done && ls -l .dev/playground/.claude/skills/saasaloy-database-d1
```

Assert the connection-string precedence in the installed client (C7). The `c7/` harness stubbed the Vite-only schema barrel and left `resolveConnectionString` untouched. It was deleted after the run, along with the `c8/` harness below.

```sh
node .dev/playground/packages/db/c7/run.ts
```

Run migrations and a repository round trip against a real Postgres (C8).

```sh
docker run -d --name pg85 -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:17 && export DATABASE_URL=postgres://postgres:pg@127.0.0.1:55432/postgres && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate && node --import ./c8/register.mjs c8/run.ts
```

Assert the Postgres descriptor and the patched manifest (C9).

```sh
node -e 'const d=require("./modules/database-postgres/registry-item.json");console.log(d.envVars.DATABASE_URL);for(const p of d.patches)console.log(p.kind,p.file,p.name||p.bindingType,p.range||p.value||"")'
```

Assert the Postgres runbook content (C10).

```sh
S=modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md && grep -c '\.dev\.vars' $S && grep -c 'wrangler secret put DATABASE_URL' $S && grep -c 'HYPERDRIVE' $S
```

Assert the ADR (C11).

```sh
grep -ln 'conflictsWith' docs/adr/*.md && grep -n 'ADR 0001\|single-provider\|stateful' docs/adr/adr-0023-database-driver-split-2026-08-28.md
```

Assert the documentation tables (C12).

```sh
grep -n 'database-d1\|database-postgres' modules/README.md README.md && ! grep -q 'comming soon' README.md
```

Assert the follow-up issue (C13).

```sh
gh issue list --search 'collision in:title' --state all --json number,title,state
```

Results:

- ✅ C1 → `add database` creates `src/schema.ts` and `src/repositories/`, and no `src/client.ts`. Scripts are `clean`, `db:generate`, `typecheck`, with no `db:migrate*` key, no `wrangler` devDependency and no `d1_databases` block.
- ✅ C2 → three mentions of each driver skill, two of "schema barrel", five of `db:generate`, and no match for `D1Database`, `c.env.DB` or `wrangler d1`.
- ✅ C3 → `_gitignore:17-18` holds `.dev.vars` and `.dev.vars.*`. `git check-ignore` reports both the repository root and `apps/api/` as ignored.
- ✅ C4 → `add database` plus `add database-d1` reproduces the pre-split baseline with four differences, all intentional and none functional. `.gitignore` gains the two `.dev.vars` lines from C3. `.saasaloy/manifest.json` re-attributes `src/client.ts`, `drizzle.config.ts` and `tsconfig.json` to `database-d1` and records the new skill and the five D1 patches. `packages/db/package.json` holds the same keys and the same values in a different order, confirmed by a sorted deep compare. `packages/db/src/schema.ts` differs by one comment, changed in commit `9e2d2e0` so the core stops naming D1.
- ✅ C5 → exit 1, with `database-postgres declares a conflict with database-d1, which is already installed. Run saasaloy remove database-d1 first.` `saasaloy.json`, `saasaloy-lock.json` and `src/client.ts` are all unchanged. The refusal prints on stdout and stderr stays empty, so exit code 1 is the reliable signal for a caller.
- ✅ C6 → frontmatter `name: saasaloy-database-d1`. Match counts: `d1_databases` 5, `c.env.DB` 6, `database_id` 6, `wrangler d1 create` 2, `db:migrate:local` 4, `db:migrate:prod` 5. The installed link is `.claude/skills/saasaloy-database-d1 -> ../../.agents/skills/saasaloy-database-d1` and the target holds `SKILL.md`.
- ✅ C7 → the installed `packages/db/src/client.ts` is byte-identical to the module source and line 41 reads `const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;`. A Node harness against the installed file returned `A` with both set, `B` with only `DATABASE_URL`, and threw the configuration error with neither.
- ✅ C8 → `db:generate` emitted `migrations/0000_material_viper.sql` for one table. `db:migrate` reported `migrations applied successfully!`. The round trip through the unmodified `src/client.ts` and repository inserted one row and read the same value back. The container's `drizzle.__drizzle_migrations` held exactly one row. The container was removed and `docker ps -a` is empty.
- ✅ C9 → `envVars.DATABASE_URL` is a non-empty string. The descriptor patches are `wrangler-binding` on `apps/api/wrangler.jsonc`, `package-json-script` `db:migrate` set to `drizzle-kit migrate`, and `package-json-dependency` entries pinning `postgres` to `3.4.9` and `@types/node` to `26.1.2`. The installed `packages/db/package.json` shows all three.
- ✅ C10 → frontmatter `name: saasaloy-database-postgres`. Counts: `.dev.vars` 7, `wrangler secret put DATABASE_URL` 1, `HYPERDRIVE` 5. Sections present at lines 45, 67, 159 and 194.
- ✅ C11 → `docs/adr/adr-0023-database-driver-split-2026-08-28.md` exists and is the only ADR naming `conflictsWith`. It cites ADR 0001's 2026-08-04 amendment and argues the carve-out for a stateful capability. `docs/adr/` keeps no index file, so that clause of the check has nothing to satisfy.
- ✅ C12 → `modules/README.md:28,37-39` describes the driver shape and names both modules. `README.md:16` reads `| Database | Drizzle, on D1 (SQLite) or Postgres |`, `README.md:37` names both drivers, and `README.md:51` adds the `database-postgres` row. No `comming soon` remains, and every surviving `D1` mention is driver-scoped.
- ✅ C13 → issue #91, `feat(cli): make cross-module file collisions a general error`, is open. `pnpm deps:verify` exited 0 at this commit on the conductor's run and was not re-run here. The second half of C13, the link from the pull request body to issue #91, cannot be checked yet because no pull request exists.

Not re-run, and why:

- `pnpm test`, `pnpm build` and `pnpm typecheck`. The conductor confirmed the gate green at commit `9e2d2e0`. Re-running produces the same answer at full cost.
- `pnpm deps:verify`. Green at this commit on the conductor's run. It rebuilds and reinstalls the playground, so it is the most expensive command in the set.
- `pnpm deps:check`. Red on the base branch too, at 22 findings on outdated template dependencies. It is a pre-existing condition, not a fault of this branch.

## Not covered / needs human judgment

- **Everything on real Cloudflare.** No agent ran `wrangler d1 create`, `wrangler d1 migrations apply`, `wrangler secret put`, `wrangler dev` or a deploy. Scenarios 1 and 2 cover this gap.
- **A real Hyperdrive binding.** Only the resolver's precedence was proved, with a fake binding object. TC-2.3 covers the rest.
- **`getDb` inside a Worker request.** The automated round trip ran under Node with the schema barrel stubbed. Whether `nodejs_compat` lets postgres.js run in workerd is untested. TC-2.1 covers it.
- **The schema barrel under real Vite.** `import.meta.glob` was stubbed in both harnesses. TC-2.4 covers it.
- **`auth` and `waitlist` on the Postgres driver.** Both still assume SQLite. `modules/auth/files/src/auth.ts:84` passes `provider: "sqlite"` and `modules/waitlist/files/db/schema/waitlist.ts:1` imports `drizzle-orm/sqlite-core`. Nobody has installed either module on `database-postgres`. Issue #85 does not claim to fix this. Issue #91 Phase 3 carries it.
- **Compatibility, accessibility and performance.** Skipped on purpose. This change ships module descriptors, template files and runbooks, with no user interface and no request path of its own.
- **Concurrency.** Partly covered. TC-2.1 step 4 sends twenty sequential requests, which is what catches the connection-lifecycle defect. Parallel load is out of scope for a manual pass.
