# QA Plan: Applier test harness and `saasaloy doctor`

_Generated 2026-09-02 · against `b091cca` (plus review fixes in the working tree) · covers the new test suites (unit gaps, remote fixture server, e2e, module matrix) and the new `doctor` command_

## Summary

- The change adds test coverage for the applier and a `saasaloy doctor` command that validates module descriptors.
- Working means: the suites pass, and `doctor` reports every descriptor problem with a readable note and exit code 2.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-47-cover-the-applier-end-to-end-and-add-saasaloy`, worktree `/home/dev/worktrees/saasaloy/issue-47-cover-the-applier-end-to-end-and-add-saasaloy`.
- No credentials and no network. `doctor` reads local folders only.

Build once so `dist/` is current:

```sh
pnpm install && pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: repo root, clean registry | Doctor passes the real registry and one module | 🔴 Critical |
| TC-1.2 | 1: repo root, clean registry | Help and refusal messages read correctly | 🟡 Normal |
| TC-2.1 | 2: repo root, broken fixture registry | Doctor names every problem and exits 2 | 🔴 Critical |
| TC-2.2 | 2: repo root, broken fixture registry | The report stays legible in a narrow terminal | 🟢 Low |

## Scenario 1: repo root, clean registry

**Setup.** None beyond Environment. Run every command from the worktree root.

- [ ] Setup complete

### TC-1.1: Doctor passes the real registry and one module  ·  🔴 Critical

**Goal.** `doctor` accepts the registry this repo ships, so the gate does not block a clean publish.

**Steps**

1. Check the whole registry:

   ```sh
   pnpm cli doctor modules
   ```

   - [ ] The note lists every module with a green check, and the outro says "No problems found."
     - the header says "Checked N modules" and N matches the folder count under `modules/`
     - the command exits without an error banner
2. Check one module folder:

   ```sh
   pnpm cli doctor modules/waitlist
   ```

   - [ ] The note says "Checked 1 module" and names only `waitlist`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Help and refusal messages read correctly  ·  🟡 Normal

**Goal.** A wrong invocation tells the user what to type instead, and never runs a check silently.

**Steps**

1. Ask for help:

   ```sh
   pnpm cli doctor --help
   ```

   - [ ] The help names the command, a one-line description, and the usage `saasaloy doctor [<path>]`
2. Pass a flag `doctor` does not know:

   ```sh
   pnpm cli doctor modules --strict
   ```

   - [ ] The command refuses with "Unknown argument(s): --strict" and shows the usage line
3. Point it at a path that does not exist:

   ```sh
   pnpm cli doctor modules/absent
   ```

   - [ ] The message says "No such path" and tells the user what `doctor` accepts

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 2: repo root, broken fixture registry

**Setup.** None. The broken registry ships with the repo at `packages/cli/test/fixtures/registry-broken/`. Do not edit it; several folders are invalid by design.

- [ ] Setup complete

### TC-2.1: Doctor names every problem and exits 2  ·  🔴 Critical

**Goal.** A broken registry produces one finding per problem, each tied to its module, and the refusal exit code.

**Steps**

1. Check the broken fixture registry and print the exit code:

   ```sh
   pnpm cli doctor packages/cli/test/fixtures/registry-broken; echo "exit=$?"
   ```

   - [ ] Each broken module gets its own note, titled with the module name and a finding count
     - `bad-json`, `bad-schema`, `bad-skill`, `ghost-dep`, `missing-file`, `name-mismatch`, `orphan-devvar`, `unknown-alias`, `unpinned-dep` all appear
     - each finding names where it is and what rule it breaks, in plain words
   - [ ] The summary line counts the modules and the problems, and the last line prints `exit=2`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The report stays legible in a narrow terminal  ·  🟢 Low

**Goal.** The wrapped notes do not break the box drawing at a narrow width.

**Steps**

1. Resize the terminal to about 60 columns. Run the same command as TC-2.1 step 1.
   - [ ] Long finding messages wrap inside the note box, and the box borders stay aligned

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm --filter saasaloy typecheck
```

```sh
pnpm --filter saasaloy test
```

```sh
pnpm --filter saasaloy build && pnpm --filter saasaloy test:e2e && pnpm --filter saasaloy test:matrix
```

```sh
node packages/cli/dist/index.js doctor modules
```

```sh
node packages/cli/dist/index.js doctor packages/cli/test/fixtures/registry-broken
```

- ✅ `pnpm lint` → all four passes green (oxlint type-aware, oxlint plain, Stylelint, Prettier).
- ✅ `pnpm --filter saasaloy typecheck` → clean.
- ✅ `pnpm --filter saasaloy test` → 40 files, 818 tests pass; coverage 82.7% statements / 77.3% branches.
- ✅ build + `test:e2e` + `test:matrix` → e2e 27/27, matrix 154/154 (run during the review pass this session; only unit-test files changed after it).
- ✅ `doctor modules` → "No problems found.", exit 0.
- ✅ `doctor` on `registry-broken` → exit 2.

## Not covered / needs human judgment

- Remote coordinate validation is a follow-up issue; `doctor` reads local folders only, by design.
- Windows behavior (junction links, path separators) — this box is Linux.
- The `SAASALOY_E2E_BIN` tarball path: the mechanism is untested against a real packed tarball.
- Concurrency, performance, accessibility, and compatibility beyond TC-2.2 do not apply to a local read-only CLI check.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
