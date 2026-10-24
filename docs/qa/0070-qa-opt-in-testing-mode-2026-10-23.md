# QA Plan: Opt-in testing mode and conditional module files

_Generated 2026-10-23 · against `1349e6c` (clean tree; same tree as `7e18318`, where the checks ran, after a commit-message fix) · covers issue #242, phases 1 to 3 of `docs/plans/0080-plan-opt-in-testing-2026-10-23.md`_

## Summary
- A project picks one testing mode (`off`, `tests-after`, `tdd`), and a descriptor entry with `when` ships only while its condition holds.
- Working means: a project with testing `off` gets no module test, turning testing on backfills them, and turning it off deletes nothing.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-242-add-the-testing-mode-and-conditional-module-files`, at `7e18318` or later.
- Run every command from the repo root in a real terminal. Scenario 1 needs a TTY, because it tests the attended prompt.
- The CLI reads modules from the working copy through `SAASALOY_REGISTRY_DIR`.

Build the CLI with:

```sh
pnpm install && pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: No project yet, a terminal attached | The attended init asks for the testing mode | 🟡 Normal |
| TC-2.1 | 2: A fresh `tdd` project | The agent guidance reads well | 🟡 Normal |

## Scenario 1: No project yet, a terminal attached

**Setup.** Run once, for every case in this scenario.

1. Make sure the scratch path is free.

```sh
rm -rf .dev/qa242-manual
```

- [ ] Setup complete

### TC-1.1: The attended init asks for the testing mode  ·  🟡 Normal

**Goal.** An owner at a terminal sees one clear question about testing, and the answer lands in `saasaloy.json`.

**Steps**

1. Start an init with no `--testing` flag.

   ```sh
   node packages/cli/dist/index.js init .dev/qa242-manual --no-install --no-git
   ```

   - [ ] The init asks one question about the testing mode, and its three choices are clear to an owner who never read the plan
     - the wording of the question and each option
     - which option is the default
2. Pick `tests-after`. Let the init finish.
   - [ ] The rest of the init output reads as it did before this change

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before you move to Scenario 2.

```sh
rm -rf .dev/qa242-manual
```

## Scenario 2: A fresh `tdd` project

**Setup.** Run once, for every case in this scenario.

```sh
node packages/cli/dist/index.js init .dev/qa242-tdd --testing=tdd --no-install --no-git </dev/null
```

- [ ] Setup complete

### TC-2.1: The agent guidance reads well  ·  🟡 Normal

**Goal.** An agent in a generated project gets short, correct guidance on which test to write and in which order.

**Steps**

1. Open `.dev/qa242-tdd/AGENTS.md` and read the "Testing Instructions" section.
   - [ ] The marked testing block and the text around it read as one section, and they do not repeat or contradict each other
2. Open `.dev/qa242-tdd/.agents/skills/saasaloy-testing/SKILL.md`.
   - [ ] The skill is short enough to use, and each kind of change maps to one test you would agree with
     - the route test's four cases (success, 401, 403, 400)
     - the contract suite marked as not shipped yet
     - the journey spec gated on `e2e`
3. Open `docs/adr/0053-adr-one-testing-mode-in-saasaloy-json-and-a-marked-agents-md-block-2026-10-23.md` and `docs/adr/0054-adr-when-gates-optional-entries-and-feature-modules-own-their-journeys-2026-10-23.md`.
   - [ ] The two ADRs record the decisions you grilled, with nothing invented

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
rm -rf .dev/qa242-tdd
```

## Automated verification (by AI agent)

_Updated 2026-10-24 · after a rebase onto `main` and a review fix round, the gate ran again at `eff9a71`: build, lint, typecheck, test and `verify:content` exit 0, and `test:e2e` gives 49 passed and the same 4 pre-existing failures. The results below come from the first run at `7e18318`._
_Checks the agent ran itself at `7e18318` (clean tree). No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm --filter saasaloy build && pnpm lint && pnpm typecheck && pnpm test
```

```sh
pnpm verify:content
```

```sh
pnpm --filter saasaloy test:e2e
```

- ✅ build, lint, typecheck and test → each exits 0 (C27).
- ✅ `pnpm verify:content` → exit 0 (C26).
- ✅ `test:e2e` `test/e2e/testing.test.ts` → 5 of 5 pass: add `auth` with testing off finds no `auth.test.ts`, `testing tests-after` writes it, `testing off` then `update` keeps it, an `enablesTesting` fixture module sets `tests-after` and writes `auth.test.ts`, and removing the module a `when.installed` entry names deletes the gated file (C20, C21, C22).
- ❌ `test:e2e` → 4 older cases fail: `apply.test.ts` (`--diff` and `--dry-run` leave the project as it was; writes `.dev.vars.example`) and `partial-apply.test.ts` (tracks exactly the files that landed). The same 4 cases fail on `main` at `186d42d` (4 failed, 44 passed), so they are pre-existing and not caused by this branch. `test:e2e` is not part of `pnpm test`.
- ✅ The Vitest suite covers C1, C2, C4 to C9 and C11 to C18 (`lib/testing.test.ts`, `commands/testing.test.ts`, `commands/init.test.ts`, `lib/scaffold.test.ts`, `lib/base.test.ts`, `commands/update.test.ts`, `lib/when.test.ts`, `lib/applier.test.ts`, `lib/backfill.test.ts`, `lib/remover.test.ts`, `lib/manifest.test.ts`, `lib/schema.test.ts`, `lib/doctor.test.ts`, `commands/add.test.ts`), inside the green `pnpm test`.

### Built CLI on `.dev/` (the declared scratch directory), real `modules/`

```sh
SAASALOY_REGISTRY_DIR=$PWD/modules node packages/cli/dist/index.js init .dev/qa242 --testing=tdd --no-install --no-git </dev/null
```

- ✅ `init --testing=tdd` → `saasaloy.json` holds `"testing": {"mode": "tdd"}`, and the `AGENTS.md` block holds the four-step `tdd` loop (C2, C6).
- ✅ The same init → `.agents/skills/saasaloy-testing/SKILL.md` exists, and `.claude/skills/saasaloy-testing` links to it (C23).
- ✅ `saasaloy testing` → prints `tdd`; `saasaloy testing bogus` → exit 2; `saasaloy testing off` → exit 0, then `saasaloy testing` prints `off` and the block holds the `off` text (C4, C5).
- ✅ `init` with no flag and no terminal → `"mode": "off"`; `init --testing=bogus` → exit 2 and no directory written (C2).
- ✅ On an `off` project, `add database-d1 --yes` then `add auth --yes` → `apps/api/src/routes/` holds `auth.ts`, `health-db.ts`, `health.ts` and no test file (C12, C20).
- ✅ `saasaloy testing tests-after` → backfills `health-db.test.ts`, `completeness.test.ts`, `dump.test.ts` and `auth.test.ts`; the manifest records `auth.test.ts` with `"when": {"testing": true}` (C13, C14, A1).
- ✅ `saasaloy testing off` then `update --yes --force` → `auth.test.ts` is still on disk, and no test file is in the merge list (C17, C20). `update` exits 3 for drift in patched `logger`, `api` and `database` files under a local install, which is the existing no-merge-base behaviour and names no test file.
- ✅ With the `testing` key removed, `update --dry-run` prints "This project holds module tests and no testing mode in saasaloy.json — run saasaloy testing tests-after to turn module tests on." With the key present, it prints no such line (C9).
- ✅ `doctor modules` → "No problems found." on the real registry; on `packages/cli/test/fixtures/registry-broken` it names `when.installed` "ghost" and "phantom" as unknown modules and `when.testing` false as invalid (C18).
- ✅ ADR 0053 and ADR 0054 exist; ADR 0007 carries "Amended by ADR 0053" and ADR 0051 carries "Amended by ADR 0054" (C10, C19).
- ✅ The template `AGENTS.md` "Testing Instructions" section names the `saasaloy-testing` skill (C25).

The agent removed `.dev/qa242` and `.dev/qa242b` after the run.

### Browser checks
_No browser checks. The change has no UI._

## Not covered / needs human judgment
- Remote registry reads: backfill at a locked SHA from GitHub (`RemoteRegistrySource`) is covered by unit tests only. No run fetched a real tarball.
- Concurrency and performance: not relevant to a local CLI command beyond one extra module read per `add`.
- Accessibility, compatibility, browser: no UI in this change.
- The `e2e` module does not declare `enablesTesting` yet. Issue #245 sets it, so `add e2e` does not turn testing on today.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
