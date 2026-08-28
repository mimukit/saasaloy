# QA Plan: api on Hono RPC with a typed route chain

_Generated 2026-08-28 · against `c3caaa9` · covers issue #86: the api module's typed route chain, `AppType`, the `chained-route` registration patch, the shared error envelope, and the waitlist form's typed client_

## Summary

- `apps/api` stops globbing `src/routes/*.ts`. Every route mounts as one `.route()` link in a single chained expression, so `typeof app` carries each path and its response shape. A module registers its route with a `chained-route` patch. `apps/web` calls the api through `hc<AppType>` instead of a raw `fetch`.
- "Working" means the waitlist form still submits from a real browser, the api answers every error with `{ error: { code, message } }`, and CORS still reaches the caller on both the success and the error path.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- **Branch under test:** `issue-86-rework-the-api-module-to-hono-rpc-with-a-typed`, at commit `c3caaa9`.
- **Machine:** a workstation with a graphical browser. This plan needs a real browser. The CI box has none, which is why these cases are here.
- **Toolchain:** Node 24.x, pnpm 11. Run every command from the repository root unless a step says otherwise.
- **URLs:** the api Worker serves `http://localhost:4000`. The web app serves `http://localhost:3000`. Both ports use `strictPort`, so a busy port fails loudly instead of shifting.
- **Env vars:** leave `PUBLIC_API_URL` and `CORS_ORIGINS` unset for Scenario 1. Later scenarios set them and say so.
- **Terms used in this plan:** *the playground* is `.dev/playground`. *The api Worker* is `apps/api`. *The web app* is `apps/web`. *The form* is the waitlist form on the web app's landing page. *The envelope* is the body `{ "error": { "code": ..., "message": ... } }`. *The chain* is the `.route()` expression in `apps/api/src/index.ts`.

Install the repository dependencies:

```sh
pnpm install
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: waitlist installed, dev servers up, no env override | The form submits and the confirmation replaces it | 🔴 Critical |
| TC-1.2 | 1: waitlist installed, dev servers up, no env override | The form shows its error paragraph when the api rejects the address | 🔴 Critical |
| TC-1.3 | 1: waitlist installed, dev servers up, no env override | A duplicate address still lands on the confirmation | 🟡 Normal |
| TC-2.1 | 2: web app built with `PUBLIC_API_URL` set | An explicit `PUBLIC_API_URL` reaches the built bundle | 🔴 Critical |
| TC-2.2 | 2: web app built with `PUBLIC_API_URL` set | A wrong `PUBLIC_API_URL` shows the error paragraph, not a false confirmation | 🟡 Normal |
| TC-3.1 | 3: api Worker started with `CORS_ORIGINS` set | A production-style allowlist admits the listed origin | 🔴 Critical |
| TC-3.2 | 3: api Worker started with `CORS_ORIGINS` set | A misconfigured allowlist fails visibly in the browser | 🟡 Normal |
| TC-4.1 | 4: auth installed on the playground | The auth D1 migration generates and applies | 🟡 Normal |
| TC-4.2 | 4: auth installed on the playground | Sign-up and session survive the pre-chain mount | 🔴 Critical |
| TC-5.1 | 5: api and waitlist installed, then api removed | `saasaloy remove api` under a dependent route module | 🟡 Normal |
| TC-6.1 | 6: the chain widened past 31 routes | A wide chain stays workable in the editor | 🟢 Low |

## Scenario 1: waitlist installed, dev servers up, no env override

**Setup.** Run once, for every case in this scenario.

1. Rebuild the CLI and scaffold a fresh playground. This deletes the current playground.

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

2. Install the waitlist module. It pulls `api`, `database` and `validators` through `dependsOn`.

```sh
cd .dev/playground && ./saasaloy add waitlist -y && cd -
```

3. Install the new workspace dependencies.

```sh
pnpm -C .dev/playground install
```

4. Generate and apply the D1 migration. `drizzle-kit generate` asks a question if it finds an ambiguous rename, so run it in a terminal with a TTY.

```sh
pnpm -C .dev/playground --filter @repo/db db:generate && pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

5. Start both dev servers. Leave them running for the whole scenario.

```sh
pnpm -C .dev/playground dev
```

- [ ] Setup complete: the api Worker answers on `:4000` and the web app answers on `:3000`

### TC-1.1: The form submits and the confirmation replaces it · 🔴 Critical

**Goal.** The form's typed `hc` client reaches the api Worker from a real browser and the success branch renders.

**Steps**

1. Open `http://localhost:3000` in the browser. Scroll to the waitlist section.
   - [ ] The form renders with an email input and a "Join the waitlist" button
2. Open the browser's developer tools. Select the Network tab and the Console tab.
   - [ ] The console shows no error on page load
3. Type `qa-first@example.com` in the input. Click "Join the waitlist".
   - [ ] The button label changes to "Joining…" and the input goes disabled while the request runs
   - [ ] The form disappears and the confirmation "You're on the list — we'll be in touch." takes its place
   - [ ] The Network tab shows one `POST` to `http://localhost:4000/waitlist` with status `201` and the response body `{"ok":true}`
   - [ ] The console shows no CORS error
4. Confirm the row reached the table.

```sh
pnpm -C .dev/playground/packages/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select email from waitlist"
```

   - [ ] The output lists `qa-first@example.com` exactly once

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The form shows its error paragraph when the api rejects the address · 🔴 Critical

**Goal.** A 400 from the api reaches the form's error branch and the user sees a message instead of a silent failure.

**Steps**

1. Reload `http://localhost:3000`. Scroll to the waitlist section.
   - [ ] The form renders again, empty
2. Type `nope` in the input. Click "Join the waitlist". The browser's own `type="email"` validation blocks this first.
   - [ ] The browser shows its native "please enter an email address" tooltip and sends no request
3. Bypass the native validation to reach the server path. Open the Console tab and run this snippet.

```js
document.querySelector('#waitlist-email').setAttribute('type', 'text')
```

4. Type `nope` in the input again. Click "Join the waitlist".
   - [ ] A red paragraph reads "Something went wrong — try again."
   - [ ] The form stays on screen with the input re-enabled
   - [ ] The Network tab shows the `POST` returning status `400` and the body `{"error":{"code":"invalid_input","message":"email: Invalid email address"}}`
   - [ ] The `400` response carries an `access-control-allow-origin: http://localhost:3000` header, so the browser does not report a CORS failure on the error path
5. Stop the api Worker with Ctrl-C in the terminal running `pnpm dev`. Reload the page and submit `qa-offline@example.com`.
   - [ ] The same red paragraph appears, and the page does not hang or crash
6. Restart the dev servers before the next case.

```sh
pnpm -C .dev/playground dev
```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A duplicate address still lands on the confirmation · 🟡 Normal

**Goal.** A repeat submission of a known address reads as a success in the browser and inserts no second row.

**Steps**

1. Reload `http://localhost:3000`. Submit `qa-first@example.com`, the address TC-1.1 already used.
   - [ ] The confirmation replaces the form, exactly as it did for the new address
   - [ ] The Network tab shows status `201`, not `409` and not `400`
2. Count the rows.

```sh
pnpm -C .dev/playground/packages/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select email, count(*) as n from waitlist group by email"
```

   - [ ] `qa-first@example.com` still has `n` of 1
3. Reload the page. Submit `QA-First@example.com ` with the capitals and the trailing space.
   - [ ] The confirmation appears again
   - [ ] The row count for `qa-first@example.com` is still 1, because the shared `email` validator trims and lowercases

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2. Stop the dev servers with Ctrl-C first.

```sh
pnpm -C .dev/playground/packages/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "delete from waitlist"
```

## Scenario 2: web app built with `PUBLIC_API_URL` set

Scenario 1's playground stays in place. Only the web app's build input changes. Nobody has confirmed that an explicitly set `PUBLIC_API_URL` takes effect; the automated run only covered the unset fallback.

**Setup.** Run once, for every case in this scenario.

1. Start the api Worker alone, on its normal port.

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

2. In a second terminal, build the web app with an explicit `PUBLIC_API_URL` that points at a second address for the same Worker.

```sh
PUBLIC_API_URL=http://127.0.0.1:4000 pnpm -C .dev/playground --filter @repo/web build
```

3. Serve the built output.

```sh
pnpm -C .dev/playground --filter @repo/web preview
```

- [ ] Setup complete: the built site answers and the api Worker answers on `:4000`

### TC-2.1: An explicit `PUBLIC_API_URL` reaches the built bundle · 🔴 Critical

**Goal.** A set `PUBLIC_API_URL` replaces the `http://localhost:4000` fallback in the shipped bundle and the form posts to it.

**Steps**

1. Search the built bundle for both addresses.

```sh
grep -rlo "http://127.0.0.1:4000" .dev/playground/apps/web/dist/_astro/
```

   - [ ] The command names a `WaitlistForm.<hash>.js` file, so the set value is baked in

```sh
grep -rlo "http://localhost:4000" .dev/playground/apps/web/dist/_astro/
```

   - [ ] The command prints nothing, so the fallback did not survive the build
2. Open the preview URL the previous command printed. Scroll to the waitlist section. Submit `qa-envset@example.com`.
   - [ ] The confirmation replaces the form
   - [ ] The Network tab shows the `POST` going to `http://127.0.0.1:4000/waitlist`, not to `localhost`
   - [ ] The response status is `201`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A wrong `PUBLIC_API_URL` shows the error paragraph, not a false confirmation · 🟡 Normal

**Goal.** A misconfigured api address fails in a way the user can see.

**Steps**

1. Stop the preview server. Rebuild the web app against a port nothing listens on.

```sh
PUBLIC_API_URL=http://127.0.0.1:4999 pnpm -C .dev/playground --filter @repo/web build
```

2. Serve the rebuilt output again.

```sh
pnpm -C .dev/playground --filter @repo/web preview
```

3. Open the preview URL. Submit `qa-badurl@example.com`.
   - [ ] The red paragraph "Something went wrong — try again." appears
   - [ ] The confirmation does not appear
   - [ ] The console shows a failed request to `:4999`, and the page stays usable

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the preview server and the api Worker with Ctrl-C. Rebuild the web app with no override before Scenario 3.

```sh
pnpm -C .dev/playground --filter @repo/web build
```

## Scenario 3: api Worker started with `CORS_ORIGINS` set

The comment at `modules/api/files/src/index.ts:14-20` claims a misconfigured production `CORS_ORIGINS` "fails visibly". Nobody has set the variable. The automated run only exercised the `DEV_ORIGINS` fallback.

**Setup.** Run once, for every case in this scenario.

1. Set the allowlist to the web app's dev origin only, then start the api Worker.

```sh
CORS_ORIGINS=http://localhost:3000 pnpm -C .dev/playground --filter @repo/api dev
```

2. In a second terminal, start the web app's dev server.

```sh
pnpm -C .dev/playground --filter @repo/web dev
```

- [ ] Setup complete: both servers answer, and the api Worker log shows no startup error

### TC-3.1: A production-style allowlist admits the listed origin · 🔴 Critical

**Goal.** An explicit `CORS_ORIGINS` value behaves the same as the dev fallback for a listed origin, and blocks an unlisted one in the browser.

**Steps**

1. Confirm the allowlist from the terminal first, for both a listed and an unlisted origin.

```sh
curl -s -D- -o /dev/null -H 'Origin: http://localhost:3000' http://localhost:4000/health
```

   - [ ] The headers include `access-control-allow-origin: http://localhost:3000` and `access-control-allow-credentials: true`

```sh
curl -s -D- -o /dev/null -H 'Origin: http://localhost:3001' http://localhost:4000/health
```

   - [ ] No `access-control-allow-origin` header appears, because `:3001` is no longer allowed once `CORS_ORIGINS` is set
2. Open `http://localhost:3000` in the browser. Submit `qa-cors@example.com`.
   - [ ] The confirmation replaces the form and the console shows no CORS error
3. Reach the same page over the loopback IP, which is a different origin and is not on the list. Open `http://127.0.0.1:3000` in the browser and submit `qa-cors2@example.com`.
   - [ ] The red error paragraph appears
   - [ ] The console reports a CORS failure naming the missing `Access-Control-Allow-Origin` header
   - [ ] The failure is legible enough to diagnose without reading the api source

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: A misconfigured allowlist fails visibly in the browser · 🟡 Normal

**Goal.** A `CORS_ORIGINS` value that omits the real front-end origin blocks the form rather than falling back silently to the dev list.

**Steps**

1. Stop the api Worker. Restart it with an allowlist that names a wrong origin.

```sh
CORS_ORIGINS=https://example.invalid pnpm -C .dev/playground --filter @repo/api dev
```

2. Reload `http://localhost:3000`. Submit `qa-misconfig@example.com`.
   - [ ] The red error paragraph appears
   - [ ] The console reports a CORS failure, so the misconfiguration is visible and not silent
   - [ ] The confirmation does not appear, which proves the dev fallback did not take over
3. Check the error path carries the same treatment.

```sh
curl -s -D- -o /dev/null -H 'Origin: http://localhost:3000' -X POST http://localhost:4000/waitlist -H 'content-type: application/json' -d '{"email":"nope"}'
```

   - [ ] The status is `400` and no `access-control-allow-origin` header appears, consistent with the blocked origin

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop both servers with Ctrl-C. Unset the variable in the shell before Scenario 4.

```sh
unset CORS_ORIGINS
```

## Scenario 4: auth installed on the playground

The auth handler now mounts on `base`, before the typed chain. The automated run reached `GET /auth/ok` only, because `drizzle-kit generate` refused to answer a rename question without a TTY. No sign-up or session flow has run against auth's tables.

**Setup.** Run once, for every case in this scenario.

1. Start from a clean playground so drizzle-kit sees no ambiguous rename.

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

2. Install auth and the waitlist module together.

```sh
cd .dev/playground && ./saasaloy add auth -y && ./saasaloy add waitlist -y && cd -
```

3. Install the new workspace dependencies.

```sh
pnpm -C .dev/playground install
```

- [ ] Setup complete: `apps/api/src/index.ts` shows `.route("/auth", authRoute)` inside `base`'s initializer, above `const app = base.route("/health", health);`

### TC-4.1: The auth D1 migration generates and applies · 🟡 Normal

**Goal.** Auth's tables reach local D1 through the documented two-step migration, with a TTY present to answer any rename question.

**Steps**

1. Generate the SQL. Answer any drizzle-kit prompt that appears. Note the question and your answer in **Notes**.

```sh
pnpm -C .dev/playground --filter @repo/db db:generate
```

   - [ ] The command exits without an error, and any prompt it asked was answerable
   - [ ] A new SQL file appears under `packages/db/drizzle/`
2. Apply the migration.

```sh
pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

   - [ ] The command reports the migration applied
3. List the tables.

```sh
pnpm -C .dev/playground/packages/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select name from sqlite_master where type='table'"
```

   - [ ] The output lists auth's tables and the `waitlist` table together

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped; the drizzle-kit prompt and your answer_

### TC-4.2: Sign-up and session survive the pre-chain mount · 🔴 Critical

**Goal.** Auth's catch-all handler still serves a full sign-up and session flow from the pre-chain mount, and the typed chain still serves alongside it.

**Steps**

1. Start the api Worker.

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

2. Create an account through auth's own endpoint.

```sh
curl -s -i -X POST http://localhost:4000/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"qa-user@example.com","password":"qa-password-123","name":"QA User"}'
```

   - [ ] The status is a success code and the response sets a session cookie
   - [ ] The body carries the created user, not an error
3. Read the session back with the cookie the previous step returned. Replace `<cookie>` with the `set-cookie` value.

```sh
curl -s -i http://localhost:4000/auth/get-session -H 'Cookie: <cookie>'
```

   - [ ] The status is `200` and the body names `qa-user@example.com`
4. Sign in again with a wrong password.

```sh
curl -s -i -X POST http://localhost:4000/auth/sign-in/email -H 'content-type: application/json' -d '{"email":"qa-user@example.com","password":"wrong-password"}'
```

   - [ ] The status is a 4xx and the body says the credentials are wrong
   - [ ] The body does not leak a stack trace, a binding value, or a SQL fragment
5. Confirm the typed chain still answers under the same Worker.

```sh
curl -s -i http://localhost:4000/health
```

   - [ ] The status is `200` and the body is `{"status":"ok"}`
6. Confirm an unmapped throw still returns the envelope. Query a path the chain does not carry.

```sh
curl -s -w '\nHTTP=%{http_code}\n' http://localhost:4000/nope
```

   - [ ] The status is `404`, and the api Worker's log shows no unhandled crash

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the api Worker with Ctrl-C before Scenario 5.

## Scenario 5: api and waitlist installed, then api removed

`saasaloy remove api` while a route module still holds a link on the chain has never run. `apps/api/src/index.ts` is now a file the CLI writes, so this removal touches more than it used to.

**Setup.** Run once, for the case in this scenario.

1. Start from a clean playground with waitlist installed.

```sh
pnpm play:reset && pnpm -C .dev/playground install && cd .dev/playground && ./saasaloy add waitlist -y && cd -
```

2. Keep a copy of the chain file for comparison.

```sh
cp .dev/playground/apps/api/src/index.ts /tmp/index.with-waitlist.ts
```

- [ ] Setup complete: `apps/api/src/index.ts` holds `.route("/waitlist", waitlist)` on the chain

### TC-5.1: `saasaloy remove api` under a dependent route module · 🟡 Normal

**Goal.** Removing the api capability while waitlist still depends on it either refuses with a clear reason, or leaves a state a developer can recover from without guessing.

**Steps**

1. Try to remove the api capability.

```sh
cd .dev/playground && ./saasaloy remove api -y; echo "exit=$?"; cd -
```

   - [ ] The CLI either refuses and names waitlist as the dependent, or removes api and warns about the dependent
   - [ ] The message is specific enough to act on, and it does not blame the wrong file
   - [ ] The exit code matches the outcome the message describes
2. Read what is left of the chain file.

```sh
diff /tmp/index.with-waitlist.ts .dev/playground/apps/api/src/index.ts; echo "exit=$?"
```

   - [ ] The diff matches what the CLI said it did, with no half-applied edit
3. Typecheck the generated project.

```sh
pnpm -C .dev/playground typecheck; echo "exit=$?"
```

   - [ ] Either the typecheck passes, or its errors point at the removal and read as a consequence a developer expected
4. Judge the outcome as a user would.
   - [ ] A developer who ran this by mistake can tell from the terminal what happened and what to do next

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped; record the exact CLI output here, because this behaviour is undocumented_

**Reset.** Restore the playground before Scenario 6.

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

## Scenario 6: the chain widened past 31 routes

The skill records a measurement at 1 route and at 31 routes. Nobody has looked past 31, and nobody has judged how a wide chain feels in an editor.

**Setup.** Run once, for the case in this scenario.

1. Install the api capability alone.

```sh
cd .dev/playground && ./saasaloy add api -y && cd - && pnpm -C .dev/playground install
```

2. Generate 64 synthetic route files and chain each one onto `const app`, following the procedure the api skill records under "What a wide chain costs to typecheck". Copy `apps/api/src/index.ts` first so you can restore it.

- [ ] Setup complete: `apps/api/src/index.ts` carries 65 `.route()` links in one expression

### TC-6.1: A wide chain stays workable in the editor · 🟢 Low

**Goal.** A chain past the measured 31 routes stays usable for a developer, not only for `tsc`.

**Steps**

1. Time the workspace typecheck three times and note the numbers.

```sh
cd .dev/playground/apps/api && time ../../node_modules/.bin/tsc --noEmit; cd -
```

   - [ ] The time is roughly linear against the recorded 1.02 s at 31 routes, near 14 ms per route
2. Open `apps/api/src/index.ts` in your editor. Wait for the language server to finish indexing.
   - [ ] Hover over `app` and read the inferred type. The tooltip appears within a few seconds
3. Open a consumer file that calls `hc<AppType>`. Type `api.` and wait for the completion list.
   - [ ] The completion list appears without a stall long enough to interrupt typing
   - [ ] The list names the synthetic routes
4. Introduce a typo in one route path on the chain. Save the file.
   - [ ] The editor reports the error at the call site, and the message names the missing property

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped; record the measured times and the route count_

**Reset.** Destroy the playground when the run is finished.

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

All 16 acceptance checks for issue #86 pass. The QA step re-ran the 11 static checks against the final code, after the fix round moved lines. The runtime halves and the repository gates are transcribed from the runs that produced them; the QA step did not re-run them, because re-running a green gate costs the same and returns the same answer, and the runtime halves need a torn-down playground rebuilt.

### Re-run by the QA step against `c3caaa9`

```sh
grep -n "import.meta.glob\|Object.entries(routes)\|for (" modules/api/files/src/index.ts
```

- ✅ C1 → no output, exit 1. No glob and no mount loop survive. The companion grep shows `export type Bindings` at line 10, one `cors(` at line 70, the chain `const app = base.route("/health", health);` at line 105, and `export type AppType = typeof app;` at line 109.

```sh
grep -n "c.json({ status: \"ok\" }, 200)" modules/api/files/src/routes/health.ts
```

- ✅ C2 → `17:export const health = new Hono().get("/", (c) => c.json({ status: "ok" }, 200));`. One chained expression, explicit `200`, named export.

```sh
node -e 'const p=require("./modules/api/files/package.json");console.log(JSON.stringify(p.exports))' && grep -n "client.ts" modules/api/registry-item.json
```

- ✅ C3 → `{"./client":{"types":"./src/client.ts"}}` and `files/src/client.ts` listed in the api scaffold. `types` is the only condition, so no runtime entry resolves.

```sh
sed -n '145,170p' modules/api/skills/saasaloy-api/SKILL.md
```

- ✅ C4 → the skill records the measurement dated 2026-08-28, Node 24.19.0, TypeScript 7.0.2, 30 synthetic routes alongside `health`. Its table gives 0.59 s at 1 route and 1.02 s at 31 for `apps/api` alone, 6.6 s and 7.2 s for the whole project, and roughly 14 ms per route. VERIFY reproduced the `apps/api` figures at 609/576/627 ms and 1097/996/965 ms.

```sh
grep -n "zValidator(\|errorBody\|, 400)\|, 201)" modules/waitlist/files/api/routes/waitlist.ts
```

- ✅ C6 → `errorBody` imported from `@repo/validators/common` at line 4, the `zValidator` failure hook at line 27, `c.json(errorBody("invalid_input", message), 400)` at line 31, `c.json({ ok: true }, 201)` at line 45.

```sh
grep -rn "onConflictDoNothing" modules/waitlist/files/api/routes/waitlist.ts && grep -rn "409" modules/waitlist/
```

- ✅ C7 → `.onConflictDoNothing()` at line 41. The `409` grep returns two hits, `waitlist.ts:39` and `saasaloy-waitlist/SKILL.md:121`, both prose arguing against a 409. No 409 ships.

```sh
node -e 'const d=require("./modules/waitlist/registry-item.json");console.log(d.dependsOn.join(","));console.log(d.files.map(f=>f.target).join(","))'
```

- ✅ C8 → `dependsOn` is `api,database,validators`; `files[]` includes `@validators/waitlist.ts`. The route imports `waitlistInput` from `@repo/validators/waitlist` and defines no local `z.object`.

```sh
grep -n "fetch(\|hono/client\|hc<\|PUBLIC_API_URL" modules/waitlist/files/web/components/WaitlistForm.tsx
```

- ✅ C9 → `hc` imported at line 1, `API_BASE` from `import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000"` at line 15, `hc<AppType>(API_BASE)` at line 21. No `fetch(` in the file. The descriptor's patches add `hono` at `4.12.33` and `@repo/api` at `workspace:*` to `apps/web/package.json`.

```sh
node -e 'const d=require("./modules/auth/registry-item.json");console.log(JSON.stringify(d.patches.filter(p=>p.kind==="chained-route")))'
```

- ✅ C12 → one `chained-route` patch with `exportName: "base"`, path `/auth`, call `authRoute`. It targets the pre-chain binding, so `/auth` never enters `AppType`.

```sh
ls docs/adr/ | tail -2
```

- ✅ C13 → `adr-0023-routes-register-by-chained-route-patch-2026-08-28.md` exists, next to ADR 0022. Its headings match ADR 0022's, it is marked `accepted — amends ADR 0005`, and it names four rejected alternatives.

```sh
grep -rn "auto-glob\|routes/\*.ts\|file-based route" .agents/skills/ packages/cli/templates/base/AGENTS.md && diff -r .agents/skills .claude/skills
```

- ✅ C14 → one hit remains, `.agents/skills/create-module/SKILL.md:224`, and it is the historical clause of the rewrite ("used to glob `routes/*.ts` … it no longer does"). `diff -r` prints nothing, so `.claude/skills` mirrors `.agents/skills`.

### Transcribed from the runs that produced them

```sh
pnpm exec turbo run test --force
```

- ✅ C15 → 13 test files, 237 of 237 tests passed, no skips. Run by VERIFY on this head and re-run by the fix-round review after the four fix commits.

```sh
pnpm exec turbo run typecheck --force
```

- ✅ C15 → exit 0, cache bypassed.

```sh
pnpm deps:verify
```

- ✅ C16 → exit 0. It re-inited `.dev/playground`, installed, built, ran `verify-css.ts`, and typechecked the generated project. `verify-css` found its sentinel in `_astro/Layout.D9G4LxrZ.css`.

```sh
curl -s -i http://localhost:4000/health
```

- ✅ C5 runtime half → `HTTP/1.1 200 OK`, body `{"status":"ok"}`. The type half typechecked `hc<AppType>(base).health.$get()` at exit 0, and a `.helth` typo failed with `TS2551` naming the inferred type `ClientRequest<string, "/health", … status: 200>`.

```sh
curl -s -i -X POST localhost:4000/waitlist -H 'content-type: application/json' -d '{"email":"nope"}'
```

- ✅ C6 runtime half → `400` with `{"error":{"code":"invalid_input","message":"email: Invalid email address"}}`. A valid address returned `201 {"ok":true}`, and a duplicate returned `201` again with one row in the table (C7).

```sh
curl -s -i -X POST localhost:4000/waitlist -H 'content-type: application/json' -d '{"email":'
```

- ✅ B1 fix, confirmed live by the fix-round review → `400` with `{"error":{"code":"invalid_input","message":"Malformed JSON in request body"}}`. Before the fix this path answered with the plain-text string. Both 400 sources now ship one shape.

```sh
curl -s -i http://localhost:4000/auth/ok
```

- ✅ C12 runtime half → `200 {"ok":true}` from Better Auth's own handler. A scratch file referencing `api.auth` failed with `TS2339`; deleting that one line returned exit 0, so `/auth` serves but stays out of `AppType`.

```sh
cd .dev/playground && cp apps/api/src/index.ts /tmp/index.before.ts && ./saasaloy add waitlist -y && ./saasaloy remove waitlist -y && diff /tmp/index.before.ts apps/api/src/index.ts
```

- ✅ C10 → `diff` printed nothing. The add wrote one import line and one `.route("/waitlist", waitlist)` link; the remove took both back out. `pnpm typecheck` exit 0. `remove` warned about the two `package-json-dependency` patches it does not reverse, which is the known #36 behaviour.

```sh
grep -n "file-drop\|glob\|src/index.ts\|chained-route" modules/waitlist/skills/saasaloy-waitlist/SKILL.md
```

- ✅ C11 → no `routes/*.ts` glob claim and no "pure file-drop" bullet survive. The two remaining `glob` mentions are the db schema and the astro sections, which still are globs.

### Known non-blocking state

```sh
pnpm deps:check
```

- ❌ exit 1, "22 pending". This is pre-existing, not a regression. The gate was already exit 1 with 21 pending before the branch. The 22nd row is the `hono` patch pin at `4.12.33`, which was already stale against `4.13.4` and is now visible because the branch taught the scanner to read descriptor patch ranges. `pnpm deps:update` reports the row but does not rewrite it; the hand edit and its rationale are documented in CONTRIBUTING.md and tracked in issue #93. Do not treat this as a QA failure.

## Not covered / needs human judgment

- **`update` and the manifest-hash three-way merge on `src/index.ts`.** ADR 0023 names this as the cost of the change. There is no `update` command to drive yet. Issue #48 owns it.
- **An `HTTPException` that carries a custom `Response`.** The `onError` handler discards `err.res`, so a `WWW-Authenticate` header set that way would be lost. Nothing in a generated project constructs such an exception today, so there is no way to exercise it without writing code that does not ship.
- **The `deps:update` interactive picker.** Only `--check` has run. The picker path was read, not driven. It is outside this issue's diff.
- **The chained-route codemod against a hand-broken chain.** A hand edit to `const app = base; app.route(...)` makes `saasaloy add` silently drop the earlier route from `AppType`. This is a known finding against issue #83's codemod, filed as a follow-up, not a defect in this branch. It is left out because the plan tests the shipped path, not a hand-broken one.
- **CLI failure messages on stdout.** `saasaloy add doesnotexist` exits 1 with its message on stdout and an empty stderr. Pre-existing, outside this diff, filed as a follow-up.
- **Concurrency.** Two simultaneous submissions of the same address were not designed into a case. `.onConflictDoNothing()` on the unique column settles the race at the database, and the form disables its own button while a request runs, so the surface is thin.
- **Performance under load.** No load test. The api Worker's throughput did not change in this issue; only the route registration mechanism did.
- **Browser and device coverage.** The plan names one browser. `hc` targets `fetch`, which every target browser carries, and the form's markup did not change in this issue. Run TC-1.1 in a second browser if the release calls for it.
