# QA Plan: stale manifest owner on a reclaimed file

_Generated 2026-09-03 · against `e778d54` · covers issue #107: what `add` does when a module claims a file that is gone but still has a manifest owner, plus the new project mode of `doctor`._

## Summary

- `saasaloy add` writes a file whose manifest owner is a different installed module when that file is gone from disk, and it warns instead of refusing.
- Working means the run exits 0, the warning names the stale owner and the path, `saasaloy doctor .` reports the same owner, and `saasaloy remove <owner>` clears it.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-107-decide-what-a-claim-on-a-missing-file-does-to-its`, commit `e778d54`.
- The plan runs in a terminal only. There is no server, no browser, and no credentials.
- All CLI commands run inside `.dev/playground`. The `./saasaloy` shim there calls the built CLI.
- Build the CLI and scaffold the playground from the repo root:

```sh
pnpm run play:reset
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: playground with `database-d1` installed and its file deleted | The `add` warning reads as an instruction | 🔴 Critical |
| TC-1.2 | 1: playground with `database-d1` installed and its file deleted | `doctor .` reports the same stale owner | 🟡 Normal |
| TC-1.3 | 1: playground with `database-d1` installed and its file deleted | `remove` clears the state both commands reported | 🟡 Normal |
| TC-2.1 | 2: playground with no `modules` directory | A bare `doctor` run points at the project mode | 🟡 Normal |

## Scenario 1: playground with `database-d1` installed and its file deleted

**Setup.** Run once, for every case in this scenario. It leaves `database-d1` in `installed`, its `client.ts` recorded in the manifest, and no file on disk.

1. Enter the playground.

```sh
cd .dev/playground
```

2. Install the driver that owns `@db/client.ts`.

```sh
./saasaloy add database-d1
```

3. Delete the file it wrote, the way a person deletes a file they no longer want.

```sh
rm packages/db/src/client.ts
```

- [ ] Setup complete

### TC-1.1: The `add` warning reads as an instruction · 🔴 Critical

**Goal.** A rival driver takes the missing file, and the run tells the user what to do rather than refusing.

**Steps**

1. Add the rival driver, which claims the same target and does not reach `database-d1` through `dependsOn`.

   ```sh
   ./saasaloy add database-postgres
   ```

   - [ ] The run finishes and reports `database-postgres` as installed
   - [ ] One warning line names `database-d1`, the path `packages/db/src/client.ts`, and the command `saasaloy remove database-d1`
   - [ ] The warning reads as a next step, not as an error
     - the line sits inside the clack rail and wraps inside it
     - the path keeps its colour accent and stays readable
     - no wording suggests the run failed or that `--force` is needed

2. Read the exit code.

   ```sh
   echo $?
   ```

   - [ ] The value is `0`

3. Read the file on disk.

   ```sh
   head -5 packages/db/src/client.ts
   ```

   - [ ] The file exists and holds the Postgres client, so the claim was written

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `doctor .` reports the same stale owner · 🟡 Normal

**Goal.** The project check names the module the `add` warning named, so the two commands agree.

**Steps**

1. Check the project.

   ```sh
   ./saasaloy doctor .
   ```

   - [ ] One finding names `database-d1` and the command `saasaloy remove database-d1`
   - [ ] No finding names `database-postgres`, `database`, or the base app
   - [ ] The finding block is legible
     - the module name carries the warning colour
     - the sentence wraps inside the rail

2. Read the exit code.

   ```sh
   echo $?
   ```

   - [ ] The value is `2`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: `remove` clears the state both commands reported · 🟡 Normal

**Goal.** The advice the two commands print is advice that works, and it does not take the rival's file with it.

**Steps**

1. Run the command the warning named.

   ```sh
   ./saasaloy remove database-d1
   ```

   - [ ] The run finishes and reports `database-d1` as removed

2. Check the project again.

   ```sh
   ./saasaloy doctor .
   ```

   - [ ] The output says no problems were found
   - [ ] The exit code is `0`

3. Read the rival's file.

   ```sh
   head -5 packages/db/src/client.ts
   ```

   - [ ] The Postgres client is still there, so `remove` did not delete a file it no longer owned

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd ../.. && pnpm run play:reset
```

## Scenario 2: playground with no `modules` directory

**Setup.** Run once. The playground is a scaffolded project, so it carries a `saasaloy.json` and has no registry layout.

1. Enter the playground.

```sh
cd .dev/playground
```

2. Confirm the state the case depends on.

```sh
ls saasaloy.json && ls modules
```

- [ ] `saasaloy.json` is listed and `modules` does not exist

- [ ] Setup complete

### TC-2.1: A bare `doctor` run points at the project mode · 🟡 Normal

**Goal.** A user who types `doctor` in their project learns that `doctor .` is the command they want.

**Steps**

1. Run `doctor` with no path.

   ```sh
   ./saasaloy doctor
   ```

   - [ ] The refusal names the missing path `modules` and then names `saasaloy doctor .`
   - [ ] The hint reads as the next command to run, and the whole line stays legible in the rail

2. Read the exit code.

   ```sh
   echo $?
   ```

   - [ ] The value is `2`

3. Run the command the hint named.

   ```sh
   ./saasaloy doctor .
   ```

   - [ ] The project check runs and reports no problems, so the hint sent the user somewhere that works

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
cd ../.. && pnpm run play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm --filter saasaloy build
```

```sh
cd packages/cli && npx vitest run src/lib/collisions.test.ts src/lib/applier.test.ts src/commands/doctor.test.ts src/commands/add.test.ts src/lib/doctor.test.ts src/lib/remover.test.ts
```

- ✅ `pnpm lint` → exit 0 across all four passes: oxlint type-aware, oxlint plain, stylelint, `prettier --check .`.
- ✅ `pnpm test` → exit 0, 41 test files, 847 CLI tests, above the 832-test baseline of the untouched tree.
- ✅ `pnpm --filter saasaloy build` → exit 0.
- ✅ targeted vitest run over the six touched suites → 289 tests, all pass.
- ✅ the decision is recorded in code → `applier.ts` carries five `#107` references, and the `classify` early return states warn-and-instruct, names `saasaloy remove <owner>`, and states that the bookkeeping is never edited. No file under `docs/adr` changed.
- ✅ the plan-level half of the `add` warning → `applier.test.ts` asserts `plan.staleOwners` carries the exact `{target, owner, claimant, ownerKeepsFiles}` entries for both contested paths; `collisions.test.ts` asserts the sentence holds the owner, the path, the claimant and the literal `saasaloy remove database-d1`, and holds neither `Cannot add` nor `--force`.
- ✅ the owner that keeps a file → `collisions.test.ts` asserts the sentence drops `saasaloy remove` when `ownerKeepsFiles` is true; `applier.test.ts` asserts the flag on a plan where the rival takes one of the owner's two files.
- ✅ the `doctor` project rule → five `checkProject` tests pass, plus a live probe on a hand-made fixture: `doctor .` exits 2 with one finding naming the stale module, and exits 0 on a project where every installed module owns a file. The base app is never reported.
- ✅ the `doctor` hint → `commands/doctor.test.ts` asserts the hint appears for a bare run in a directory with a `saasaloy.json` and does not appear in a directory without one. A live probe on the built `dist` matched both directions.
- ✅ `remove` leaves no orphan → `remover.test.ts` executes a real remove and asserts that no entry in the whole `managed` map names a module absent from `installed`, and that the rival's files survive.

## Not covered / needs human judgment

- The `ownerKeepsFiles` branch of the `add` warning cannot be reproduced from the shipped registry. `@db/client.ts` is the only target two modules contest, and each of those two owns exactly one file, so no real `add` leaves the owner holding a second file. Unit tests cover the branch; a manual run would need a hand-written module.
- Colour and wrapping in a real TTY. Every automated probe ran non-interactive, where clack falls back to plain rails.
- `pnpm --filter saasaloy test:e2e` and `pnpm --filter saasaloy test:matrix` are outside `pnpm test` and were not re-run in the fix round.
- Concurrency, performance, accessibility and browser compatibility do not apply. The change is terminal output and planning logic, with no UI, no server and no concurrent path.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
