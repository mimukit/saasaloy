# QA Plan: one ledger for every state-file write

_Generated 2026-09-16 · against `12f7e9d` plus the uncommitted work of issue #150 · covers `add`, `update` and `remove` writing `.saasaloy/manifest.json`, `saasaloy.json` and `saasaloy-lock.json`._

## Summary

- Saasaloy now writes its three state files through one function, `persistLedger`, instead of three hand-written blocks in three commands.
- "Working" means the three files always describe what is on disk, all three saves run even after one fails, and the command error still wins over a save error.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-150-route-every-state-file-write-through-one-ledger`.
- No server, no credentials and no network. The CLI runs offline against this worktree's own `modules/` folder.
- The playground lives at `.dev/playground`. The `saasaloy` shim inside it calls this worktree's built CLI.

Build the CLI and create the playground:

```sh
pnpm run play:init
```

Enter the playground. Every later command in this plan runs from there:

```sh
cd .dev/playground
```

Confirm the shim reaches the local registry:

```sh
./saasaloy --version
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| #      | Scenario                              | Test case                                                     | Priority    |
| ------ | ------------------------------------- | ------------------------------------------------------------- | ----------- |
| TC-1.1 | 1: fresh playground, nothing installed | `add` writes all three state files and they agree             | 🔴 Critical |
| TC-1.2 | 1: fresh playground, nothing installed | `add` is idempotent and records one patch, not two            | 🟡 Normal   |
| TC-2.1 | 2: one module installed, manifest blocked | `add` still writes the config and the lock, and names the manifest | 🔴 Critical |
| TC-2.2 | 2: one module installed, manifest blocked | `remove` still writes the config and the lock                 | 🔴 Critical |
| TC-2.3 | 2: one module installed, manifest blocked | `update` still writes the config and the lock                 | 🟡 Normal   |
| TC-3.1 | 3: one module installed, disk healthy  | `remove` drops the module from all three files                | 🔴 Critical |
| TC-3.2 | 3: one module installed, disk healthy  | `adopted` never appears on a file the tool wrote              | 🟢 Low      |

## Scenario 1: fresh playground, nothing installed

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground from scratch.

```sh
cd .. && pnpm run play:reset && cd .dev/playground
```

2. Confirm the project starts with no installed module.

```sh
cat saasaloy.json
```

- [ ] Setup complete

### TC-1.1: `add` writes all three state files and they agree · 🔴 Critical

**Goal.** A clean `add` leaves a manifest, a config and a lock that describe the same install.

**Steps**

1. Install one module.

   ```sh
   ./saasaloy add logger-console --yes
   ```

   - [ ] The command ends with a success line and no warning about a state file

2. Read the three state files.

   ```sh
   cat .saasaloy/manifest.json saasaloy.json saasaloy-lock.json
   ```

   - [ ] The three files agree on the install
     - `saasaloy.json` lists `logger-console` under `installed`
     - `.saasaloy/manifest.json` carries a `managed` entry for every file the command printed
     - every `managed` entry carries a `module`, a 64-character `hash` and a `from`
   - [ ] No `managed` entry carries an `adopted` field

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `add` is idempotent and records one patch, not two · 🟡 Normal

**Goal.** A forced re-add lands the same patch again and the manifest still lists it once.

**Steps**

1. Count the recorded patches.

   ```sh
   node -e "console.log(JSON.parse(require('fs').readFileSync('.saasaloy/manifest.json')).patches.length)"
   ```

   - [ ] The number is written down for step 3

2. Re-add the same module with `--force`.

   ```sh
   ./saasaloy add logger-console --force --yes
   ```

   - [ ] The command succeeds

3. Count the recorded patches again.

   ```sh
   node -e "console.log(JSON.parse(require('fs').readFileSync('.saasaloy/manifest.json')).patches.length)"
   ```

   - [ ] The number is the same as in step 1

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd .. && pnpm run play:reset && cd .dev/playground
```

## Scenario 2: one module installed, manifest blocked

This scenario proves the behaviour change. A blocked manifest must not stop the config and the lock from being written.

**Setup.** Run once, for every case in this scenario.

1. Install one module.

```sh
./saasaloy add logger-console --yes
```

2. Delete the manifest folder and put a plain file in its place. `mkdir` then refuses it, so every manifest save throws.

```sh
rm -rf .saasaloy && printf 'not a directory\n' > .saasaloy
```

3. Record the current config and lock, so you can see them change.

```sh
cp saasaloy.json /tmp/qa-config-before.json && cp saasaloy-lock.json /tmp/qa-lock-before.json
```

- [ ] Setup complete

### TC-2.1: `add` still writes the config and the lock, and names the manifest · 🔴 Critical

**Goal.** A failed manifest save does not skip the two saves after it, and the user hears which file failed.

**Steps**

1. Add a second module.

   ```sh
   ./saasaloy add kv-memory --yes
   ```

   - [ ] The output warns about `manifest.json` by name
   - [ ] The warning names no other state file

2. Compare the config against the copy from setup.

   ```sh
   diff /tmp/qa-config-before.json saasaloy.json
   ```

   - [ ] `saasaloy.json` changed, and now lists `kv-memory` under `installed`

3. Compare the lock against the copy from setup.

   ```sh
   diff /tmp/qa-lock-before.json saasaloy-lock.json
   ```

   - [ ] `saasaloy-lock.json` changed, and now carries a `kv-memory` entry

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `remove` still writes the config and the lock · 🔴 Critical

**Goal.** `remove` no longer lets the first failed save skip the other two. Before this change it awaited the three in sequence, so a thrown manifest save left the config and the lock stale.

**Steps**

1. Copy the config and the lock again, so this case compares against the state TC-2.1 left.

   ```sh
   cp saasaloy.json /tmp/qa-config-2.json && cp saasaloy-lock.json /tmp/qa-lock-2.json
   ```

2. Remove the module TC-2.1 added.

   ```sh
   ./saasaloy remove kv-memory --yes
   ```

   - [ ] The command fails, and the error names the manifest

3. Compare the config.

   ```sh
   diff /tmp/qa-config-2.json saasaloy.json
   ```

   - [ ] `saasaloy.json` changed, and no longer lists `kv-memory`

4. Compare the lock.

   ```sh
   diff /tmp/qa-lock-2.json saasaloy-lock.json
   ```

   - [ ] `saasaloy-lock.json` changed, and no longer carries a `kv-memory` entry

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: `update` still writes the config and the lock · 🟡 Normal

**Goal.** `update` reaches the same ledger as the other two commands, in the same order.

**Steps**

1. Run an update against the local registry.

   ```sh
   ./saasaloy update --yes
   ```

   - [ ] The command either reports nothing to update, or fails naming the manifest
   - [ ] The command never reports a config or lock write it did not attempt

2. Confirm the config and the lock are still valid JSON, not half-written.

   ```sh
   node -e "JSON.parse(require('fs').readFileSync('saasaloy.json')); JSON.parse(require('fs').readFileSync('saasaloy-lock.json')); console.log('both parse')"
   ```

   - [ ] The command prints `both parse`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
rm -f /tmp/qa-config-before.json /tmp/qa-lock-before.json /tmp/qa-config-2.json /tmp/qa-lock-2.json && cd .. && pnpm run play:reset && cd .dev/playground
```

## Scenario 3: one module installed, disk healthy

**Setup.** Run once, for every case in this scenario.

1. Install one module with a skill link and a patch.

```sh
./saasaloy add logger-console --yes
```

- [ ] Setup complete

### TC-3.1: `remove` drops the module from all three files · 🔴 Critical

**Goal.** A clean remove leaves no trace of the module in any of the three files.

**Steps**

1. Remove the module.

   ```sh
   ./saasaloy remove logger-console --yes
   ```

   - [ ] The command succeeds and prints the files it deleted

2. Search the three files for the module name.

   ```sh
   grep -c "logger-console" .saasaloy/manifest.json saasaloy.json saasaloy-lock.json
   ```

   - [ ] Every file reports `0`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: `adopted` never appears on a file the tool wrote · 🟢 Low

**Goal.** The `adopted` field survives only where the tool adopted bytes off disk, never where it wrote them.

**Steps**

1. Rebuild the playground, which renders the base template rather than adopting it.

   ```sh
   cd .. && pnpm run play:reset && cd .dev/playground
   ```

2. List every managed entry that carries `adopted`.

   ```sh
   node -e "const m=JSON.parse(require('fs').readFileSync('.saasaloy/manifest.json')).managed; console.log(Object.entries(m).filter(([,e])=>'adopted' in e).map(([k])=>k))"
   ```

   - [ ] The command prints an empty list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd .. && pnpm run play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm run typecheck
```

```sh
pnpm run lint
```

```sh
pnpm run test
```

```sh
pnpm run build
```

- ✅ `pnpm run typecheck` → `tsc --noEmit` clean across the CLI package and the scripts project.
- ✅ `pnpm run lint` → all four passes clean: oxlint type-aware, oxlint plain, Stylelint, `prettier --check .`.
- ✅ `pnpm run test` → 55 test files, 1286 CLI tests pass; 160 script tests pass. This includes the new `src/lib/ledger.test.ts` (4 tests) and the new record-half tests in `src/lib/manifest.test.ts` (29 tests total in that file).
- ✅ `pnpm run build` → `dist/index.js` built, 281.55 KB.

Two of those checks cover the behaviour the manual plan re-confirms by hand:

- `persistLedger` writes the config and the lock when the manifest save throws, and returns all three failures when all three throw, in ledger order.
- `applyAndPersist` throws the apply error, not the save error, and still leaves the config and the lock on disk.

## Not covered / needs human judgment

- A real remote registry. Every case runs against this worktree's local `modules/` folder, so no case exercises a network fetch or an unresolvable commit SHA.
- Concurrency. Two commands writing the state files at the same time is out of scope; this change adds no locking and no transactionality.
- Compatibility and accessibility. The CLI has no UI surface and this change touches no output layout, so both dimensions are skipped.
- Performance. The change moves three writes, it does not add any, so no timing case is worth running.
- Windows. The symlink and junction paths behave differently there, and this box is Linux only.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
