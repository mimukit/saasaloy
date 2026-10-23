# QA Plan: an agent drives every CLI command with no TTY

_Generated 2026-10-23 · against `eecc9a8` (clean), gate re-run after the rebase onto `main` at `c404949` · covers issue #223: the no-TTY guard, the answering flags, `--json` output and module metadata_

## Summary
- Every `saasaloy` command now runs with no terminal: a prompt either has a flag that answers it, or the command exits 2 and names that flag.
- "Working" means an agent builds a project with flags only, reads module data as JSON, and no command waits on stdin.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-223-let-an-agent-drive-every-command-with-no-tty`, at `eecc9a8` or later.
- The CLI under test is the local build in `packages/cli/dist/`.
- The registry is this repo's `modules/`, set through `SAASALOY_REGISTRY_DIR`.
- All scratch projects go under `.dev/qa223/`, as `AGENTS.md` requires.

Build the CLI:

```sh
pnpm --filter saasaloy build
```

Set the shell for every later command:

```sh
export SAASALOY_REGISTRY_DIR="$PWD/modules" && alias saasaloy="node $PWD/packages/cli/dist/index.js" && mkdir -p .dev/qa223 && cd .dev/qa223
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Interactive terminal, empty folder | The prompts still work on a real terminal | 🔴 Critical |
| TC-1.2 | 1: Interactive terminal, empty folder | The refusal messages read clearly | 🟡 Normal |
| TC-2.1 | 2: Fresh project with modules added | The `--json` documents are useful to an agent | 🟡 Normal |
| TC-2.2 | 2: Fresh project with modules added | The stage and needs values fit each module | 🟡 Normal |

## Scenario 1: Interactive terminal, empty folder

**Setup.** Run once, for every case in this scenario. Use a real terminal, not a pipe.

1. Make an empty folder and go into it.

```sh
mkdir -p tty && cd tty
```

- [ ] Setup complete

### TC-1.1: The prompts still work on a real terminal  ·  🔴 Critical

**Goal.** The guard refuses only when no terminal exists, so a person at a terminal still gets every prompt.

**Steps**

1. Run `init` with no name.

   ```sh
   saasaloy init
   ```

   - [ ] The CLI asks for the project name. Type `demo`.
   - [ ] The CLI asks "Install dependencies now?". Pick "No, I'll run it later".
2. Go into the project and add a module that needs a driver.

   ```sh
   cd demo && saasaloy add waitlist
   ```

   - [ ] The CLI asks you to pick a database driver. Pick `database-d1`.
   - [ ] The CLI asks "Proceed?". Answer yes, and the module installs.
3. Run `env` with no flags.

   ```sh
   saasaloy env
   ```

   - [ ] The CLI asks for each unset variable, with the module's own description. Press Ctrl-C at the first prompt.
     - the command exits with code 1 (`echo $?` prints `1`)

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The refusal messages read clearly  ·  🟡 Normal

**Goal.** Each no-TTY refusal tells an agent or a person the exact flag to add.

**Steps**

1. Read the refusals the agent captured in `/tmp/afk223qa/checks1.out` and `/tmp/afk223qa/checks2.out`.
   - [ ] Each refusal names the flag that answers the prompt, and the sentence is clear on first read
     - `init` with no name: names `<name>`
     - `init demo` with no install flag: names `--yes` and `--no-install`
     - `add waitlist --yes`: names `--with database-d1`
     - `remove` with no `--yes`: names `--yes` and `--dry-run`
     - `env --set NOT_A_KEY=1`: names the unknown key

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd .. && cd .. && rm -rf tty
```

## Scenario 2: Fresh project with modules added

**Setup.** Run once, for every case in this scenario.

1. Make a project with flags only.

```sh
saasaloy init qa --no-install --no-git </dev/null && cd qa && saasaloy add waitlist --with database-d1 --yes </dev/null
```

- [ ] Setup complete

### TC-2.1: The `--json` documents are useful to an agent  ·  🟡 Normal

**Goal.** An agent can pick a module and plan an install from the JSON alone.

**Steps**

1. Print the module list as JSON.

   ```sh
   saasaloy list --json 2>/dev/null | node -e 'process.stdin.pipe(process.stdout)' | head -c 3000
   ```

   - [ ] The fields and their names make sense to a reader who never saw the TUI
2. Print an add plan as JSON.

   ```sh
   saasaloy add auth --dry-run --json 2>/dev/null | head -c 3000
   ```

   - [ ] The plan says what the install writes, in a shape an agent can act on

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The stage and needs values fit each module  ·  🟡 Normal

**Goal.** The `stage` and `needs` values on the 44 descriptors match how the owner sees each module.

**Steps**

1. Print each module's stage and needs.

   ```sh
   saasaloy list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{for(const m of JSON.parse(s).modules)console.log(m.stage.padEnd(9),m.name.padEnd(20),m.needs.join(","))})'
   ```

   - [ ] Each module sits at the stage you expect, and each `needs` list is complete
     - the agent assigned these by a rule; the rule is in the PR body under Assumptions

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd .. && rm -rf qa
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm typecheck
```

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
pnpm --filter saasaloy test:e2e
```

```sh
bash /tmp/afk223qa/checks1.sh
```

```sh
bash /tmp/afk223qa/checks2.sh
```

```sh
bash /tmp/afk223qa/checks3.sh
```

All results below ran at `eecc9a8` with a clean tree. The scripts run the built CLI in `.dev/qa223/` with stdin from `/dev/null` and stdout to a file, so no command has a TTY.

- ✅ After the rebase onto `origin/main` (29 new commits, including the config capability), the gate ran again at `c404949`: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm --filter saasaloy build` exit 0; `pnpm --filter saasaloy test:e2e` fails only the same 4 tests; `doctor modules` → exit 0, "No problems found." The behaviour scripts below ran at `eecc9a8`. In `packages/cli/src/commands/`, `main` changed only `doctor.ts` (two dropped doctor checks), and `doctor modules` above re-ran on it.
- ✅ `pnpm typecheck` → exit 0
- ✅ `pnpm lint` → exit 0
- ✅ `pnpm test` → exit 0; the CLI suite passes 64 of 64 files, including `src/commands/no-tty.test.ts`, which runs every registered command with stdin closed and with a silent pipe under a timeout (C4)
- ✅ `pnpm --filter saasaloy build` → exit 0
- ❌ `pnpm --filter saasaloy test:e2e` → exit 1, 4 failed and 57 passed. The 4 failures also fail on base `e3501d6`: `apply.test.ts` (`--dry-run`, `--diff`, `.dev.vars.example`) and `partial-apply.test.ts` ("tracks exactly the files that landed"). The new `agent-flags.test.ts` and `json-output.test.ts` pass (C9). The acceptance check verifies the base claim.
- ✅ C1 · every `select`, `confirm` and `text` in `src/commands/` comes from `lib/prompts.ts`; `src/lib/prompts.test.ts` fails on any other prompt import from `@clack/prompts`
- ✅ C5 · `saasaloy init </dev/null` → exit 2, "No project name and no terminal to ask for one — pass `<name>`", nothing written
- ✅ C2 · `init p </dev/null` → exit 2, names `--yes` and `--no-install`, nothing written; `init p --yes --no-install` → exit 2; `init p2 --yes` with a fake `pnpm` that exits 1 → exit 1, pnpm's output shown
- ✅ C3 · the cancel paths in `env.ts` and `new.ts` return `EXIT_FAILURE` (code read; a cancel needs a real TTY, so TC-1.1 checks it by hand)
- ✅ C6 · `add waitlist --yes` → exit 2, names `--with database-d1`; `add waitlist --with database-d1 --yes` → exit 0; `add auth`, `admin`, `email`, `email-console` with `--yes` → exit 0 each; `saasaloy.json` lists all 11 modules
- ✅ C7 · `env --set NOT_A_KEY=1` → exit 2, no `.env` written; `env --from-file` → exit 0, writes `PUBLIC_API_URL` and `BETTER_AUTH_SECRET`; `env --set BETTER_AUTH_SECRET=from-set` → exit 0, replaces the value; `env --from-file` with `BOGUS=1` → exit 2, `.env` unchanged
- ✅ C8 · with an upstream change and a local edit to `apps/api/src/routes/waitlist.ts`: `update waitlist --yes` → exit 3, the merge plan prints the `--resolved` command; after a hand merge, `update waitlist --resolved apps/api/src/routes/waitlist.ts --yes` → exit 0; the next `update waitlist --yes` → exit 0, "Already up to date.", merged file byte-identical; `--resolved saasaloy.json` → exit 2, "does not send to a merge"
- ✅ C10 · `docs/wiki/reference.md` documents `env` (`packages/env/.env`, `--check`, `--set`, `--from-file`, exit codes), the commands that read `GITHUB_TOKEN`, `add --with`, `update --resolved`, `init --yes` and a "JSON output" section (read from the diff)
- ✅ C11 · `doctor modules` → exit 0, "No problems found." over 44 modules; `doctor` on fixture `registry-broken/no-description` → exit 2 with a `description` finding
- ✅ C12 · `env --check --json` → exit 2 with a `schemaVersion: 1` report (unset keys); `env --json` without `--check` → exit 2; `doctor --json` → exit 0, `schemaVersion: 1`; `outdated --json` → exit 0, `schemaVersion: 1`
- ✅ C13 · `list --json` → exit 0, 44 modules, none missing `description`, `stage` or `needs`; `waitlist` carries `tier`, `stage`, `needs`, `dependsOn`, `requiresOneOf`, `conflictsWith`, `envVars`, `skill: saasaloy-waitlist`, `installed: true`
- ✅ C14 · `list --installed --json` → 11 modules, all `installed: true`; `list --installed` → exit 0, installed rows only
- ✅ C15 · on a fresh project, `add waitlist --with database-d1 --dry-run --json` → exit 0, 67 files and 33 patches; every file target and applied patch file appears in the human plan, which also lists 67 file lines; nothing written
- ✅ C16 · `packages/cli/templates/base/AGENTS.md` has a "Find the right skill" section that names `saasaloy list --installed --json` and `.agents/skills/` (read from the diff)
- ✅ C17 · ADR 0046 was re-read against the build; one sentence was amended in place
- ✅ `new module demo --type saasaloy:feature </dev/null` → exit 2 (no `--depends-on`); with `--depends-on=` → exit 0, the descriptor carries a `TODO` description, `stage: "mvp"`, `needs: []`

### Browser checks
_No browser checks: the change is CLI-only and has no page._

## Not covered / needs human judgment
- The interactive prompts on a real terminal: a test process has no TTY, so TC-1.1 checks them.
- The wording of the refusals and the JSON field names: TC-1.2 and TC-2.1.
- The stage and needs assignment for each module: TC-2.2.
- A remote registry: every check used the local `modules/` folder. `list --json` reads one descriptor per module, so a remote run costs one fetch each.
- Security, concurrency, accessibility and compatibility: the change adds no endpoint, no shared state and no UI.
- Performance: not measured beyond the 20 s timeout in the closed-stdin test.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
