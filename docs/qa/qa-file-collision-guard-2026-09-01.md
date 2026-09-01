# QA Plan: cross-module file collision guard

_Generated 2026-09-01 · against `60579e5` · covers issue #91, phases 1 to 3_

## Summary

- The CLI refuses an `add` run when two unrelated modules write the same file, and when a module claims a file another installed module owns.
- Working means the refusal exits 2 with a message that names both modules, every contested path, and the way through, and `waitlist` and `auth` now pick a database driver through the capability prompt.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-91-make-cross-module-file-collisions-a-general-error`, commit `60579e5`.
- Run every command from the repo root unless a step says otherwise.
- `.dev` is the directory for running the `saasaloy` CLI. `pnpm play:init` scaffolds `.dev/playground` and drops the `./saasaloy` shim.
- `--no-install` is not an `add` flag. Pass `-y` alone. Adding `--no-install` makes the command fail on an unknown flag.
- The `./saasaloy` shim hardcodes `SAASALOY_REGISTRY_DIR`. To point the CLI at another registry, call `node ../../packages/cli/dist/index.js` directly and set the variable on the command line.
- No case needs `pnpm install` inside the playground, except TC-3.1, which states it.

Build the CLI and scaffold the playground:

```sh
pnpm play:init
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh playground, no modules installed | The `requiresOneOf` picker appears and installs the picked driver | 🔴 Critical |
| TC-1.2 | 1: fresh playground, no modules installed | The picker copy reads clearly and both drivers are selectable | 🟢 Low |
| TC-2.1 | 2: registry copy with `conflictsWith` stripped | The ownership refusal fires and `--force` does not cross it | 🔴 Critical |
| TC-3.1 | 3: installed playground with dependencies | `pnpm typecheck` fails loudly on the Postgres dialect gap | 🟡 Normal |
| TC-4.1 | 4: playground on an older module version | `saasaloy update` reaches the same guard | 🟡 Normal |
| TC-5.1 | 5: registry copy with two skill-link claimants | Two modules contesting one skill path are refused | 🟢 Low |

## Scenario 1: fresh playground, no modules installed

**Setup.** Run once, for every case in this scenario. Run these steps in a real terminal, because the picker needs a TTY.

```sh
pnpm play:reset
```

- [ ] Setup complete

### TC-1.1: The `requiresOneOf` picker appears and installs the picked driver · 🔴 Critical

**Goal.** `add waitlist` in a terminal prompts for a database driver and installs the driver you pick.

**Steps**

1. Change into the playground.

   ```sh
   cd .dev/playground
   ```

2. Start the interactive add. Pass no `-y`, and do not redirect stdin.

   ```sh
   ./saasaloy add waitlist
   ```

   - [ ] The CLI shows a driver prompt that lists both `database-d1` and `database-postgres`
   - [ ] The prompt names the `database` capability and says why it needs a driver

3. Select `database-postgres`. Confirm the prompt.

   - [ ] The command exits 0 and reports the applied modules
   - [ ] The report names `database-postgres` and does not name `database-d1`

4. Read the installed list.

   ```sh
   node -e "console.log(require('./saasaloy.json').installed)"
   ```

   - [ ] The list holds `database-postgres` and `waitlist`
   - [ ] The list does not hold `database-d1`

5. Read the file owner of the database client.

   ```sh
   node -e "console.log(require('./.saasaloy/manifest.json').managed['packages/db/src/client.ts'])"
   ```

   - [ ] The entry reads `"module": "database-postgres"`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The picker copy reads clearly and both drivers are selectable · 🟢 Low

**Goal.** A first-time user understands the driver choice without reading the docs.

**Steps**

1. Reset the playground, then start the same interactive add.

   ```sh
   pnpm play:reset && cd .dev/playground && ./saasaloy add waitlist
   ```

   - [ ] The prompt text reads clearly and states that one driver is required
     - the capability name `database` is visible
     - both driver names are visible on their own lines
     - the arrow keys move the selection, and the highlighted entry is easy to see

2. Move the selection to `database-d1`. Confirm the prompt.

   - [ ] The command exits 0 and installs `database-d1`, not `database-postgres`

3. Cancel a fresh run with `Ctrl+C` at the prompt.

   ```sh
   pnpm play:reset && cd .dev/playground && ./saasaloy add waitlist
   ```

   - [ ] The CLI stops with a cancel message and writes no module files

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
pnpm play:reset
```

## Scenario 2: registry copy with `conflictsWith` stripped

**Setup.** Run once, for every case in this scenario.

The shipped `database-d1` and `database-postgres` declare `conflictsWith` each other. That check runs **before** the new ownership guard, so the shipped pair never reaches the phase 2 refusal. To see the new guard, use a registry copy with `conflictsWith` removed from both drivers. A future pair that shares a target and declares no `conflictsWith` reaches the guard directly.

1. Copy the registry to `/tmp/reg91`.

   ```sh
   rm -rf /tmp/reg91 && mkdir -p /tmp/reg91 && cp -R modules /tmp/reg91/modules
   ```

2. Delete the `conflictsWith` key from both driver descriptors.

   ```sh
   node -e "for (const m of ['database-d1','database-postgres']) { const p='/tmp/reg91/modules/'+m+'/registry-item.json'; const j=JSON.parse(require('fs').readFileSync(p,'utf8')); delete j.conflictsWith; require('fs').writeFileSync(p, JSON.stringify(j,null,2)+'\n'); }"
   ```

3. Reset the playground.

   ```sh
   pnpm play:reset
   ```

- [ ] Setup complete

### TC-2.1: The ownership refusal fires and `--force` does not cross it · 🔴 Critical

**Goal.** A module that claims a file another installed module owns is refused, and `--force` does not override the refusal.

**Steps**

1. Install the first driver against the stripped registry.

   ```sh
   cd .dev/playground && SAASALOY_REGISTRY_DIR=/tmp/reg91 node ../../packages/cli/dist/index.js add database-d1 -y
   ```

   - [ ] The command exits 0 and reports the applied modules

2. Record the bytes of one contested file, so a later step can compare them.

   ```sh
   shasum packages/db/src/client.ts
   ```

   - [ ] The command prints a hash

3. Add the second driver with `--force`.

   ```sh
   SAASALOY_REGISTRY_DIR=/tmp/reg91 node ../../packages/cli/dist/index.js add database-postgres --force -y; echo "exit=$?"
   ```

   - [ ] The command prints `exit=2`
   - [ ] The message reads clearly and gives the tester a next action
     - the headline names `database-postgres` and says the files are owned by another module
     - each line names `database-d1` as the owner and one contested path
     - `packages/db/src/client.ts`, `packages/db/drizzle.config.ts` and `packages/db/tsconfig.json` all appear
     - the message states that `--force` does not cross module file ownership
     - the message names `saasaloy remove database-d1` as the way through

4. Confirm nothing was written.

   ```sh
   shasum packages/db/src/client.ts
   ```

   - [ ] The hash matches step 2

5. Follow the message. Remove the first driver, then add the second.

   ```sh
   ./saasaloy remove database-d1 -y && ./saasaloy add database-postgres -y
   ```

   - [ ] Both commands exit 0
   - [ ] The remove step reports the removed file count

6. Read the file owner.

   ```sh
   node -e "console.log(require('./.saasaloy/manifest.json').managed['packages/db/src/client.ts'])"
   ```

   - [ ] The entry reads `"module": "database-postgres"`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
rm -rf /tmp/reg91 && pnpm play:reset
```

## Scenario 3: installed playground with dependencies

**Setup.** Run once, for every case in this scenario. This scenario installs node modules, so it takes several minutes.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres -y && ./saasaloy add waitlist -y && pnpm install
```

- [ ] Setup complete

### TC-3.1: `pnpm typecheck` fails loudly on the Postgres dialect gap · 🟡 Normal

**Goal.** The Postgres plus `waitlist` combination installs cleanly, then fails at typecheck instead of silently overriding the driver choice.

This failure is an accepted consequence of phase 3, not a defect to report. The `waitlist` and `auth` schemas import `drizzle-orm/sqlite-core`, so they do not compile against the Postgres driver. Issue #99 owns the fix. The point of this case is that the mismatch is loud.

**Steps**

1. Confirm the installed set.

   ```sh
   node -e "console.log(require('./saasaloy.json').installed)"
   ```

   - [ ] The list holds `database-postgres` and `waitlist`, and not `database-d1`

2. Run the typecheck.

   ```sh
   pnpm typecheck; echo "exit=$?"
   ```

   - [ ] The command prints a non-zero exit
   - [ ] The error names a Drizzle dialect mismatch, and points at a schema file that imports `drizzle-orm/sqlite-core`
   - [ ] No error says a driver file was overwritten or replaced

3. Read the client file to confirm the driver stayed as picked.

   ```sh
   node -e "console.log(require('./.saasaloy/manifest.json').managed['packages/db/src/client.ts'])"
   ```

   - [ ] The entry still reads `"module": "database-postgres"`

4. Repeat the scenario with `database-d1` instead, as a control.

   ```sh
   pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 -y && ./saasaloy add waitlist -y && pnpm install && pnpm typecheck; echo "exit=$?"
   ```

   - [ ] The command prints `exit=0`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 4.

```sh
pnpm play:reset
```

## Scenario 4: playground on an older module version

**Setup.** Run once, for every case in this scenario. `saasaloy update` was read in the code, not run against a live registry, so this case covers the gap.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 -y
```

Then lower a version by hand, so `update` has work to do.

```sh
node -e "const p='./saasaloy.json'; const j=JSON.parse(require('fs').readFileSync(p,'utf8')); console.log(JSON.stringify(j.installed,null,2));"
```

- [ ] Setup complete

### TC-4.1: `saasaloy update` reaches the same guard · 🟡 Normal

**Goal.** An update that pulls in a new prerequisite runs through the same collision guard and refuses cleanly.

**Steps**

1. Lower the recorded version of one installed module in `saasaloy.json`, so `update` sees a newer registry version.

   - [ ] The file now records a lower version for `database-d1`

2. Run the update.

   ```sh
   ./saasaloy update -y; echo "exit=$?"
   ```

   - [ ] The command completes and prints an exit code
   - [ ] The output reports the updated modules, or reports that nothing changed

3. Read the file owners after the update.

   ```sh
   node -e "const m=require('./.saasaloy/manifest.json').managed; for (const k of Object.keys(m)) console.log(k, m[k].module);"
   ```

   - [ ] Every `packages/db` entry still names `database-d1`
   - [ ] No path is owned by a module that is not in `saasaloy.json`'s `installed` list

4. If the update refuses with exit 2, read the message.

   - [ ] The refusal headline reads `Cannot add these modules` and names every contested path
   - [ ] The message states a next action the tester can run

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 5.

```sh
pnpm play:reset
```

## Scenario 5: registry copy with two skill-link claimants

**Setup.** Run once, for every case in this scenario. `listModuleFiles` enumerates `agent.skills` targets, so a skill link is in scope for the guard. No test or probe made two modules contest one skill path, so this case closes that gap.

1. Copy the registry.

   ```sh
   rm -rf /tmp/reg91skill && mkdir -p /tmp/reg91skill && cp -R modules /tmp/reg91skill/modules
   ```

2. Add two synthetic modules under `/tmp/reg91skill/modules`, `skill-a` and `skill-b`. Give each an `agent.skills` entry that points at the same skill path. Declare no `dependsOn` between them and no `conflictsWith`.

   - [ ] Both descriptors validate, because `./saasaloy add skill-a` alone exits 0

3. Reset the playground.

   ```sh
   pnpm play:reset
   ```

- [ ] Setup complete

### TC-5.1: Two modules contesting one skill path are refused · 🟢 Low

**Goal.** The guard covers a skill-link target the same way it covers a `files[]` target.

**Steps**

1. Install the first module.

   ```sh
   cd .dev/playground && SAASALOY_REGISTRY_DIR=/tmp/reg91skill node ../../packages/cli/dist/index.js add skill-a -y
   ```

   - [ ] The command exits 0

2. Install the second module.

   ```sh
   SAASALOY_REGISTRY_DIR=/tmp/reg91skill node ../../packages/cli/dist/index.js add skill-b -y; echo "exit=$?"
   ```

   - [ ] The command prints `exit=2`
   - [ ] The message names `skill-a` as the owner and prints the contested skill path
   - [ ] The message names `saasaloy remove skill-a` as the way through

3. Confirm the first module's skill link survives.

   ```sh
   ls -l .claude/skills
   ```

   - [ ] The link from `skill-a` is still there and still points at its source

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after this case.

```sh
rm -rf /tmp/reg91skill && pnpm play:reset
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The verify step ran 18 agent checks on this branch. All 18 passed, 0 failed. Full detail lives in `.afkkit/verified.md`.

Commands run (one per block):

```sh
pnpm exec vitest run src/lib/collisions.test.ts --reporter=verbose --coverage.enabled=false
```

```sh
pnpm exec vitest run src/lib/applier.test.ts --reporter=verbose --coverage.enabled=false
```

```sh
pnpm play:init && cd .dev/playground && ./saasaloy add database-d1 -y
```

```sh
cd .dev/playground && SAASALOY_REGISTRY_DIR=/tmp/reg91 node ../../packages/cli/dist/index.js add database-postgres --force -y
```

```sh
cd .dev/playground && ./saasaloy add waitlist -y < /dev/null
```

```sh
pnpm test && pnpm build && pnpm lint
```

Phase 1, refuse a collision inside one `add` run:

- ✅ C1, `lib/collisions.ts` exposes the graph-reachability rule → `collisions.test.ts` passes 29 of 29. The file exports `mayShareTarget`, `detectCollisions`, `formatCollisions`, `detectOwnedCollisions`, `formatOwnedCollisions`.
- ✅ C2, `buildPlan` refuses an illegal same-run overlap before any write → `applier.test.ts` passes 92 of 92. The refusal throws `RefusalError`, and the contested path never appears on disk.
- ✅ C3, the message names both modules, the path and `conflictsWith` → real CLI output reads "probe-a and probe-b both write packages/validators/src/shared.ts, and neither declares the other in `dependsOn`. Give one of them a different target, or declare `conflictsWith` between them if they are deliberately exclusive."
- ✅ C4, `files[]` and `scaffolds[].files[]` alike → two passing cases, one per source.
- ✅ C5, `add database-d1` still installs → exit 0, `Applied logger, logger-console, api, database, database-d1 (25 files)`, and `packages/db/tsconfig.json` is owned by `database-d1`.
- ✅ C6, `collisions.test.ts` covers a legal and an illegal pair → both named cases pass.

Phase 2, refuse a collision against what is already installed:

- ✅ C7, `classify` compares `managed.module` to the installing module → `classify` takes a `module` argument and returns `ownedBy` on a mismatch.
- ✅ C8, one `RefusalError` naming every contested path before any write → exit 2, all three `packages/db` paths listed, and the target file keeps its original bytes.
- ✅ C9, a module rewriting its own file is unaffected → both `add database-d1` runs exit 0, and a re-apply reports `Applied database-d1 (0 files)`.
- ✅ C10, a module may write over a file owned by a module it depends on → `add database` then `add database-d1` both exit 0, and ownership flips to `database-d1`.
- ✅ C11, `--force` does not override, and the message names `remove <other>` → exit 2, and the message names `saasaloy remove database-d1`.
- ✅ C12, `remove` leaves ownership consistent → `remove database-d1` then `add database-postgres` exits 0, and the client file is owned by `database-postgres`.
- ✅ C13, the `--force` behaviour is documented → `docs/wiki/reference.md:109-111` and `docs/wiki/how-to/add-a-module.md:85-90` both state the rule and the swap.

Phase 3, a feature names the capability, never the driver:

- ✅ C14, `waitlist` drops `database-d1` → `dependsOn` reads `["api","database","validators"]`.
- ✅ C15, `auth` drops `database-d1` → `dependsOn` reads `["api","database"]`.
- ✅ C17, the same command with no terminal refuses and names both drivers → exit 2, and the message names `database-d1, database-postgres`.
- ✅ C18, `create-module` and `create-provider` teach the rule → `create-module/SKILL.md:116-121` and `create-provider/SKILL.md:88-90`.
- ✅ C19, the follow-up issue for the dialect gap is filed → issue #99, OPEN. The link to #91 sits in a comment, not in the body.

Gate:

- ✅ C20, the repo gate → `pnpm test` exit 0 with 550 tests across 30 files, `pnpm build` exit 0, `pnpm lint` exit 0. No lint suppression was added.

One probe result the tester should know about:

- ⚠️ A deleted file lets ownership flip with no refusal. `classify` returns `create` when the target is missing from disk, so deleting the three `packages/db` files and adding the other driver exits 0 and lists both drivers as installed. Review judged this a nit, and issue #107 owns the fix. It is out of scope for this plan.

## Not covered / needs human judgment

- **Compatibility and accessibility.** The change is a CLI refusal path with no UI, so browser, device, dark mode and screen-reader dimensions do not apply. The picker's keyboard behaviour is covered in TC-1.2.
- **Performance.** The guard runs over an in-memory file map that the planner already builds, so no case measures it.
- **Concurrency.** Two `add` runs at the same time, and a failure part way through `executePlan`, are out of scope for issue #91.
- **Windows path handling.** Out of scope for this change.
- **`saasaloy remove` after the deleted-file ownership flip.** The claim that `remove database-d1` deletes none of the three files was read off `remover.ts:141` and `remover.ts:182`, not run. Issue #107 owns it.
- **A manifest owner that is no longer in the registry.** `detectOwnedCollisions` refuses it by design, but the resulting `saasaloy remove <missing-module>` may not be actionable. Not exercised.
- **The shipped registry alone cannot reach the phase 2 refusal.** `conflictsWith` fires first for the driver pair. Scenario 2 uses a stripped registry copy on purpose. Do not report "the feature does not work" from a run against the shipped registry.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
