# Plan: Lint the shipped Vitest payloads in the repo and in the smoke scaffold

Grilled: 2026-10-24

## Context

Issue #266. The #220 afkkit run found 9 oxlint errors in a full `database-d1` scaffold, all in `apps/api/src/routes/auth.test.ts`: `vitest(prefer-strict-equal)` at lines 127 and 136, and `vitest(prefer-expect-resolves)` at seven more. `modules/auth/registry-item.json` writes that file from `files/api/routes/auth.vitest.ts`.

The file on `main` is already fixed. Commit `71e5badb` ("test(auth): await promises through expect resolves", PR #261, issue #225) changed the seven `expect(await ...)` lines, and the two `toEqual` calls are now `toStrictEqual`. So the reported errors are gone, and the work left for #266 is the gap that let them reach a scaffold. That gap has two parts:

1. **The repo's lint skips the Vitest rules on a `.vitest.ts` payload.** `oxlint.config.mjs` gives `modules/*/files/**` the template's rule map, but the Vitest rules arrive only through Ultracite's test-file override, whose glob is `**/*.{test,spec}.*`. A `.vitest.ts` name does not match it. Seven payloads use that name today (`auth`, `reset-password`, `health-db`, `completeness`, `dump`, `production`, `files`). Plan 0080 Phase 4 (#243, `ready`) renames 49 more module tests to `.vitest.ts`, so the gap is about to grow from 7 files to 56.
2. **`pnpm release:smoke` lints no module test at all.** `lintFullScaffold` in `scripts/release-smoke.ts` runs `init --no-install --no-git` with no `--testing` flag. The mode defaults to `off`, and every test entry carries `when: { testing: true }` (guarded by `scripts/test-file-gates.test.ts`). So the full scaffold gets no `.test.ts` file, and its `pnpm lint` passes whatever the tests contain.

Evidence, 2026-10-24 on `main` at `7eb3a584`: the two `api-keys-organization` full scaffolds from `fullScaffolds` (44 modules each, one per database driver), made with `init --testing=tests-after`, both pass their own `pnpm lint` with exit 0. Each holds 18 `.test.ts` files, including all six module tests for its driver. So the issue's acceptance criterion holds today, and only by hand.

Goal: a lint rule a scaffolded project applies to a shipped test fails in this repo's `pnpm lint` first, and the release smoke proves it in a real project.

Target: `pnpm lint` in each full scaffold made with `--testing=tests-after` exits 0, and a planted `expect(await p).toBe(1)` in any `modules/*/files/**/*.vitest.ts` makes this repo's `pnpm lint:code` exit non-zero. Baseline, checked 2026-10-24: the repo reports no vitest error on that planted line in a `modules/auth/files/api/routes/*.vitest.ts` file, so none of the 75 rules in Ultracite's vitest block reach these files. The current seven payloads, copied to `*.test.ts` under `modules/` and linted, give 0 errors. That copy also took the node:test exemptions, so it is a strong hint and not proof that Phase 1 starts clean.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Rewrite `auth.vitest.ts` | No. `71e5badb` already fixed it. The plan re-checks it in Phase 2 and changes it only if the scaffold lint still reports it. |
| Where the `.vitest.ts` rules come from | Derive them from the presets in `oxlint.config.mjs`: take Ultracite's test-file override blocks (`core`'s relaxations and `vitest`'s rule set) and re-target their `files` to `modules/*/files/**/*.vitest.ts`. No hand-written rule list, so an Ultracite bump cannot open the gap again. Same reasoning as `vitestRulesOff` in the template config. |
| Override order | The new block sits after the `modules/*/files/**` template block and the `templateOverrides`, and it does not take the node:test exemptions (`no-import-node-test`, `prefer-importing-vitest-globals`, `prefer-each`). A `.vitest.ts` file runs on Vitest in the project, so those rules apply to it. |
| Testing mode in the smoke scaffold | `lintFullScaffold` passes `--testing=tests-after`. It ships the same files as `tdd` (both read as `testing: true`) and differs only in the `AGENTS.md` block. |
| Smoke scaffold count | Unchanged. Testing on in the existing full scaffolds, no extra testing-off scaffold. The testing-off file set is a subset, so it cannot fail lint where the testing-on set passes. |
| Scope of #266 | Both phases, though `71e5badb` already fixed the reported errors. Each phase closes a different hole: the repo lint and the smoke scaffold. (Q1, asked) |
| Order with #243 | #266 merges first. #243's 49 renamed `.vitest.ts` files then meet the new rule set in #243's own `pnpm lint`, and its build fixes each violation in the payload. (Q2, asked) |
| #243 while #266 is open | The #243 body gets `Blocked by #266`, and its label goes from `ready` to `blocked`, so no unattended run builds it first. issuekit `sync` moves it back to `ready` after #266 merges. Done when the plan is published, not in the build. (Q8, asked) |
| Smoke check that test files exist | `lintFullScaffold` calls `assertExists` for `apps/api/src/routes/auth.test.ts` after the adds, so a later flag change cannot drop the tests silently. (Q3, defaulted) |
| Guard for the new override | A manual plant-and-check step in the override's comment, the same method the config uses for `unicorn/no-new-array`. No automated test: a fixed fixture under `modules/*/files` would fail lint. (Q4, defaulted) |
| `create-module` skill | One sentence beside the `.vitest.ts` rename rule: the repo lints a `.vitest.ts` payload with the project's Vitest rules. (Q5, defaulted) |
| Issue title | `fix(lint): apply the vitest rules to shipped test payloads`, because the old title names a fix that is already done. (Q6, defaulted) |
| Outward actions, test runner, attended phases | None beyond the branch and its PR. No new test runner. No phase needs a person. (Q7, defaulted) |

## Approach

Close the gap in both places, in the repo config first so a payload fails here before any scaffold sees it. Reuse the `mergePresets` result (`ultracite.overrides`) and the existing `fullScaffolds` / `lintFullScaffold` step. Nothing new to install.

Rejected: rename the payloads to `.test.ts` and exclude them from `test:modules` by glob. `node --test` takes no negated glob, and plan 0080 already settled the `.vitest.ts` name (ADR 0054 gate, Phase 4).

### Phase 1: apply the scaffold's test rules to `.vitest.ts` payloads (built 2026-10-24)

- In `oxlint.config.mjs`, add an override block built from the Ultracite overrides whose `files` match a test glob, with `files: ["modules/*/files/**/*.vitest.ts"]` and `plugins: ["vitest"]`.
- Write its comment in the file's style: why the name is `.vitest.ts`, why the glob misses it, and the plant-and-check step below.
- Add the one-sentence note to `.agents/skills/create-module/SKILL.md` beside the `.vitest.ts` rename rule.
- Run `pnpm lint:code`. Fix any payload it now reports, in the payload, not with a suppression, unless the template config already exempts that rule for the target path.
- Plant `expect(await Promise.resolve(1)).toBe(1)` in `modules/auth/files/api/routes/auth.vitest.ts`, confirm `vitest(prefer-expect-resolves)` fires, then remove it.

Done when: `pnpm lint` exits 0 on the branch, and with the planted line `pnpm lint:code` exits 1 and names `vitest(prefer-expect-resolves)` at `modules/auth/files/api/routes/auth.vitest.ts`.

### Phase 2: lint the shipped tests in the release smoke

- In `scripts/release-smoke.ts`, pass `--testing=tests-after` to `init` in `lintFullScaffold`, and say so in the step line and the closing summary.
- After the adds, call `assertExists` for `apps/api/src/routes/auth.test.ts` in each full scaffold.
- Run `pnpm release:smoke` and fix any shipped test its scaffolds report.
- Update the `pnpm lint` note in CONTRIBUTING.md if it says what the smoke lint covers.

Done when: `pnpm release:smoke` exits 0, and its log shows each full scaffold made with `--testing=tests-after` and passing `pnpm lint`, and removing `--testing=tests-after` makes the `assertExists` check fail. That is the issue's acceptance criterion with the module tests in the project.

## Open questions

None. The grill on 2026-10-24 settled Q1 to Q8.

## Non-goals

- The scheduled `smoke` workflow failure `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER` (plan 0085).
- The typecheck failures in #252 and #253.
- Plan 0080 Phase 9's nightly full-project `build`, `typecheck` and `test` run (#245).
- Lint rules for the Playwright specs in `packages/e2e/`, which the template already turns off.
