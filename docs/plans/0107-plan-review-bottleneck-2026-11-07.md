# Plan: remove the human review bottleneck

Created: 2026-11-07. Source brief: `/home/dev/research-context/review-bottleneck-2026-11-07/brief.md` (27 recommendations, numbered as in the brief). This plan covers the **S** items and the saasaloy side of the **S+K** items. A separate plan in the mimukit/skills repo covers the **K** items and the kit side.

## Context

The owner is the only reviewer. Agents open PRs faster than the owner can read them, so the PR queue stalls while CI stays green. The owner keeps control of architecture and code quality, and gives every machine-checkable rule to CI. Recaps and decision lists replace line review where the risk is low. The guiding rule: "We want to preserve human time and attention for issues only humans can solve and make sure automated checks catch the rest."

Live state on 2026-11-07 (checked with `gh`, not copied from the brief):

- 18 open PRs, about 70,700 added lines. The oldest is #276 (2026-10-25). `mimukit` authored all 18.
- 17 of 18 have green CI. #322 is red: one test fails in `packages/cli/src/lib/update-notes.test.ts` ("dates every base note at or before the CLI in this package"). #285, #276, #280, #281 and #282 conflict with `main`.
- Commits on `main`: 155 on 2026-10-24, then 2 to 20 a day. The last merge is #326 on 2026-11-06.
- Over the last 60 merged PRs, the median wait from open to merge is 5.6 hours and the p90 is 669 hours (about 28 days). The wait is bimodal: a PR merges the same day or it waits weeks.
- `main` has no branch protection and no rulesets. The repo has no CODEOWNERS, no PR template and no `REVIEW.md`. `allow_auto_merge` is off and only merge commits are on.
- `.github/workflows/` holds `ci.yml` (`lint`, `typecheck`, `test`, `verify:content`, `verify:pins`), `e2e.yml`, `site.yml` and `smoke.yml`. No review bot runs, although afkkit's SKILL.md says one does.
- The registry is this repo's `main` (ADR 0012). CONTRIBUTING.md "Releasing" says a PR that only touches `modules/**` "reaches users the moment it lands on `main`". An npm dist-tag does not hold a module back. Only a registry-side status can.

Repo facts this plan builds on:

- Guard tests exist for plural table names (`scripts/table-names.test.ts`), env presets (`scripts/env-presets.test.ts`), module test gates (`scripts/test-file-gates.test.ts`), module skill sections (`scripts/skills.test.ts`), pins (`scripts/verify-pins.ts`) and descriptor floors (`packages/cli/src/lib/registry-floors.test.ts`).
- No guard exists for these `AGENTS.md` rules: a capability core has zero runtime dependencies and no vendor SDK; no workspace imports another capability's vendor package (ADR 0020); a capability never reads `process.env`; `@repo/config` imports nothing; module names are singular; every scaffolded `package.json` has a `clean` script on an exact-pinned `rimraf`; `<CAP>_PROVIDER` never falls back to a default.
- The landing catalog already reads every `registry-item.json` at build time (`apps/web/src/lib/module-registry.ts`). `modules/README.md` (102 lines of prose) and `docs/wiki/modules.md` (a 69-line table) are hand-written.
- `packages/cli/schemas/registry-item.schema.json` has `"additionalProperties": false` and a `stage` enum (`validate`, `mvp`, `teams`, `money`, `scale`). A new descriptor key fails validation in CLI 0.8.0, so `registry-floors.test.ts` forces a `requires.saasaloy` floor on every module that uses it.
- `oxlint.config.mjs` has a `suppressed` block with 36 rules off and an `overrides` list. The repo has 63 `oxlint-disable` lines, 38 of them in shipped payload (`modules/*/files`, `packages/cli/templates/base`). Shipped payload has 0 `TODO`, `FIXME`, `HACK` or `workaround` comments.
- `scripts/agent-bench/` is a product-build benchmark (the Shelfnote brief). It does not score a reviewer.
- PR #283 adds `pnpm play:up`, `play:down`, `play:smoke` and `play:restore`, `scripts/play-presets.json` (`minimal`, `full`), and `modules/<name>/smoke.ts` for 7 modules (37 HTTP checks). It edits `modules/billing/`, so it must merge before the billing rename lands.
- Past escapes: #251 (payment admin join cast), #269 (typecheck failed after `add`), #274 (ambient Workers types). All three merged.

Success outcome: the owner reads only what needs a human, and the queue does not grow again.

Target (proposed; baselines above, from `gh pr list` on 2026-11-07):

- Open PRs that wait for the owner: from 18 to 3 or fewer, held for 4 weeks.
- PR wait p90: from 669 hours to 48 hours or less.
- Reverts on `main` stay at 0 (0 since 2026-08-01). `fix(<module>)` commits within 7 days of that module's merge do not rise above the 4 weeks before the plan. The phase 5 script measures both after release.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Scope | S items and the saasaloy side of S+K items. Kit work is listed as a dependency, never planned here. |
| Phase order | The brief's "Recommended order". Four S or S+K items have no place in that order, so this plan places them: item 2 in Phase 3, item 5 inside item 19 (Phase 3, the brief marks it superseded), items 13 and 17 in Phase 4. |
| Approval mechanism | GitHub forbids self-approval, and the owner authors every PR. A required status check named `owner-gate` carries the human decision. The owner adds the `approved` label. A workflow records the head SHA at that moment, and a new push removes the label (item 13). A bot never adds `approved`. |
| One human, three tiers | The brief's "high needs two humans" cannot hold with one maintainer. High tier is owner approval plus a clean bot review plus resolved threads plus the full review pack. |
| Merge queue (item 14) | Not available: merge queue needs an organization-owned repo, and `mimukit` is a user account. A transfer would move the default registry that released CLIs hard-code (`mimukit/saasaloy`). Use generated catalog files (item 1), a ruleset that requires an up-to-date branch, and auto-merge instead. |
| Experimental is a registry status | It must live in the repo, because a module ships on merge to `main`. The npm `next` dist-tag covers CLI releases only. |
| Start strict | Until Phase 5 passes its trust test, every PR needs `approved`. Tier labels run in report-only mode first. |
| Runner for new guard tests | Node's test runner in `scripts/*.test.ts`, the same as `table-names.test.ts`, run by `pnpm test:scripts`. |

## Approach

Recommended: build the gates inside this repo with plain GitHub Actions and `scripts/*.test.ts`, and keep one required check (`owner-gate`) as the place where a human decision enters. The plan reuses the existing guard-test pattern, `ci.yml` step style (bare `- run: pnpm <script>`, read by `scripts/release-preflight.test.ts`), the descriptor schema and floor test, the site's descriptor reader, and #283's playground and smoke files.

Alternatives considered:

- **Minimal:** a `REVIEW.md`, a hosted review bot and a ruleset, no tiers. It ships in a day but leaves every PR on the owner, so the queue grows back.
- **Lateral:** a machine user or GitHub App opens agent PRs, so the owner's normal GitHub approval counts and rulesets can require one approval per tier. It needs a kit change (afkkit and prkit push identity) and a second credential on the box. It stays open as a later swap for `owner-gate` (Open question 8).

### Phase 1: clear the queue

Attended: the owner picks a lane for each PR from the table below, reads the experimental-status PR in full, and closes the stale PRs.

Tasks:

1. Refresh the live state with `gh pr list` and `gh pr checks`. Update the lane table if a PR changed.
2. Fix or close #322. Its red test is `update-notes.test.ts`. Nothing merges red.
3. Ship experimental status (item 15) as one small high-tier PR. The shape depends on Open question 2. Recommended shape: an optional descriptor key `status` (`"experimental"` or absent), a schema entry, `saasaloy list` hides experimental modules unless `--all`, `saasaloy add` prints a warning and adds a `warnings[]` entry to `--json` output, the site catalog marks or hides the tile, and the README and wiki generators (Phase 3) mark the row. Each experimental module declares the `requires.saasaloy` floor that `registry-floors.test.ts` demands. Release the CLI that reads the key. Promotion to stable is a later one-line PR that deletes the key.
4. Publish that CLI release on the npm `next` dist-tag first, then move `latest` after one release smoke (`pnpm release:smoke` against the `next` tarball). Record the step in CONTRIBUTING.md "Releasing" and `packages/cli/.release-it.js`.
5. Merge the experimental lane. A PR qualifies when every changed path is inside `modules/<new>/**`, or is one catalog line, or is a new test file. The owner reads the recap and the descriptor, not the module files.
6. Split the PRs that mix a new module with shared-surface changes. The shared part becomes its own PR on the normal path. The module part rebases on it and joins the experimental lane. Plan and mockup files leave the feature PR and land on `main` first (#323 carries 16 such files, #321 carries 21, #325 carries 12).
7. Present every remaining PR as one decision list (item 23, saasaloy side). Each entry is one PR, riskiest first: link, what changes for a user, the agent's pick, the evidence, the risk, and the choice (merge, split, close). Until the kit's queue mode exists, write the list by hand into `docs/status/` with the next serial.
8. Close stale conflicting PRs and regenerate them from their plan on today's `main` (item 18). Close #276 and #280. Regenerate #276 after #283 merges, because #283 edits `modules/billing/`. Regenerate #280 as one PR per module or per group of 5 modules.

Lane table (proposed, from the live file lists):

| PR | Size | Outside its own module | Proposed lane |
|----|------|------------------------|---------------|
| #286 infra-ci-deploy | +496, 7 files | one wiki line, one new test file | Experimental lane |
| #281 payment-sslcommerz | +1,286, 13 files, conflicts | payment skill, one payment descriptor line, catalog lines | Rebase, then experimental lane; the owner reads the payment descriptor line |
| #282 payment-bkash | +2,069, 19 files, conflicts | ADR 0057, `modules/payment/files/src/provider-env.ts`, `scripts/ts-resolve-hook.ts` | Rebase, then decision list (ADR and payment core) |
| #330 cms | +11,645, 78 files | base template `Layout.astro`, `navbar.tsx`, `wrangler.jsonc`; CLI `nav-entry.ts`; admin shell; root `package.json` and 444 lockfile lines | Split: shared surfaces first, then cms experimental |
| #323 notification | +4,740, 59 files | 16 plan files, `apps/web` landing, admin, app and shell nav counts | Split: plan to `main`, nav-count change, then notification experimental |
| #324 auth-phone | +7,165, 81 files | `oxlint.config.mjs`, auth, app, sms, e2e | Split: sms and auth changes, then auth-phone experimental |
| #279 ci module | +574, 17 files | schema, applier, new `const-property` patch kind | Split: CLI patch kind, then ci experimental |
| #283 playground | +1,202, 18 files | scripts, 7 `smoke.ts` files | Phase 2, merge first |
| #285 release smoke | +89, 4 files, conflicts | `.github/workflows/` | Rebase; the owner reads all 89 lines |
| #325 admin audit | +8,388, 95 files | ADR, `CONTEXT.md`, auth, payment, feature-flags | Decision list, high |
| #322 env worktrees | +4,142, 81 files, red, breaking | 34 CLI files, api, auth, admin | Fix red, then decision list, high |
| #321 ui primitives | +7,138, 85 files | 34 CLI files, shell | Decision list, high |
| #320 postgres operator tools | +5,261, 87 files | database driver, 12 modules | Decision list, high |
| #319 update skipped releases | +3,258, 27 files | CLI, 2 ADRs | Decision list, high |
| #318 template dev loop | +979, 36 files | base template, 7 modules | Decision list, high |
| #302 sidebar hints | +718, 15 files | command, shell | Decision list, medium |
| #280 module tests | +9,673, 187 files, conflicts | 30+ modules | Close, regenerate in small PRs |
| #276 billing rename | +1,880, 131 files, conflicts | every module that names billing | Close, regenerate after #283 |

Kit dependency: the "calls waiting on you" queue mode (item 23, statuskit or mergekit) replaces task 7's hand-written list.

Done when: `gh pr list --state open` shows 3 or fewer PRs that wait for the owner, every other PR from the table is merged, closed or replaced by a smaller PR, and `saasaloy list` hides a module that declares `"status": "experimental"` while `saasaloy add <it>` prints the warning.

### Phase 2: make work verifiable

Tasks:

1. Merge #283 after a rebase on `main`.
2. Add a feature map entry per module (item 20, saasaloy side): how to `add` it in the playground, which route or screen to drive, and what output proves it works. Recommended home: `modules/<name>/feature-map.md` beside #283's `smoke.ts`, outside `files[]`, so it never ships to a user project and needs no schema key. A generator seeds each entry from `registry-item.json` (name, `dependsOn`, `envVars`, routes from `files[]` targets).
3. Add a guard test, `scripts/feature-map.test.ts`, that fails when a module has no feature map. It starts with an allowlist of the modules that lack one, and the allowlist may only shrink (the ratchet from item 26).
4. Add the repo's verification skill at `.agents/skills/verify-saasaloy/`: a CLI that runs `play:up`, drives one feature from its map with `playwright-cli` or HTTP, saves the evidence, and runs `play:down`. It replaces the per-PR QA plan for any module that has a map.
5. Add a scheduled workflow, `play.yml`, that runs `pnpm play:up --preset full` and `pnpm play:smoke` once a day on both drivers. A red run opens or updates one issue. This is the deterministic half of "maintained by a scheduled job". An agent that rewrites stale map entries waits for the Phase 4 API secret.

Kit dependency: the generic verification-skill and map-maintenance skills (items 20 and 22, kit side).

Done when: `pnpm test:scripts` runs `feature-map.test.ts` green, `play.yml` has one green scheduled run on both drivers, and the verification skill CLI drives one module (recommended: `waitlist`) from `play:up` to saved evidence to `play:down` with exit code 0.

### Phase 3: move rules out of review

Attended: the owner accepts the mistake classes the `/correct` run proposes, and applies the ruleset and repo settings (task 7).

Tasks:

1. Add a rule-and-enforcer table to `AGENTS.md` (item 19): rule, enforcer (file and test name, or "none"), past mistake it caught. Seed it with the existing guards listed in Context.
2. Add the missing enforcers (item 5, method from item 19). Use the highest layer that works: an oxlint rule in an `overrides` entry when oxlint has one (for example a `process.env` ban scoped to capability paths), else a `scripts/*.test.ts` guard whose failure message names the fix. Guards to add:
   - `scripts/capability-core.test.ts`: every capability core descriptor that owns `providers/` has zero `dependencies`, and its files import no vendor SDK and no Workers binding type.
   - `scripts/vendor-imports.test.ts`: no workspace imports a package that another capability's descriptor owns (ADR 0020).
   - `process.env` ban in `modules/*/files/**` capability source, through oxlint or a guard test.
   - `scripts/config-leaf.test.ts`: `packages/config` source imports nothing outside itself.
   - `scripts/module-names.test.ts`: every module folder name is singular, with an allowlist for the words where the rule needs a human call.
   - `scripts/clean-script.test.ts`: every `package.json` under `packages/cli/templates/base/` and `modules/*/files/` declares `clean` and an exact-pinned `rimraf` devDependency.
   - `scripts/provider-default.test.ts`: every `create<Cap>(env)` throws on an unset or unknown `<CAP>_PROVIDER`. Recommended form: run each core's factory with `{}` and with `{ <CAP>_PROVIDER: "nope" }` and expect the capability's error type.
   Prove each guard fails on a real past mistake or on a planted one, and record the proof in the table's third column.
3. Run the `/correct` method once on git history and PR review comments: list each mistake class that occurs twice or more, then fix it at the highest layer. Commit the result as a `docs/refactor/` or `docs/research/` artifact with the next serial.
4. Add a ratchet test, `scripts/ratchet.test.ts` (item 26): it fails when a PR adds `oxlint-disable` lines above the recorded count (63 total, 38 in shipped payload on 2026-11-07), adds a rule to `suppressed` (36 today), or adds a `TODO`, `FIXME`, `HACK` or `workaround` comment to shipped payload (0 today). A deliberate increase edits the recorded count in the same PR, which raises the PR's tier in Phase 5.
5. Add a weekly gardener workflow, `garden.yml`, that reports the ratchet counts and every new second way of doing one thing that a script can find (for example two `rimraf` pins, two copies of one helper by hash). It opens or updates one issue. An agent-based gardener waits for the Phase 4 secret.
6. Generate the catalog files (item 1). `scripts/catalog.ts` writes the module table in `docs/wiki/modules.md` and the module list in `modules/README.md` between `<!-- catalog:start -->` and `<!-- catalog:end -->` markers, from each `registry-item.json`. The hand-written prose stays outside the markers, and each module's long paragraph moves to its own skill or a `modules/<name>/README.md`. `scripts/catalog.test.ts` fails when the files differ from a fresh run, and `ci.yml` runs it through `pnpm test:scripts`. The site keeps its existing reader.
7. Turn on the merge settings (item 14, replaced): enable `allow_auto_merge`; add a ruleset on `main` that requires the `gate` check, an up-to-date branch, and resolved conversations; and allow squash merge so a split PR lands as one commit. Merge queue stays out (see Design decisions).
8. Add a size check (item 2, saasaloy side): `scripts/pr-size.ts` in a `pr-size` job counts added lines outside tests, `docs/plans/`, `docs/qa/`, lockfiles and generated catalog files. Above the limit (Open question 1) the job fails with a message that asks for a split. Add the rule "a plan and its mockup land on `main` before the build PR" to `AGENTS.md`.

Kit dependencies: the afkkit WIP cap (item 7) and the afkkit stop above the size limit (item 2, kit side).

Done when: `pnpm test:scripts` runs every new guard green on `main`, each guard has a recorded failing proof in the `AGENTS.md` table, two concurrent module PRs that each add a catalog row both merge without a hand-resolved conflict, and `gh api repos/mimukit/saasaloy/rulesets` lists the `main` ruleset.

### Phase 4: automate review

Attended: the owner adds the API secret, writes the per-area failure statements in `REVIEW.md`, and picks the bot (Open question 4).

Tasks:

1. Write `REVIEW.md` at the repo root (item 10): one failure statement per area, a nit cap, skip paths, file-and-line evidence for each finding, findings tagged Important, Nit or Pre-existing, and a summary that starts with a count. Seed statements:
   - A descriptor fails when `saasaloy add` breaks a fresh scaffold.
   - A module skill fails when it says something the code does not do.
   - A template change fails when a new project does not typecheck.
   - A provider fails when it falls back to a default instead of throwing.
   - A test change fails when it deletes or weakens an assertion without a stated reason.
   - A CI or config change fails when it removes a gate or widens `suppressed`.
   Add the loop rule: a finding flagged twice becomes a lint rule, a guard test, a skill fix or a `REVIEW.md` line.
2. Add `review.yml` (item 4): the review bot runs on every PR push, reads `REVIEW.md` and `AGENTS.md`, and reports one check, `review`. The check fails while an Important finding is open. Each finding must carry a command or test that reproduces it, and the prompt drops findings with no reproduction (the saasaloy side of item 21).
3. Add a security review job (item 11) on the same workflow, scoped to auth, payment, secrets, env and `.github/workflows/`.
4. Make findings block (item 11): the ruleset from Phase 3 requires `review` and resolved conversations. Every finding is fixed or answered with a reason.
5. Add `owner-gate.yml` (items 13 and 3 groundwork): a required check that passes only when the `approved` label is on the PR and the recorded SHA equals the head SHA. A `synchronize` event removes the label. Until Phase 5, every PR needs it.
6. Add a reviewer eval set (item 17, saasaloy side) in `scripts/review-evals/`: one case per past escape (#251, #269, #274), each with the parent commit of the fix, the diff that carried the bug, and the finding a reviewer must report. A runner, `pnpm review:eval`, runs the bot's prompt against each case and prints caught or missed. Every change to `REVIEW.md` or `review.yml` runs it.

Kit dependencies: the mergekit review pack (item 6), the review round cap (item 12), the proof-only rerun in reviewkit (item 21), and the independent verifier (item 22).

Done when: `review.yml` and `owner-gate.yml` are required checks on `main`, `pnpm review:eval` catches at least 2 of the 3 escapes, a push to an `approved` PR removes the label and turns `owner-gate` red, and the bot's cost per PR over the first 10 PRs is recorded in `REVIEW.md`.

### Phase 5: loosen only with evidence

Attended: the owner approves each move of a path to a lighter tier.

Tasks:

1. Add `tier.yml` (item 3): it sets one `risk:low`, `risk:medium` or `risk:high` label from the changed paths (Open question 1). Raise-only checks: a deleted test file, an added `oxlint-disable`, an edited `suppressed` block or ratchet count, a changed `.github/workflows/` file, a breaking (`!`) commit, or an outside author. Each raises the tier and never lowers it. Run it in report-only mode for 2 weeks.
2. Add `scripts/review-metrics.ts` and a weekly `metrics.yml` (item 9): PR wait time (median and p90), open PRs that wait for the owner, reverts on `main`, `fix(<module>)` commits within 7 days of the module's merge, smoke and `play.yml` failures, and bot findings per PR. It writes one snapshot to an issue.
3. Write the trust test into `REVIEW.md` (item 27): a path moves to a lighter tier only when the owner has done that kind of task once, the agent has the same tools, every stage proves its work and can stop the line, repeated failures became checks, and the Phase 5 metrics stayed flat for the agreed window (Open question 5).
4. When the trust test passes for low tier, let `owner-gate` pass a `risk:low` PR on a clean `review` check, and turn on auto-merge for it. Medium tier gets a recap and tour (kit review pack), and `metrics.yml` samples 1 in 5 merged medium PRs for a post-merge read.

Kit dependencies: the weekly recap and sampled read (item 8), the decision log and Attention section (item 24), and the PR body sections (items 16 and 25).

Done when: `metrics.yml` has 4 weekly snapshots, at least one `risk:low` PR merged on green checks with no owner action, reverts on `main` are still 0, and the open-PR and p90 targets in Context hold in the latest snapshot.

## Open questions

1. **Tier paths and the size limit (items 3 and 2).** Recommended low tier: `docs/**` except `docs/adr/**`, `apps/web/src/content/**`, test-only changes, and `deps:update` bumps. Medium: a new module confined to `modules/<new>/**` from a grilled plan, plus experimental modules. High: `packages/cli/src/**`, `packages/cli/templates/base/**`, `packages/cli/schemas/**`, `docs/adr/**`, `CONTEXT.md`, `AGENTS.md`, `REVIEW.md`, `oxlint.config.mjs`, `modules/{auth,payment,database,database-d1,database-postgres,env}/**`, and `.github/**`. Recommended size limit: 1,500 added lines outside tests, plans, QA plans, lockfiles and generated files, and 40 files. Zalando's data says agents split PRs to score low, so the tier reads the whole stack, not one PR. Settle it with a dry run of `tier.yml` against the 18 PRs in the lane table.
2. **How experimental works (item 15).** Options: a hidden catalog entry, a warning in `add`, or both. Recommended: both, through one descriptor key `status`. The cost is a CLI release and a `requires.saasaloy` floor on each experimental module, so CLI 0.8.0 refuses the module. That refusal is acceptable for a module that is not stable. The alternative with no CLI change is a repo-side `modules/experimental.json` that only the site and generated docs read, so `add` gives no warning.
3. **dependency-cruiser or `scripts/*.test.ts` for boundary rules (items 5 and 19).** Recommended: `scripts/*.test.ts`, plus oxlint overrides where oxlint has the rule. `modules/*/files/**` are file fragments with `@repo/*` aliases that do not resolve inside this repo, so dependency-cruiser cannot build their graph without a scaffolded playground. Most rules also read descriptors (owned packages, `providers/`), which dependency-cruiser cannot see. Reconsider dependency-cruiser for a scaffolded project in `release:smoke` if a guard test misses a real import.
4. **Which review bot, how strict, and its cost (items 4 and 11).** Recommended: Anthropic's Claude Code GitHub Action with an API key, Sonnet for every PR and Opus for `risk:high`, failing only on Important findings with a reproduction. Alternatives: Anthropic's managed Code Review (per-review billing on a Team or Enterprise plan), CodeRabbit (free on public repos, noisier by the audits the brief cites as search-only), and Copilot code review (needs a subscription and gives no blocking check by itself). No verified price per PR exists in the brief. Settle the cost by running the action on 3 merged PRs of different sizes and recording the bill. Proposed ceiling, to confirm with that run: a median of $3 per PR.
5. **Starting numbers for guardrails and the trust test (items 9 and 27).** Recommended: report-only tiers for 2 weeks; a lighter tier only after 4 weekly snapshots with 0 reverts on `main` and no rise in `fix(<module>)` commits within 7 days of a merge; a sampled post-merge read of 1 in 5 medium PRs; and a WIP cap of 3 PRs waiting for review. Any revert sends that path back one tier.
6. **Catalog generation before Phase 3.** Phase 1 merges several module PRs that edit the same two catalog files. Moving item 1 into Phase 1 removes those conflicts first. Recommended: keep the brief's order, but merge the experimental lane one PR at a time with a rebase between them. Move item 1 up if more than three conflicts appear.
7. **Long module prose in `modules/README.md`.** Generation forces the per-module paragraphs out of the shared file. Recommended home: each module's skill, which agents already read. The alternative is `modules/<name>/README.md`, which agents may not find.
8. **Agent identity.** A machine user or GitHub App that opens agent PRs would let GitHub's own approvals replace the `approved` label. Recommended: keep `owner-gate` now, and revisit after Phase 5, because the swap needs a kit change and a second credential.
9. **Regenerate #280 as one PR or many.** Recommended: one PR per group of 5 modules, each under the size limit.

## Non-goals

- The K items (6, 7, 8, 12, 16, 21 kit side, 22, 23 kit side, 24, 25) and the kit side of every S+K item. The mimukit/skills plan owns them.
- Installing pstack. Its ideas are ported, not its code.
- A comment ban. CI and config files use explanatory comments on purpose (brief item 26).
- Moving the repo to an organization for merge queue.
- Feature flags, staged rollout or rollback tooling for user projects.
- Changing the plan and grill workflow. It stays the owner's control point for architecture and data shape.
