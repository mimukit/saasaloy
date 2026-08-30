# QA Plan: `saasaloy update` + agent-consumable merge plan

_Generated 2026-08-10 · against `95adc4ef6db04b290c50f1d6b580060cb1662fe1` (branch `issue-48-add-saasaloy-update-with-an-agent-consumable-merge`, 12 commits) · covers the new `update` command, the three-way updater, and the merge-plan document._

## Summary
- `saasaloy update` re-applies installed modules at a newer commit, writes only the files you never touched, and prints a markdown merge plan for the files you did.
- "Working" means: your hand edits always survive, the clean files land, and the merge plan tells an agent everything it needs with no editing.

## Overall result
_Tick one when you finish the run._

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment
True for the whole plan — do this once, before Scenario 1.

- **Branch under test:** `issue-48-add-saasaloy-update-with-an-agent-consumable-merge` at `95adc4e`.
- **Build:** `pnpm play:reset` rebuilds the CLI and rescaffolds `.dev/playground`. It deletes the current playground, which is expected.
- **Network:** Scenario 1 fetches `mimukit/saasaloy` from GitHub. `GITHUB_TOKEN` must be set, or the API rate limit stops the run.
- **Terminal:** run every case in a real terminal. The confirmation prompt and the merge plan split across stderr and stdout, and you must see both.
- **Two ways to call the CLI.** Use exactly the one each scenario names:
  - `./saasaloy …` — the shim in the playground. It forces `SAASALOY_REGISTRY_DIR` to this worktree's `modules/`, so it never reaches GitHub.
  - `node ../../packages/cli/dist/index.js …` — the same build with no registry override. It reaches GitHub.
- **Base commit for Scenario 1:** `564ef61bf3d460876d079d0ae8cb0562d356f726`. Four commits touch `modules/email/` between it and `main`.

Rebuild the CLI and the playground:

```sh
pnpm play:reset
```

Move into the playground. Every command below runs from there:

```sh
cd .dev/playground
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1 — `email` pinned at an old commit, edited by hand | A pin holds, and `--ref` asks before it writes | 🔴 Critical |
| TC-1.2 | 1 — `email` pinned at an old commit, edited by hand | A missing file comes back only if the module changed it | 🟢 Low |
| TC-1.3 | 1 — `email` pinned at an old commit, edited by hand | The confirmed update writes the clean files and never the edited one | 🔴 Critical |
| TC-1.4 | 1 — `email` pinned at an old commit, edited by hand | An agent finishes the merge from the plan alone | 🔴 Critical |
| TC-1.5 | 1 — `email` pinned at an old commit, edited by hand | The merge plan pipes and renders as clean markdown | 🟡 Normal |
| TC-2.1 | 2 — `email` + `database` from a local module checkout | A missing merge base degrades the document, never refuses | 🟡 Normal |
| TC-2.2 | 2 — `email` + `database` from a local module checkout | An edited config value is reported, not overwritten | 🟡 Normal |
| TC-2.3 | 2 — `email` + `database` from a local module checkout | The migration and verify commands are named, never run | 🟡 Normal |
| TC-2.4 | 2 — `email` + `database` from a local module checkout | Bare `update` covers every module under one confirmation | 🟢 Low |

## Scenario 1 — `email` pinned at an old commit, edited by hand

**Setup** — once, for every case in this scenario. It needs the network.

1. Install `email` from GitHub, pinned at the old commit. It pulls `api` with it.

```sh
node ../../packages/cli/dist/index.js add mimukit/saasaloy@564ef61bf3d460876d079d0ae8cb0562d356f726/email --yes
```

2. If the command prints `fetch failed`, run it again. A first-call network blip happened once during preparation.

3. Add a hand edit to one file the upstream commits also changed.

```sh
printf '\n// MY HAND EDIT — must survive\nexport const mine = true;\n' >> packages/email/src/render.ts
```

- [ ] Setup complete

### TC-1.1 — A pin holds, and `--ref` asks before it writes  ·  🔴 Critical

**Goal** — a SHA in the lock never moves on its own, and the explicit unpin still stops at a confirmation.

**Steps**

1. Ask for an update with no flags.

   ```sh
   node ../../packages/cli/dist/index.js update email
   ```

   - [ ] The output says `email` is pinned at `564ef61`, names `--ref <branch|tag>` as the way off it, and ends with `Everything is up to date.`
2. Unpin it onto `main`.

   ```sh
   node ../../packages/cli/dist/index.js update email --ref main
   ```

   - [ ] A `Plan` box lists 4 files to update, 1 file as `drift → merge`, and closes with `4 file(s) to apply, 1 needing merge`
     - `packages/email/src/define.ts`, `provider.ts`, `templates/welcome.ts` and `.agents/skills/saasaloy-email/SKILL.md` are the four
     - `packages/email/src/render.ts` is the drifted one
   - [ ] The whole box fits your terminal width, and the colors separate the four states
   - [ ] A `Proceed?` prompt waits for an answer
3. Answer `n`.

   - [ ] The CLI says nothing was applied
4. Read the lock.

   ```sh
   cat saasaloy-lock.json
   ```

   - [ ] `email` still holds `ref` and `resolved` at `564ef61bf3d460876d079d0ae8cb0562d356f726`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — A missing file comes back only if the module changed it  ·  🟢 Low

**Goal** — a tracked file that vanished is restored, but only when the new version of the module touched it.

**Steps**

1. Delete one file the upstream commits changed and one they did not.

   ```sh
   rm packages/email/src/define.ts packages/email/src/index.ts
   ```

2. Preview the update.

   ```sh
   node ../../packages/cli/dist/index.js update email --ref main --dry-run
   ```

   - [ ] The plan shows `restore  packages/email/src/define.ts`
   - [ ] The plan says nothing about `packages/email/src/index.ts` — it is inside the `already up to date` count
   - [ ] Judge this: a file the module did not change stays missing, because "the module did not touch it" wins over "it is gone". Decide whether that is acceptable, and write your verdict in Notes
3. Confirm the preview wrote nothing.

   ```sh
   ls packages/email/src/
   ```

   - [ ] Both files are still absent

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _`packages/email/src/index.ts` stays missing for the rest of Scenario 1. That is expected and does not affect the later cases._

### TC-1.3 — The confirmed update writes the clean files and never the edited one  ·  🔴 Critical

**Goal** — the clean path lands, the hand edit survives untouched, and the lock keeps the old SHA as the merge base.

**Steps**

1. Run the update and answer `y`.

   ```sh
   node ../../packages/cli/dist/index.js update email --ref main
   ```

   - [ ] The CLI reports `update` for `define.ts`, `provider.ts`, `templates/welcome.ts` and `SKILL.md`, and `restore` for the file you deleted in TC-1.2
   - [ ] No line reports a write to `packages/email/src/render.ts`
   - [ ] The closing line names `email` as still needing a merge, and the run ends without an error
2. Read the merge plan the CLI printed above the closing line.

   - [ ] The `Intent` section lists these four real commit subjects
     - `fix(email): reject unsafe cta url schemes`
     - `fix(email): escape unquoted-attribute delimiters in the html tag`
     - `fix(email): close the EmailError contract gap in resolve()`
     - `docs(email): warn that the console provider must not ship to production`
   - [ ] `Provenance` names the base SHA `564ef61…`, the new SHA, and the ref `main`
   - [ ] `packages/email/src/render.ts` carries two diffs, `base → theirs` and `base → mine`
   - [ ] The `What Saasaloy records afterwards` paragraph says Saasaloy records nothing, the lock stays on the base SHA, and a later update offers the same file again. Judge whether it reads as honest rather than as a defect report
   - [ ] The `Verification` section names `pnpm typecheck`
3. Check the file on disk.

   ```sh
   tail -3 packages/email/src/render.ts
   ```

   - [ ] Your `MY HAND EDIT — must survive` lines are still there
4. Check that the upstream fix was not forced into the drifted file.

   ```sh
   grep -c '&#96;' packages/email/src/render.ts
   ```

   - [ ] The count is `0`
5. Read the lock.

   ```sh
   cat saasaloy-lock.json
   ```

   - [ ] `email` now has `"ref": "main"` but keeps `"resolved": "564ef61bf3d460876d079d0ae8cb0562d356f726"`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — An agent finishes the merge from the plan alone  ·  🔴 Critical

**Goal** — the document is enough for an agent CLI to complete the merge with no extra instruction and no lost user work.

**Steps**

1. Write the same plan to a file.

   ```sh
   node ../../packages/cli/dist/index.js update email --out ../merge-plan.md
   ```

   - [ ] The CLI says the merge plan was written, and prints nothing else to the screen except its own boxes
2. Hand the file to your agent CLI. Give it no other instruction.

   ```sh
   claude -p "Do exactly what ../merge-plan.md says."
   ```

   - [ ] The agent needs no clarification about which file to edit or which side is `mine`
   - [ ] The agent leaves `.saasaloy/manifest.json` and `saasaloy-lock.json` alone
3. Read `packages/email/src/render.ts` after the agent finishes.

   - [ ] Your `MY HAND EDIT` lines are still present
   - [ ] The upstream escaping fix is present too — `escapeHtml` now replaces the backtick and the `=` character
4. Run the update again.

   ```sh
   node ../../packages/cli/dist/index.js update email
   ```

   - [ ] The CLI either offers the same file again, or reports the module up to date and advances `resolved` in the lock. Judge whether the message matches what the merged file actually looks like

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _record which agent CLI you used, and any point where it asked you a question_

### TC-1.5 — The merge plan pipes and renders as clean markdown  ·  🟡 Normal

**Goal** — stdout carries the document and nothing else, so a redirect or a pipe produces a file an agent can read.

**Steps**

1. Undo the merge so a drifted file exists again.

   ```sh
   printf '\n// SECOND HAND EDIT\nexport const mine2 = true;\n' >> packages/email/src/render.ts
   ```

2. Redirect stdout to a file.

   ```sh
   node ../../packages/cli/dist/index.js update email > /tmp/qa-plan.md
   ```

   - [ ] The boxes and the step lines are still visible on screen while stdout goes to the file
   - [ ] The first message says stdout is not a terminal and the run proceeds as if `--yes` were given, and it appears before any work
3. Open `/tmp/qa-plan.md` in a markdown previewer.

   - [ ] The file starts at `# Saasaloy merge plan` and holds no box drawing and no color codes
   - [ ] Every diff block renders as one code block
     - some blocks open with four backticks, because the diff itself contains a three-backtick fence
     - the headings, the bullet lists and the numbered instructions all render

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 2.

```sh
cd ../.. && pnpm play:reset && cd .dev/playground
```

## Scenario 2 — `email` + `database` from a local module checkout

This scenario runs offline. It points the CLI at a scratch copy of `modules/`, so you can change a module version without editing the repository.

**Setup** — once, for every case in this scenario.

1. Copy the module checkout to a scratch directory.

```sh
cp -r ../../modules /tmp/qa-modules
```

2. Point every later command at that copy.

```sh
export SAASALOY_REGISTRY_DIR=/tmp/qa-modules
```

3. Install both modules from it.

```sh
node ../../packages/cli/dist/index.js add email --yes && node ../../packages/cli/dist/index.js add database --yes
```

- [ ] Setup complete

### TC-2.1 — A missing merge base degrades the document, never refuses  ·  🟡 Normal

**Goal** — an install with no commit identity still produces a usable merge plan instead of an error.

**Steps**

1. Edit a managed file by hand.

   ```sh
   printf '\n// LOCAL HAND EDIT\nexport const local = true;\n' >> packages/email/src/render.ts
   ```

2. Run the update and answer `y`.

   ```sh
   node ../../packages/cli/dist/index.js update email
   ```

   - [ ] A warning says the registry override is set, so the module comes from a working copy with no merge base
   - [ ] The plan box shows `no merge base — local install` and routes `render.ts` to the merge plan
   - [ ] The run ends without an error
3. Read the merge plan on screen.

   - [ ] `Provenance` carries the bold `no merge base — local install` line, and explains that the diff is two-way
   - [ ] The single diff is labelled `theirs → mine`, not `base → theirs`
   - [ ] Judge this: with only a two-way diff, is the document still enough to act on? Write your verdict in Notes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — An edited config value is reported, not overwritten  ·  🟡 Normal

**Goal** — a real `database_id` you set by hand survives the update and is explained in the merge plan.

**Steps**

1. Replace the placeholder database id.

   ```sh
   sed -i 's/"database_id": "local"/"database_id": "9f3c1e88-real-id"/' apps/api/wrangler.jsonc
   ```

2. Update the `database` module and answer `y`.

   ```sh
   node ../../packages/cli/dist/index.js update database
   ```

   - [ ] The merge plan has a `Config patches that moved` section for `apps/api/wrangler.jsonc`
     - Identity reads `d1_databases[binding=DB]`
     - On disk shows your `9f3c1e88-real-id`
     - The declared value shows `local`
   - [ ] Judge this: the plan box counts `0 needing merge` while the merge plan is still printed, because only a config patch moved. Decide whether that counter misleads you, and write your verdict in Notes
3. Read the config file.

   ```sh
   grep database_id apps/api/wrangler.jsonc
   ```

   - [ ] Your value is unchanged

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — The migration and verify commands are named, never run  ·  🟡 Normal

**Goal** — a schema change tells you which commands to run, and the CLI runs neither of them.

**Steps**

1. Add a schema file to the scratch module copy.

   ```sh
   printf 'export const users = { id: "text" };\n' > /tmp/qa-modules/database/files/src/schema/users.ts
   ```

2. Declare it in the scratch descriptor. Add this entry to the `scaffolds[0].files` array of `/tmp/qa-modules/database/registry-item.json`:

   ```sh
   node -e 'const f="/tmp/qa-modules/database/registry-item.json",d=require(f);d.scaffolds[0].files.push({path:"files/src/schema/users.ts",target:"src/schema/users.ts"});require("fs").writeFileSync(f,JSON.stringify(d,null,2))'
   ```

3. Update `database` and answer `y`.

   ```sh
   node ../../packages/cli/dist/index.js update database
   ```

   - [ ] A `Migrations` box names `pnpm --filter @repo/db db:generate` and says the schema changed
   - [ ] A `Verify with` box names `pnpm typecheck` and says it is named, not run
   - [ ] Neither command runs — no drizzle output appears, and no typecheck output appears
4. Read the merge plan, if one is printed.

   - [ ] The `Verification` section repeats both commands

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.4 — Bare `update` covers every module under one confirmation  ·  🟢 Low

**Goal** — one run handles every installed module, and a broken module is reported instead of stopping the run.

**Steps**

1. Break one module in the scratch copy so it cannot be read.

   ```sh
   rm -rf /tmp/qa-modules/api
   ```

2. Run the bare command and answer `y`.

   ```sh
   node ../../packages/cli/dist/index.js update
   ```

   - [ ] One `Plan` box covers every installed module, and one `Proceed?` prompt covers them all
   - [ ] `api` is reported as skipped with a reason, and the other modules still update
   - [ ] The merge plan holds one `## <module>` heading per module that needs a merge, then one shared `## Instructions` and `## Verification` section
   - [ ] Judge whether a multi-module document stays readable

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above.

```sh
unset SAASALOY_REGISTRY_DIR && rm -rf /tmp/qa-modules /tmp/qa-plan.md ../merge-plan.md
```

```sh
cd ../.. && pnpm play:reset
```

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

The agent ran these against a throwaway copy of the playground and a throwaway project under its scratch directory. It did not touch `.dev/playground` and it did not rebuild.

The command gate was already green on this commit and was not re-run: `pnpm exec turbo run test typecheck build --force` → 12 test files, 205 tests, typecheck and build clean.

Commands run:

```sh
node packages/cli/dist/index.js --help
```

```sh
node packages/cli/dist/index.js update --ref v2
```

```sh
node packages/cli/dist/index.js update --bogus
```

```sh
node packages/cli/dist/index.js update --ref
```

```sh
node ../../packages/cli/dist/index.js add mimukit/saasaloy@564ef61bf3d460876d079d0ae8cb0562d356f726/email --yes
```

```sh
node ../../packages/cli/dist/index.js update email
```

```sh
node ../../packages/cli/dist/index.js update email --ref main --dry-run
```

```sh
node ../../packages/cli/dist/index.js update email --ref main --out /tmp/merge.md --yes
```

```sh
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.sha" https://api.github.com/repos/mimukit/saasaloy/commits/main
```

```sh
SAASALOY_REGISTRY_DIR=/tmp/qa-modules node ../../packages/cli/dist/index.js update email --dry-run --out /tmp/should-not-exist.md
```

- ✅ `--help` → `update` appears in the command list with the describe line `re-apply modules at a newer ref, with a merge plan for anything you edited`. It is registered in the `COMMANDS` map.
- ✅ `update --ref v2` (no module) → exit 1, `` `--ref` needs an explicit module `` plus the usage line.
- ✅ `update --bogus` → exit 1, `Unknown argument(s): --bogus`. `update --ref` with no value → exit 1, `--ref (missing value)`.
- ✅ `update nope` in a project → exit 1, `nope isn't installed — nothing to update.`
- ✅ Pinned lock → `email — pinned at 564ef61 — nothing to update (use --ref <branch|tag> to move it)`, exit 0, lock untouched.
- ✅ Real three-way against GitHub → base `564ef61…` refetched, 4 files classified clean, the hand-edited `render.ts` classified `drift → merge`, plan shows `4 file(s) to apply, 1 needing merge`.
- ✅ Intent is real → the merge plan listed exactly the 4 commit subjects that touch `modules/email/` between `564ef61…` and `main`. The same intersection reproduced through the GitHub `compare` and `commits?path=` endpoints (46 commits between, 10 touching, 4 in both).
- ✅ Applied run → 4 files written, `render.ts` untouched (`&#96;` count stayed 0, the hand edit stayed last), lock became `"ref": "main"` with `"resolved"` still on the base SHA.
- ✅ Re-run → the same file was offered again against the same base. After `render.ts` was made byte-identical to the new version, the next run reported `Already up to date.` and `resolved` advanced to the new SHA.
- ✅ Ref-only rewrite is persisted → after the applied run the lock's `ref` moved to `main` while `resolved` stayed put; `--dry-run` before it left the lock unchanged.
- ✅ Output split → with `--out`, stdout was 0 bytes and the file held 6739 bytes of markdown. With a plain redirect, stdout held only the markdown and stderr held only the TUI. Non-TTY stdout printed `stdout isn't a terminal — proceeding as if --yes were given.` first.
- ✅ `--dry-run` with `--out` wrote no file at all.
- ✅ Degraded base → a local-registry run stamped `no merge base — local install` in the plan box and in `Provenance`, and rendered a two-way `theirs → mine` diff instead of refusing.
- ✅ Deletions → a dropped file whose hash still matched was deleted; a dropped file that was hand-edited was kept, reported as `dropped → kept`, given a merge-plan section, and untracked in the manifest.
- ✅ Missing files → a deleted file the new version changed classified as `restore`; a deleted file the new version did not change stayed in the `already up to date` count and was not restored.
- ✅ Config patches → an edited `database_id` produced `Config patches that moved` with `d1_databases[binding=DB]`, the on-disk value and the declared value. An edited `@repo/email` range produced the same for `dependencies[@repo/email]`.
- ✅ Migration surfacing → adding a file under the `@db` schema prefix produced the `Migrations` box naming `pnpm --filter @repo/db db:generate`. Nothing was executed.
- ✅ Bare `update` → one summary, one document, one `## <module>` section per module (`## api`, `## email`, `## database`) plus one shared `## Instructions` and `## Verification`.
- ✅ Local-source lock entries with no override → reported as `installed from a working copy — set SAASALOY_REGISTRY_DIR to update it` and skipped, exit 0. A module with no lock entry was reported as `no lock entry — reinstall it with saasaloy add`.
- ⚠️ Observations for the tester to judge, not failures:
  - The help list pads command names to 6 characters, so `update` gets a single space before its description while the shorter names get three. It is cosmetic alignment only.
  - The plan box counts only files, so a run whose sole merge reason is a moved config patch prints `0 needing merge` and still emits a merge plan. TC-2.2 asks you to judge this.
  - A managed file deleted from disk is not restored when the new version did not change it, because the `base === theirs` rule short-circuits first. TC-1.2 asks you to judge this.
  - One `add` against GitHub failed once with a bare `fetch failed` and succeeded on the immediate retry. It looked like a network blip, not a defect.

## Not covered / needs human judgment
- A force-pushed branch, a deleted tag, a private repository and a rate-limited API. Only the `local install` reason for a missing merge base was exercised. Producing the others needs a repository you can rewrite.
- Windows path separators. Every run was on Linux.
- A new `dependsOn` prerequisite introduced by a newer module version. No module in the registry gained one between two published commits, so this needs a hand-built module copy.
- Dependency-pin bumping through `package.json`. No pin moved between the two commits used here.
- Concurrency, retries and interrupted writes. Issue #49 owns real transactionality for `add` and `update`.
- Performance on a large module. The largest module here ships 9 files.
- Accessibility and browser compatibility. This change ships no UI.
- The quality of the merge an agent actually produces. TC-1.4 asks you to judge it; no automated check can.
