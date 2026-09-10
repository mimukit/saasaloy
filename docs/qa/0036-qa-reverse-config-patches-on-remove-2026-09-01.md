# QA Plan: reverse config patches on `remove`

_Generated 2026-09-01 · against `a1459421` · covers issue #36: the `wrangler-binding` and `plugin-array` inverse codemods, the drift and parse-error refusals, the `--dry-run` / `--diff` previews, and the docs that describe them_

## Summary

- `saasaloy remove` now undoes the three patch kinds that edit a config file, so a module that patched another module's file takes its edit back out with it.
- Working means: an untouched target returns to its pre-patch content, a hand-edited target is reported and left alone, a target that does not parse is reported and does not abort the command, and the two `package.json` kinds still drop with a warning.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Worktree `/home/dev/worktrees/saasaloy/issue-36-reverse-config-patches-on-remove-via-tracked`, branch `issue-36-reverse-config-patches-on-remove-via-tracked`, commit `a1459421`.
- Node 24 (`.nvmrc` pins `v24.13.0`), pnpm 11.
- No server, no credentials, no feature flags. The CLI runs offline against this worktree's `modules/` directory.
- Run every command from the worktree root unless the step says otherwise. Scenario 2 and Scenario 3 run from `.dev/playground`; each of their command blocks returns you there.
- Run all CLI work under `.dev`, per AGENTS.md. `.dev/playground/saasaloy` is a shim that points the built CLI at this worktree's `modules/` directory.
- Run Scenario 2 and Scenario 3 in a real terminal, not through a pipe. Several checkpoints judge what `@clack/prompts` draws, and a redirected run never shows it.

Confirm you are on the right commit:

```sh
git rev-parse --short=8 HEAD
```

- [ ] The command prints `a1459421`

Install the workspace once:

```sh
pnpm install --frozen-lockfile
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: worktree only, no build | Wiki prose matches what `remove` does | 🔴 Critical |
| TC-1.2 | 1: worktree only, no build | The module skills match the new behaviour | 🟡 Normal |
| TC-2.1 | 2: playground with `email` installed | The preview reads as a plan a user can act on | 🔴 Critical |
| TC-2.2 | 2: playground with `email` installed | The reverted files read like hand-written code | 🔴 Critical |
| TC-2.3 | 2: playground with `email` installed | A hand edit is reported, never reverse-patched | 🔴 Critical |
| TC-2.4 | 2: playground with `email` installed | The created-property branch leaves a file a person accepts | 🟡 Normal |
| TC-2.5 | 2: playground with `email` installed | The picker and the confirm behave at a terminal | 🟢 Low |
| TC-2.6 | 2: playground with `email` installed | The unreversed kinds still warn, and `--force` still works | 🟡 Normal |
| TC-3.1 | 3: playground with `auth` installed | A string binding entry and a route link reverse together | 🟡 Normal |
| TC-3.2 | 3: playground with `auth` installed | An object binding matched on `binding` reverses cleanly | 🟡 Normal |

## Scenario 1: worktree only, no build

**Setup.** Run once, for every case in this scenario. No build and no playground are needed. You read files.

- [ ] Setup complete

### TC-1.1: Wiki prose matches what `remove` does · 🔴 Critical

**Goal.** A user reading the wiki forms a correct expectation of what `remove` undoes and what it leaves behind.

**Steps**

1. Open `docs/wiki/reference.md`. Read the "Known limitations" entry on patch reversal, at the heading `remove` leaves the two `package.json` patch kinds behind.
   - [ ] The entry names the three reversed kinds and the two unreversed kinds, and every claim matches a descriptor under `modules/`
     - the reversed set is `chained-route`, `wrangler-binding` and `plugin-array`
     - the `email-cloudflare` example matches `modules/email-cloudflare/registry-item.json`, which patches `apps/api/wrangler.jsonc` and `packages/email/src/index.ts`
     - the `waitlist` example matches `modules/waitlist/registry-item.json`, which leaves `hono` and `@repo/api` in `apps/web/package.json`
     - the reason given for each unreversed kind is a reason, not a restatement
   - [ ] The prose reads as a person wrote it, with no puffery and no em dash used as sentence punctuation
2. Open `docs/wiki/how-to/remove-a-module.md`. Read the `--diff` paragraph and the "What stays behind" section.
   - [ ] Both documents use one word per idea, and the four labels match what the command prints: `revert`, `drift → left`, `already gone`, `untrack`
   - [ ] The asymmetry rule is decidable from the text alone, so you can predict the outcome for a file you have not seen
     - a binding array in `apps/api/wrangler.jsonc` goes once its last entry goes
     - a `providers` array in a capability's `src/index.ts` stays, empty
     - the stated reason for the difference is the one the code gives

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The module skills match the new behaviour · 🟡 Normal

**Goal.** An agent driving a module skill does not tell the user to hand-revert an edit `remove` already took out.

**Steps**

1. Open `modules/database-d1/skills/saasaloy-database-d1/SKILL.md` and `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md`. Read the paragraph on what `remove` leaves behind.
   - [ ] Each paragraph says the `wrangler.jsonc` edit comes out, and lists only `package.json` items as leftovers
   - [ ] The d1 paragraph states the drift case, and a reader can tell when the edit stays
2. Open `modules/waitlist/skills/saasaloy-waitlist/SKILL.md`. Read the "What it patches" table and its introduction.
   - [ ] The sentence no longer blames issue #36 for the two dependency patches, and gives the real reason instead
   - [ ] The table's three rows still match `modules/waitlist/registry-item.json`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. No case above writes a file.

## Scenario 2: playground with `email` installed

The fixture is `email-cloudflare`. It carries one `wrangler-binding` into `apps/api/wrangler.jsonc` and one `plugin-array` into `packages/email/src/index.ts`, so one module exercises both new inverses on two files it does not own.

**Setup.** Run once, for every case in this scenario.

1. Build the CLI and scaffold a fresh playground.

   ```sh
   pnpm play:reset
   ```

2. Install the `email` capability, which pulls `api` in first.

   ```sh
   cd .dev/playground && ./saasaloy add email --yes
   ```

3. Snapshot both target files while they are still unpatched. Later cases compare against these.

   ```sh
   cp apps/api/wrangler.jsonc /tmp/qa36-wrangler.before && cp packages/email/src/index.ts /tmp/qa36-email.before
   ```

- [ ] Setup complete

### TC-2.1: The preview reads as a plan a user can act on · 🔴 Critical

**Goal.** A user who runs `--dry-run` or `--diff` can decide whether to remove the module without reading the source.

**Steps**

1. Install the provider, then preview the removal as a plan.

   ```sh
   ./saasaloy add email-cloudflare --yes && ./saasaloy remove email-cloudflare --dry-run
   ```

   - [ ] The plan block lists both patched files under the `revert` label, and the outro says nothing was removed
   - [ ] The output renders correctly at a real terminal, with no stray escape codes and no line that wraps into unreadable box drawing
2. Preview the same removal as a diff.

   ```sh
   ./saasaloy remove email-cloudflare --diff
   ```

   - [ ] Each panel names its file above the diff, and shows only the lines the patch added, as removals
     - `apps/api/wrangler.jsonc`: the `send_email` array, its `{ "name": "EMAIL", "remote": false }` entry, and nothing else
     - `packages/email/src/index.ts`: the `cloudflare` import and the `providers: [cloudflare()]` line
   - [ ] The diff is short enough to read in one screen, so the preview is worth running

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The reverted files read like hand-written code · 🔴 Critical

**Goal.** A user who opens a reverted file sees the file they had before the install, not a file a tool rewrote.

**Steps**

1. Remove the provider for real, then open `apps/api/wrangler.jsonc` in an editor.

   ```sh
   ./saasaloy remove email-cloudflare --yes
   ```

   - [ ] The file reads exactly as it did before the install, and you would accept it in review
     - the closing comment "No bindings in the base `api` module" is still the last thing in the object
     - the two-space indent and the JSONC trailing commas are unchanged
     - no blank line, stray comma or orphaned bracket sits where the `send_email` array was
     - every other comment in the file is in its original position
2. Open `packages/email/src/index.ts`.
   - [ ] The file reads exactly as it did before the install
     - `export const email = defineEmail({ providers: [] });` is back on one line
     - the comment block above that line is untouched, including the "Never omit `providers`" sentence
     - the `cloudflare` import is gone and no blank line is left in the import group
     - the file ends with exactly one newline
3. Compare both files with the snapshots, to catch a difference your eye passed over.

   ```sh
   diff /tmp/qa36-wrangler.before apps/api/wrangler.jsonc; diff /tmp/qa36-email.before packages/email/src/index.ts
   ```

   - [ ] Neither `diff` prints anything

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A hand edit is reported, never reverse-patched · 🔴 Critical

**Goal.** A line the user changed after the install stays the user's, and the message tells them which file to open and why.

**Steps**

1. Reinstall the provider, then edit both targets by hand in an editor.

   ```sh
   ./saasaloy add email-cloudflare --yes
   ```

   Change `"remote": false` to `"remote": true` in the `send_email` entry of `apps/api/wrangler.jsonc`. Change `cloudflare()` to `cloudflare({ binding: "MAIL" })` in `packages/email/src/index.ts`.
2. Remove the provider.

   ```sh
   ./saasaloy remove email-cloudflare --yes
   ```

   - [ ] Each warning names the file, names the patch kind, and says what it found on disk instead
   - [ ] The wording reads as "this line is yours now", and you can tell it apart from "there was nothing to revert" without checking the file
   - [ ] Both files still hold your edit, and neither gained a second edit
   - [ ] The command exits without an error banner, so a drifted file does not read as a failed removal
3. Reinstall, then hand-revert instead of drifting. Delete the whole `send_email` array from `apps/api/wrangler.jsonc`, and delete both the `cloudflare()` call and its import from `packages/email/src/index.ts`. Then remove.

   ```sh
   ./saasaloy add email-cloudflare --yes
   ```

   ```sh
   ./saasaloy remove email-cloudflare --yes
   ```

   - [ ] The message says the patch was already gone, and reads as information, not as a fault
   - [ ] Neither file is re-edited
4. Reinstall, then break the syntax of one target. Append a broken line to `packages/email/src/index.ts`, so the parser cannot read it.

   ```sh
   ./saasaloy add email-cloudflare --yes && printf '\nfunction broken( {{{\n' >> packages/email/src/index.ts
   ```

   ```sh
   ./saasaloy remove email-cloudflare --diff && ./saasaloy remove email-cloudflare --yes; echo "EXIT=$?"
   ```

   - [ ] The warning names `packages/email/src/index.ts`, gives the parser's position, and tells the user to fix the file and hand-revert
   - [ ] The healthy patch on `apps/api/wrangler.jsonc` still reverses, so one broken file does not cost the whole removal
   - [ ] `EXIT=0`, and no stack trace reaches the screen

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: The created-property branch leaves a file a person accepts · 🟡 Normal

**Goal.** The one reversal that is not a byte-for-byte restore still leaves a file the user would keep. Every shipped capability declares `providers: []`, so this branch needs a hand edit to reach.

**Steps**

1. Reset the scenario and rebuild the fixture, then delete the `providers` property so the forward patch has to create it.

   ```sh
   cd ../.. && pnpm play:reset && cd .dev/playground && ./saasaloy add email --yes
   ```

   Edit `packages/email/src/index.ts` so the export reads `export const email = defineEmail({});`.
2. Install and remove the provider.

   ```sh
   ./saasaloy add email-cloudflare --yes && ./saasaloy remove email-cloudflare --yes
   ```

3. Open `packages/email/src/index.ts` and read the export line.
   - [ ] The `providers` property is present and empty, so the next provider install has an array to push into
   - [ ] The formatting is one you would accept in review, or you record it as a follow-up
     - magicast reprints the call across several lines with a one-space indent
     - no formatter in this repo produces that indent, and the playground cannot run its own Prettier
     - decide whether a user would notice, and say so in **Notes** either way
   - [ ] The comment block above the export survived the reprint

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.5: The picker and the confirm behave at a terminal · 🟢 Low

**Goal.** The interactive path shows the reversal before it asks, so a user answers the confirm with the edit in view.

**Steps**

1. Reset the scenario, rebuild the fixture, then run `remove` with no module name and no `--yes`.

   ```sh
   cd ../.. && pnpm play:reset && cd .dev/playground && ./saasaloy add email --yes && ./saasaloy add email-cloudflare --yes
   ```

   ```sh
   ./saasaloy remove
   ```

   - [ ] The picker lists the installed modules and marks the ones a dependent blocks
   - [ ] The confirm shows the patch plan, with both files under the `revert` label, before it asks the question
2. Answer "no" at the confirm.
   - [ ] The command stops and says so, and both target files still hold the patch
3. Run it again and press Ctrl-C at the picker.

   ```sh
   ./saasaloy remove
   ```

   - [ ] The command exits cleanly, with no half-written `.saasaloy/manifest.json` and no partly edited target file

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.6: The unreversed kinds still warn, and `--force` still works · 🟡 Normal

**Goal.** A user removing a module whose dependent is installed gets a refusal they can act on, and the two `package.json` kinds still say "hand-revert this".

**Steps**

1. With `email-cloudflare` still installed, try to remove the capability it depends on.

   ```sh
   ./saasaloy remove email --yes; echo "EXIT=$?"
   ```

   - [ ] The refusal names `email-cloudflare` as the dependent and names the flag that overrides it
   - [ ] `EXIT` is non-zero, and nothing on disk changed
2. Override the refusal.

   ```sh
   ./saasaloy remove email --yes --force; echo "EXIT=$?"
   ```

   - [ ] The warning for `apps/api/package.json` says the `package-json-dependency` patch is not reversed and tells the user to hand-revert it
   - [ ] That wording matches the wiki prose you read in TC-1.1, using the same words for the same idea
   - [ ] `@repo/email` is still in `apps/api/package.json`, so the warning told the truth
   - [ ] The run does not crash on `email-cloudflare`'s own records, which now point at a capability that is going away

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
cd ../.. && pnpm play:reset
```

## Scenario 3: playground with `auth` installed

`email-cloudflare` uses `matchOn: "name"` and an object entry. `auth` and `database-d1` cover the two binding shapes it does not: a bare string entry in `compatibility_flags`, and an object entry matched on the default key `binding`. `auth` also carries the `chained-route` patch, which no CLI run has driven end to end.

**Setup.** Run once, for every case in this scenario.

1. Snapshot the base `wrangler.jsonc` before any module patches it.

   ```sh
   cd .dev/playground && cp apps/api/wrangler.jsonc /tmp/qa36-wrangler.base
   ```

2. Install `auth`. It pulls `api`, `database` and `database-d1` in first.

   ```sh
   ./saasaloy add auth --yes
   ```

3. Read `apps/api/wrangler.jsonc` once, so you know what the reversal has to take back out.
   - [ ] The file now holds a `compatibility_flags` array with `"nodejs_compat"`, and a `d1_databases` array with one entry whose `binding` is `DB`

- [ ] Setup complete

### TC-3.1: A string binding entry and a route link reverse together · 🟡 Normal

**Goal.** One module reverses three patch kinds in one run, and the file it shares with another module survives.

**Steps**

1. Remove `auth`.

   ```sh
   ./saasaloy remove auth --yes; echo "EXIT=$?"
   ```

   - [ ] The `compatibility_flags` array is gone from `apps/api/wrangler.jsonc`, because `nodejs_compat` was its only entry
   - [ ] The `d1_databases` array is untouched, because `database-d1` owns it and is still installed
   - [ ] `EXIT=0`
2. Open `apps/api/src/index.ts`.
   - [ ] The `/auth` link and the `authRoute` import are both gone, and the remaining route chain reads as valid TypeScript
   - [ ] No blank line is left in the import group, and the file ends with one newline
3. Read the warnings the run printed.
   - [ ] One warning names `apps/api/package.json` for the `@repo/auth` dependency, and `@repo/auth` is still in that file

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: An object binding matched on `binding` reverses cleanly · 🟡 Normal

**Goal.** The default match key works, and the last entry out takes its array with it.

**Steps**

1. Remove the driver.

   ```sh
   ./saasaloy remove database-d1 --yes; echo "EXIT=$?"
   ```

   - [ ] The whole `d1_databases` array is gone from `apps/api/wrangler.jsonc`, not just its one entry
   - [ ] Every comment in the file is in its original position, including the closing "No bindings in the base `api` module"
   - [ ] `EXIT=0`
2. Compare the file with the snapshot you took before any install.

   ```sh
   diff /tmp/qa36-wrangler.base apps/api/wrangler.jsonc
   ```

   - [ ] `diff` prints nothing, so three reversals across two modules returned the file to its base content
3. Read the warnings the run printed, then open `packages/db/package.json`.
   - [ ] The run warns for each `package.json` patch it does not reverse, naming the file each time
   - [ ] The two `db:migrate:*` scripts and the `wrangler` and `@cloudflare/workers-types` devDependencies are all still there

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. This deletes the playground.

```sh
cd /home/dev/worktrees/saasaloy/issue-36-reverse-config-patches-on-remove-via-tracked && pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself at `0125b53`, then re-ran after the three fix commits that follow it. No action needed from the tester; listed here for context and sign-off._

These are the acceptance checks C1 to C5 from the run's check set, plus six probes. The agent ran them in `.dev/playground` and in the worktree root. Nothing below was re-run to write this plan.

```sh
cd .dev/playground && ./saasaloy remove email-cloudflare --yes && diff /tmp/c-wrangler.before apps/api/wrangler.jsonc && diff /tmp/c-email.before packages/email/src/index.ts
```

```sh
cd .dev/playground && ./saasaloy add email-cloudflare --yes && ./saasaloy remove email-cloudflare --yes
```

```sh
cd .dev/playground && ./saasaloy remove email-cloudflare --diff && ./saasaloy remove email-cloudflare --dry-run && diff -r /tmp/r1-c3-saasaloy .saasaloy
```

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm verify:content
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/patch/index.test.ts
```

```sh
grep -rn "one config patch kind out of five\|out of five" docs/ packages/cli/src
```

```sh
grep -rn "until issue #36\|wait on issue #36\|no inverse yet (#36)\|until #36\|#36 generalises\|reverses only \`chained-route\`" packages/cli/src docs/
```

- ✅ C1 a reversal restores the patched file to its pre-patch content → both `diff` calls printed nothing and returned rc=0. The run printed `revert apps/api/wrangler.jsonc (wrangler-binding)` and `revert packages/email/src/index.ts (plugin-array)`. `manifest.patches` for the module filtered to `[]`.
- ✅ C2 a hand-edited target is warned about and skipped → exit 0, two `left untouched` warnings naming the file, the kind and the drifted value, zero `revert` lines, both files byte-identical to the hand-edited snapshots. The `already gone` sub-case printed `was already gone — nothing to revert` and re-edited nothing.
- ✅ C3 the preview flags show the reversal and write nothing → both flag runs exited 0. `--diff` rendered a `revert` panel per file whose removals include `"send_email": [` and `export const email = defineEmail({ providers: [cloudflare()] });`. `--dry-run` listed both files with the `revert` label. Afterwards `.saasaloy` and `saasaloy.json` were unchanged, the target was still patched, and `installed` still held `email-cloudflare`.
- ✅ C4 the repo gate stays green → all five commands exited 0, `GATE_RC=0`. Vitest reported 29 test files and 552 tests passed. `node --test` on the module files reported `pass 37, fail 0`. `verify-content` reported 8 blocks clean. `remover.ts` coverage is 98% of statements.
- ✅ C5 the unreversed kinds still warn, and the docs say so → `index.test.ts` passed 28 tests, asserting `isReversibleKind` true for `chained-route`, `plugin-array` and `wrangler-binding`, and false for both `package.json` kinds. Both greps returned no hits. Removing `email` printed the `is not reversed by remove` warning and left `apps/api/package.json` byte-identical.
- ✅ P1 a `providers` array shared with another installed module → with `email-console` and `email-cloudflare` both installed, removing `email-cloudflare` left `providers: [consoleEmail()]` and its import, and took only cloudflare's entry and import.
- ✅ P2 the `plugin-array` empty-container branch → with the property hand-deleted first, the reversal leaves `providers: []` rather than deleting the property, and magicast reprints the call multi-line with a one-space indent. Behaves as `7b9685c` designed it, but it is the one branch that does not restore byte for byte. **TC-2.4 asks a human to judge the result.**
- ✅ P3 a `send_email` array shared with a foreign entry → a hand-added `NOTIFY` entry survived, only the `EMAIL` entry went, and the array container and the file's JSONC comments were preserved.
- ✅ P4 the target file deleted before `remove` → `--diff` labelled it `already gone` and still rendered the panel for the surviving file. The real run exited 0, warned, reversed the other patch, and did not recreate the file.
- ✅ P5 `package-json-dependency` still drops and warns → `remove email --yes` exited 0, printed the warning, and left `@repo/email` in `apps/api/package.json`.
- ✅ P6 a syntactically broken target file → both the `--diff` run and the real run exit 0. The plan previews the broken target as `drift → left` with `does not parse (Unexpected token (48:18)) — fix the file, then hand-revert this patch`, and the healthy `wrangler-binding` still reverses. The broken file is left byte-identical. A unit test in `remover.test.ts` pins this, and the agent confirmed it fails against the unfixed code.

Review round 1 raised the broken-file case as a blocker; the fix landed in `41d6571` and P6 above is the re-run. Two more fix commits corrected a stale comment in `applier.ts` and retitled a `jsonc.test.ts` test. The test count moved from 551 to 552.

## Not covered / needs human judgment

- **`chained-route` end to end through the CLI.** No agent run drove it. Its unit tests pass, and the shared `INVERSES` table changed under it. TC-3.1 covers it by hand.
- **`wrangler-binding` for any descriptor but `email-cloudflare`.** The agent never removed `auth`, `database-postgres` or `database-d1`. TC-3.1 and TC-3.2 cover the string entry and the default `matchOn: "binding"` by hand. `database-postgres` is still uncovered; it writes the same `nodejs_compat` string entry `auth` does.
- **A binding entry two installed modules both need.** `auth` and `database-postgres` write the same `compatibility_flags` entry, and the applier records a patch only when it changed the file, so only the first installer holds a record. They cannot be installed together in this repo, because `auth` depends on `database-d1`, so no case here reaches the state.
- **`plugin-array` for `logger-console` or `sms-console`.** Only the `email` capability's array was driven.
- **`remove` with more than one module in one plan**, and cascading removal of a module whose dependent still patches the same file. TC-2.6 reaches the closest state the fixture allows.
- **`update` and patched files.** `updater.ts` still has no hash to compare a patched file against, so a patched file classifies as drift on the next update. Out of scope for issue #36.
- **The playground's own Prettier.** `pnpm play:init` scaffolds with `--no-install`, so `.dev/playground` has no `node_modules` and cannot run its own `pnpm lint`. TC-2.2 and TC-2.4 judge the reverted files by eye instead.
- **Windows and CRLF line endings.** Every run was a Linux container with LF files.
- **Compatibility, accessibility and performance dimensions.** The change ships no UI and touches no hot path, so these do not apply.
