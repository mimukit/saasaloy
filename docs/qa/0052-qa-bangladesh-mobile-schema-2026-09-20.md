# QA Plan: Bangladeshi mobile number schema

_Generated 2026-09-20 · against `ba4c572` plus the working tree · covers `bangladeshMobile` in the `validators` module, its scaffold entry, and the `saasaloy-sms` cross-reference_

## Summary

- `@repo/validators/phone` exports `bangladeshMobile`, a Zod schema that accepts five written forms of a Bangladeshi mobile number and returns canonical E.164, `+8801XXXXXXXXX`.
- Working means a scaffolded project receives `src/phone.ts`, an api route validates a request body with it, and every value it returns passes the `khudebarta` provider's `/^\+880\d{10}$/` check.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-147-add-a-bangladesh-mobile-number-schema`, in this worktree.
- No credentials and no auth token. The feature is a pure input schema.
- No feature flags and no config.
- No database. The change touches no migration, no model, and no query, so this plan defines no `DB_CMD`.

Install the workspace once.

```sh
pnpm install
```

The plan uses the `.dev` playground for every `saasaloy` cli command, as `AGENTS.md` requires.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh playground, validators added | The scaffold delivers `src/phone.ts` | 🔴 Critical |
| TC-1.2 | 1: fresh playground, validators added | A route accepts the five forms and returns E.164 | 🔴 Critical |
| TC-1.3 | 1: fresh playground, validators added | A route rejects a bad number with one clear message | 🔴 Critical |
| TC-1.4 | 1: fresh playground, validators added | The playground still builds and lints | 🟡 Normal |
| TC-2.1 | 2: repo checkout, no playground | The two skills read as one pair, not as duplication | 🟢 Low |

## Scenario 1: fresh playground, validators added

**Setup.** Run once, for every case in this scenario.

1. Build the cli and create the playground.

```sh
pnpm run play:init
```

2. Add the `validators` capability to the playground.

```sh
cd .dev/playground && ./saasaloy add validators
```

3. Install the playground's dependencies.

```sh
pnpm -C .dev/playground install
```

- [ ] Setup complete

### TC-1.1: The scaffold delivers `src/phone.ts` · 🔴 Critical

**Goal.** A project that adds `validators` receives the schema file, and does not receive the repo-only test file.

**Steps**

1. List the scaffolded package.

   ```sh
   ls .dev/playground/packages/validators/src
   ```

   - [ ] The listing shows `common.ts` and `phone.ts`
   - [ ] The listing shows no `phone.test.ts`

2. Read the delivered file.

   ```sh
   cat .dev/playground/packages/validators/src/phone.ts
   ```

   - [ ] The file exports `bangladeshMobile` and `BangladeshMobile`
   - [ ] The header comment names `modules/sms-khudebarta/files/khudebarta.ts` and its `+880` regex

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A route accepts the five forms and returns E.164 · 🔴 Critical

**Goal.** A person's typed number reaches a handler already normalized, in the one form the sms provider accepts.

**Steps**

1. Create the route file `.dev/playground/apps/api/src/routes/mobile.ts` with this content.

   ```ts
   import { zValidator } from "@hono/zod-validator";
   import { errorBody } from "@repo/validators/common";
   import { bangladeshMobile } from "@repo/validators/phone";
   import { Hono } from "hono";
   import { z } from "zod";

   export const mobile = new Hono().post(
     "/",
     zValidator("json", z.object({ mobile: bangladeshMobile }), (result, c) => {
       if (!result.success) {
         const issue = result.error.issues[0];
         const message = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid request body";
         return c.json(errorBody("invalid_input", message), 400);
       }
     }),
     (c) => c.json({ mobile: c.req.valid("json").mobile }, 200),
   );
   ```

2. Mount the route in `.dev/playground/apps/api/src/index.ts`, next to the routes already mounted there.

3. Start the api.

   ```sh
   pnpm -C .dev/playground dev
   ```

   - [ ] The api starts and prints its local url

4. Set the base url in a second terminal. Use the port the api printed.

   ```sh
   export BASE_URL=http://localhost:8787
   ```

5. Send the national form.

   ```sh
   curl -i -X POST "$BASE_URL/mobile" -H 'Content-Type: application/json' -d '{"mobile":"01712345678"}'
   ```

   - [ ] The status is `200` and the body is `{"mobile":"+8801712345678"}`

6. Send the four other forms, one at a time.

   ```sh
   for n in "+8801712345678" "8801712345678" "1712345678" "008801712345678"; do curl -s -X POST "$BASE_URL/mobile" -H 'Content-Type: application/json' -d "{\"mobile\":\"$n\"}"; echo; done
   ```

   - [ ] All four replies read `{"mobile":"+8801712345678"}`

7. Send a number written with separators.

   ```sh
   curl -s -X POST "$BASE_URL/mobile" -H 'Content-Type: application/json' -d '{"mobile":"+880 (17) 1234-5678"}'
   ```

   - [ ] The reply reads `{"mobile":"+8801712345678"}`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A route rejects a bad number with one clear message · 🔴 Critical

**Goal.** Every rejection class returns `400` with the one documented message, and no near-miss input slips through.

**Steps**

1. Send a number with text wrapped around it.

   ```sh
   curl -i -X POST "$BASE_URL/mobile" -H 'Content-Type: application/json' -d '{"mobile":"hello01712345678world"}'
   ```

   - [ ] The status is `400`
   - [ ] The message reads `mobile: must be a Bangladeshi mobile number, for example +8801712345678`

2. Send the other rejection classes.

   ```sh
   for n in "0171234567" "0221234567" "01212345678" "+919712345678" "০১৭১২৩৪৫৬৭৮" "01712345678!!!" ""; do curl -s -o /dev/null -w "%{http_code} " -X POST "$BASE_URL/mobile" -H 'Content-Type: application/json' -d "{\"mobile\":\"$n\"}"; done; echo
   ```

   - [ ] All seven replies are `400`

3. Read the message a client would show a user.

   - [ ] The message names an example number and does not leak a regex or a stack trace

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The playground still builds and lints · 🟡 Normal

**Goal.** The new scaffolded file does not break a generated project's own gate.

**Steps**

1. Stop the dev server with `Ctrl+C`.

2. Build the playground.

   ```sh
   pnpm -C .dev/playground build
   ```

   - [ ] The build finishes with no error

3. Lint and typecheck the playground.

   ```sh
   pnpm -C .dev/playground lint && pnpm -C .dev/playground typecheck
   ```

   - [ ] Both passes finish with no error

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
pnpm run play:destroy
```

The playground holds no database and no seeded rows, so there is nothing else to clean.

## Scenario 2: repo checkout, no playground

**Setup.** No setup. Read the files in this worktree.

- [ ] Setup complete

### TC-2.1: The two skills read as one pair, not as duplication · 🟢 Low

**Goal.** A reader who meets both the schema and the sms provider understands why each one exists.

**Steps**

1. Read the new section in the validators skill.

   ```sh
   cat modules/validators/skills/saasaloy-validators/SKILL.md
   ```

   - [ ] The section lists the five accepted forms, the allowed separators, the ASCII-digits-only rule and the normalized output
   - [ ] The section says why the schema lives in `phone.ts` and not in `common.ts`
   - [ ] The closing paragraph names the `saasaloy-sms` skill and explains the two layers

2. Read the provider's back-comment.

   ```sh
   sed -n '38,50p' modules/sms-khudebarta/files/khudebarta.ts
   ```

   - [ ] The comment points at `modules/validators/files/src/phone.ts` and names ADR 0020 as the reason the two do not share a constant

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm install
```

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm verify:pins
```

```sh
node -e "const r=require('./modules/validators/registry-item.json');const fs=require('fs');for(const f of r.scaffolds[0].files){console.log(f.path, fs.existsSync('modules/validators/'+f.path)?'ok':'MISSING')}"
```

- ✅ `pnpm install` → `zod 4.5.4` resolved into the root `devDependencies`, so `pnpm test:modules` can import it.
- ✅ `pnpm test` → 571 module tests pass, 0 fail. This includes 40 new `phone.test.ts` cases: the five accepted forms, all seven operator digits, six separator forms, seventeen rejection classes, the failure message, and the assertion that every accepted output matches the provider's `/^\+880\d{10}$/`. The scripts suite also passes, 160 tests.
- ✅ `pnpm lint` → all four passes clean: oxlint type-aware, oxlint plain, Stylelint, and `prettier --check`.
- ✅ `pnpm typecheck` → `tsc --noEmit` clean.
- ✅ `pnpm verify:pins` → 2 pin rules still agree across their manifests.
- ✅ registry check → all four `scaffolds[0].files` paths resolve, including the new `files/src/phone.ts`. `phone.test.ts` is absent from the list, as designed.
- ⚠️ `pnpm deps:check` reports 69 outdated pins. This is pre-existing repo drift and no pin in this change is among them. `pnpm deps:update` clears it in a separate change.

## Not covered / needs human judgment

- **Compatibility and accessibility.** The change ships no UI. There is no screen, no keyboard path and no browser surface to judge.
- **Performance.** The schema is two regex tests on a short string. There is no realistic data volume to measure.
- **Concurrency and timing.** The schema is a pure function with no shared state.
- **Data and state.** The change touches no migration, no model and no query, so this plan runs no database check.
- **Security.** The schema is an input guard and reads no secret. A tester who wants one extra look can confirm a rejection reply carries no regex and no stack trace; TC-1.3 step 3 covers that.
- **Real number routing.** Nothing here proves a normalized number reaches a live handset. The `khudebarta` gateway owns that, and the QA plan for `sms-khudebarta` covers it.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
