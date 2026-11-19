# 0064: The running CLI serves its own base skills

A project holds the base skills of the CLI that last wrote its base. The `saasaloy-update` skill at `.agents/skills/saasaloy-update/SKILL.md` is the runbook for `saasaloy update`, yet the project's copy changes only during the update it describes, so an agent reads steps written for an older CLI and then runs a newer one whose flags and exit codes can differ. A base skill added in a later release has the same problem: a project made before it shipped does not have it until a base update succeeds, which is the moment it is least needed. Settled in the grill of plan [0113](../plans/0113-plan-agent-runbook-and-failure-report-2026-11-19.md), decisions "Where the current runbook comes from", "The command's name", "Scope of `saasaloy skill`" and "How an old project learns of the command" (issue [#359](https://github.com/mimukit/saasaloy/issues/359)).

**`saasaloy skill <name>` prints the base skill bundled in the running CLI's npm package**, rendered with the same template variables `init` uses, so its bytes are the bytes `init` would write today. Inside a project the variables take that project's name; outside one they take a default. **`saasaloy skill` with no name lists the bundled base skills** with the `description` from each skill's frontmatter, and `--json` prints the list, or the named skill, as one document. An unknown name exits 2 and lists the known names on stderr. stdout carries only the skill text, the list or the JSON document.

**The scope is base skills only**, read from `templates/base/_agents/skills/` inside the package. Module skills already arrive with their module through `add` and `update`, and serving them would add a registry fetch to a command that today needs no network.

**The CLI output names the command, because an old skill cannot.** The merge plan header names `saasaloy skill saasaloy-update`, and the failure hint names `saasaloy skill saasaloy-report`. A project whose base predates this command learns of it the first time a newer CLI runs `update` or fails in it.

## Status

accepted.

## Considered Options

- **Name it `runbook`.** Rejected. The word fits the update skill and no other one, and the command serves every base skill, `saasaloy-report` included.
- **Serve skills through `saasaloy help <skill>`.** Rejected. It mixes the CLI's own help with instructions written for an agent, and `help` already means the command list.
- **Add `update --runbook`.** Rejected. It serves only the update skill, so it cannot hand `saasaloy-report` to a project that does not have it yet.
- **Fetch the skill from a raw GitHub URL at the release tag.** Rejected. It needs the network and a fetch tool, where the npm package already carries the same file at the same version (`templates/` is in the package's `files`).
- **Read the skill from `main`.** Rejected. A project runs a released CLI, and `main` can describe flags that the release does not have.
- **Serve module skills too.** Rejected for now. A module skill is versioned with its module, the project already holds the one its lock records, and the current one lives in a registry, not in this package.

## Consequences

- **`skill` is public CLI surface.** Its name, its two forms and its JSON shapes follow the same rules as every other command: a breaking change to a document bumps its `schemaVersion`, and a new field does not.
- **The printed text matches the CLI that runs it.** An agent that follows `saasaloy skill saasaloy-update` after a CLI upgrade works from the steps of the CLI it is about to run, whatever its project's copy says.
- **A new base skill reaches every project at once.** It ships in the package, so `saasaloy skill <name>` prints it in a project that has never taken the base update that would write it.
- **The project's copy can differ from the printed one.** An owner edit makes the two differ as much as an older CLI does, so the merge plan header says "differs from this project's copy", never "is older".
- **The render guards a later change.** The base skills hold no template variables today, so every project gets the same bytes. The render keeps a later `{{PROJECT_NAME}}` in a skill correct without a change to the command.

## References

Issue [#359](https://github.com/mimukit/saasaloy/issues/359). Plan: [`0113-plan-agent-runbook-and-failure-report-2026-11-19.md`](../plans/0113-plan-agent-runbook-and-failure-report-2026-11-19.md), phase 2. Prior: [ADR 0046](0046-adr-the-cli-runs-unattended-by-refusing-never-by-guessing-2026-10-21.md) (stdout and refusals under `--json`), [ADR 0062](0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md) (a release reads its own tag). Code: `packages/cli/src/commands/skill.ts`, `packages/cli/src/lib/scaffold.ts` (`baseTemplateDir`, `templateVars`, `applyVars`). Tests: `packages/cli/src/commands/skill.test.ts`.
