# QA Plan: `package-json-script`, `conflictsWith` and `chained-route`

_Generated 2026-08-28 · against `a76e250b` · covers issue #83: two new patch kinds, the `chained-route` inverse, the `conflictsWith` descriptor field, and the docs that describe them_

## Summary

- A descriptor can now upsert a `package.json` script, append a `.route(path, handler)` link to a TS entry file, and name modules it refuses to sit beside.
- Working means: `add` refuses a conflicting module in either install order, `remove` reverses a `chained-route` patch, and the docs describe both accurately.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-83-add-package-json-script-conflictswith`, at commit `a76e250b`.
- Worktree: `/Users/mukit/worktrees/saasaloy/issue-83-add-package-json-script-conflictswith`. Run every command from that directory.
- No server, no credentials, no feature flags. The CLI runs offline against a local registry directory.
- Node and pnpm 11 are on the path.

Confirm you are on the right commit:

```sh
git rev-parse --short=8 HEAD
```

- [ ] The command prints `a76e250b`

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: worktree only, no build | Schema descriptions describe the real behaviour | 🔴 Critical |
| TC-1.2 | 1: worktree only, no build | `create-module` guidance is accurate and decidable | 🟡 Normal |
| TC-1.3 | 1: worktree only, no build | Wiki reversal prose matches what `remove` does | 🔴 Critical |
| TC-2.1 | 2: playground with two conflicting modules | The refusal message tells the user what to do | 🔴 Critical |
| TC-2.2 | 2: playground with two conflicting modules | Patched and reverted files read like hand-written code | 🟡 Normal |
| TC-2.3 | 2: playground with two conflicting modules | The CLI stays quiet when there is nothing to warn about | 🟢 Low |
| TC-2.4 | 2: playground with two conflicting modules | A user's own route and import survive add and remove | 🔴 Critical |

## Scenario 1: worktree only, no build

**Setup.** Run once, for every case in this scenario. No build and no playground are needed. You read files.

- [ ] Setup complete

### TC-1.1: Schema descriptions describe the real behaviour · 🔴 Critical

**Goal.** A module author who reads only the schema learns the correct payload and the correct reversal rule.

**Steps**

1. Open `packages/cli/schemas/registry-item.schema.json`. Read the `conflictsWith` description, the `patches` description, the `kind` enum description, and both `allOf` branches.
   - [ ] Every description states the behaviour the code has, with no claim you cannot find in the source
     - `conflictsWith`: says either side may declare it, says the field is recorded into `saasaloy-lock.json`, says `add` uninstalls nothing
     - `kind` enum: lists all five kinds and says `chained-route` is the only kind `remove` reverses
     - `package-json-script` branch: requires `name` and `value`, and says an entry already present is never overwritten
     - `chained-route` branch: requires `exportName`, `path`, `call` and `import`, and names `path` as the match key
   - [ ] The prose reads as a person wrote it, with no puffery and no em dash used as sentence punctuation
2. Open `packages/cli/schemas/saasaloy-lock.schema.json`. Read the `conflictsWith` description on the module entry.
   - [ ] The description explains why the field is recorded, not just what it holds

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `create-module` guidance is accurate and decidable · 🟡 Normal

**Goal.** An author writing a new module can decide between the auto-glob route and the `chained-route` patch without reading the CLI source.

**Steps**

1. Open `.agents/skills/create-module/SKILL.md`. Read the `conflictsWith[]` row in the field table, the `conflictsWith` field note, and the `patches` kind table.
   - [ ] The five-kind table matches the schema enum, and each payload column names the same fields the schema requires
   - [ ] The "declare it on one side only" instruction is unambiguous and gives its reason
2. Read the paragraph in Step 3 that compares `api`'s auto-glob with the `chained-route` patch.
   - [ ] The paragraph gives a decidable rule, so you can pick one option for a concrete module without guessing
3. Read the two changed checklist items at the end of the file.
   - [ ] Each checklist item is checkable by looking at a descriptor, not by running the CLI

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Wiki reversal prose matches what `remove` does · 🔴 Critical

**Goal.** A user reading the wiki forms a correct expectation of what `remove` undoes and what it leaves behind.

**Steps**

1. Open `docs/wiki/reference.md`. Read the new `conflictsWith` paragraph under `saasaloy add`, and the "Known limitations" entry on patch reversal.
   - [ ] The `add` paragraph states the exit code, says `--force` does not bypass the refusal, and covers the unverifiable-lock case
   - [ ] The limitations entry says one kind of five is reversed, and names `chained-route`
2. Open `docs/wiki/how-to/remove-a-module.md` and `docs/wiki/architecture.md`. Read the changed "What stays behind" list and the changed asymmetry sentence.
   - [ ] All three documents say the same thing about reversal, using the same words for the same idea
   - [ ] The `email-cloudflare` example still matches the modules on disk under `modules/`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. No case above writes a file.

## Scenario 2: playground with two conflicting modules

No module under `modules/` declares `conflictsWith` or uses the two new patch kinds. You build a scratch registry to exercise them.

**Setup.** Run once, for every case in this scenario.

1. Build the CLI and create a fresh playground.

   ```sh
   pnpm build && pnpm play:reset
   ```

2. Copy the shipped registry into a scratch directory.

   ```sh
   mkdir -p .dev/registry && cp -R modules/. .dev/registry/
   ```

3. Create module `db-alpha`, which declares no conflict.

   ```sh
   mkdir -p .dev/registry/db-alpha && cat > .dev/registry/db-alpha/registry-item.json <<'JSON'
   { "name": "db-alpha", "type": "capability", "description": "Scratch driver A." }
   JSON
   ```

4. Create module `db-beta`, which conflicts with `db-alpha`, upserts a script, and appends a route link.

   ```sh
   mkdir -p .dev/registry/db-beta/files/routes && cat > .dev/registry/db-beta/registry-item.json <<'JSON'
   { "name": "db-beta", "type": "capability", "description": "Scratch driver B.",
     "conflictsWith": ["db-alpha"],
     "patches": [
       { "file": "apps/api/package.json", "kind": "package-json-script", "name": "db:migrate", "value": "wrangler d1 migrations apply" },
       { "file": "apps/api/src/index.ts", "kind": "chained-route", "exportName": "default", "path": "/waitlist", "call": "waitlist", "import": { "name": "waitlist", "from": "./routes/waitlist.js" } }
     ] }
   JSON
   ```

5. Give the playground an entry file with a literal `.route()` chain, because the shipped `api` module uses a glob instead.

   ```sh
   mkdir -p .dev/playground/apps/api/src/routes && printf 'import { Hono } from "hono";\nimport { health } from "./routes/health.js";\n\nconst app = new Hono();\n\nexport default app.route("/health", health);\n' > .dev/playground/apps/api/src/index.ts
   ```

6. Give the playground the `package.json` the script patch targets.

   ```sh
   printf '{\n  "name": "api",\n  "scripts": {\n    "build": "tsc"\n  }\n}\n' > .dev/playground/apps/api/package.json
   ```

7. Point the CLI at the scratch registry for the rest of the scenario.

   ```sh
   export SAASALOY_REGISTRY_DIR=$PWD/.dev/registry
   ```

- [ ] Setup complete

### TC-2.1: The refusal message tells the user what to do · 🔴 Critical

**Goal.** A user who hits a module conflict can read the message once and know which command clears it.

**Steps**

1. Install `db-alpha`, then try to add the module that conflicts with it.

   ```sh
   cd .dev/playground && node ../../packages/cli/dist/index.js add db-alpha --yes && node ../../packages/cli/dist/index.js add db-beta --yes; echo "EXIT=$?"
   ```

   - [ ] The second run prints `EXIT=1`, names both `db-beta` and `db-alpha`, and names the `saasaloy remove` command that clears the conflict
   - [ ] The message reads as one clear refusal, not as a stack trace or a wall of repeated lines
2. Try the same add with `--force`.

   ```sh
   node ../../packages/cli/dist/index.js add db-beta --yes --force; echo "EXIT=$?"
   ```

   - [ ] `--force` prints the same refusal and `EXIT=1`, so no user reads it as an override
3. Reset the playground, install the declarer first, then add the module it names.

   ```sh
   cd ../.. && pnpm play:reset && cd .dev/playground && node ../../packages/cli/dist/index.js add db-beta --yes && node ../../packages/cli/dist/index.js add db-alpha --yes; echo "EXIT=$?"
   ```

   - [ ] The reverse order refuses too, and the message says which module is already installed and which one it names
   - [ ] The message is direction-aware, so it does not read as if the roles were swapped

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: Patched and reverted files read like hand-written code · 🟡 Normal

**Goal.** A user opening a patched file sees an edit they would accept in review, and a clean file after `remove`.

**Steps**

1. Reset, then add the module that carries both patches. Read the two files it touched.

   ```sh
   cd ../.. && pnpm play:reset && cd .dev/playground && node ../../packages/cli/dist/index.js add db-beta --yes
   ```

   - [ ] `apps/api/package.json` gained `"db:migrate"` beside `"build"`, and the indent and the trailing newline match the rest of the file
   - [ ] `apps/api/src/index.ts` gained the `waitlist` import and the `.route("/waitlist", waitlist)` link after `/health`, and no line you did not expect moved
   - [ ] The inserted import matches the spacing style of the imports around it
2. Add the same module a second time.

   ```sh
   node ../../packages/cli/dist/index.js add db-beta --yes --force
   ```

   - [ ] The run reports the patches as unchanged, and neither file gains a duplicate entry
3. Remove the module and read the two files again.

   ```sh
   node ../../packages/cli/dist/index.js remove db-beta --yes; echo "EXIT=$?"
   ```

   - [ ] The entry file lost the `/waitlist` link and the `waitlist` import, and kept the `/health` link
   - [ ] The warning about the `package-json-script` patch names the file, says the patch is not reversed, and matches the wiki prose you read in TC-1.3
   - [ ] The entry file ends the same way it started, with its trailing newline intact

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The CLI stays quiet when there is nothing to warn about · 🟢 Low

**Goal.** The unverifiable-lock warning fires only for a module the tool installed, not for the template's own baseline.

**Steps**

1. Reset and run a plain add that has nothing to do with conflicts.

   ```sh
   cd ../.. && pnpm play:reset && cd .dev/playground && node ../../packages/cli/dist/index.js add db-alpha --yes
   ```

   - [ ] No warning about a missing lock entry for `web` appears
2. Delete the lock entry the tool just wrote, then add another module.

   ```sh
   node -e 'const f="saasaloy-lock.json",j=JSON.parse(require("fs").readFileSync(f,"utf8"));delete j.modules["db-alpha"];require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")' && node ../../packages/cli/dist/index.js add db-beta --yes; echo "EXIT=$?"
   ```

   - [ ] A warning now names `db-alpha` as unverifiable, and the run proceeds instead of failing
   - [ ] The remedy the warning offers is one the user can actually perform on `db-alpha`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: A user's own route and import survive add and remove · 🔴 Critical

**Goal.** The route path locates a patch; it does not prove ownership. Both directions skip and report rather than overwriting a line the user wrote.

**Steps**

1. Reset the scenario, then bind `waitlist` in the entry file to a module of your own before adding `db-beta`.

   ```sh
   cd ../.. && pnpm play:reset && mkdir -p .dev/playground/apps/api/src/routes && printf 'import { Hono } from "hono";\nimport { waitlist } from "./mine.js";\n\nconst app = new Hono();\n\nexport default app;\n' > .dev/playground/apps/api/src/index.ts && printf '{\n  "name": "api",\n  "scripts": {\n    "build": "tsc"\n  }\n}\n' > .dev/playground/apps/api/package.json && cd .dev/playground && node ../../packages/cli/dist/index.js add db-beta --yes; echo "EXIT=$?"
   ```

   - [ ] A warning names `apps/api/src/index.ts` and says the name is already imported from `./mine.js`
   - [ ] The warning says what to do next, and the file still imports from `./mine.js` with no `.route("/waitlist", …)` added
   - [ ] `.saasaloy/manifest.json` records no `chained-route` patch, so a later `remove` claims nothing here
2. Reset, install cleanly, then repoint the installed route at a handler of your own and remove the module.

   ```sh
   cd ../.. && pnpm play:reset && printf 'import { Hono } from "hono";\nimport { health } from "./routes/health.js";\n\nconst app = new Hono();\n\nexport default app.route("/health", health);\n' > .dev/playground/apps/api/src/index.ts && printf '{\n  "name": "api",\n  "scripts": {\n    "build": "tsc"\n  }\n}\n' > .dev/playground/apps/api/package.json && cd .dev/playground && node ../../packages/cli/dist/index.js add db-beta --yes && node -e 'const f="apps/api/src/index.ts",fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("\"/waitlist\", waitlist","\"/waitlist\", myWaitlist"))' && node ../../packages/cli/dist/index.js remove db-beta --yes; echo "EXIT=$?"
   ```

   - [ ] `remove` reports the patch left untouched and names the handler it found instead
   - [ ] The message reads as "this line is yours now", not as "there was nothing to revert"
   - [ ] `.route("/waitlist", myWaitlist)` is still in the file, and the module is gone from `saasaloy.json`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. This deletes the scratch registry and the playground.

```sh
cd /Users/mukit/worktrees/saasaloy/issue-83-add-package-json-script-conflictswith && pnpm play:destroy && rm -rf .dev
```

## Automated verification (by AI agent)

_Checks the agent ran itself at `a76e250b`. No action needed from the tester; listed here for context and sign-off._

These are the acceptance checks C1 to C11 from the run's check set, re-run against the final code after the three fix commits landed.

```sh
pnpm --filter saasaloy exec vitest run src/lib/patch/pkg-json-script.test.ts src/lib/applier.test.ts
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/patch/pkg-json-script.test.ts
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/applier.test.ts -t "registry-item schema"
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/conflicts.test.ts
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/patch/chained-route.test.ts
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/remover.test.ts -t "chained-route"
```

```sh
grep -rnE "saasaloy:(managed|anchor|begin|end)|BEGIN saasaloy|@saasaloy-anchor" packages/cli/src/lib/patch/ ; echo "exit=$?"
```

```sh
grep -c "package-json-script\|chained-route\|conflictsWith" packages/cli/schemas/registry-item.schema.json .agents/skills/create-module/SKILL.md docs/wiki/reference.md
```

```sh
pnpm --filter saasaloy exec vitest run
```

```sh
pnpm --filter saasaloy exec tsc --noEmit && pnpm run typecheck:scripts
```

```sh
file packages/cli/src/lib/conflicts.ts && git diff --numstat origin/main..HEAD -- packages/cli/src/lib/conflicts.ts
```

- ✅ C1 `package-json-script` upserts a script entry → 2 files, 60 tests passed
- ✅ C2 re-applying the same script patch is idempotent → 9 tests passed, including the byte-for-byte re-insert case
- ✅ C3 schema rejects a payload missing `name` or `value` → 21 passed, 30 skipped, in the `registry-item schema` block
- ✅ C4 a descriptor can name conflicting modules → 24 tests passed in `conflicts.test.ts`; `tsc --noEmit` exit 0
- ✅ C5 `add` refuses when a conflicting module is installed → unit-covered in `conflicts.test.ts`; the CLI-level run is TC-2.1, left for the tester
- ✅ C6 the check fires in both install orders → covered in the same 24 tests, with the stale-lock and missing-lock cases
- ✅ C7 `chained-route` inserts the import and the `.route()` link → 23 tests passed, including a `trailing newline` block
- ✅ C8 re-applying `chained-route` is idempotent → covered in the same 23 tests
- ✅ C9 `remove` deletes the link and the import → 5 passed, 37 skipped, in `remover.test.ts`
- ✅ C10 no anchor comments (ADR 0006) → grep returned `exit=1`, no matches
- ✅ C11 fixtures cover add, re-add and remove for all three capabilities → 13 files, 214 tests passed, uncached, up from 121 at base `e4a0ed6`
- ✅ Gate → `vitest run` 214 passed, `tsc --noEmit` exit 0, `typecheck:scripts` exit 0
- ✅ C12 string presence → schema 6 hits, `SKILL.md` 8 hits, `reference.md` 2 hits. The prose judgement is TC-1.1 to TC-1.3.
- ✅ `conflicts.ts` is now a text file, not binary → `file` reports UTF-8 text, and `git diff --numstat` reports `150 0` instead of a binary marker. This is a change since the earlier run, which recorded raw NUL bytes in `pairKey`.

Two counts moved since the earlier run: the suite grew from 207 to 214 tests, and `conflicts.test.ts` grew from 22 to 24. No check that passed before fails now.

## Not covered / needs human judgment

- **The shipped registry.** No module under `modules/` declares `conflictsWith` or uses either new patch kind, so every run exercises scratch modules the tester writes in Scenario 2's setup.
- **Remote registry path.** Every check ran with `SAASALOY_REGISTRY_DIR`, so `source: "local"`. A `conflictsWith` list read from a `owner/repo@ref` descriptor fetched by giget is untested.
- **`pnpm typecheck` inside the playground.** `pnpm play:init` scaffolds with `--no-install`, so the playground has no `node_modules`. A typecheck there fails on missing `hono`, not on the codemod. The unit test that compiles the reverted file is the standing evidence.
- **`--dry-run` and `--diff` previews** for the two new kinds. Issue #36 owns those; no acceptance criterion here covers them.
- **CRLF entry files and files with no trailing newline.** Only the LF-with-terminator case has a test.
- **Error output stream.** The refusal and the warnings go to stdout, not stderr, because `@clack/prompts` writes there. `saasaloy add X >/dev/null` hides the refusal while still returning exit 1. This predates issue #83; exit code 1 is the reliable signal for a script.
- **Concurrency, permission-denied targets, read-only files and symlinked patch targets.** No degraded-filesystem case was run.
- **Compatibility, accessibility and performance dimensions.** The change ships no UI and touches no hot path, so these do not apply.
