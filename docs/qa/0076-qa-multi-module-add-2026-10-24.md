# QA Plan: Several modules in one `saasaloy add` run

_Generated 2026-10-24 · against `76697e90` (clean) · covers issue #233: `saasaloy add <module>...`, the multi-select picker, `--with` across the set, and the `--dry-run --json` `requested` array_

## Summary
- `saasaloy add` takes several module names, resolves them into one graph, prints one plan, and asks once.
- Working means every refusal runs on the whole set before the first write, and one name prints what it printed before.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-233-add-several-modules-in-one-add-run` at `76697e90`.
- A real terminal (TTY). The picker does not open without one.
- No credentials. The CLI reads modules from this checkout's `modules/`.

Build the CLI and scaffold the playground:

```sh
pnpm play:init
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh playground, nothing added | Pick two modules in the multi-select | 🟡 Normal |
| TC-1.2 | 1: Fresh playground, nothing added | Read the messages of a set run | 🟢 Low |

## Scenario 1: Fresh playground, nothing added

**Setup.** Run once, for every case in this scenario.

```sh
cd .dev/playground
```

- [ ] Setup complete

### TC-1.1: Pick two modules in the multi-select  ·  🟡 Normal

**Goal.** Bare `add` in a terminal lets a person pick several modules and install them in one run.

**Steps**

1. Run the picker.

   ```sh
   ./saasaloy add
   ```

   - [ ] A multi-select opens and lists only modules that are not installed
     - space toggles a module; enter submits
     - enter with nothing selected does not submit
2. Select `waitlist` and `teams`. Press enter.
   - [ ] The prompt for the `database` driver opens once, not once per module
3. Pick `database-d1`. Answer `y` at `Proceed?`.
   - [ ] One plan prints, and the closing line names both `waitlist` and `teams`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Read the messages of a set run  ·  🟢 Low

**Goal.** The new messages read clearly to a person who names several modules.

**Steps**

1. Run a conflicting pair.

   ```sh
   ./saasaloy add database-d1 database-postgres --yes
   ```

   - [ ] The conflict message is clear about which two modules conflict and what to do
2. Run a set with one installed module.

   ```sh
   ./saasaloy add teams admin --yes
   ```

   - [ ] The skip note for `teams` and the "Dependencies" box read clearly
     - the "Dependencies" box shows one `<root> requires:` line for each named module that pulled something in

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Target: `.dev/playground`, scaffolded with `node packages/cli/dist/index.js init playground --no-install --no-git` plus a `git init` baseline commit, and reset with `pnpm play:destroy` after the checks. The CLI ran as `node packages/cli/dist/index.js` with `SAASALOY_REGISTRY_DIR` set to this checkout's `modules/`, stdin closed (no TTY), at `76697e90`.

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm --filter saasaloy test
```

```sh
pnpm lint
```

```sh
pnpm --filter saasaloy typecheck
```

```sh
pnpm --filter saasaloy build && pnpm --filter saasaloy test:e2e
```

```sh
saasaloy add waitlist nosuch other --dry-run
```

```sh
saasaloy add database-d1 database-postgres --yes
```

```sh
saasaloy add waitlist teams --dry-run --json
```

```sh
saasaloy add waitlist teams --with database-d1 --dry-run --json
```

```sh
saasaloy add
```

```sh
saasaloy add waitlist acme/kit/teams --dry-run
```

```sh
saasaloy add --help
```

```sh
saasaloy add admin teams --with database-d1 --yes
```

```sh
saasaloy add admin teams --yes
```

```sh
saasaloy add teams waitlist --yes
```

```sh
saasaloy add admin teams --force --dry-run
```

- ✅ C1 · `pnpm --filter saasaloy test` → 70 files, 1812 tests passed. `add — parseArgs` "keeps every positional as a name (#233)" and "still reports every unknown flag beside several names" pass.
- ✅ C2 · `add waitlist acme/kit/teams --dry-run` → exit 2, `Cannot add modules from two sources in one run — "waitlist" reads mimukit/saasaloy and "acme/kit/teams" reads acme/kit. Add them in separate runs.`
- ✅ C3 · `resolveGraphs — several named roots` (7 tests) pass: prerequisites first, argv order between roots, `rootOf` names the first root, a repeated name is read once.
- ✅ C4 · `add waitlist nosuch other --dry-run` → exit 2, `Unknown modules "nosuch", "other" — the registry has no descriptor for any of them. Nothing was written.`
- ✅ C5 · `requested — naming what the user typed` and the existing one-name formatter tests pass; one name prints `database (required by waitlist)` as before.
- ✅ C6 · `add teams waitlist --yes` after `teams` is installed → exit 0, `teams is already installed — skipped (pass --force to re-apply it).`, then `Applied validators, waitlist (12 files)`.
- ✅ C7 · `add — pinToLock` "refuses two forced modules pinned to different commits" passes with the exact message `Cannot re-apply admin (9f3a1c2) and teams (b81e04d) together, they are pinned to different commits. Re-apply them in separate runs, or pass @<ref>.`
- ✅ C8 · `add admin teams --with database-d1 --yes` → exit 0, `Applied logger, logger-console, api, database, auth, shell, admin, teams, database-d1 (181 files)`, and `saasaloy.json` lists all nine. The issue's command has no `--with`: in a fresh project it exits 2 with the unmet `database` requirement, as one `add admin --yes` does.
- ✅ C9 · `add admin teams --yes` again → exit 0, `Nothing to do`.
- ✅ C10 · `add database-d1 database-postgres --yes` → exit 2, `Cannot add database-d1 and database-postgres — module conflict:`. `git status --short` printed 0 lines before and 0 after.
- ✅ C11 (no TTY) · bare `add` with stdin closed → exit 2, `No module named and no terminal to pick one in — usage: …`. The prompt guard test "refuses a multiselect, naming the flag (#233)" passes.
- ✅ C12 · `add admin teams --with database-d1 --yes` answers the one `database` choice that both roots reach; unit test "answers one requiresOneOf choice for every module in the set with --with" passes.
- ✅ C13 · `add waitlist teams --with database-d1 --dry-run --json` → exit 0, `schemaVersion` 2, `requested` `["waitlist","teams"]`. Without `--with` in a fresh project → exit 2 with an error document at `schemaVersion` 2 that names `--with database-d1`.
- ✅ C14 · `add --help` → the usage line reads `saasaloy add [<module>...|<owner/repo[@ref]/module>...|<owner/repo>] …`; `docs/wiki/reference.md` and `docs/wiki/how-to/add-a-module.md` show several names (commit `76697e90`).
- ✅ C15 · `test/e2e/multi-add.test.ts` (4 cases) and `test/e2e/json-output.test.ts` → 11 passed.
- ✅ `add admin teams --force --dry-run` → `will install: admin → teams`, prerequisites listed under "already installed (skipped)".
- ✅ `pnpm lint` → exit 0. `pnpm --filter saasaloy typecheck` → exit 0.
- ❌ `pnpm --filter saasaloy test:e2e` → exit 1, 4 failed of 70: `apply.test.ts` "--dry-run leaves the project exactly as it was" and "--diff leaves the project exactly as it was" (`.saasaloy` exists after a preview), "writes the env vars the module declared into .dev.vars.example" (ENOENT `apps/api/.dev.vars.example`), and `partial-apply.test.ts` "tracks exactly the files that landed" (manifest also lists 133 base-template files). None of these tests names several modules. The run claims they fail on `main` too; the acceptance check verifies that claim.

## Not covered / needs human judgment
- Interactive prompts: the multi-select and the driver prompt need a real terminal (TC-1.1).
- Message wording: whether the new set messages read well (TC-1.2).
- A remote registry: every agent run used `SAASALOY_REGISTRY_DIR`, which turns lock pinning off. The pin split is covered by a unit test only.
- Browser, accessibility, compatibility: the change is CLI-only, with no page.
- Database: the change touches no schema, migration or query.
- Concurrency and performance: one CLI process per run; no new network calls.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
