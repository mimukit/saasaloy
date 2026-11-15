# QA Plan: `saasaloy update` survives skipped releases and local deletions

_Generated 2026-11-05 · against `607799eb` (clean) · covers issue #312, plan `docs/plans/0103-plan-update-skipped-releases-2026-11-04.md`_

## Summary
- `saasaloy update` adds missing aliases, plans a shared prerequisite once, merges the base three-way, and keeps a deleted file deleted.
- "Working" means an owner can read the merge plan, settle each deleted file with one command, and trust what `doctor` reports.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-312-make-update-survive-skipped-releases` at `607799eb`.
- Run every `saasaloy` command against a copy in this repo's `.dev` directory, never in `/home/dev/projects/primeshopr`.
- `GITHUB_TOKEN` must be set. The base snapshot and the modules come from GitHub.
- Screenshots: none. This change has no UI.

Build the CLI from the repo root:

```sh
pnpm build
```

Copy PrimeShopr into `.dev` without its build output:

```sh
mkdir -p .dev/qa-312/primeshopr && tar -C /home/dev/projects/primeshopr --exclude=node_modules --exclude=.git --exclude=.turbo --exclude=dist --exclude=.wrangler --exclude=.astro --exclude=coverage --exclude=.saasaloy/backups -cf - . | tar -C .dev/qa-312/primeshopr -xf -
```

Go to the copy:

```sh
cd .dev/qa-312/primeshopr
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: PrimeShopr copy, five demo blocks deleted, no tombstones | The merge plan explains each deleted block | 🔴 Critical |
| TC-1.2 | 1: PrimeShopr copy, five demo blocks deleted, no tombstones | The three-way base diffs make sense | 🟡 Normal |
| TC-2.1 | 2: PrimeShopr copy, five demo blocks kept deleted | `doctor` and the refusal read clearly | 🟡 Normal |
| TC-3.1 | 3: No project needed | The update skill recipe reads correctly | 🟢 Low |

## Scenario 1: PrimeShopr copy, five demo blocks deleted, no tombstones

**Setup.** Run once, for every case in this scenario.

1. Write the merge plan to a file. The dry run writes nothing to the project.

```sh
node ../../../packages/cli/dist/index.js update --dry-run --force > ../plan-dry.txt 2>&1
```

- [ ] Setup complete

### TC-1.1: The merge plan explains each deleted block  ·  🔴 Critical

**Goal.** An owner who reads only the merge plan knows how to keep or restore each deleted block.

**Steps**

1. Open `.dev/qa-312/plan-dry.txt`. Read the `## base` section, from the five `deleted locally` items to the next `####` heading.
   - [ ] Each deleted-block item says what happened and gives the right next command
     - the item names the template source path
     - "Keep it deleted" gives `saasaloy update --resolved <path>`
     - "Bring it back" says to run `--resolved` first, then `--restore`
2. Read the Plan box at the top of the same file.
   - [ ] The five `deleted locally → merge` lines read as work for the owner, not as an error

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The three-way base diffs make sense  ·  🟡 Normal

**Goal.** The base diffs for `AGENTS.md` and `globals.css` show the template change and the PrimeShopr change apart.

**Steps**

1. In `.dev/qa-312/plan-dry.txt`, find the `AGENTS.md` and `packages/ui/src/styles/globals.css` items in the `## base` section.
   - [ ] The `base → theirs` diff shows only template changes, and the `base → mine` diff shows only PrimeShopr changes
     - compare with the PrimeShopr history for these two files if you are not sure
     - the section has no `no merge base` line

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The dry run wrote nothing to the copy.

## Scenario 2: PrimeShopr copy, five demo blocks kept deleted

**Setup.** Run once, for every case in this scenario. This writes tombstones in the copy only.

1. Keep the five blocks deleted. The run exits `3`, because `AGENTS.md` and `globals.css` still wait on a merge.

```sh
node ../../../packages/cli/dist/index.js update base --force --yes --resolved packages/ui/src/blocks/audience.tsx --resolved packages/ui/src/blocks/logo-cloud.tsx --resolved packages/ui/src/blocks/pain-points.tsx --resolved packages/ui/src/blocks/pricing-table.tsx --resolved packages/ui/src/blocks/showcase.tsx
```

- [ ] Setup complete

### TC-2.1: `doctor` and the refusal read clearly  ·  🟡 Normal

**Goal.** An owner understands which files are kept deleted, and why `--restore` refuses a file that is not.

**Steps**

1. Run `doctor`.

   ```sh
   node ../../../packages/cli/dist/index.js doctor
   ```

   - [ ] The "Kept deleted (5)" box reads as information, not as a fault, and each line is legible at your terminal width
2. Ask `--restore` for a file that is not kept deleted.

   ```sh
   node ../../../packages/cli/dist/index.js update base --force --yes --restore packages/ui/src/blocks/faq.tsx
   ```

   - [ ] The refusal message tells you what to do next

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before Scenario 3. Run it from the repo root.

```sh
rm -rf .dev/qa-312
```

## Scenario 3: No project needed

**Setup.** None.

### TC-3.1: The update skill recipe reads correctly  ·  🟢 Low

**Goal.** An agent that holds only the `saasaloy-update` skill can run an update that skips releases.

**Steps**

1. Read the sections on a file deleted locally, the base section header, and an update that skips releases in `packages/cli/templates/base/_agents/skills/saasaloy-update/SKILL.md`.
   - [ ] The steps are in a correct order, and no step repeats an update note
   - [ ] The text uses one term per thing: "deleted locally", "kept deleted", "tombstone"

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm build
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
node scripts/release-smoke.ts --skipped-only
```

```sh
node packages/cli/dist/index.js update --dry-run --force
```

```sh
node packages/cli/dist/index.js update base --force --yes --resolved packages/ui/src/blocks/audience.tsx --resolved packages/ui/src/blocks/logo-cloud.tsx --resolved packages/ui/src/blocks/pain-points.tsx --resolved packages/ui/src/blocks/pricing-table.tsx --resolved packages/ui/src/blocks/showcase.tsx
```

```sh
node packages/cli/dist/index.js update base --force --yes --restore packages/ui/src/blocks/faq.tsx
```

```sh
node packages/cli/dist/index.js doctor
```

```sh
node packages/cli/dist/index.js update base --force --yes --restore packages/ui/src/blocks/showcase.tsx
```

The last six ran inside a copy of PrimeShopr at `21139b8` in `.dev/qa-312/primeshopr`, deleted after the run.

- ✅ `pnpm build`, `pnpm lint`, `pnpm typecheck` → exit 0 at `607799eb`.
- ✅ `pnpm test` → exit 0: CLI 75 files, 2009 tests; node runs 1021, 91, 147 and 542 pass, 0 fail.
- ✅ `pnpm test`, first run → `no-tty.test.ts` failed with `Assertion failed: (0) == (uv_thread_create(...))`. The container `pids.max` is 1024, and other worktrees used 665 to 876. The file passed alone (40 of 40), and the second full run passed.
- ✅ Smoke from `saasaloy@0.5.0` → exit 0: no `Unknown alias`; `faq.tsx` listed as deleted locally; base section three-way with no `no merge base` line; `faq.tsx` still absent after `--resolved` (35 s).
- ✅ PrimeShopr dry run → no `Unknown alias`; base plan is 2 drift (`AGENTS.md`, `globals.css`), 5 `deleted locally`, 120 files up to date; 7 `base → theirs` diffs; no `no merge base` line.
- ✅ PrimeShopr `--resolved` on the five blocks → exit 3 (two merges still wait); each manifest entry holds `"deleted": true`; the next dry run lists only the two drift files.
- ✅ `--restore faq.tsx` → exit 2: "`--restore` names packages/ui/src/blocks/faq.tsx, which is not a file kept deleted. … Nothing was written."; manifest byte-equal before and after.
- ✅ `doctor` → exit 0; "Kept deleted (5)" with one `ℹ … deleted, kept deleted (base)` line per block.
- ✅ `--restore showcase.tsx` → `showcase.tsx` written (185 lines); the manifest entry has no `deleted` field.
- ✅ `update --help` → lists `--restore <path>`; `--abort` reads "put back the files the last update replaced".

## Not covered / needs human judgment
- A real `update` applied to PrimeShopr's own repo. The owner runs it there; this plan uses a copy.
- A shared prerequisite planned once with real registry modules. No two current modules add the same new prerequisite, so the unit test in `commands/update.test.ts` covers it.
- `templateVersion` on a re-run after a waiting base merge. The unit tests in `base.test.ts` and `commands/update.test.ts` cover it; the smoke does not re-run the update.
- The `auth` module diff of `scoped-adapter.ts` prints two-way. That module revision did not ship the file. This is existing module behaviour, outside #312.
- Compatibility, accessibility, concurrency and performance: the change is a CLI with no UI, no server and one GitHub request per base update.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
