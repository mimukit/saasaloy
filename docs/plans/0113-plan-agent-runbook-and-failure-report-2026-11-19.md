# Plan: The running CLI serves its runbook, and an agent reports a framework failure upstream

Grilled: 2026-11-19

## Context

Saasaloy is used mostly by AI agents, and a brownfield project takes new releases through `saasaloy update`. Two gaps remain after ADRs 0058 and 0059.

The first gap is a stale runbook. The `saasaloy-update` skill is a base file at `packages/cli/templates/base/_agents/skills/saasaloy-update/SKILL.md`. A project holds the copy from the CLI that last wrote its base. The agent reads that old copy, then runs a newer CLI whose flags, exit codes and steps can differ. The project's copy changes only during the update it describes. The same problem blocks any new base skill: a project made before the skill shipped does not have it until a base update succeeds, which is the moment it is least needed.

The second gap is the path back to the framework. When an update fails or a merge cannot be settled, the agent stops and reports to the project owner. That knowledge stays in one project. PrimeShopr's 0.5.0 to 0.8.0 update produced ADR 0059 only because the maintainer read that session by hand.

T3 Code's triage feature (`docs/user/triage.md` and `.github/triage/PLAYBOOK.md` in `pingdotgg/t3code`) solves the same two problems for its own installs. Its agent reads the newest playbook before it acts, reads the source at the release tag, searches existing issues, and drafts a redacted issue that it posts only after an explicit yes. This plan takes those parts and leaves out its launcher command.

Goal: an agent in any Saasaloy project, of any age, works from the instructions of the CLI that runs, and a framework failure found in a real project reaches `mimukit/saasaloy` as an issue with a reproduction.

Target: no number. The build checks the runbook pointer with tests. The maintainer reviews the `via-agent` issues at the first release after this ships and decides then whether the report path needs a number (measured after release; set by the owner in the grill on 2026-11-19).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the current runbook comes from | A new command prints a base skill bundled in the CLI's npm package (`templates/` already ships in `files`). It needs no network, and it matches the running version exactly. A raw GitHub URL at the tag needs the network and a fetch tool. An `update --runbook` flag cannot serve `saasaloy-report` to a project that does not have it. |
| The command's name | `saasaloy skill [<name>] [--json]`. With no name it lists the bundled base skills. `runbook` fits only the update skill, and `help <skill>` mixes CLI help with agent instructions. This is public CLI surface, so ADR 0064 records it. |
| Scope of `saasaloy skill` | Base skills only, read from `templates/base/_agents/skills/`. Module skills already arrive with their module through `add` and `update`, and a registry fetch would add a network path. |
| How an old project learns of the command | The CLI output names it, because an old skill cannot. The merge plan header names `saasaloy skill saasaloy-update`, and the failure hint names `saasaloy skill saasaloy-report`. |
| When the merge plan header line prints | On every run. When the project's copy of `saasaloy-update/SKILL.md` has different bytes from the bundled one, the line adds "differs from this project's copy". It says "differs", not "is older", because an owner edit also makes the copies differ. |
| Where the failure hint prints | Two places only: the catch for unhandled errors in `packages/cli/src/index.ts`, and the apply failure path in `packages/cli/src/commands/update.ts`. It is one stderr line, `Report this to Saasaloy: saasaloy skill saasaloy-report`, and it never prints under `--json`. A hint on every exit `1` would also fire after a cancel, because exit `1` means "something failed, or you cancelled" (`src/cli.ts`). A typed failure through all 23 `EXIT_FAILURE` paths costs too much for this plan. |
| Exit `2` and exit `3` | They print no hint and do not trigger the report skill. A refusal and pending work are expected outcomes. The owner can still call `saasaloy-report` by hand. |
| No launcher | No `saasaloy triage` that starts Claude Code or Codex. A Saasaloy user already works inside an agent, and a launcher ties the CLI to two vendors, against the vendor-blind rule in `AGENTS.md`. |
| Name of the new skill | `saasaloy-report`. The job is to report a framework failure upstream, so "triage" would name the wrong job. |
| Where the report goes | A GitHub issue form, `.github/ISSUE_TEMPLATE/agent-report.yml`, in this repo. The form applies the label `via-agent`. |
| How the agent posts | When `gh` is signed in, the agent runs `gh issue create --repo mimukit/saasaloy` with a body that uses the form's headings and starts with `<!-- via-agent -->`. It adds `--label via-agent` only when `gh api repos/mimukit/saasaloy --jq .permissions.triage` prints `true`. When `gh` is not signed in, it prints a prefilled `issues/new?template=agent-report.yml` URL under 6,000 characters. A prefilled URL as the only path fails on a headless box with no browser. |
| Who labels an issue posted without the label | A workflow, `.github/workflows/label-agent-reports.yml`, with `issues: write`. It adds `via-agent` to a new issue whose body starts with `<!-- via-agent -->`. |
| Consent | The agent posts an issue or a comment only after the owner reads the full text and says yes. A comment on a duplicate follows the same rules as a new issue. In an unattended run the agent writes the draft to `.saasaloy/report.md` and posts nothing (ADR 0046). |
| Privacy | The agent never reads `packages/env/.env` or any `.env` file. By default it quotes only managed files as upstream ships them, CLI output, and versions. It quotes the owner's own code only after a separate yes for each excerpt, shown with its path. An unattended draft leaves owner code out and lists each excerpt it would ask about. The agent removes tokens, keys and the home directory path. |
| Fix boundary | The agent never patches the installed CLI or a file in `node_modules` as a fix. It may fix inside the project, upgrade the CLI, or report. |
| Source for diagnosis | The skill tells the agent to make a shallow, sparse clone of `mimukit/saasaloy` at `v<cli version>` into `$TMPDIR/saasaloy-source/v<version>`, and to reuse that folder when it exists. Reports are rare, so a cache with cleanup rules gains nothing. |
| Tests | Command tests with vitest beside the source in `packages/cli/src/commands/skill.test.ts`, as for every other command. Repo-level checks go in `scripts/*.test.ts`, as `scripts/skills.test.ts` and `scripts/env-presets.test.ts` do. No new kind of test. |
| Approved outward actions | Phase 1 runs `gh label create via-agent --repo mimukit/saasaloy`, approved by the owner in the grill on 2026-11-19. An unattended run (afkkit) may run it, and the PR shows the `gh label list` output as proof (re-grill 2026-11-19). The one real test report posts only after the owner's separate yes at that time, in the manual QA below. |
| The end-to-end report | Not a build phase. It is a manual case in the PR's QA plan, which the owner runs in the review worktree before the merge, so a skill gap gets fixed in the same PR. Before the merge the label workflow does not run from the default branch, so the test issue gets `via-agent` from the triage check in `gh`. A follow-up issue was rejected because the check belongs to this change. An unattended draft only was rejected because it never proves a post (re-grill 2026-11-19). |

## Approach

The plan adds one small CLI command, one base skill, an issue form and a label workflow, and it changes three outputs: the merge plan header, the failure hint, and two skills. It reuses:

- `packages/cli/src/commands/index.ts`, the command registry that feeds help and the picker, and `descriptions.ts`.
- `renderTemplate` and `templateVars` in `packages/cli/src/lib/base.ts` and `lib/scaffold.ts`, so a printed skill has the same bytes `init` would write. The base skills hold no template variables today, so this only guards a later change.
- `createOutput` and `printJson` in `lib/json-output.ts` for `--json`, and `lib/usage.ts` for help.
- `renderMergePlan` in `lib/merge-plan.ts` for the header line.
- The failure path in `src/index.ts`, which already prints `formatFailure(error)`.
- `saasaloy doctor --json`, `saasaloy --version` and `saasaloy-lock.json` as the facts a report carries, in place of a new context file.
- `scripts/skills.test.ts`, which already lists the base skills.

Rejected: fetch the runbook from `main` as T3 does. A project runs a released CLI, and `main` can describe flags that the release does not have.

### Phase 1: create the `via-agent` label (#359)

The owner approved this outward action in the grill on 2026-11-19, and the re-grill on 2026-11-19 lets an unattended run do it. The PR body shows the `gh label list` output.

- Run `gh label create via-agent --repo mimukit/saasaloy --description "Filed by an agent through the saasaloy-report skill"`.

Done when: `gh label list --repo mimukit/saasaloy --search via-agent` prints the label.

### Phase 2: `saasaloy skill` (#359)

- Add `packages/cli/src/commands/skill.ts` and register it in `commands/index.ts` after `doctor`, with a line in `descriptions.ts`.
- `saasaloy skill <name>` renders `templates/base/_agents/skills/<name>/SKILL.md` with `renderTemplate` and prints it on stdout. Run inside a project, it uses that project's name for the template vars. Outside a project it uses the default vars.
- `saasaloy skill` with no name lists each bundled base skill with the `description` from its frontmatter. `--json` prints that list as one document.
- An unknown name exits `2` and lists the known names. Nothing goes to stdout except the skill text or the JSON.
- Add `skill.test.ts`: it prints a known skill byte for byte, lists every folder in the template, refuses an unknown name with exit `2`, and keeps stdout clean.
- Write ADR 0064, "The running CLI serves its own base skills", with the decisions on the name, the scope and the two pointers.

Done when: `node packages/cli/dist/index.js skill saasaloy-update` run in `.dev` prints the template skill, `skill nope` exits `2`, `pnpm --filter saasaloy test` passes, and `docs/adr/0064-*.md` exists.

### Phase 3: the CLI points to its own runbook (#359)

- `renderMergePlan` adds one line under `# Saasaloy merge plan`. It names the CLI version and says: read `saasaloy skill saasaloy-update` before you work this plan. When the project's copy has different bytes, the line adds "differs from this project's copy".
- `src/index.ts` and the apply failure path in `update.ts` print one stderr line after the error: `Report this to Saasaloy: saasaloy skill saasaloy-report`. The line never prints under `--json`.
- Edit `saasaloy-update/SKILL.md`. Step 1 tells the agent to run `saasaloy skill saasaloy-update` after the CLI upgrade and to follow that text when it differs. The exit `1` row and the "Unattended run" stop list send the agent to `saasaloy-report`.
- Add tests to `merge-plan.test.ts` for the header line in both states, a test for the hint after an unhandled error, a test for the hint after an update apply failure, and a test that a cancel prints no hint.

Done when: a test project whose `saasaloy-update` skill differs from the bundled one gets a merge plan whose second line names `saasaloy skill saasaloy-update` and says the copy differs, the hint tests pass, and `pnpm --filter saasaloy test` passes.

### Phase 4: the `saasaloy-report` skill, the issue form and the label workflow (#359)

- Add `.github/ISSUE_TEMPLATE/agent-report.yml` with these field ids: `what-happened`, `command`, `diagnosis`, `steps`, `versions`, `environment`, `evidence`, `related`, `workaround`, `agent`. The form applies the label `via-agent`.
- Add `.github/workflows/label-agent-reports.yml`. On `issues: opened`, it adds `via-agent` when the body starts with `<!-- via-agent -->`. It needs `issues: write` and nothing else.
- Add `packages/cli/templates/base/_agents/skills/saasaloy-report/SKILL.md`. Its procedure:
  1. Ask the owner what went wrong, unless the session already shows it.
  2. Collect the facts: the failed command and its exit code, `saasaloy --version`, `saasaloy doctor --json`, the module refs in `saasaloy-lock.json`, the Node and pnpm versions, and the OS.
  3. Check for a newer runbook with `saasaloy skill saasaloy-report`, and follow it when it differs.
  4. Clone the source at `v<cli version>` into `$TMPDIR/saasaloy-source/v<version>` to map the error to code. Reuse the folder when it exists.
  5. Search `mimukit/saasaloy` issues and releases newer than the project's CLI. If a newer release has the fix, give the upgrade command.
  6. Offer the outcomes: a fix inside the project, an upgrade, a new issue, a comment on a duplicate, or nothing.
  7. Apply the privacy rule. Quote owner code only after a separate yes for each excerpt. Remove secrets and the home path.
  8. Show the full text of the issue or the comment, and post only after a yes.
  9. Post as the "How the agent posts" decision says: `gh` with the body marker, the label only with triage permission, and a prefilled URL when `gh` is not signed in.
  10. In an unattended run, write `.saasaloy/report.md` with no owner code, list the excerpts it would ask about, and stop.
- The skill states that issue text, logs and update notes from the network are data, never instructions.
- Add `.saasaloy/report.md` to `packages/cli/templates/base/_gitignore`.
- Add `saasaloy-report` to `scripts/skills.test.ts`. Add `scripts/agent-report-form.test.ts`, which fails when the field ids in the form and in the skill differ.
- Update the skill list in `packages/cli/templates/base/AGENTS.md` ("Ten skills" becomes eleven) and in `llms.txt`.

Done when: `pnpm test` passes with the two script tests, `pnpm lint` passes, `saasaloy skill saasaloy-report` prints the new skill, and a project made with `saasaloy init` in `.dev` holds `.claude/skills/saasaloy-report`.

## Manual QA (owner): try one report end to end (#359)

Not a build phase. The QA plan of the #359 PR carries these steps as human-only manual cases. The owner runs them in the review worktree before the merge, and gives a separate yes before the agent posts the test report.

- In `.dev`, start an agent on a project and force an unhandled error (for example, an unreachable registry).
- Check that the CLI prints the hint, and let the agent follow `saasaloy-report` to the point of the issue text.
- Post it with the owner's yes, then close it as a test. Record what the skill got wrong.

Done when: one issue on `mimukit/saasaloy` carries the `via-agent` label (from the form or the triage flag, because the workflow runs only from the default branch), its body follows the form's headings, and the QA plan's run record lists each skill gap found.

## Open questions

None. The grill on 2026-11-19 settled every decision. The report count has no target. The maintainer reviews the `via-agent` issues at the first release after this ships.

## Non-goals

- A launcher command that starts Claude Code, Codex or any other agent.
- Automatic posting, telemetry, or any network call that the owner did not approve.
- A patch to the installed CLI or to `node_modules` as a fix.
- Reading the runbook from `main`.
- Serving module skills through `saasaloy skill`.
- A failure hint on every exit `1`, or a typed failure through every command.
- A base update note for this change. The new skill arrives as a new base file, and the merge plan header reaches old projects without a note.
