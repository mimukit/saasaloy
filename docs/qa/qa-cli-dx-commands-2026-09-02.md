# QA Plan: env, outdated, new module, and the `requires` descriptor field

_Generated 2026-09-02 · against `7ad29b1` · covers issue #50: the descriptor's `requires` field, `saasaloy env`, `saasaloy outdated`, `saasaloy new module`, and the `create-module` skill edit_

## Summary

- The CLI gains three commands. `saasaloy env` fills every declared variable into the `.dev.vars` or `.env` that reads it. `saasaloy outdated` tables each installed module's current SHA against its latest. `saasaloy new module <name>` scaffolds a registry module. A descriptor can now declare `requires.saasaloy`, and a CLI outside that range refuses the run before it writes a file.
- Working means a person answers one prompt per unset variable and the value lands in the right gitignored file, `outdated --check` fails only on real drift, and a scaffolded module passes `saasaloy doctor` with no hand edits.

## Scope note: why this plan is short

`.afkkit/checks.md` holds twelve checks, C1 to C12. The agent ran all twelve and they pass; see [Automated verification](#automated-verification-by-ai-agent). Three halves need a person, because a command cannot decide them. Those three are the manual cases below.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-50-add-env-outdated-new-module-and-descriptor`, commit `7ad29b1`.
- Repo root: `/home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor`. Every command runs from there unless a step names another directory.
- The CLI must be built. The agent ran `pnpm build` green on this commit, so `packages/cli/dist/index.js` exists.
- The playground at `.dev/playground` carries eight installed modules and the `./saasaloy` shim. The shim sets `SAASALOY_REGISTRY_DIR` to the repo's `modules/` folder.
- Run every step in a real terminal, not in a pipe and not through a capture tool. Two of the three cases are about what the terminal shows.
- No credentials, no auth token, no feature flag.

Confirm the state before you start:

```sh
node -e 'const s=require("./.dev/playground/saasaloy.json");console.log(s.installed)'
```

- [ ] The command prints eight module names, `api` and `waitlist` among them
- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: playground, every declared variable blank | `env` prompts read well in a real terminal | 🟡 Normal |
| TC-1.2 | 1: playground, every declared variable blank | `new module` refuses inside a project, and its prompts read well outside one | 🟢 Low |
| TC-2.1 | 2: a project outside this repo, `.dev.vars` not gitignored | `env` refuses to write a secret into a tracked file | 🔴 Critical |
| TC-3.1 | 3: no setup, read only | `create-module` still reads as guidance | 🟡 Normal |

## Scenario 1: playground, every declared variable blank

**Setup.** Run once, for every case in this scenario.

1. Clear the two files `env` writes, so every declared variable reads as unset.

```sh
cd .dev/playground && rm -f apps/api/.dev.vars apps/web/.env
```

- [ ] Setup complete

### TC-1.1: `env` prompts read well in a real terminal · 🟡 Normal

**Goal.** A person can answer every prompt without reading the descriptor first.

**Steps**

1. Copy the example file over `.dev.vars`, so the file starts as a column of empty placeholders. This is the state a person reaches by following the old procedure.

   ```sh
   cp apps/api/.dev.vars.example apps/api/.dev.vars
   ```

2. Start the command.

   ```sh
   ./saasaloy env
   ```

   - [ ] The command prompts once per unset variable, and no prompt repeats
   - [ ] Each prompt names the variable and reads out the module's own description
     - the description is a sentence, not a truncated fragment
     - a long description wraps inside the terminal, and no line runs off the right edge
     - the box rules and the prompt rail line up

3. Answer each prompt with a short value, such as `v1`, `v2`, `v3`. Answer the `PUBLIC_API_URL` prompt with `http://localhost:4000`.

   - [ ] The closing summary names each file it wrote and each variable it put there
   - [ ] The `wrangler secret put` block is printed, and no `wrangler` process starts

4. Read the file back.

   ```sh
   cat apps/api/.dev.vars
   ```

   - [ ] Each placeholder is filled where it stood, with its comment above it intact
   - [ ] No key appears on two lines

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `new module` refuses inside a project, and its prompts read well outside one · 🟢 Low

**Goal.** The scaffolder never runs in a generated project, and its two prompts are answerable.

**Steps**

1. Run the scaffolder from inside the playground.

   ```sh
   node ../../packages/cli/dist/index.js new module billing
   ```

   - [ ] The command refuses, names the `saasaloy.json` it found, and says nothing was written
   - [ ] No `modules` folder appears in the playground

2. Copy the registry to a scratch folder, so the repo stays clean.

   ```sh
   rm -rf /tmp/qa50 && mkdir -p /tmp/qa50 && cp -r ../../modules /tmp/qa50/modules
   ```

3. Run the scaffolder there with no flags, and answer the prompts.

   ```sh
   cd /tmp/qa50 && node /home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor/packages/cli/dist/index.js new module billing
   ```

   - [ ] The tier prompt lists both tiers and says enough to pick one
   - [ ] The `dependsOn` prompt says the format it wants, and an empty answer is accepted
   - [ ] The closing note names the three paths it wrote and reports the `doctor` result

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after both cases above, before Scenario 2.

```sh
rm -rf /tmp/qa50 && cd /home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor && pnpm play:reset
```

## Scenario 2: a project outside this repo, `.dev.vars` not gitignored

This scenario cannot run in `.dev/playground`. The repo's own `.gitignore` carries `/.dev/`, so every file under the playground is ignored whatever the project's `.gitignore` says. The refusal is only observable in a project that sits outside this repo.

**Setup.** Run once, for the case in this scenario.

1. Create a project in `/tmp` and install `api` into it.

```sh
rm -rf /tmp/qa50-proj && node packages/cli/dist/index.js init /tmp/qa50-proj --force --no-install && cd /tmp/qa50-proj && git init -q . && SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor/modules node /home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor/packages/cli/dist/index.js add api -y
```

- [ ] Setup complete

### TC-2.1: `env` refuses to write a secret into a tracked file · 🔴 Critical

**Goal.** A secret never reaches a file git would commit.

**Steps**

1. Write one value by hand, then take `.dev.vars` out of the project's `.gitignore`.

   ```sh
   printf 'CORS_ORIGINS=keep-me\n' > apps/api/.dev.vars && sed -i '/^\.dev\.vars$/d' .gitignore
   ```

2. Confirm git now tracks the file.

   ```sh
   git check-ignore -v apps/api/.dev.vars; echo "exit=$?"
   ```

   - [ ] The command prints `exit=1`, so the file is not ignored

3. Run `env`.

   ```sh
   SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor/modules node /home/dev/worktrees/saasaloy/issue-50-add-env-outdated-new-module-and-descriptor/packages/cli/dist/index.js env
   ```

   - [ ] The command refuses before it prompts, names `apps/api/.dev.vars`, and says why
   - [ ] The message tells the person to add the file to `.gitignore` and run again

4. Read the file back.

   ```sh
   cat apps/api/.dev.vars
   ```

   - [ ] The file still holds `CORS_ORIGINS=keep-me` and nothing else

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
rm -rf /tmp/qa50-proj
```

## Scenario 3: no setup, read only

**Setup.** None. This case reads one file.

- [ ] Setup complete

### TC-3.1: `create-module` still reads as guidance · 🟡 Normal

**Goal.** The skill still teaches the conventions, now that the scaffolder writes the skeleton.

**Steps**

1. Read `.agents/skills/create-module/SKILL.md` top to bottom.

   - [ ] The document still teaches, rather than listing commands
     - the two tiers are still explained, with the difference between them
     - the capability conventions are still there
     - the vertical-slice section is still there
     - the authoring checklist is still there
   - [ ] Step 2 hands the skeleton to `saasaloy new module <name>` and no later step writes `registry-item.json` from scratch
   - [ ] The `requires` field is explained where an author would look for it
   - [ ] An agent following the document in order would produce a working module

2. Read the diff to the same file.

   ```sh
   git diff origin/main...HEAD -- .agents/skills/create-module/SKILL.md
   ```

   - [ ] Nothing the diff removed was worth keeping

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. Source: `.afkkit/verified.md`, run against this branch and this build._

The gate, run after the review fixes landed:

```sh
pnpm test && pnpm build && pnpm typecheck && pnpm lint
```

The twelve acceptance checks, run against `packages/cli/dist/index.js`:

```sh
cd .dev/playground && ./saasaloy add api -y && ./saasaloy add database-d1 -y && ./saasaloy add waitlist -y
```

```sh
cd packages/cli && pnpm exec vitest run src/lib/cli-requires.test.ts src/lib/semver.test.ts src/lib/gitignore.test.ts src/lib/env-vars.test.ts src/commands/env.test.ts src/commands/outdated.test.ts src/commands/new.test.ts src/lib/new-module.test.ts src/lib/doctor.test.ts src/commands/add.test.ts
```

```sh
cd .dev/playground && SAASALOY_REGISTRY_DIR=/tmp/reg50 node ../../packages/cli/dist/index.js add a -y; echo "exit=$?"
```

```sh
node packages/cli/dist/index.js doctor packages/cli/test/fixtures/registry-broken/bad-requires; echo "exit=$?"
```

```sh
cd .dev/playground && ./saasaloy env --check </dev/null; echo "exit=$?"
```

```sh
cd .dev/playground && ./saasaloy outdated; echo "exit=$?"; ./saasaloy outdated --check; echo "exit=$?"
```

```sh
cd /tmp/regcopy50 && node packages/cli/dist/index.js new module billing --type saasaloy:feature --depends-on api && node packages/cli/dist/index.js doctor modules/billing; echo "exit=$?"
```

- ✅ Gate → `pnpm test` 1069 tests in 49 files, `pnpm build`, `pnpm typecheck` and the four `pnpm lint` passes all exit 0.
- ✅ C1, descriptor `requires` checked before any write → `add c` (satisfiable range) exits 0 and writes its file; `add a` exits 2 and writes nothing. `ls apps/web/src/a.txt apps/web/src/b.txt` finds neither.
- ✅ C2, a mismatch is fatal and transitive → the refusal reads `b (required by a) needs saasaloy >=99, and 0.0.0 is installed. Upgrade with \`pnpm add --global saasaloy@latest\`.` `semver.test.ts` pins `1.x`, `>=0.3`, `>=0.3 <2` and `^1.2.0` as valid ranges.
- ✅ C3, `create-module`, `new module` and `doctor` know `requires` → `grep -n "requires" .agents/skills/create-module/SKILL.md` hits lines 47, 106, 136-145 and 408. `doctor` exits 2 on both bad fixtures, with findings at `/requires/saasaloy`.
- ✅ C4, `env` prompts and routes → an interactive run through a pty wrote `LOGGER_PROVIDER`, `LOG_LEVEL` and `CORS_ORIGINS` to `apps/api/.dev.vars` and `PUBLIC_API_URL` to `apps/web/.env`. The captured prompt text carries the descriptor's own wording. Re-run after the review fix, starting from a file of empty placeholders: each placeholder is filled in place and `grep -c '^CORS_ORIGINS=' apps/api/.dev.vars` gives 1.
- ✅ C5, fills blanks only, refuses a tracked target → a value of `keep-me` is not prompted for and is byte-identical afterwards. With `.dev.vars` removed from `.gitignore`, `env` exits 2 and leaves the file unchanged. Run in `/tmp/proj50`, for the reason Scenario 2 gives.
- ✅ C6, `--check` reports without prompting → with stdin closed, the command lists all four missing names with their declaring module and target file, then exits 2. With every variable set it exits 0.
- ✅ C7, production secrets printed, never run → the output carries one `wrangler secret put` line per secret under `# from apps/api`. `grep -rn "spawn\|execFile\|exec(\|child_process"` over the new `env` files finds nothing.
- ✅ C8, `add` points at `saasaloy env` → both `add api -y` and `add waitlist -y` print the pointer in their next-steps box. Pinned by `add.test.ts:851-859`.
- ✅ C9, `new module` scaffolds and refuses inside a project → the scaffold writes `registry-item.json`, `files/.gitkeep` and `skills/saasaloy-billing/SKILL.md`. Inside the playground, and inside a nested package folder, the same command exits 2 and writes nothing.
- ✅ C10, a fresh scaffold passes `doctor` → `doctor modules/billing` prints `No problems found.` and exits 0, with no hand edits.
- ✅ C11, `create-module` invokes the new command (agent half) → `grep -n "saasaloy new module"` hits lines 52, 87, 145 and 405. The tier, capability, vertical-slice and checklist sections are still in the diff. The guidance half is TC-3.1.
- ✅ C12, `outdated` tables and gates → against a lock entry ten commits behind `main`, the table prints one row per module with five columns and short SHAs, a bare run exits 0, and `--check` exits 2. With `SAASALOY_GITHUB_API=http://127.0.0.1:1` the row reads `unresolvable` and both forms exit 0. Under `SAASALOY_REGISTRY_DIR`, every row reads `local`, nothing counts as drift, and both forms exit 0.
- ✅ Semver differential against `semver@7.8.5` → 44 ranges times 18 versions, prerelease rules included: 0 mismatches.
- ✅ Gitignore differential against `git check-ignore -q --no-index` → 37 cases, 3 mismatches, every one in the "we say not ignored, git says ignored" direction. None turns a refusal into a write.

## Not covered / needs human judgment

- Prompt legibility in a real terminal. The agent drove the prompts through a pty, which wraps differently from a terminal a person sizes. TC-1.1 covers it.
- Whether `create-module` still reads as guidance. TC-3.1 covers it.
- `update` with a `requires` mismatch on an incoming descriptor. Unit tests cover it; no live run.
- `env`'s `ambiguous` route and the `select` prompt it opens. No installed module writes into two app workspaces, so the shape does not occur in the playground.
- `env` against a remote registry. Every live run used `SAASALOY_REGISTRY_DIR`.
- `outdated` with a `pinned` row live. The renderer test covers it.
- Windows path handling in `gitignore.ts`. This box is Linux only.
- `pnpm --filter saasaloy test:e2e` and `test:matrix`. Neither is part of `pnpm test`.
- Compatibility, accessibility and performance dimensions. The change ships no UI and no data path, so none applies.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
