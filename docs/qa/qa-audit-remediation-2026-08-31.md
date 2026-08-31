# QA Plan: 2026-08-30 audit remediation (issue #98)

_Generated 2026-08-31 · against `d56aab8` · covers the seven remediation phases: the CI gate, the `add` write path, the database driver split, the fail-closed auth secret, the unified apply engines, `update` correctness, and the 14 DX and doc-truth items._

## Summary

- The branch closes the findings of the 2026-08-30 audit across the CLI, the module descriptors, the `auth` payload, and the docs.
- Working means a scaffolded project installs modules without a manifest error, the driver split refuses a mismatched pair, the auth Worker refuses to start without a signing secret outside local dev, and the CI gate stops a bad push.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Worktree `/home/dev/worktrees/saasaloy/issue-98-remediate-the-2026-08-30-audit-findings`, branch `issue-98-remediate-the-2026-08-30-audit-findings`, commit `d56aab8`.
- Node 24.13.0 (`.nvmrc`), pnpm 11.
- Run every command from the worktree root unless the step says otherwise.
- Run all CLI commands against `.dev/playground`, per AGENTS.md. `.dev/playground/saasaloy` is a shim that points the CLI at this repo's `modules/` directory.
- Scenario 5 needs the pull request for issue #98 and a GitHub account with push rights on the branch.
- The api dev server listens on port 4000. The web dev server listens on port 3000. Both ports must be free.

Install the workspace once:

```sh
pnpm install --frozen-lockfile
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh playground, no modules | The interactive picker and the driver rail | 🟡 Normal |
| TC-1.2 | 1: fresh playground, no modules | `add auth` lands the driver's files and reports its next steps | 🔴 Critical |
| TC-1.3 | 1: fresh playground, no modules | `list` and the picker separate installed from available | 🟡 Normal |
| TC-1.4 | 1: fresh playground, no modules | The `add` → `remove` → `add` round trip and `update --dry-run` | 🔴 Critical |
| TC-2.1 | 2: playground with auth and waitlist, dependencies installed | The generated project typechecks | 🔴 Critical |
| TC-2.2 | 2: playground with auth and waitlist, dependencies installed | The auth Worker fails closed without a secret | 🔴 Critical |
| TC-2.3 | 2: playground with auth and waitlist, dependencies installed | The waitlist form renders the api's error message | 🟡 Normal |
| TC-3.1 | 3: fresh playground on database-postgres | `add auth` refuses the mismatched driver | 🔴 Critical |
| TC-4.1 | 4: repository files only | The three skills document both drivers | 🟡 Normal |
| TC-4.2 | 4: repository files only | The ADR 0026 amendment retracts the old claim | 🟢 Low |
| TC-4.3 | 4: repository files only | The wiki describes the CLI that ships | 🟡 Normal |
| TC-5.1 | 5: the open pull request | The CI gate turns the pull request red, then green | 🔴 Critical |

## Scenario 1: fresh playground, no modules

**Setup.** Run once, for every case in this scenario. This builds the CLI and rescaffolds `.dev/playground`.

```sh
pnpm play:reset
```

- [ ] Setup complete

### TC-1.1: The interactive picker and the driver rail · 🟡 Normal

**Goal.** The picker and the `requiresOneOf` driver prompt are usable in a real terminal, which no automated check can reach.

**Steps**

1. Start `add` with no module name, from an interactive terminal.

   ```sh
   cd .dev/playground && ./saasaloy add
   ```

   - [ ] The picker lists the available modules and marks none as installed
     - the list holds all 16 modules
     - `web` does not appear, because it is the base app and not a module
2. Select `database` and confirm the selection.
   - [ ] A second rail asks which driver to install, and offers `database-d1` and `database-postgres`
   - [ ] The rail's wording explains why the choice is needed
3. Cancel the run with `Ctrl+C` before the apply confirm.
   - [ ] The CLI exits without writing, and `.dev/playground/.saasaloy/manifest.json` still lists no modules

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `add auth` lands the driver's files and reports its next steps · 🔴 Critical

**Goal.** A first-party `add auth` writes the D1 driver's own `packages/db/tsconfig.json` and ends with a usable pointer to the skill and the env vars.

**Steps**

1. Install `auth` and its prerequisites.

   ```sh
   cd .dev/playground && ./saasaloy add auth --yes
   ```

   - [ ] The command exits 0 and reports `api`, `auth`, `database`, `database-d1`, `logger`, `logger-console` as applied
   - [ ] The output holds no `Changed under us` line
     - review round 1 recorded this line for `packages/db/tsconfig.json` before the fix, and the fix is not re-verified live
   - [ ] The last block names the module's slash command and lists the env vars to set
     - the block names `/saasaloy-auth`
     - the block names `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `COOKIE_DOMAIN`
     - the block points at `apps/api/.dev.vars.example`
2. Read the driver's tsconfig.

   ```sh
   cat .dev/playground/packages/db/tsconfig.json
   ```

   - [ ] `types` holds `@cloudflare/workers-types`, which is the D1 driver's copy and not the core's
3. Read the generated env example.

   ```sh
   cat .dev/playground/apps/api/.dev.vars.example
   ```

   - [ ] The file explains the copy step and carries one empty `KEY=` line per declared variable, with no secret value
     - `BETTER_AUTH_URL` carries the `http://localhost:4000` default

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: `list` and the picker separate installed from available · 🟡 Normal

**Goal.** After an install, the tool tells the operator what is already there and stops offering it.

**Steps**

1. List the modules.

   ```sh
   cd .dev/playground && ./saasaloy list
   ```

   - [ ] The six installed modules carry the installed mark and the other ten do not
   - [ ] The footer reads `16 modules · 6 installed`, and a separate line names `web` as the base app
2. Start the picker again.

   ```sh
   cd .dev/playground && ./saasaloy add
   ```

   - [ ] The picker no longer offers the six installed modules
3. Cancel with `Ctrl+C`.
   - [ ] The CLI exits without writing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The `add` → `remove` → `add` round trip and `update --dry-run` · 🔴 Critical

**Goal.** Every command after the first `add` still loads the manifest the tool wrote, which is the failure the manifest schema fix closed.

**Steps**

1. Add a second module on top of the installed set.

   ```sh
   cd .dev/playground && ./saasaloy add waitlist --yes
   ```

   - [ ] The command exits 0 and reports no manifest error
2. Remove it again.

   ```sh
   cd .dev/playground && ./saasaloy remove waitlist --yes
   ```

   - [ ] The command exits 0 and reports the removed files
   - [ ] `apps/api/src/index.ts` no longer chains the `/waitlist` route
3. Add it back.

   ```sh
   cd .dev/playground && ./saasaloy add waitlist --yes
   ```

   - [ ] The command exits 0 and the project returns to the state of step 1
4. Preview an update over the whole project.

   ```sh
   cd .dev/playground && ./saasaloy update --dry-run
   ```

   - [ ] The command exits 0 and prints a plan or reports that everything is current
   - [ ] No output names an invalid manifest or an invalid lockfile

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset. Scenario 2 continues from this playground.

## Scenario 2: playground with auth and waitlist, dependencies installed

**Setup.** Run once, for every case in this scenario. Scenario 1 must have passed first, so the playground holds `auth` and `waitlist`.

Install the generated project's dependencies:

```sh
cd .dev/playground && pnpm install
```

Create the local env file from the generated example:

```sh
cd .dev/playground && cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Open `.dev/playground/apps/api/.dev.vars` and set `BETTER_AUTH_URL=http://localhost:4000`. Leave `BETTER_AUTH_SECRET` empty for now.

- [ ] Setup complete

### TC-2.1: The generated project typechecks · 🔴 Critical

**Goal.** `packages/db` compiles with the driver's type packages, which proves the shared-target fix landed. No automated step could prove this, because it needs an install.

**Steps**

1. Typecheck the whole generated workspace.

   ```sh
   cd .dev/playground && pnpm typecheck
   ```

   - [ ] The command exits 0
     - a failure naming `D1Database` means `packages/db/tsconfig.json` lost `@cloudflare/workers-types`
2. Build the generated workspace.

   ```sh
   cd .dev/playground && pnpm build
   ```

   - [ ] The command exits 0

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The auth Worker fails closed without a secret · 🔴 Critical

**Goal.** A missing `BETTER_AUTH_SECRET` stops the Worker outside local dev, and a loopback `BETTER_AUTH_URL` is the only escape hatch.

**Steps**

1. Start the api dev server with `BETTER_AUTH_URL=http://localhost:4000` and no secret.

   ```sh
   cd .dev/playground/apps/api && pnpm dev
   ```

   - [ ] The server starts on port 4000 and prints no `BETTER_AUTH_SECRET` error
2. Call the auth route from a second terminal.

   ```sh
   curl -i http://localhost:4000/auth/ok
   ```

   - [ ] The response is a 2xx, so the loopback escape hatch works
3. Stop the server. Edit `.dev/playground/apps/api/.dev.vars` and set `BETTER_AUTH_URL=https://api.example.com`. Keep `BETTER_AUTH_SECRET` empty. Start the server again and repeat the request.

   ```sh
   curl -i http://localhost:4000/auth/ok
   ```

   - [ ] The request fails, and the api dev server's log names `BETTER_AUTH_SECRET`
     - the message names `wrangler secret put BETTER_AUTH_SECRET` and the `apps/api/.dev.vars` alternative
     - the message names the loopback `BETTER_AUTH_URL` exemption
4. Stop the server. Set `BETTER_AUTH_SECRET` in `.dev.vars` to any 32-character string. Keep `BETTER_AUTH_URL=https://api.example.com`. Start the server again and repeat the request.
   - [ ] The server starts and the request succeeds, so a set secret needs no loopback URL
5. Stop the server. Set `BETTER_AUTH_URL=http://localhost.attacker.example:4000` and clear `BETTER_AUTH_SECRET`. Start the server again and repeat the request.
   - [ ] The request fails with the same `BETTER_AUTH_SECRET` error, so a hostname that merely contains `localhost` gets no exemption
6. Restore `.dev.vars` to `BETTER_AUTH_URL=http://localhost:4000` with `BETTER_AUTH_SECRET` set. Stop the server.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The waitlist form renders the api's error message · 🟡 Normal

**Goal.** A 400 whose body carries the typed error envelope reaches the user as the api's own message, not as the generic text.

**Steps**

1. Start both dev servers from the playground root.

   ```sh
   cd .dev/playground && pnpm dev
   ```

   - [ ] The web server listens on port 3000 and the api server on port 4000
2. Confirm the api's refusal shape directly.

   ```sh
   curl -i -X POST http://localhost:4000/waitlist -H 'Content-Type: application/json' -d '{"email":"not-an-email"}'
   ```

   - [ ] The status is 400 and the body is `{ "error": { "code": ..., "message": ... } }`
3. Open `http://localhost:3000` in a browser. Scroll to the "Get early access" section. Enter `not-an-email` and submit.
   - [ ] The form renders the same `message` the curl call returned, not `Something went wrong — try again.`
   - [ ] The error text is legible against its panel and the form stays usable
4. Enter a valid address, for example `qa@example.com`, and submit.
   - [ ] The form renders its success state
5. Stop the api server only, then submit again.
   - [ ] The form renders `Something went wrong — try again.`, because there is no envelope to read
6. Stop the dev servers.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3. Stop every dev server first.

```sh
pnpm play:reset
```

## Scenario 3: fresh playground on database-postgres

**Setup.** Run once, for the single case in this scenario.

```sh
pnpm play:reset && (cd .dev/playground && ./saasaloy add database-postgres --yes)
```

- [ ] Setup complete

### TC-3.1: `add auth` refuses the mismatched driver · 🔴 Critical

**Goal.** A project on Postgres cannot install a module that pins D1, and the refusal says which three modules are involved.

**Steps**

1. Read the Postgres driver's tsconfig.

   ```sh
   cat .dev/playground/packages/db/tsconfig.json
   ```

   - [ ] `types` holds `node`, which is the Postgres driver's copy and not the core's
2. Try to add `auth`.

   ```sh
   cd .dev/playground && ./saasaloy add auth --yes; echo "exit $?"
   ```

   - [ ] The command exits 2
   - [ ] The message names all three of `auth`, `database-d1` and `database-postgres`, and it tells the operator to remove `database-postgres` first
   - [ ] The message is the driver refusal, not a manifest validation error
3. Confirm nothing was written.

   ```sh
   cd .dev/playground && git status --short 2>/dev/null; ls apps/api/src/routes
   ```

   - [ ] No `auth.ts` route file exists

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
pnpm play:destroy
```

## Scenario 4: repository files only

**Setup.** No setup. Read the files in the worktree. Every path is relative to the worktree root.

- [ ] Setup complete

### TC-4.1: The three skills document both drivers · 🟡 Normal

**Goal.** An agent reading a skill gets correct instructions for Postgres, not D1 instructions with a Postgres word pasted in.

**Steps**

1. Read `modules/database/skills/saasaloy-database/SKILL.md`, `modules/auth/skills/saasaloy-auth/SKILL.md` and `modules/waitlist/skills/saasaloy-waitlist/SKILL.md`.
   - [ ] Each file names both drivers and gives the correct script names for each one
     - the migration and studio commands differ between D1 and Postgres, so check the names against `modules/database-d1/files/package.json` and `modules/database-postgres/files/package.json`
     - the `auth` and `waitlist` skills state that those modules pin D1 today
   - [ ] No instruction tells the reader to run a D1 command against a Postgres project

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.2: The ADR 0026 amendment retracts the old claim · 🟢 Low

**Goal.** The record says plainly that the "no branch needed" claim was wrong, so nobody re-derives it.

**Steps**

1. Read `docs/adr/adr-0026-database-driver-split-2026-08-28.md`.
   - [ ] The amendment section dated 2026-08-31 states what was retracted and why, and the retracted line is marked in place
   - [ ] The text says `auth` and `waitlist` pin D1 until they get a branch, and it defers the dialect-neutral payloads to issue #99

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.3: The wiki describes the CLI that ships · 🟡 Normal

**Goal.** A new reader following the docs runs commands that exist and reads module descriptions that match the modules.

**Steps**

1. Read `docs/wiki/index.md` and `docs/wiki/reference.md`.
   - [ ] Both name five commands, and the `update` section describes what `update` actually does
2. Read `docs/wiki/modules.md`.
   - [ ] Each of the 16 rows describes its module correctly, including the two drivers
3. Read `packages/cli/templates/base/AGENTS.md`.
   - [ ] The named scripts match `packages/cli/templates/base/package.json`
     - a known leftover: the file names `pnpm test`, which the template does not declare. Record whether it is still there.
4. Read `CONTRIBUTING.md`.
   - [ ] It states that the repo does not use changesets and points at issue #46

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset.

## Scenario 5: the open pull request

**Setup.** Run once, for the single case in this scenario. The pull request for issue #98 must exist and its first CI run must have finished.

```sh
gh pr checks --watch
```

- [ ] Setup complete

### TC-5.1: The CI gate turns the pull request red, then green · 🔴 Critical

**Goal.** GitHub Actions actually fails a bad push. This is the one criterion nobody could confirm locally, because no pull request existed when the checks ran.

**Steps**

1. Read the run of the current head.
   - [ ] The `gate` job passed, and its log shows `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm verify:content` each running
   - [ ] No step runs `deps:verify`
2. Plant a lint error on the branch and push it. Do not use `packages/cli/src/cli.ts`, which the config exempts from `no-console`.

   ```sh
   printf '\nconsole.log("temporary lint canary — issue #98 C0.4");\n' >> packages/cli/src/lib/registry.ts && git commit -am "test: lint canary, do not merge" && git push
   ```

   - [ ] A new CI run starts on the pull request
3. Watch the run.

   ```sh
   gh pr checks --watch
   ```

   - [ ] The `gate` job fails, and the failure is the `pnpm lint` step naming `packages/cli/src/lib/registry.ts`
   - [ ] GitHub marks the pull request as not mergeable while the check is red
4. Revert the canary and push again.

   ```sh
   git revert --no-edit HEAD && git push
   ```

   - [ ] The next run's `gate` job passes and the pull request goes green again
5. Drop the two throwaway commits before merge, or squash them. Record which you did.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. All 43 acceptance checks and the whole-issue gate ran on 2026-08-31 against this worktree. Two checks (C2.6, C5.5) failed on the first pass and were re-run green after fix round 1._

Commands run (a representative one per group; the full record is in `.afkkit/verified.md`):

```sh
pnpm test
```

```sh
pnpm lint && pnpm typecheck && pnpm build && pnpm verify:content
```

```sh
pnpm play:reset && (cd .dev/playground && ./saasaloy add database-postgres --yes && ./saasaloy add auth --yes); echo $?
```

```sh
grep -nE "^on:|push|pull_request|pnpm (lint|typecheck|test|verify:content)" .github/workflows/ci.yml
```

Phase 0, the CI gate:

- ✅ C0.1 → `.github/workflows/ci.yml` runs on `push` and `pull_request`, with one `gate` job that runs the four gate commands after `pnpm install --frozen-lockfile`.
- ✅ C0.2 → `packages/cli` `test` is `vitest run --coverage`; the run prints a per-file table, `All files 68.2%` statements.
- ✅ C0.3 → the only `deps:verify` string in the workflow is a header comment; there is no `run:` step for it.
- ✅ C0.4, local half → a `console.log` appended to `packages/cli/src/lib/registry.ts` makes `pnpm lint:code` exit 1 and name the line; the revert restores exit 0. The GitHub half is TC-5.1 and is not confirmed.

Phase 1, the write path:

- ✅ C1.1 → `applier.ts` resolves all four write targets through `resolveWithinRoot`; no `join(root` remains.
- ✅ C1.2 → `assertNoSymlinkPath` guards the file write, the patch and the skill link; four symlink-refusal tests pass.
- ✅ C1.3 → `files[].target`, `patches[].file` and the scaffold target each carry `"not": { "pattern": "(^|/)\\.\\.?(/|$)" }`; six schema tests pass, including one that still accepts a dot-leading file name.
- ✅ C1.4 → `upsertPackageJsonScript` refuses all six install lifecycle keys by name; twelve tests pass, plus an applier-level test that still allows an ordinary script starting with a lifecycle word.
- ✅ C1.5 → the malicious-descriptor test refuses by name; `pnpm test` exits 0 with 490 vitest tests and 37 `node --test` tests.

Phase 2, the driver split:

- ✅ C2.1 → `auth` declares `["api", "database", "database-d1"]`; `waitlist` declares the same plus `validators`.
- ✅ C2.2 → `requiresOneOf` is a schema property, `modules/database` sets it to the two drivers, and `requires.test.ts` covers the schema and the refusal.
- ✅ C2.3 → `withDb` is exported from `modules/database-postgres/files/src/client.ts:116` and closes the client through `waitUntil`. It lives in `client.ts`, not a separate file.
- ✅ C2.4, presence only → all three `SKILL.md` files name `database-postgres`. The prose is TC-4.1.
- ✅ C2.5, presence only → `adr-0026-database-driver-split-2026-08-28.md` carries `accepted, amended 2026-08-31`, a marked retraction and an amendment section. The wording is TC-4.2.
- ✅ C2.6, re-run after fix round 1 → the second `add` exits 2 with `database-d1 (required by auth) declares a conflict with database-postgres, which is already installed.` TC-3.1 repeats it by hand.

Phase 3, the fail-closed auth secret:

- ✅ C3.1 → the "falls back to Better Auth's dev default" comment is gone repo-wide; `requireAuthSecret` in `modules/auth/files/src/env.ts:64` throws with a message naming `BETTER_AUTH_SECRET` and `wrangler secret put`.
- ✅ C3.2 → `modules/auth/files/src/env.test.ts` covers `deriveCookieDomain` with six cases and `requireAuthSecret` with four, including the loopback exemption. All pass under `node --test`.

Phase 4, the unified engines:

- ✅ C4.1 → `listModuleFiles` is exported from `applier.ts` and imported by `updater.ts`; the hand-copy and its comment are gone, and a parity test asserts both paths enumerate the same files.
- ✅ C4.2 → `previewPatches` is exported from `applier.ts:234` and used by both `applier.ts` and `updater.ts`. `remover.ts` keeps `previewPatchRemoval`, which is the reverse direction and not a copy.
- ✅ C4.3 → one `samePatchEntry`, in `manifest.ts:56`, imported by `applier.ts`, `updater.ts` and `remover.ts`.
- ✅ C4.4 → `executePlan` calls `stillMatches` before each write and reports misses as "Changed under us"; two drift tests pass.
- ✅ C4.5 → `WRITABLE` is `new Set(["create", "overwrite"])`; an unchanged file refreshes its manifest entry without a rewrite.
- ✅ C4.6 → with the apply forced to throw, `package.json` is untouched.

Phase 5, `update` correctness:

- ✅ C5.1 → four tests carry `conflictsWith` through the plan and into the lock entry.
- ✅ C5.2 → `commands/update.ts` imports `detectConflicts` at `:13` and calls it at `:571`; a conflicting update is refused and a clean one passes.
- ✅ C5.3 → the `process.stdout.isTTY` auto-approve branch is gone. Live, `update` with no terminal exits 2 with `No terminal to confirm in — re-run with --yes to apply, or --dry-run to preview.` and writes nothing.
- ✅ C5.4 → four tests cover the new-env-var report, the no-merge-base case and the unchanged case.
- ✅ C5.5, re-run after fix round 1 → `loadManifest` and `loadLock` validate on load; a corrupt hash makes `add` exit 2 with the validator's own error text. The manifest schema now lists all five patch kinds, and a test holds both schemas to the engine's `PATCH_KINDS`.

Phase 6, DX and doc truth:

- ✅ C6.1 → the `Next steps` block names the module's slash command and re-prints `CORS_ORIGINS`, `LOGGER_PROVIDER`, `LOG_LEVEL`, `PUBLIC_API_URL`. `nextSteps` appears nowhere in `packages` or `modules`. The pointer names the slash command, not the skill path the check text predicted.
- ✅ C6.2 → `apps/api/.dev.vars.example` generates from the descriptors, with one `KEY=` line per declared variable and no secret value.
- ✅ C6.3 → `--version` and `-v` print `0.0.0`; `add --help` prints usage and exits 0; all five commands exit 2 on `--bogus` with the same message shape.
- ✅ C6.4 → a refusal exits 2, an unexpected failure exits 1, and `SAASALOY_DEBUG=1` prints the error name and the full stack. `--help` documents the scheme.
- ✅ C6.5 → the one `fetch` passes `signal: AbortSignal.timeout(15_000)`, and the offline hint naming `SAASALOY_REGISTRY_DIR` is appended to the network, rate-limit and 404 messages.
- ✅ C6.6, `list` half → `list` marks six of 16 modules installed and names `web` as the base app on its own line. The picker is TC-1.1 and TC-1.3.
- ✅ C6.7 → `init` into an empty directory outside a repo creates `.git`; `init` inside an existing repo skips it, and `--no-git` exists.
- ✅ C6.8 → `managedModules` is gone from `packages/cli/src`; `saasaloy.schema.json` declares `base`; the template's `saasaloy.json` is `{ "base": "web", "aliases": {…}, "installed": [] }`.
- ✅ C6.9, mechanical half → no `four commands` anywhere; both wiki files say five. `docs/wiki/modules.md` has a row for each of the 16 module directories and names no module that does not exist. `CONTRIBUTING.md:17` states that changesets are not used. The prose is TC-4.3, which also carries the one leftover: the template `AGENTS.md` names `pnpm test`, which the template does not declare.
- ✅ C6.10 → two files carry 0023, and the three 2026-08-28 duplicates renumbered to 0026, 0027 and 0028. No file cites a renumbered ADR by its old number. A bare "ADR 0023" citation is still ambiguous between the two remaining files, which the issue did not ask to fix.
- ✅ C6.11 → root `package.json`, `packages/cli/package.json`, `.nvmrc` and `README.md` all name 24.13.0.
- ✅ C6.12 → `@cloudflare/workers-types` is `5.20260801.1` in all six payloads that declare it; `zod` and `@hono/zod-validator` are gone from `modules/api`. The tanstack pair stays at `1.170.32` and `1.168.35`, because npm publishes no plugin release above `1.168.35`.
- ✅ C6.13 → `escapeHtml` has 7 cases, `safeUrl` 6, `redact` 7 and `deriveCookieDomain` 6, all passing.
- ✅ C6.14, code path only → `WaitlistForm.tsx:26-41` parses the envelope structurally and falls back to the generic text. The rendered result is TC-2.3.

Whole-issue gate:

- ✅ CG.1 → `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm verify:content` each exit 0 on the final tree. 505 vitest tests and 37 `node --test` tests pass.

Two defects the checks found were fixed after the recorded run, and only the first was re-verified live:

- The manifest schema rejected three of the five patch kinds the tool writes, which broke every second command in any project. Fixed and re-verified under C2.6 and C5.5.
- The core and the driver both scaffold `packages/db/tsconfig.json`, so the driver's copy was dropped as late drift and the project lost its type package. Fixed in commit `b4855e6`; TC-1.2, TC-2.1 and TC-3.1 confirm the fix by hand.

## Not covered / needs human judgment

- **The `SAASALOY_DEBUG` cause-chain print.** The one site that attaches a `cause` needs a network timeout or a DNS failure. The 404 path attaches none, so nobody has seen the chain print. Reproducing it needs a controlled network fault, which this plan does not set up.
- **The descriptor source-path traversal hole.** Review round 1 recorded that `files[].path` gained a guard in commit `0f24b44`. Proving the exploit needs a hostile third-party descriptor, which needs a remote registry the plan does not stand up. The schema and the unit tests cover it.
- **Coverage thresholds.** The suite reports 68.2% statements. No threshold is enforced and none was asked for. Nobody has judged whether the number is adequate.
- **Compatibility and accessibility.** The only UI change is the waitlist form's error text. TC-2.3 checks it in one browser at desktop width. Cross-browser, mobile and screen-reader passes are out of scope for this branch.
- **Performance and concurrency.** The branch adds no request path and no data volume. Both dimensions are considered and skipped.
- **A remote registry install.** Every CLI run in this plan uses the local `modules/` directory through the playground shim. The `owner/repo` fetch path is covered by the automated checks only.
