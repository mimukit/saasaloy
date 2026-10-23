# QA Plan: The release step before each production deploy

_Generated 2026-10-23 · against `4e5c8de` (clean), refreshed at `6733b0f` (clean; that commit changes only the plan file) · covers issue #236: `pnpm release`, the release in the deploy output and tag message, the root `version` rule in `saasaloy update` and `saasaloy doctor`, and the release docs_

## Summary
- `pnpm release` gives a generated project a version, a `CHANGELOG.md` entry, a `v*` tag and a GitHub Release before `pnpm deploy:production`.
- Working means the release runs with no question, the deploy names the version, and a release never puts the root `package.json` in a merge plan.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-236-add-a-release-step-with-a-changelog-and-a-version` at `4e5c8de`.
- A GitHub account that can create a private repository, and `gh` signed in to it.
- No Cloudflare account is needed. Every deploy step in this plan is a dry run.

Build the CLI from the branch:

```sh
pnpm install && pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: A new project in a private GitHub repository, no release yet | The first real release creates a correct GitHub Release | 🔴 Critical |
| TC-2.1 | 2: The branch checked out, no project needed | The deploy skill and the runbook read clearly for an agent and a person | 🟡 Normal |
| TC-2.2 | 2: The branch checked out, no project needed | ADR 0049 and the two glossary terms say what the code does | 🟢 Low |

## Scenario 1: A new project in a private GitHub repository, no release yet

**Setup.** Run once, for every case in this scenario.

1. Make a new project in `.dev` with the branch CLI:

```sh
node packages/cli/dist/index.js init .dev/qa-release && pnpm -C .dev/qa-release install
```

2. Make the first commit, and push it to a new private repository:

```sh
cd .dev/qa-release && git init -q && git add -A && git commit -qm "chore: first commit" && gh repo create qa-release-236 --private --source . --push
```

3. Add one feature commit and push it:

```sh
echo faq > faq.txt && git add faq.txt && git commit -qm "feat(web): add the faq page" && git push
```

- [ ] Setup complete

### TC-1.1: The first real release creates a correct GitHub Release  ·  🔴 Critical

**Goal.** A real `pnpm release` on GitHub makes the version, the tag and the GitHub Release that the dry run promised.

**Steps**

1. Run the release:

   ```sh
   pnpm release
   ```

   - [ ] The run ends with `Done`, and it asks no question
2. Open the release page in a browser:

   ```sh
   gh release view v0.1.0 --web
   ```

   - [ ] The GitHub Release `v0.1.0` reads correctly
     - the title is `v0.1.0`
     - the body is the `0.1.0` entry from `CHANGELOG.md`, with the `faq` feature under `Features`
     - the tag `v0.1.0` points at the commit `chore(release): v0.1.0`
3. Run the deploy dry run:

   ```sh
   pnpm deploy:production --dry-run
   ```

   - [ ] The first line names `(v0.1.0)`, and the output has no `Warning:` line

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before you move to Scenario 2. The first command deletes the GitHub repository.

```sh
gh repo delete qa-release-236 --yes
```

```sh
cd ../.. && rm -rf .dev/qa-release
```

## Scenario 2: The branch checked out, no project needed

**Setup.** Run once, for every case in this scenario.

1. Open the branch in your editor. No command is needed.

- [ ] Setup complete

### TC-2.1: The deploy skill and the runbook read clearly for an agent and a person  ·  🟡 Normal

**Goal.** An agent that reads only the skill releases and deploys in the right order, and stops for the owner where it must.

**Steps**

1. Read `packages/cli/templates/base/_agents/skills/saasaloy-deploy/SKILL.md`, from "The rule" to "The release".
   - [ ] The go-ahead rule covers `pnpm release` as clearly as the deploy
     - `pnpm release:dry` may run with no go-ahead; `pnpm release` may not
     - the procedure checks `git status -sb` before the release, and says why
     - the report template has a `Release:` line
2. Read the sections "Hotfix" and "A project made before the release step".
   - [ ] The hotfix merge-back steps are clear enough to follow during an incident
     - merge, never rebase
     - the `CHANGELOG.md` and `version` conflict, and which side to keep
     - the note that the hotfix release path is unproven
3. Read `packages/cli/templates/base/docs/runbook-deploy.md`.
   - [ ] A person reads the two-step flow (`pnpm release`, then `pnpm deploy:production`) at the top of the commands table

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: ADR 0049 and the two glossary terms say what the code does  ·  🟢 Low

**Goal.** The decision record and the glossary match the shipped behaviour.

**Steps**

1. Read `docs/adr/0049-adr-a-release-names-each-production-deploy-2026-10-23.md`, and the `Release` and `Release tag` entries in `CONTEXT.md`.
   - [ ] The ADR and the glossary agree with the code and with each other
     - the first release is `0.1.0`, and below 1.0 a breaking change bumps the minor
     - the deploy warns and never refuses
     - `update` keeps the project's `version`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

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
pnpm release:smoke
```

```sh
pnpm deps:check
```

```sh
pnpm -C .dev/playground typecheck && pnpm -C .dev/playground lint && pnpm -C .dev/playground test
```

- ✅ `pnpm lint` at `4e5c8de` → exit 0. All four passes are clean.
- ✅ `pnpm typecheck` at `4e5c8de` → exit 0.
- ✅ `pnpm test` at `4e5c8de` → exit 0. The CLI suite has 1427 tests and the tooling suite has 136, with 0 failures in every `node --test` run.
- ✅ `pnpm release:smoke` at `990f88d` → `saasaloy@0.6.1 packs, installs outside the workspace, scaffolds a project ... and passes pnpm lint with every module in 2 project(s).` The later commit `4e5c8de` changes only the plan file.
- ❌ `pnpm deps:check` at `990f88d` → exit 1, `78 outdated · 71 up-to-date`. Two of the 78 are this branch's new pins: `release-it` 21.0.2 → 21.1.1 and `@release-it/conventional-changelog` 12.0.0 → 12.0.2. They are the versions primeshopr proved. The other 76 are on `main`, which the acceptance check verifies.
- ✅ The playground typecheck, lint and test, with the branch's `packages/tooling` files → exit 0 each. The tooling tests are 100 of 100, and `release.ts` typechecks against release-it's own types.

### Scenarios on the disposable target
_Run by the agent in `.dev/playground` (reset: `pnpm play:reset`), with a local bare origin in `.dev/origin.git`, at `990f88d`. The playground keeps its state for inspection; `pnpm play:reset` rebuilds it._

- ✅ C2 · `pnpm release:dry` after two `feat:` commits → `🚀 Let's release playground (0.0.0...0.1.0)`, with both commits under `### Features`.
- ✅ C3 · `pnpm release` with no `GITHUB_TOKEN` and no signed-in `gh` → exit 1, `The release did not start, because a GitHub Release needs a token and none was found.` The version stayed `0.0.0`, and no tag or commit was made.
- ✅ C5 · `pnpm deploy:production --dry-run` with no release → `Branch main at 4ee0c5d (no release tag).` and `Warning: HEAD has no release tag yet ...`. The dry run exits 0.
- ✅ `pnpm release` with `githubRelease: false` in the playground only → commit `ec7e007 chore(release): v0.1.0`, tag `v0.1.0`, `CHANGELOG.md` with `# Changelog` and `## 0.1.0`, pushed to the local origin.
- ✅ C4, C5 · the deploy dry run on the release commit → `Branch main at ec7e007 (v0.1.0).`, no warning. After one `fix:` commit → `Branch main at 8eea466 (1 commit(s) after v0.1.0).` and the warning lists `8eea466 fix(web): fix the faq link`.
- ✅ `pnpm release:dry` after that `fix:` → `0.1.0...0.1.1`, with the fix under `### Bug Fixes` and no `chore` commit in the entry.
- ✅ The release refuses on a dirty tree → `Working dir must be clean.` The clean-tree check stays on.

### Update and doctor on a released project
_Run by the agent in `.dev/c14` (deleted after), made with the CLI from `origin/main` at `569e0b4`, then a `version` bump to `0.1.0`._

- ✅ C7 · `saasaloy update base --dry-run` → the root `package.json` is `update`, not a merge. `saasaloy update base --yes` kept `"version": "0.1.0"` and added `release` and `release:dry`. A second dry run lists the file as up to date.
- ✅ C14 · the merge plan holds one file, `packages/tooling/src/deploy.config.ts`, which is owned, so nothing was written. Nine files were written, and `release.ts` and its test were created.
- ✅ `saasaloy doctor` → `115 files match the record`, the bumped root `package.json` included.
- ✅ C8 · `saasaloy doctor` with the root `release` script removed → one Deploy warning: `packages/tooling/src/release.ts exists and the root package.json has no release script ...`.

### Acceptance checks
_One line per acceptance criterion of issue #236, at `4e5c8de` unless the line names another revision._

- ✅ C1 · the base root `package.json` has `release` and `release:dry` on `node packages/tooling/src/release.ts`, and `packages/tooling/package.json` pins `release-it` 21.0.2 and `@release-it/conventional-changelog` 12.0.0 exactly.
- ✅ C2 · `0.0.0...0.1.0` in the playground (above).
- ✅ C3 · the release refused with no token (above).
- ✅ C4 · the tag message test expects `Production deploy of 7812604 (v0.3.0): api, web.`, and the playground dry run printed `(v0.1.0)`.
- ✅ C5 · the warning lists the commits after the release, and the deploy test still tags (`warns, lists the commits past the release, and still deploys and tags`).
- ✅ C6 · `release.test.ts` (18 tests) and the new `deploy-production.test.ts` cases run with a fake `Io`, and `release.ts` loads release-it only inside `main`.
- ✅ C7 · `update` kept `0.1.0` (above), and `base.test.ts` covers overwrite, unchanged and a real edit.
- ✅ C8 · the doctor warning (above), and `doctor.test.ts` covers it.
- ✅ C9 · the skill has "The release", the `git status -sb` step, the release in both report templates, and the hotfix merge-back. The runbook has the two-step flow. TC-2.1 is the human read.
- ✅ C10 · the base `AGENTS.md` "Branches and Deploys" has "Release before you deploy" and the merge-never-rebase rule.
- ✅ C11 · at `6733b0f` · the commit `docs(template)!: carry the release step merge steps to the changelog` carries the merge steps in its `BREAKING CHANGE:` footer, which release-it writes into `packages/cli/CHANGELOG.md` at the next CLI release. #234 used the same footer in `1540dca`. The CLI sets `ignoreRecommendedBump: true`, so the footer does not pick the version.
- ✅ C12 · `docs/adr/0049-adr-a-release-names-each-production-deploy-2026-10-23.md` cites ADRs 0048, 0034 and 0020, and `CONTEXT.md` has `Release` and `Release tag`.
- ✅ C13 · `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (above).
- ✅ C14 · the merge plan is recorded here and in plan 0078, Phase 6.
- ✅ C15 · `pnpm release:smoke` passed at `990f88d` (above).

## Not covered / needs human judgment
- A real deploy to Cloudflare that writes a `deploy-*` tag with the version in its message. The unit tests and the dry runs cover the message, and primeshopr's `deploy-20261023-0616` proved it on a live deploy.
- A release from a `hotfix-*` branch, and its merge back into `main`. Plan 0078 Q4 keeps this path unproven until a real hotfix.
- Branch protection on `main`, which refuses the release push. The plan settled no rule for it.
- Compatibility, accessibility and performance: the change has no UI, and the release runs once per deploy.
- Concurrency: two releases at the same time on one branch. The second push fails on a non-fast-forward, as for any push.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
