# QA Plan: The render and merge engine

_Generated 2026-11-20 · against `162347d0` (clean, rebased onto `origin/main` `4286d6da`) · covers issue #365, Phases 1 to 7 of plan 0116_

## Summary
- `init`, `add`, `remove` and `update` run through one render and a three-way merge, and the registration tables are generated files.
- Working means: every edit has an undo, an update leaves conflict markers in place of a merge plan, and the PrimeShopr 0.8.0 replay leaves at most 45 files for an agent.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-365-replace-the-add-update-and-remove-engines-with-one` at `162347d0`.
- The CLI runs from the branch build. No base URL and no credentials are necessary.
- The PrimeShopr checkout is at `/home/dev/projects/primeshopr`. Do not change it.
- Screenshots: none. This change has no UI.

Build the CLI with:

```sh
pnpm install && pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: The branch build and the PrimeShopr checkout | The conflicts the table move leaves are fair work for an agent | 🔴 Critical |
| TC-2.1 | 2: The branch source | The Better Auth plugin order is safe | 🔴 Critical |
| TC-2.2 | 2: The branch source | The ADRs and update notes read correctly for an owner and an agent | 🟡 Normal |

## Scenario 1: The branch build and the PrimeShopr checkout

**Setup.** Run once, for every case in this scenario. The replay script copies the project into a temporary folder and writes nothing to the PrimeShopr repository.

1. Confirm that the PrimeShopr checkout is at its head and clean.

```sh
git -C /home/dev/projects/primeshopr status --short && git -C /home/dev/projects/primeshopr log --oneline -1
```

- [ ] Setup complete

### TC-1.1: The conflicts the table move leaves are fair work for an agent  ·  🔴 Critical

**Goal.** The update from PrimeShopr's head to this branch leaves conflicts that an agent can resolve with the update notes.

**Steps**

1. Replay the update from PrimeShopr's head to this checkout.

   ```sh
   node scripts/replay-update.ts /home/dev/projects/primeshopr 161af2e0 --to-local
   ```

   - [ ] The count of files that need an agent, and the table files the list marks, are an amount of work you accept for the first update
     - the agent measured 118 files, 525 conflict hunks, and 20 table files with 46 hunks
     - most hunks come from upstream changes between 0.8.0 and this branch, not from the table move
2. Read update notes 0007 and 0008 with that list in front of you.

   ```sh
   cat packages/cli/update-notes/0007-render-and-merge-engine.md packages/cli/update-notes/0008-generated-tables.md
   ```

   - [ ] The notes tell an agent enough to resolve a table-file conflict without guessing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The script removes its temporary folder.

## Scenario 2: The branch source

**Setup.** Run once, for every case in this scenario.

1. Open the worktree at the commit under test.

```sh
cd /home/dev/worktrees/saasaloy/issue-365-replace-the-add-update-and-remove-engines-with-one && git log --oneline -1
```

- [ ] Setup complete

### TC-2.1: The Better Auth plugin order is safe  ·  🔴 Critical

**Goal.** The new sort order of the generated plugin arrays does not change auth behavior.

**Steps**

1. List the old order. The old engine wrote it into each project in install order, so read it from PrimeShopr.

   ```sh
   git -C /home/dev/projects/primeshopr show 161af2e0:packages/auth/src/auth.ts | grep -n -A20 '^  plugins: \['
   ```

2. List the new order. On the branch the generated rows sort by `order`, then module name.

   ```sh
   jq -r '.name as $m | .entries[]? | select(.table=="auth.plugins") | "\(.order // 1000) \($m) \(.call)"' modules/*/registry-item.json | sort -k1,1n -k2,2
   ```

   - [ ] `audience()` stays first, and no plugin depends on a plugin that now comes after it
     - hooks that read a session or an organization run after the plugin that sets it
     - the admin auth instance keeps the same guards as before

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The ADRs and update notes read correctly for an owner and an agent  ·  🟡 Normal

**Goal.** The decision records and the update notes say what the engine does.

**Steps**

1. Read ADRs 0066, 0067 and 0068, and update notes 0007 and 0008.

   ```sh
   ls docs/adr/0066-* docs/adr/0067-* docs/adr/0068-* packages/cli/update-notes/0007-* packages/cli/update-notes/0008-*
   ```

   - [ ] Each document states the rule the code applies, in plain words
     - update note 0007 names the release order the conversion searches (the code tries the lock's release, then each release up to the running CLI, newest first)
     - the new `saasaloy-update` skill tells an agent how to resolve markers and when to run `update --merge <path>`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset.

## Automated verification (by AI agent)
_Checks the agent ran itself at `162347d0`, clean tree. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

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
pnpm --filter saasaloy build
```

```sh
pnpm --filter saasaloy test:e2e
```

```sh
pnpm --filter saasaloy test:matrix
```

```sh
pnpm docs:check
```

```sh
node scripts/replay-update.ts /home/dev/projects/primeshopr d9cc35fc
```

```sh
pnpm scaffold:check
```

```sh
pnpm release:smoke
```

- ✅ `pnpm lint` → exit 0: oxlint type-aware and plain, Stylelint and `prettier --check` all pass.
- ✅ `pnpm typecheck` → exit 0.
- ✅ `pnpm test` → exit 0: the turbo vitest suites and the module, base, tooling and script suites pass.
- ✅ `pnpm --filter saasaloy test:e2e` → 65 of 65 pass on the built CLI, including the clean-tree rule: `add` passes over an uncommitted new file and exits 2 when it must merge a file with uncommitted changes (C18).
- ✅ `pnpm --filter saasaloy test:matrix` → 1654 of 1654 pass: `add` then `remove` gives the starting tree byte for byte for each of the 57 modules, and both add orders give the same tree for each pair with no dependency edge (C14, C15, C31).
- ✅ `pnpm docs:check` → 61 generated pages are current.
- ✅ PrimeShopr replay at `d9cc35fc` → base found for 316 of 317 tracked files, 40 files need an agent (target at most 45), 141 conflict hunks (C20, C21, C32).
- ✅ `pnpm scaffold:check` → a fresh scaffold with 15 modules passes `pnpm check` (C25, C31).
- ✅ `pnpm release:smoke` → `saasaloy@0.10.0` packs and installs, 4 full projects pass lint, typecheck, test and build, and a 0.5.0 project updates with a base found for each file and a deleted block kept deleted (C25, C31).
- ✅ Table patches left in `modules/*/registry-item.json` (jq over the four table kinds) → 0 (C29).
- ✅ CLI source without tests (`packages/cli/src`, `*.test.ts` excluded) → 18,942 lines, below 24,807 (C27).
- ✅ ADRs 0066, 0067 and 0068 and update notes 0007 and 0008 exist (C28, C33).
- ✅ No PrimeShopr file is tracked. `git ls-files` names only the older plan `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, and two scripts name PrimeShopr in comments (C22).
- ✅ Old engine files, `--resolved`, `--from` and the `SAASALOY_ENGINE` flag are gone (C23, C24).
- ❌ The Phase 6 grep (`--resolved`, `merge plan`) finds one line: `docs/wiki/generated/adr.md:68`, the ADR index row that quotes the title of ADR 0058. The owner decides the fix (C26).
- ✅ Phase 1 result → both typed tables keep their types (comment on #365, 2026-11-20) (C1 to C4).
- Unit evidence for C5 to C13, C17 and C19 is in `packages/cli/src/engine/*.test.ts` and `packages/cli/src/commands/*.test.ts`, which `pnpm test` ran above. The Phase 2 parity test against the old engine ran in Phase 2 (commit `7f68cb8c` on this branch) and was deleted with the old engine in Phase 6.

## Not covered / needs human judgment
- A real `saasaloy update` of a version 1 project, with conflict markers to resolve by hand and `update --abort`. It needs the `v0.10.0` payload, which exists only after the release. Plan 0116 puts the PrimeShopr conversion after the merge. Unit and e2e tests cover the conversion, the markers, the refusals and `--abort` on fixtures.
- Network fetch of a release payload into the user cache. The tests use a fake fetcher and the local registry. A real fetch needs a published tag, and `v0.9.0` does not exist yet (#358).
- Performance of a render on a large project. No check measures it.
- One Phase 6 criterion is unmet: the plan's grep finds `docs/wiki/generated/adr.md:68`, the ADR index row that quotes the title of ADR 0058. The owner decides the fix.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
