# Plan: close the release pipeline gaps and ship 0.9.0
Grilled: 2026-11-19

## Context

PrimeShopr releases and deploys on a steady cycle: 14 releases, v0.14.0 on 2026-11-19, each with a changelog, a GitHub Release, a `deploy-*` tag and a stakeholder walkthrough. A review of saasaloy against that cycle (2026-11-19) found these gaps:

- **The framework does not release.** The last CLI release is v0.8.0 (2026-10-27). `main` holds 349 commits since then: 170 `feat`/`fix` and 7 breaking. `packages/cli/package.json` already says `0.9.0`, and the `ci` module needs `saasaloy >=0.9.0`, so no project can install it. Under ADR 0062 a module change reaches users only through a CLI release, so every module fix since v0.8.0 is out of reach too.
- **Three checks stop `pnpm release` today** (checked on `b00dec74`):
  1. The update-note check. `974d223 feat(auth)!: gate admin routes and close plugin admin endpoints` (2026-11-05) adds no note, and `checkUpdateNotes` in `scripts/release-preflight.ts` accepts only a note that the breaking commit itself adds (`addedUpdateNotes` runs `git diff-tree` on that one commit). History on `main` cannot change, so no fix exists today.
  2. The bench gate. 228 changed paths need an agent benchmark run, and the only report, `docs/research/0005-research-agent-bench-baseline-2026-10-24.md`, has no score for the briefs `prepline`, `receiptbox` and `shelfnote`.
  3. The smoke. `smoke.yml` failed on 11-15, 11-16, 11-17 and 11-18, each day for a different reason. The newest failure is one `Hook timed out in 10000ms` in `apps/api/src/routes/auth-phone.test.ts` of the `full-database-d1-api-keys-organization` scaffold. CI on `main` is green.
- **The `ci` module workflow has two defects that PrimeShopr fixed by hand.** `modules/ci/files/workflows/ci.yml` sets `cancel-in-progress: true` for every ref, so a second merge cancels the run on the first merge commit, and the deploy CI gate then finds a cancelled run. It also has no `pnpm build` step, so a broken build passes CI and fails at deploy time.
- **A project cannot add a file to its release commit.** The template `packages/tooling/src/release.ts` calls release-it with `config: false` and no hooks. PrimeShopr needs `docs/release/` in the release commit, so it still runs its own `.release-it.json`, and the `release.ts` that the 0.8.0 update brought is not used there.
- **The npm publish runs from this box.** `packages/cli/release-npm-last.js` publishes with a local npm login and a one-time password. The package carries no provenance.

**Goal:** saasaloy releases as reliably as a project built on it does, and every project gets the same release tooling that PrimeShopr built by hand.

**Target:** `saasaloy@0.9.0` is `latest` on npm, published by `.github/workflows/publish.yml` with a provenance attestation (`npm view saasaloy@0.9.0 dist.attestations` is not empty), and `pnpm release` ran with zero preflight failures. Time to the next release after 0.9.0 is measured after release.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Scope | Items 1, 2, 3 and 5 of the 2026-11-19 review. Item 4 (a `hotfix-*` path for the CLI release) is out. |
| Order | Trusted publishing ships before 0.9.0, so 0.9.0 is the first release with provenance (owner, 2026-11-19). |
| Late update note | A later commit adds the note file and carries the footer `Update-Note-For: <full sha>`, one footer for each commit it covers. The preflight counts that commit's added notes for the named commit, and the changelog linker in `scripts/changelog-update-notes.ts` links the breaking item to the note. The rule stays for every future miss (owner, 2026-11-19). |
| Publish trigger | A `v*` tag push starts `publish.yml`. The job runs in the GitHub environment `npm`, which has the owner as required reviewer, so nothing publishes until the owner approves on GitHub (owner, 2026-11-19). |
| Publish auth | npm trusted publishing (OIDC): `permissions: id-token: write`, no `NPM_TOKEN` secret. The trusted publisher on npmjs.com names `mimukit/saasaloy`, `publish.yml` and the environment `npm`. The repository is public, so npm records provenance. |
| What release-it still does | Bump the version, write `packages/cli/CHANGELOG.md` with the update-note links, commit, tag, push and create the GitHub Release. It no longer publishes. `release-npm-last.js` goes away, because the tag push now comes before the publish by construction. |
| ADR | A new ADR 0064 records the move to a tag-started, approved, OIDC publish. It amends the ADR 0062 consequence "The tag reaches GitHub before npm publishes", whose mechanism changes while its rule holds. |
| Walkthrough opt-in | A new key `release.include: string[]` in `ReleaseConfig` (`packages/cli/templates/base/packages/tooling/src/types.ts`), default `[]`. `release.ts` stages each listed path before release-it commits. The `saasaloy-deploy` skill writes `docs/release/v<version>-walkthrough.md` and drafts a stakeholder summary only when `release.include` lists `docs/release/` (owner, 2026-11-19). |
| Project-owned config | `deploy.config.ts` is written once at `init` and never updated, so an existing project gets `release.include` from the default and turns it on by hand. `types.ts`, `release.ts` and the skill are template-owned and reach projects through `saasaloy update`. |
| `ci` module changes need no update note | The `ci` module was never in a release, so its first released version is the fixed one. |
| `ci` module workflow | Copy the PrimeShopr rules: `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, `push` on `main` only plus `pull_request`, a `pnpm build` step after `pnpm test`, every `uses:` pinned to a 40-character commit SHA with a `# vX.Y.Z` comment, and a `.turbo/cache` restore keyed by ref and SHA. |
| Tests | Node's test runner, the same as `pnpm test:scripts` and `test:tooling`. Workflow files are checked by a test that parses the YAML with `yaml`, an exact-pinned root devDependency, beside the other `scripts/*.test.ts` files (grill Q10). |
| Build env in the `ci` module | A new flag, `node packages/env/scripts/env-setup.ts --example`, writes each service's `.env` from the defaults in `packages/env/.env.example` and refuses nothing. It is for CI only. The `ci` module adds the root script `ci:prepare:env` that runs it, so `pnpm ci:prepare` covers it (grill Q1, asked). A key with no default is written blank. When a build needs it, the project gives it a default in `.env.example`, and the build failure names the key (grill Q12). |
| SHA pin updates | `scripts/update-deps.ts` gains a `github-actions` group. It reads the `uses:` lines of shipped workflows only (`modules/*/files/**` and the base template) and resolves each tag to its commit SHA. The repo's own `.github/` stays on tags (grill Q2 asked, Q14 defaulted). |
| Smoke fix policy | A slow hook in a scaffold test gets a faster hook, because every user gets the test. A longer timeout is allowed only when the hook does no avoidable work, and the fix commit says so (grill Q3, asked). |
| Token publish | npm keeps a token publish with 2FA as the emergency path for a GitHub Actions outage: `npm publish` from a checkout of the tag, with the one-time code, and no provenance. CONTRIBUTING.md documents it. The trusted publisher is the normal path (grill Q4 asked, Q13 defaulted). |
| `publish.yml` checks | The tag equals `v` plus the `packages/cli` version, the CLI builds, `pnpm pack` makes the tarball, the tarball installs, and `saasaloy --version` prints the version. The local preflight already ran the full gate on that commit (grill Q6). |
| A failed publish | Rerun the job. The preflight refuses a new release while the version of the last tag is missing on npm, so a skipped version cannot go unnoticed (grill Q7). |
| Footer SHA | `Update-Note-For:` takes a full 40-character SHA only. A short SHA can become ambiguous later (grill Q8). |
| `release.include` paths | Each path is shell-quoted in the hook. An absolute path, `..`, or a character outside `[A-Za-z0-9._/-]` refuses at start, because release-it hooks run in a shell (grill Q9). |
| Workflow lint | `actionlint` runs from the `rhysd/actionlint` Docker image, pinned by digest. Nothing is installed on the box (grill Q11). |
| Outward actions | The agent may dispatch `smoke.yml` runs, push branches and open a PR for each phase, and file follow-up issues without asking. The GitHub and npm settings (phase 1), the bench run (phase 7) and the release (phase 8) stay attended (grill Q5, asked). |
| A bench FAIL | The release waits. Each FAIL line gets an issue and a fix inside this plan, then the brief runs again. |

## Approach

The plan reuses the release machinery that exists: `packages/cli/.release-it.js`, `scripts/release-preflight.ts`, `scripts/changelog-update-notes.ts`, `scripts/update-note-footer.ts`, `scripts/bench-gate.ts`, `scripts/release-smoke.ts` and `smoke.yml`. On the template side it reuses `release.ts`, `types.ts`, `deploy.config.ts` and the `saasaloy-deploy` skill, and it takes the walkthrough procedure from PrimeShopr's `.agents/skills/primeshopr-deploy/SKILL.md` ("The release walkthrough" and "The stakeholder summary").

Rejected: ship 0.9.0 first on the local publish, then move to OIDC. It ships sooner, but the owner wants 0.9.0 to carry provenance. Rejected: publish on `release: published` with no approval. The tag push with a required reviewer keeps one human check on what reaches npm.

Phase 1 is attended and has no build dependency, so it goes first. Phases 7 and 8 are attended too, but they must come last: phase 5 changes a base skill, and the bench gate counts a base skill change, so the bench run must cover the final tree.

### Phase 1: GitHub environment and npm trusted publisher (#358)
Attended: the owner signs in to npmjs.com and approves the GitHub environment settings.

- Create the GitHub environment `npm` on `mimukit/saasaloy`. Add the owner as required reviewer. Limit deployments to tags that match `v*`.
- On npmjs.com, in the `saasaloy` package settings, add a GitHub Actions trusted publisher: owner `mimukit`, repository `saasaloy`, workflow `publish.yml`, environment `npm`.
- Leave the token-based publish allowed. It stays as the emergency path (grill Q4).

Done when: `gh api repos/mimukit/saasaloy/environments/npm --jq '.protection_rules[].type'` prints `required_reviewers` and `branch_policy`, and the owner confirms that the npm package settings list the trusted publisher.

### Phase 2: accept a late update note (#358)
- In `scripts/update-note-footer.ts`, parse `Update-Note-For: <sha>` footers. One commit can carry several. Refuse a SHA that is not 40 hex characters.
- Check that commitlint (`@commitlint/config-conventional`) accepts the footer in the `commit-msg` hook.
- In `scripts/release-preflight.ts`, after the per-commit check, map each footer since the last tag to the notes its commit adds. A breaking commit counts as covered when a later commit names it and adds at least one note.
- In `scripts/changelog-update-notes.ts`, link a breaking item to the late note the same way it links a same-commit note.
- Name the footer in the preflight failure message and in CONTRIBUTING.md, next to `Update-Note: none (<reason>)`.
- Write the note for `974d223` under `modules/auth/update-notes/` (the next free serial, `0006`). It says that `/admin/auth/admin/*` answers 404 over HTTP and how a project moves a call to `adminAuth.api`. Commit it with `Update-Note-For: ` and the full SHA of `974d223f`.

Done when: `node --test scripts/release-preflight.test.ts scripts/changelog-update-notes.test.ts scripts/update-note-footer.test.ts` passes with new cases for a late note, a footer that names a non-breaking commit, a footer whose commit adds no note, and a short SHA; and the update-note check of the preflight prints `every breaking commit since v0.8.0 has an update note`.

### Phase 3: make the smoke green (#358)
- Run `smoke.yml` by `workflow_dispatch` on `main` and read each failed check.
- Find the cause of the `auth-phone.test.ts` hook timeout in the D1 scaffolds, and record it in the fix commit. Follow the "Smoke fix policy" decision.
- The agent dispatches the runs itself (grill Q5).
- Fix each remaining failure.

Done when: two `workflow_dispatch` runs of `smoke.yml` on the same `main` commit both end in `success`.

### Phase 4: fix the `ci` module workflow (#358)
- Edit `modules/ci/files/workflows/ci.yml` as in the "`ci` module workflow" decision.
- Add the `--example` flag to `packages/cli/templates/base/packages/env/scripts/env-setup.ts`, with tests, and name it in the `saasaloy-env` skill as CI only.
- Add a `package-json-script` patch for `ci:prepare:env` to `modules/ci/registry-item.json`. Add the `pnpm build` step after `pnpm test`.
- Add the `github-actions` group to `scripts/update-deps.ts`, as in the "SHA pin updates" decision, with tests.
- Update `modules/ci/skills/saasaloy-ci/SKILL.md`: the step list, the `main`-only push, and the reason runs on `main` are never cancelled (the deploy gate reads them).
- Add `scripts/ci-module-workflow.test.ts`. It parses the workflow and checks the cancel expression, the triggers, the `pnpm build` step, and a SHA pin on every `uses:`.

Done when: `node --test scripts/ci-module-workflow.test.ts` passes, `pnpm deps:check` lists the actions of the `ci` workflow, and in a `.dev` scaffold with the MVP set plus `ci`, each `run:` step of the scaffold's `.github/workflows/ci.yml` runs in order and exits 0.

### Phase 5: `release.include` and the release walkthrough (#358)
- Add `include?: string[]` to `ReleaseConfig` in `types.ts`, default `[]`, and resolve it with the other release defaults.
- In `release.ts`, pass a release-it `before:git:release` hook that runs `git add -- <path>` for each entry. Follow the "`release.include` paths" decision.
- Add the commented key to the template `deploy.config.ts`: `include: undefined` with a note that `["docs/release/"]` turns on the walkthrough.
- In `_agents/skills/saasaloy-deploy/SKILL.md`, add "The release walkthrough" and "The stakeholder summary", taken from PrimeShopr's `primeshopr-deploy` skill with the PrimeShopr names removed. Both apply only when `release.include` lists `docs/release/`. The walkthrough stays untracked until `pnpm release` commits it.
- Add a packages/cli update note only if the change needs a project action. The default keeps today's behavior, so none is expected.

Done when: `pnpm test:tooling` passes with new cases in `release.test.ts` (the hook lists each path, an empty list adds no hook, an absolute path, a `..` path and a path with a space refuse), and in a `.dev` scaffold with `include: ["docs/release/"]` and an untracked `docs/release/v0.1.0-walkthrough.md`, `pnpm release` against a throwaway bare remote makes a release commit whose `git show --stat HEAD` lists the walkthrough.

### Phase 6: publish from GitHub Actions with OIDC (#358)
- Add `.github/workflows/publish.yml`: on `push` of tags `v*`; `environment: npm`; `permissions: contents: read, id-token: write`; checkout of the tag; pnpm and Node 24 set up as in `ci.yml`; `pnpm install --frozen-lockfile`; then the "`publish.yml` checks" decision; then `npm publish <tarball> --access public --provenance`.
- Add a step that fails by name when `npm --version` is below 11.5.1. Node 24 ships npm 11.x, so no install step is expected.
- Confirm in the first run that OIDC and provenance work for a tarball path. `packages/cli` has no `workspace:` or `catalog:` dependency, so the packed `package.json` matches what `release-npm-last.js` published.
- In `scripts/release-preflight.ts`, refuse a release while the version of the last tag is missing on npm (`npm view saasaloy@<version> version`).
- In `packages/cli/.release-it.js`, drop the `./release-npm-last.js` plugin and set `npm: { publish: false }`, so release-it still bumps `packages/cli/package.json` and does not publish. Delete `release-npm-last.js`.
- Rewrite `scripts/release-order.test.ts`: release-it in dry-run mode runs no `npm publish`, and `publish.yml` starts only on a `v*` tag push and only in the `npm` environment.
- Write ADR 0064 and amend the ADR 0062 consequence with a pointer to it.
- Update CONTRIBUTING.md, the release section: the approval step on GitHub, how to rerun a failed publish job, and the emergency token publish. A tag without a publish delays users and breaks nothing (ADR 0062).

Done when: `pnpm test:scripts` passes, `pnpm release:dry` prints no npm publish step, and `actionlint` from the pinned Docker image reports nothing for `publish.yml` and the `ci` module workflow.

### Phase 7: the agent benchmark run (#358)
Attended: the owner starts three `claude -p` benchmark runs, which cost money and take time.

- After phases 2 to 6 are on `main`, run `node scripts/agent-bench.ts --interview --brief <name>` for `shelfnote`, `prepline` and `receiptbox` (CONTRIBUTING.md, "Before you run it").
- Copy the three `score.md` files into one `docs/research/NNNN-research-agent-bench-<slug>-2026-MM-DD.md` report and commit it on `main`.
- When a line reads FAIL, fix the cause, then run the brief again.

Done when: the bench check of the preflight prints `the benchmark report <file> covers this release with no FAIL line`.

### Phase 8: release 0.9.0 (#358)
Attended: the owner gives the go-ahead for `pnpm release` and approves the `npm` environment on GitHub.

- Run `pnpm release:dry`. Read the version (`0.9.0`) and the changelog, which must link each breaking item to its update note.
- Run `pnpm release`. The preflight runs the full gate and the smoke.
- Approve the `publish.yml` run on GitHub.
- Check the result: `npm view saasaloy@0.9.0 dist.attestations`, then `npm audit signatures` in a project that installs it, then `saasaloy add ci --dry-run` from a global `saasaloy@0.9.0`.

Done when: `npm view saasaloy dist-tags.latest` prints `0.9.0`, `npm view saasaloy@0.9.0 dist.attestations` is not empty, and the GitHub Release `v0.9.0` exists.

## Open questions

None. The grill of 2026-11-19 settled each one, and the Design decisions table records the answers.

## Non-goals

- A `hotfix-*` path for the CLI release (item 4 of the review).
- Moving PrimeShopr to the template `release.ts` and deleting its `.release-it.json`. That follows when PrimeShopr updates to a release that holds phase 5.
- The saasaloy repository's own `ci.yml`. The repository has no deploy gate, so a cancelled run on `main` costs nothing there.
- A deploy workflow for projects. `infra-ci-deploy` stays as it is.
- A release cadence or an automatic release. This plan makes a release possible, not scheduled.
- Refusing token publishes on npm. The token stays as the emergency path (grill Q4).
- SHA pins and the `deps:update` actions group for the repo's own `.github/` workflows.
