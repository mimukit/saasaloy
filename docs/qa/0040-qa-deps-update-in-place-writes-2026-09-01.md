# QA Plan: `deps:update` in-place manifest writes

_Generated 2026-09-01 · against `5c4f96d` · covers the `deps:update` write path, its interactive report, and the `CONTRIBUTING.md` prose that explains it_

## Summary

- `deps:update` now changes a version with `jsonc-parser`'s `modify` + `applyEdits` over each manifest's own bytes, instead of reserializing the parsed document with `JSON.stringify`.
- Working means a bump is a one-line diff, a hand-authored descriptor keeps its compact arrays and its formatting, and the interactive report still reads correctly.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-93-let-deps-update-write-descriptor-patch-ranges` at `5c4f96d`.
- Repo root: `/home/dev/worktrees/saasaloy/issue-93-let-deps-update-write-descriptor-patch-ranges`. Run every command from there.
- Node and pnpm come from `mise`. No server, no credentials, no feature flags.
- The tool reads the npm registry, so the box needs network access.
- The working tree must be clean before you start. `git status --porcelain` must print nothing.
- Dependencies must already be installed. Do not run a build; this change is not on the build path.

Check the starting state with:

```sh
git status --porcelain && git rev-parse --short HEAD
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: clean tree, no bump due | The `CONTRIBUTING.md` paragraph explains the root pin | 🔴 Critical |
| TC-1.2 | 1: clean tree, no bump due | The interactive report renders and exits without a write | 🟡 Normal |
| TC-2.1 | 2: one range lowered by hand | The interactive pick writes one readable line | 🔴 Critical |
| TC-2.2 | 2: one range lowered by hand | `--dry-run` prints the step and writes nothing | 🟡 Normal |
| TC-3.1 | 3: cooldown lifted | A 17-bump diff stays reviewable across 11 files | 🔴 Critical |
| TC-3.2 | 3: cooldown lifted | The major group is a separate opt-in | 🟢 Low |

## Scenario 1: clean tree, no bump due

**Setup.** Run once, for every case in this scenario.

1. Confirm the tree is clean and no bump is due. The command must exit 0.

```sh
node scripts/update-deps.ts --check; echo "exit=$?"
```

- [ ] Setup complete

### TC-1.1: The `CONTRIBUTING.md` paragraph explains the root pin · 🔴 Critical

**Goal.** A contributor reads the new paragraph and understands why `jsonc-parser` is pinned twice.

**Steps**

1. Open `CONTRIBUTING.md` and read the `## Updating dependencies` section from line 227 to the end.

   ```sh
   sed -n '227,275p' CONTRIBUTING.md
   ```

   - [ ] The new paragraph at line 263 states the write is a text edit, not a reserialization
     - it names `jsonc-parser`'s `modify` + `applyEdits`
     - it names the old `JSON.stringify(json, null, 2)` behaviour and the compact arrays it broke
     - it cites issue #93
   - [ ] The paragraph gives the reason the pin sits in the **root** `devDependencies`
     - bare `node` with type stripping, no bundler, no build step
     - pnpm's isolated layout will not surface a `packages/cli` dependency at the root
     - it tells the reader to keep the two pins on the same version
   - [ ] The prose reads as a person wrote it, with no puffery and no em dash used as sentence punctuation
   - [ ] The paragraph fits its neighbours in the section, in tone and in line width

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The interactive report renders and exits without a write · 🟡 Normal

**Goal.** The interactive path still draws a correct report when nothing is due.

**Steps**

1. Start the tool with no flags, so it takes the interactive path.

   ```sh
   node scripts/update-deps.ts
   ```

   - [ ] The spinner and the scan finish without an error
   - [ ] The report states that nothing is due, and names the 3-day cooldown where it holds a bump back
   - [ ] The tool exits on its own, with no prompt left waiting for a key
2. Confirm nothing was written.

   ```sh
   git status --porcelain
   ```

   - [ ] The command prints nothing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. This scenario writes no file.

## Scenario 2: one range lowered by hand

This scenario gives the tool one real bump to write, on a hand-authored descriptor. `hono` `4.13.5` is already the newest within-major release, so you must lower the range yourself to see the write path run.

**Setup.** Run once, for every case in this scenario.

1. Keep a copy of the file, then lower the `hono` patch range to `4.13.0`.

```sh
cp modules/waitlist/registry-item.json /tmp/waitlist-before.json && sed -i 's/"range": "4.13.5"/"range": "4.13.0"/' modules/waitlist/registry-item.json && git diff --numstat modules/waitlist/registry-item.json
```

- [ ] Setup complete. `git diff --numstat` reports `1	1` for that file.

### TC-2.1: The interactive pick writes one readable line · 🔴 Critical

**Goal.** A bump picked in the interactive report moves one `"range"` line and leaves the descriptor's hand-authored shape intact.

**Steps**

1. Start the tool with no flags.

   ```sh
   node scripts/update-deps.ts
   ```

   - [ ] The grouped report lists `hono` with the current `4.13.0` and the target `4.13.5`
   - [ ] The report names the file `modules/waitlist/registry-item.json`
2. Select the `hono` bump in the multi-select, then confirm.

   - [ ] The multi-select responds to the keyboard, and the selection state is visible
   - [ ] The confirm prompt states what it will write before it writes
   - [ ] One `log.step` line prints for the bump, naming the path, the dep, the current spec and the target
3. Read the diff of the written file.

   ```sh
   git diff modules/waitlist/registry-item.json
   ```

   - [ ] The diff is empty, because the tool restored the file to its committed `4.13.5` state
4. Compare the written bytes with the pre-edit copy.

   ```sh
   diff /tmp/waitlist-before.json modules/waitlist/registry-item.json; echo "exit=$?"
   ```

   - [ ] The command prints nothing and exits 0
5. Read the whole descriptor by eye.

   ```sh
   cat modules/waitlist/registry-item.json
   ```

   - [ ] The hand-authored shape survives the write
     - `dependsOn` stays on one line
     - `files` stays on one line
     - `agent.skills` stays on one line
     - the indent stays at two spaces, and the file ends with one newline

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `--dry-run` prints the step and writes nothing · 🟡 Normal

**Goal.** `--dry-run` reports the same bump it would write, and touches no file.

**Steps**

1. Lower the range again, because TC-2.1 restored it.

   ```sh
   sed -i 's/"range": "4.13.5"/"range": "4.13.0"/' modules/waitlist/registry-item.json
   ```

2. Run the tool in dry-run mode.

   ```sh
   node scripts/update-deps.ts --dry-run --yes
   ```

   - [ ] The output names the `hono` bump and reads the same as the real run's step line
   - [ ] The footer says it *would* update, and gives the count
3. Confirm the file still holds `4.13.0`.

   ```sh
   grep -n '"range"' modules/waitlist/registry-item.json
   ```

   - [ ] The range is still `4.13.0`, so the dry run wrote nothing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
git checkout -- modules/waitlist/registry-item.json && rm -f /tmp/waitlist-before.json && git status --porcelain
```

## Scenario 3: cooldown lifted

`--allow-fresh` drops the 3-day cooldown and surfaces 17 held-back bumps across 11 files. This scenario reviews the diff a human would read before a commit. It ends by discarding every change.

**Setup.** Run once, for every case in this scenario.

1. Confirm the tree is clean.

```sh
git status --porcelain
```

- [ ] Setup complete. The command prints nothing.

### TC-3.1: A 17-bump diff stays reviewable across 11 files · 🔴 Critical

**Goal.** A real multi-file run produces a diff a reviewer can read line by line.

**Steps**

1. Write every available bump without the cooldown.

   ```sh
   node scripts/update-deps.ts --yes --allow-fresh
   ```

   - [ ] One step line prints per bump, and no error appears
2. Count the changed lines per file.

   ```sh
   git diff --numstat
   ```

   - [ ] Every file's insertion count equals its deletion count
   - [ ] The counts match the bump count for that file, so no file gained extra lines
3. Read the full diff.

   ```sh
   git diff
   ```

   - [ ] Each hunk is a version string change and nothing else
     - `modules/database-d1/registry-item.json` moves one `"range"` line
     - `modules/validators/registry-item.json` moves two `"range"` lines
     - no compact array reflows into one entry per line
     - no key order changes, and no blank line moves
   - [ ] The diff is small enough to review by eye in a normal pull request

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The major group is a separate opt-in · 🟢 Low

**Goal.** A major bump never lands without an explicit choice.

**Steps**

1. Discard the writes from TC-3.1 first.

   ```sh
   git checkout -- . && git status --porcelain
   ```

   - [ ] The command prints nothing
2. Start the interactive path with majors allowed.

   ```sh
   node scripts/update-deps.ts --allow-major --allow-fresh
   ```

   - [ ] The report puts the major bumps in their own group, apart from the within-major ones
   - [ ] The major group starts unselected, so a plain confirm writes no major
3. Select one major bump, confirm, then read its diff.

   ```sh
   git diff
   ```

   - [ ] The major bump moves one line, exactly like a patch bump does
   - [ ] No unselected bump landed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. This discards every write the scenario made.

```sh
git checkout -- . && git status --porcelain
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The spec gate wrote 22 checks. 21 are agent-confirmable and the verify step ran all of them. C14 is human-only and is TC-1.1 above.

Commands run (one per block):

```sh
node --test scripts/update-deps.test.ts
```

```sh
node scripts/update-deps.ts --yes --allow-fresh && git diff --numstat && git checkout -- .
```

```sh
node scripts/update-deps.ts --yes && node scripts/update-deps.ts --check; echo "exit=$?"; git status --porcelain
```

```sh
git status --porcelain > /tmp/before && node scripts/update-deps.ts --dry-run --yes --allow-fresh; git status --porcelain > /tmp/after && diff /tmp/before /tmp/after
```

```sh
sed -n '/^async function writeUpdates/,/^}/p' scripts/update-deps.ts | grep -nE '=[^=]' | grep -E 'patch\.range|bucket\[|arr\['
```

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Results:

- ✅ C1 — a descriptor patch-range bump is a one-line diff. The forced run changed 11 files, one insertion and one deletion per bump. The fix round repeated it on `modules/waitlist/registry-item.json` with a hand-lowered range, and the rest of the file came back byte-identical.
- ✅ C2 — a descriptor `dependencies[]` bump is a one-line diff. The changed line is `  "dependencies": ["hono@4.14.0", "@scope/pkg@1.0.0"],`.
- ✅ C3 — template `package.json` writes are byte-identical. The sweep test covers 13 template and module `package.json` files plus 16 descriptors.
- ✅ C4 — `deps:check` exits 0 after `deps:update --yes`, with an empty `git status --porcelain`.
- ✅ C5 — `depPath` returns `["patches", 0, "range"]`, `["dependencies", "hono"]` and `["dependencies", 0]`.
- ✅ C6 — the array form resolves a scoped entry by the last `@`, not the leading one.
- ✅ C7 — a missing bucket or a non-object patch entry throws with the manifest path in the message.
- ✅ C8 — no assignment through the parsed document remains in `writeUpdates`. The grep exits 1 with no output.
- ✅ C9 — `Manifest` declares `raw: string` at `scripts/update-deps.ts:144`, and the doc comment says `json` is read-only scan input.
- ✅ C10 — `jsonc-parser` is `3.3.1` in the root `devDependencies` and imports from the repo root.
- ✅ C11 — `inferFormatting` carries a comment naming `packages/cli/src/lib/patch/jsonc.ts:177`.
- ✅ C12 — the fold lives in the exported `applyBumps`, seeded from `manifest.raw`, one `modify` + one `applyEdits` per bump. No `JSON.stringify` remains in either function.
- ✅ C13 — `--dry-run` with the cooldown lifted printed 34 arrow lines and the footer `dry run — would update 17 dependencies.`, exit 0, tree unchanged.
- ⬜ C14 — human-only. Not judged by the agent. It is TC-1.1 in this plan.
- ✅ C15 — the sweep test covers 29 manifests, 103 deps, 0 skipped. A probe confirmed it is not vacuous: all 16 descriptors would reflow by 27 to 108 lines under the old path.
- ✅ C16 — the compact one-line array fixture takes a bump with `changedLineCount === 1`, and `dependsOn` and `agent.skills` survive verbatim.
- ✅ C17 — a named fixture covers a descriptor `dependencies[]` entry.
- ✅ C18 — a fixture takes two bumps in one document. Both new versions land and both old ones are gone.
- ✅ C19 — `pnpm test` picks up `scripts/**/*.test.ts`. 29 test files run, 15 of 15 pass in `scripts/update-deps.test.ts`.
- ✅ C20 — `pnpm lint` passes all four passes, including `lint:types` over `scripts` and `format:check`.
- ⚠️ C21 — `hono` in `modules/waitlist/registry-item.json` moves as a one-line diff. npm reports no newer within-major `hono`, because `4.13.5` is already the newest, so no live bump was available. The fix round proved the path by hand-editing that range down to `4.13.0` and watching `deps:update` write it back as a single line. Scenario 2 above repeats that method by hand.
- ❌ C22 — `pnpm deps:verify` fails. It exits 1 at `pnpm -C .dev/playground lint` with "No files found to lint". The cause is `/.dev/` at `.gitignore:155`, which makes oxlint skip every scaffolded playground file. **This failure is pre-existing on `origin/main` and this branch does not cause it.** The conductor confirmed it against the base. The later steps of that chain, `verify-css.ts` and the playground typecheck, are therefore unexercised on this branch.

Score: 20 of 21 agent-confirmable checks pass. The one failure is C22, and it is not this branch's.

## Not covered / needs human judgment

- **The interactive path.** Every automated run used `--yes`. The grouped report, the multi-select and the major opt-in group were never driven by hand. Scenarios 1, 2 and 3 cover them.
- **A major bump end to end.** No major landed through the new write path. The unit level covers it, because `depPath` and `depValue` do not branch on the bump kind. TC-3.2 covers the rest.
- **`writeUpdates` in a test.** The test calls the shared `applyBumps`, not `writeUpdates`. The two can drift. Only a live run proves the real function matches, which is what TC-2.1 does.
- **A write failure part way through a fold.** Nobody made `writeFile` fail with a read-only file or a full disk. `writeUpdates` writes once per file at the end of the fold, so the window is one `writeFile`, but that is unproven.
- **A large insertion shifting a later edit's offsets.** The two-bump case moved two short version strings only.
- **JSONC input.** A manifest with a `//` comment still fails at `JSON.parse` in `readManifestDeps`, before the write path. That is unchanged behaviour, not a regression, but the script now imports a JSONC parser and still refuses JSONC input.
- **Windows and macOS.** Everything ran on this Linux container. CRLF, tabs and BOM were covered by a probe over hand-built sources, not by a real run on those platforms.
- **`deps:verify` past its lint step.** C22 fails first, for a pre-existing reason, so the steps after it never ran.
- **Accessibility, compatibility, performance, concurrency, security.** Skipped on purpose. This change is a build-time script with no UI, no network endpoint, no auth surface and no concurrent caller.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
