# QA Plan: release pipeline gaps (issue #358, phases 2 to 6)

_Generated 2026-11-19 · updated 2026-11-19 · against `0e9d54d8` (clean) · covers the late update note, the smoke fix, the `ci` module workflow, `release.include`, and the OIDC publish workflow_

## Summary
- The branch lets a later commit cover a breaking commit's missing update note, fixes the D1 smoke timeout and the `ci` module workflow, adds `release.include`, and moves the npm publish to a tag-started OIDC workflow.
- "Working" means `pnpm release` can pass its preflight for 0.9.0 and the first `v*` tag publishes with provenance after the owner approves.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-358-publish-with-oidc-fix-the-ci-module-and-ship-0-9-0`, or `main` after the merge.
- No dev server and no UI. Each case reads a file, a GitHub run, or a command output.
- Screenshots: none. No case judges a screen.

```sh
cd /home/dev/worktrees/saasaloy/issue-358-publish-with-oidc-fix-the-ci-module-and-ship-0-9-0 && pnpm install --frozen-lockfile
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: branch checked out, nothing merged | the new release docs read correctly | 🟡 Normal |
| TC-1.2 | 1: branch checked out, nothing merged | the walkthrough sections fit a saasaloy project | 🟢 Low |
| TC-2.1 | 2: branch merged to `main` | two smoke runs pass on one `main` commit | 🔴 Critical |

## Scenario 1: branch checked out, nothing merged

**Setup.** Run once, for every case in this scenario.

1. Open the worktree in your editor.

- [ ] Setup complete

### TC-1.1: the new release docs read correctly  ·  🟡 Normal

**Goal.** The owner can approve, rerun, and do an emergency publish from the written text alone.

**Steps**

1. Read the "Releasing" section of `CONTRIBUTING.md`, then ADR 0064 in `docs/adr/`.
   - [ ] The approval, the rerun, and the emergency token publish each read as steps you can follow without the plan
     - the `npm` environment approval on GitHub
     - the rerun of a failed `publish.yml` job
     - the token publish from a checkout of the tag, with the one-time code
   - [ ] ADR 0064 states the decision and its amendment of ADR 0062 the way you settled it in the grill

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: the walkthrough sections fit a saasaloy project  ·  🟢 Low

**Goal.** The saasaloy-deploy skill's new sections hold no PrimeShopr detail and match the PrimeShopr practice.

**Steps**

1. Read "The release walkthrough" and "The stakeholder summary" in `packages/cli/templates/base/_agents/skills/saasaloy-deploy/SKILL.md`.
   - [ ] The text applies to any project and says it runs only when `release.include` lists `docs/release/`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** None. The scenario changes nothing.

## Scenario 2: branch merged to `main`

**Setup.** Run once, after the PR merges.

1. Note the `main` commit after the merge.

```sh
git fetch origin main && git rev-parse origin/main
```

- [ ] Setup complete

### TC-2.1: two smoke runs pass on one `main` commit  ·  🔴 Critical

**Goal.** The smoke is green on `main`, which the release preflight requires.

**Steps**

1. Start two `smoke.yml` runs on `main`.

   ```sh
   gh workflow run smoke.yml --ref main
   ```

   ```sh
   gh workflow run smoke.yml --ref main
   ```

2. Read the result of both runs when they end.

   ```sh
   gh run list --workflow smoke.yml --branch main --limit 2 --json databaseId,conclusion,headSha
   ```

   - [ ] Both runs show `success` on the same `headSha`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** None.

## Automated verification (by AI agent)
_Checks the agent ran itself at `9642a3a7` (clean), unless the line names another revision. The fix commit `0e9d54d8` changes only `modules/ci/skills/saasaloy-ci/SKILL.md`, so the agent re-ran the skills test and lint at `0e9d54d8` and reused the other results. No action needed from the tester._

Commands run (one per block):

```sh
node --test scripts/update-note-footer.test.ts scripts/release-preflight.test.ts scripts/changelog-update-notes.test.ts scripts/release-order.test.ts scripts/ci-module-workflow.test.ts scripts/update-deps.test.ts
```

```sh
node --input-type=module -e 'import("./scripts/release-preflight.ts").then((m) => m.runUpdateNoteCheck())'
```

```sh
printf 'docs(auth): add a note\n\nUpdate-Note-For: 974d223f83c798fc66f674a5bd48a52cee1d7321\n' | pnpm exec commitlint
```

```sh
printf 'docs(auth): add a note\n\nUpdate-Note-For: 974d223f\n' | pnpm exec commitlint
```

```sh
pnpm test:tooling
```

```sh
pnpm deps:check
```

```sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 .github/workflows/publish.yml modules/ci/files/workflows/ci.yml
```

```sh
GITHUB_TOKEN=$(gh auth token) pnpm --filter saasaloy exec release-it --dry-run --ci --no-git.requireBranch --no-git.requireCleanWorkingDir --no-git.requireUpstream
```

```sh
pnpm test && pnpm lint && pnpm typecheck
```

- ✅ C1, C3 · scripts tests → 123 pass, 0 fail. They cover a late note that covers, a footer on a non-breaking commit, a footer commit with no note, and a short SHA.
- ✅ C5 · update-note check → `974d223 ... update note added later by 3113167 (Update-Note-For)`, then `every breaking commit since v0.8.0 has an update note`, exit 0.
- ✅ C4 · commitlint → a full SHA exits 0; `974d223f` exits 1 with `must name a full 40-character commit SHA [update-note-for-sha]`.
- ✅ C2 · the dry-run changelog links the `974d223` item to `modules/auth/update-notes/0006-admin-plugin-endpoints-closed.md`.
- ✅ C9, C10, C12 · `modules/ci/files/workflows/ci.yml` → `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, `push` on `main` plus `pull_request`, four `uses:` pinned to 40-char SHAs with `# vX.Y.Z`, `.turbo/cache` restored. `ci-module-workflow.test.ts` guards each rule.
- ✅ C13 · `pnpm deps:check` → a `github-actions (7)` box lists the four `ci.yml` pins as current. The command exits 1 on npm drift that predates this branch. It also lists three tag-only `uses:` in `modules/infra-ci-deploy`, which the plan keeps out of scope.
- ✅ C16 · `pnpm test:tooling` → 466 pass.
- ✅ C19 · `.dev` scaffold with `include: ["docs/release/"]`, `githubRelease: false`, and a bare remote → `pnpm release` exit 0, and `git show --stat HEAD` lists `docs/release/v0.1.0-walkthrough.md` in `chore(release): v0.1.0`.
- ✅ C20, C21 · `publish.yml` → `tags: v*`, `environment: npm`, `id-token: write`, no `NPM_TOKEN`, then `npm publish "$TARBALL" --access public --provenance`.
- ✅ C22 · `packages/cli/release-npm-last.js` is gone. The release-it dry run exits 0 and shows `npm version`, the changelog, the commit, and the tag, and no `npm publish`.
- ✅ C25 · actionlint (pinned digest) on `publish.yml` and the `ci` module `ci.yml` → exit 0, no output.
- ✅ C25 · `pnpm release:dry` refuses off `main` (`Must be on branch main`). The release-it dry run above stands in until the merge.
- ✅ Full gate · `pnpm test`, `pnpm lint`, `pnpm typecheck` → exit 0 on the committed tree.
- ✅ C15 · fresh `.dev` scaffold, `init --yes --testing=tests-after`, then one `add` of the 15 MVP modules plus `ci`, then each `run:` step of its `ci.yml` in a clean clone → install 0, `ci:prepare` 0, lint 0, typecheck 0, test 1, build 0, `ci:e2e` 0. The test step fails on blank `EMAIL_PROVIDER` and `EMAIL_FROM`. The owner chose the grill Q12 path (blocker B1): the project sets those two local values in `.env.example`, and with them every step exits 0 (`.afkkit/result-phase4.md`, run 2). The saasaloy-ci skill now names this case.
- ✅ B1 fix · `node --test scripts/skills.test.ts` → 37 pass at `0e9d54d8`; `pnpm lint` exit 0.
- ✅ Review fixes (Fable review of PR #360) · `publish.yml` now has a `build` job with `contents: read` and a `publish` job in `npm` with `id-token: write` that runs only `npm publish`. Every `uses:` is pinned by SHA, `cache: pnpm` is gone, and `build` refuses a tag whose commit is not on `main`. The `ci` module groups each `main` commit alone. A wrong `Update-Note-For:` footer is now a warning. `release.include` refuses `.` and a path git ignores. `deps:update` reads a quoted `uses:`. `node --test` on the seven script suites → 163 pass; `pnpm test:tooling` → 467 pass; actionlint exit 0; `pnpm test`, `pnpm lint`, `pnpm typecheck` exit 0; the update-note check prints `every breaking commit since v0.8.0 has an update note`.
- ✅ C6, C7 · `smoke.yml` runs 44503924435 and 44503939521 on `9642a3a7` (the D1 fix) → both `success`, both jobs. Run 44500678599 on `006725e5` also passed. Two runs on one `main` commit stay for TC-2.1.

## Not covered / needs human judgment
- Phases 1, 7 and 8 (the npm and GitHub settings, the bench run, the release) are attended and outside this branch.
- The first real OIDC publish with provenance from a tarball path. Only the 0.9.0 publish in phase 8 proves it.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
