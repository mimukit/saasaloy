# QA Plan: `add` is honest about a partial failure

_Generated 2026-09-03 · against `a89ec9c` · covers issue #49: what `saasaloy add` records and says when an apply does not finish_

## Summary

- `saasaloy add` has no rollback. It now records only the modules whose files actually landed, and it tells the user which re-run finishes the job.
- Working means three things. `saasaloy.json`, `.saasaloy/manifest.json` and `saasaloy-lock.json` describe disk. A run that stopped inside the apply prints the recovery line. A run that stopped anywhere else does not.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-49-make-add-honest-about-partial-failure` at commit `a89ec9c`.
- macOS or Linux. Scenario 4 needs Windows and is skipped elsewhere.
- No credentials are needed for Scenario 1, 3 or 4. Scenario 2 needs network access to `github.com`. Set `GITHUB_TOKEN` only if the API rate limit blocks you.
- Node 22 or later, and pnpm 11.
- Work inside the repo's `.dev` directory, per `AGENTS.md`. Create it if it is absent.

Install and build the CLI once:

```sh
pnpm install && pnpm --filter saasaloy build
```

The plan calls the built CLI by path. Export both paths once per shell, from the repo root:

```sh
export SAASALOY="$PWD/packages/cli/dist/index.js" && export FIXTURES="$PWD/packages/cli/test/fixtures/registry-clean"
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: repo checkout, no project | ADR 0031 records the model the code implements | 🔴 Critical |
| TC-1.2 | 1: repo checkout, no project | The glossary and ADR 0006 point at 0031 | 🟡 Normal |
| TC-2.1 | 2: fresh project, real GitHub registry | A remote add pins a real commit SHA | 🟡 Normal |
| TC-2.2 | 2: fresh project, real GitHub registry | A failed remote add reads as honest to a first-time user | 🟡 Normal |
| TC-3.1 | 3: project with one module held back | `remove` over a partially applied project | 🟢 Low |
| TC-3.2 | 3: project with one module held back | `update` over a partially applied project | 🟢 Low |
| TC-4.1 | 4: Windows machine | The e2e suites skip instead of failing | 🟢 Low |

## Scenario 1: repo checkout, no project

**Setup.** Run once, for every case in this scenario.

1. Open a shell at the repo root on the branch under test. No project and no build are needed.

- [ ] Setup complete

### TC-1.1: ADR 0031 records the model the code implements · 🔴 Critical

**Goal.** The record a future reader finds is the behaviour the code ships, not a plan of it.

**Steps**

1. Read the ADR end to end.

   ```sh
   cat docs/adr/adr-0031-re-run-is-recovery-for-a-partial-add-2026-09-03.md
   ```

   - [ ] The Decision states the invariant plainly: the bookkeeping describes disk, and the re-run is the recovery.
   - [ ] The Context names the bug it answers, and a reader who was not in the session can follow why rollback was rejected.
   - [ ] The rejected options (stage-and-commit, journal-undo) each carry a reason, not just a name.
2. Read the Consequences section against the code path.

   ```sh
   sed -n '/Consequences/,$p' docs/adr/adr-0031-re-run-is-recovery-for-a-partial-add-2026-09-03.md
   ```

   - [ ] Every consequence the ADR claims is one the code actually has, including "a failure before or after that window is its own story and gets no such line".
   - [ ] The open surfaces are named as open, including the `doctor` project mode that no command calls yet.
3. Compare the ADR against its neighbours.

   ```sh
   ls docs/adr/
   ```

   - [ ] The file uses the next free number and the same heading shape as `adr-0030`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The glossary and ADR 0006 point at 0031 · 🟡 Normal

**Goal.** A reader who starts at the state files reaches the decision that governs them.

**Steps**

1. Read the cross-references.

   ```sh
   grep -n "0031" CONTEXT.md docs/adr/adr-0006*.md
   ```

   - [ ] `CONTEXT.md` links 0031 from both the `saasaloy.json` and the manifest entries, and the sentence around each link reads correctly.
   - [ ] ADR 0006's Status names 0031 and says what 0031 changes about it.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. This scenario writes no files.

## Scenario 2: fresh project, real GitHub registry

**Setup.** Run once, for every case in this scenario. This is the path the automated checks never drove: every automated run used the local fixture registry, whose `provenance()` cannot throw.

1. Scaffold a project outside any existing workspace.

   ```sh
   mkdir -p .dev/qa49 && cd .dev/qa49 && node "$SAASALOY" init remote-check --no-install --no-git
   ```

2. Enter the project. Leave `SAASALOY_REGISTRY_DIR` unset, so the CLI reads the real registry over the network.

   ```sh
   cd remote-check && unset SAASALOY_REGISTRY_DIR
   ```

- [ ] Setup complete

### TC-2.1: A remote add pins a real commit SHA · 🟡 Normal

**Goal.** The lock records the commit the files came from when the source is a real remote, and the unresolved-provenance guard stays quiet.

**Steps**

1. Add a module from the remote registry.

   ```sh
   node "$SAASALOY" add waitlist --yes
   ```

   - [ ] The run ends on `Applied`, and it names the modules it installed.
   - [ ] No line mentions `provenance()`, and no line says `Couldn't pin saasaloy-lock.json`.
2. Read the lock.

   ```sh
   cat saasaloy-lock.json
   ```

   - [ ] Each entry's `resolved` is a 40-character commit SHA, not `local` and not empty.
   - [ ] Each entry's `source` is `mimukit/saasaloy`, and `ref` names the branch or tag you pulled.
3. Compare the lock against the config.

   ```sh
   cat saasaloy.json
   ```

   - [ ] The module names in `installed` and the keys of `modules` in the lock are the same set.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A failed remote add reads as honest to a first-time user · 🟡 Normal

**Goal.** The closing screen of a failed apply tells a user who did not write the code what state the project is in and what to do next.

**Steps**

1. Block the write of the next module's skill directory, so the apply fails part-way through.

   ```sh
   mkdir -p .agents/skills/saasaloy-validators && chmod 555 .agents/skills/saasaloy-validators
   ```

2. Add that module from the remote registry.

   ```sh
   node "$SAASALOY" add validators --yes
   ```

   - [ ] The run exits non-zero, and the last lines carry both the recovery line and the underlying error.
   - [ ] Read the recovery line as a stranger would. It says what the state files now describe, and it names one command to run next. Nothing in it is ambiguous about whether files were written.
   - [ ] The error that stopped the run is still reported. The recovery line does not replace it or hide it.
3. Run the command the recovery line named.

   ```sh
   chmod 755 .agents/skills/saasaloy-validators && node "$SAASALOY" add validators --yes
   ```

   - [ ] The re-run re-plans the module rather than reporting it already installed.
   - [ ] The preview shows the files it will complete, and the run ends on `Applied`.
   - [ ] The advice was true. The re-run finished the job, and no `--force` was needed.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
chmod -R u+w .dev/qa49 && rm -rf .dev/qa49
```

## Scenario 3: project with one module held back

This scenario covers behaviour issue #49 does not own. `remove` and `update` over a partially applied project were never checked, by the implementer or the reviewer. Treat a failure here as a follow-up issue, not a blocker on this branch.

**Setup.** Run once, for every case in this scenario.

1. Scaffold a project and point the CLI at the local fixture registry.

   ```sh
   mkdir -p .dev/qa49b && cd .dev/qa49b && node "$SAASALOY" init drift-check --no-install --no-git
   ```

2. Enter the project and point the CLI at the fixture registry.

   ```sh
   cd drift-check && export SAASALOY_REGISTRY_DIR="$FIXTURES"
   ```

3. Create the drift the plan cannot see. `apps/api/src/beta.ts` is a symlink to a sibling that does not exist yet, so `beta` plans a create and finds bytes by the time it writes.

   ```sh
   mkdir -p apps/api/src && ln -s index.ts apps/api/src/beta.ts && node "$SAASALOY" add beta --yes
   ```

- [ ] Setup complete
- [ ] The run exits 0, says `beta` is not installed, and `saasaloy.json` lists `alpha` only

### TC-3.1: `remove` over a partially applied project · 🟢 Low

**Goal.** `remove` handles a module whose files are on disk but which never reached `installed`.

**Steps**

1. Remove the module the run held back.

   ```sh
   node "$SAASALOY" remove beta
   ```

   - [ ] The command reports a clear result. It either removes what the manifest tracks, or it says the module is not installed. It does not crash and it does not report a success it did not have.
   - [ ] The user's own file at `apps/api/src/beta.ts` is untouched, and it is still a symlink to `index.ts`.
2. Read the state files.

   ```sh
   cat saasaloy.json && cat .saasaloy/manifest.json
   ```

   - [ ] The manifest and the config agree with what is on disk after the removal.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: `update` over a partially applied project · 🟢 Low

**Goal.** `update` gives a sane answer for a module that is on disk but not in `installed`.

**Steps**

1. Run the update.

   ```sh
   node "$SAASALOY" update
   ```

   - [ ] The command reports a clear result and exits without a stack trace.
   - [ ] The message tells the user what to do about a module the config does not claim.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
rm -rf .dev/qa49b
```

## Scenario 4: Windows machine

**Setup.** Run once. Skip this scenario if you have no Windows machine, and record the skip.

1. Clone the branch on Windows and build the CLI.

   ```sh
   pnpm install && pnpm --filter saasaloy build
   ```

- [ ] Setup complete

### TC-4.1: The e2e suites skip instead of failing · 🟢 Low

**Goal.** The two fault-injection suites detect that Windows cannot reproduce their fault, and skip rather than fail the file.

**Steps**

1. Run the e2e set.

   ```sh
   pnpm --filter saasaloy test:e2e
   ```

   - [ ] The run is green, and no suite errors inside a `beforeAll`.
   - [ ] The summary reports skipped tests, not failed ones. The read-only suites and the drift suite are the skipped ones.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. Transcribed from `.afkkit/verified.md`, which records the acceptance run against the nine criteria in `.afkkit/checks.md`._

Commands run:

```sh
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

```sh
pnpm --filter saasaloy test:e2e
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/applier.test.ts
```

```sh
pnpm --filter saasaloy exec vitest run src/commands/add.test.ts
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/doctor.test.ts src/commands/doctor.test.ts
```

```sh
grep -rn "SAASALOY_TEST\|__test" packages/cli/src
```

Results:

- ✅ Full gate → `pnpm build`, `pnpm typecheck`, `pnpm test` (`Test Files 41 passed (41)`) and `pnpm lint` (four passes, `All matched files use Prettier code style!`) all green at `a89ec9c`.
- ✅ `pnpm --filter saasaloy test:e2e` → `Test Files 2 passed (2), Tests 48 passed (48)`, 0 skipped. Both fault probes returned true on the run machine, so every suite ran.
- ✅ C1, completeness derives from results → `applier.test.ts`, 112 tests. `ApplyResult.completed` drives `config.installed`; the e2e case `pins nothing the config does not also claim` asserts the lock keys equal `installed`.
- ✅ C2, the persist path is hardened → `add.test.ts`, 51 tests. `persistState` wraps the lock upsert and each of the three saves separately, warns per failure, and returns the failures rather than throwing.
- ✅ C3, a thrown mid-apply failure states the recovery and exits non-zero → the e2e suite asserts exit code 1, `Partial apply` in the output, and the original `EACCES` preserved.
- ✅ C4, an incomplete `lateDrift` run exits 0 and names the module → the drift suite asserts exit 0, `is not installed`, and `installed` of `["alpha"]`.
- ✅ C6, `lib/doctor.ts` flags a partial install → `doctor.test.ts` and `commands/doctor.test.ts`, 46 tests. `checkProject` returns ``partial install — re-run `saasaloy add X` `` for a tracked-but-uninstalled module.
- ✅ C7, the mid-apply failure test uses a read-only parent directory → `grep -rn "SAASALOY_TEST\|__test" packages/cli/src` exits 1 with no match, so production code carries no test hook. The suite also proves the failure was genuinely mid-apply by asserting a written file exists before the refused one.
- ✅ C8, the `lateDrift` case and the repair re-run → drift is injected with filesystem state alone. The suite asserts the user's bytes survive, the module stays uninstalled, and the re-run installs it.
- ✅ C9, convergence → the repaired project and a clean-run project compare equal on the three parsed state files and on a full sha256 tree snapshot.
- ✅ Live probe, refused write → `chmod 555` on beta's skill directory, then `add beta --yes`. Exit 1, the recovery line, then the original `EACCES`. `installed` is `[]`.
- ✅ Live probe, save-only failure after a clean apply → `chmod 444 saasaloy-lock.json`, then `add beta --yes`. Exit 1, `Couldn't write saasaloy-lock.json — EACCES...`, and no `Partial apply` line. The recovery line now fires for an incomplete apply only.
- ✅ Live probe, `doctor` in a consumer project → reports `No such path: modules`. `checkProject` is exported but no command calls it. This is recorded as an open surface in ADR 0031 and carried to the PR body as a follow-up.

## Not covered / needs human judgment

- **ADR 0031 as a record.** Whether the decision document is faithful and complete is a judgment no command makes. Scenario 1 covers it. Criterion C5 is human-only by design.
- **A real remote through the partial path.** Every automated run used the local fixture registry, whose `provenance()` cannot throw, so the unresolved-SHA branch of `persistState` is unit-tested only. Scenario 2 drives a real remote by hand.
- **Windows and root.** The read-only-dir and symlink faults do not reproduce there, so both suites self-skip. Neither skip path was exercised, because both probes returned true on the run machine. Scenario 4 covers Windows. Running as root is not covered at all.
- **`remove` and `update` over a partially applied project.** Out of issue #49's scope, and never checked. Scenario 3 covers it as a known gap.
- **Ctrl-C mid-apply.** A stated non-goal of the issue. Not covered.
- **The `doctor` command surface.** `checkProject` exists and is tested, but no command calls it, so no user reaches the check. The command surface is a follow-up, recorded in ADR 0031. Not covered here.
- **Performance, accessibility, browser compatibility.** The change is a CLI state-and-message path with no UI and no measurable hot loop. All three dimensions are skipped as irrelevant.
- **Concurrency.** Two `add` runs at once are not covered. The CLI takes no lock, and that gap predates this branch.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
