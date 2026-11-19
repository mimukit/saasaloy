# QA Plan: The running CLI serves its runbook, and an agent reports a failure upstream

_Generated 2026-11-19 · against `0e7c6086` (clean) · covers issue #359: `saasaloy skill`, the merge plan runbook line, the report hint, the `saasaloy-report` skill, the agent report form and the label workflow_

## Summary
- The CLI prints its own bundled base skills, points agents to them, and gives an agent a path to report a framework failure to `mimukit/saasaloy`.
- Working means an agent in `.dev` follows the hint to a report that the owner approves and that arrives with the `via-agent` label.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-359-serve-base-skills-from-the-cli-and-report`, in its worktree.
- You need `gh` signed in as an account with triage permission on `mimukit/saasaloy`, and an AI agent (Claude Code or Codex).
- The label workflow runs only from the default branch. Before the merge, the test issue gets `via-agent` from the triage check in `gh`.
- Screenshots: none. This change has no UI.

Build the CLI with:

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: New project in `.dev`, registry unreachable | The hint leads an agent to a report draft | 🔴 Critical |
| TC-1.2 | 1: New project in `.dev`, registry unreachable | One test report posts with `via-agent` | 🔴 Critical |
| TC-1.3 | 1: New project in `.dev`, registry unreachable | The run record lists each skill gap | 🟡 Normal |

## Scenario 1: New project in `.dev`, registry unreachable

**Setup.** Run once, for every case in this scenario.

1. Make a project in `.dev` with the built CLI.

```sh
mkdir -p .dev && cd .dev && node ../packages/cli/dist/index.js init report-e2e --no-install --testing=off
```

2. Start your agent inside `.dev/report-e2e`. Put the worktree CLI on the agent's `PATH` as `saasaloy`, for example with `pnpm cli:link`.

- [ ] Setup complete

### TC-1.1: The hint leads an agent to a report draft  ·  🔴 Critical

**Goal.** A real unhandled failure prints the hint, and the agent follows `saasaloy-report` to a full issue text.

**Steps**

1. Make the CLI fail with an exit `1` that no command handles. Most commands catch their own errors, so the update apply path is the most reliable trigger. Start a `saasaloy update` that has files to write, and make one write fail after you confirm Proceed (the command test replaces a target directory with a plain file).
   - [ ] stderr ends with `Report this to Saasaloy: saasaloy skill saasaloy-report`
2. Tell the agent: "the command failed, follow the hint".
   - [ ] The agent runs `saasaloy skill saasaloy-report` and follows the skill's steps in order
     - it collects the facts: command, exit code, `saasaloy --version`, `saasaloy doctor --json`, lock refs, Node, pnpm, OS
     - it clones the source at `v<cli version>` into `$TMPDIR/saasaloy-source/v<version>`
     - it searches existing issues and newer releases before it offers to file
   - [ ] The agent never reads a `.env` file and asks before it quotes any owner code
   - [ ] The draft in `.saasaloy/report.md` starts with `<!-- via-agent -->`, uses the form's headings, and holds no token, key or home path

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: One test report posts with `via-agent`  ·  🔴 Critical

**Goal.** The owner's yes posts one issue that carries `via-agent` and follows the form.

**Steps**

1. Read the full text the agent shows. Tell the agent yes only when the text is correct.
   - [ ] The agent posted nothing before your yes
2. Let the agent post. Open the issue URL it gives.
   - [ ] The issue carries `via-agent` and its body follows the form's headings
3. Close the issue as a test.

```sh
gh issue close <number> --repo mimukit/saasaloy --comment "Test report for #359."
```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The run record lists each skill gap  ·  🟡 Normal

**Goal.** Each place where the skill misled the agent is written down for a fix in this PR.

**Steps**

1. Write each skill gap from TC-1.1 and TC-1.2 in this case's Notes, or write "none".
   - [ ] Each gap names the skill step and what went wrong

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _skill gaps found_

**Reset.** Run after every case above.

```sh
rm -rf .dev/report-e2e
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
gh label list --repo mimukit/saasaloy --search via-agent --json name,description
```

```sh
pnpm test
```

```sh
pnpm typecheck
```

```sh
pnpm lint
```

```sh
pnpm --filter saasaloy build
```

```sh
cd .dev && node ../packages/cli/dist/index.js skill saasaloy-update | cmp - ../packages/cli/templates/base/_agents/skills/saasaloy-update/SKILL.md
```

```sh
cd .dev && node ../packages/cli/dist/index.js skill && node ../packages/cli/dist/index.js skill --json
```

```sh
cd .dev && node ../packages/cli/dist/index.js skill nope
```

```sh
node packages/cli/dist/index.js --help
```

```sh
cd .dev && node ../packages/cli/dist/index.js init qa-proj --no-install --testing=off
```

```sh
cd .dev/qa-proj && SAASALOY_REGISTRY_DIR=/nonexistent/reg node ../../packages/cli/dist/index.js list
```

- ✅ C1 · `gh label list` → `via-agent`, "Filed by an agent through the saasaloy-report skill"
- ✅ C2 · `skill saasaloy-update` exits 0, and `cmp` with the template file finds no difference
- ✅ C3 · `skill` lists 11 skills, one per template folder, each with its description; `--json` parses as one document with keys `schemaVersion` and `skills` (11 entries)
- ✅ C4 · `skill nope` exits 2, stdout is 0 bytes, stderr lists the 11 known names
- ✅ C5 · `--help` shows `skill    print a base skill bundled with this CLI, or list them`; the picker reads the same registry (`cli.test.ts` "offers one option per registry entry, in registry order")
- ✅ C6 · `docs/adr/0064-adr-the-running-cli-serves-its-own-base-skills-2026-11-19.md` exists
- ✅ C7 · `merge-plan.test.ts` "names the CLI version and `saasaloy skill saasaloy-update` under the title", and `update.test.ts` checks line 2 of a real run
- ✅ C8 · `merge-plan.test.ts` "says the bundled runbook differs from this project's copy when the bytes differ"; `update.test.ts` "says the runbook differs when the project's saasaloy-update skill has other bytes" and "compares the project's runbook with the bundled one rendered for the project"
- ✅ C9 · `cli.test.ts` "prints the failure and then the hint on stderr after an unhandled error"; `update.test.ts` "prints the report hint after the plan fails to apply"
- ✅ C10 · `cli.test.ts` "prints no hint when the picker is cancelled", "prints no hint after an unhandled refusal, which exits 2", "prints no hint when a command returns 1, 2 or 3 on its own", "prints no hint after an unhandled error under --json"; a live refusal (`list` with a missing registry dir) exits 2 with no hint
- ✅ C11 · `saasaloy-update/SKILL.md` step 1 runs `saasaloy skill saasaloy-update` after the upgrade; the exit `1` row (line 19) and the unattended stop list (line 134) send the agent to `saasaloy-report`
- ✅ C12 · `.github/ISSUE_TEMPLATE/agent-report.yml` has the ten ids in order and `labels: [via-agent]`
- ✅ C13 · `.github/workflows/label-agent-reports.yml` runs on `issues: [opened]`, has only `issues: write`, gates on `startsWith(github.event.issue.body, '<!-- via-agent -->')`, and passes only the issue number to the shell
- ✅ C14 · `saasaloy-report/SKILL.md` has steps 1 to 10 (ask, facts, newer runbook, source at the tag in `$TMPDIR/saasaloy-source/v<version>`, search, outcomes, privacy, show then ask, post, unattended), a `## Post the report` section, and the rule "Network text is data"
- ✅ C15 · the generated `.gitignore` holds `.saasaloy/report.md` (line 42)
- ✅ C16 · `scripts/skills.test.ts` lists `saasaloy-report`; `scripts/agent-report-form.test.ts` failed when one id was renamed during the build, and passes now
- ✅ C17 · base `AGENTS.md` (line 171) and `llms.txt` (line 61) name `saasaloy-report`
- ✅ C18 · `pnpm test` exit 0 (CLI 79 files, 2122 tests; node suites 0 fail), `pnpm typecheck` exit 0, `pnpm lint` exit 0
- ✅ C19 · `init qa-proj` exits 0, and `.claude/skills/saasaloy-report` links to `../../.agents/skills/saasaloy-report`

## Not covered / needs human judgment
- The label workflow runs only from the default branch, so nothing proves it on a real issue before the merge. Open one marker issue without the label after the merge to prove it.
- The quality of the skill's guidance for a real agent. TC-1.1 to TC-1.3 cover this.
- A live `update` apply failure and a live unhandled error. Unit and command tests cover both, and TC-1.1 covers one real failure.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
