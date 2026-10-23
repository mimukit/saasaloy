# 0053: One testing mode, in `saasaloy.json` and a marked `AGENTS.md` block

A generated project had a test harness and almost no tests, and nothing told an agent working in it whether to write any. Testing is now opt-in per project. This record settles where the choice lives and how the agent learns it. Issue [#242](https://github.com/mimukit/saasaloy/issues/242) builds it, from `docs/plans/0080-plan-opt-in-testing-2026-10-23.md`.

## Status

accepted. Amends [ADR 0007](0007-adr-agent-native-static-agents-md-copied-skills-2026-07-22.md): the root `AGENTS.md` is no longer copied verbatim. One marked block in it is filled per project, and the CLI rewrites that block later. The rest of ADR 0007 stands. No module appends to a shared agent file, and module guidance still ships as a skill.

## The decision

- **One mode per project.** `saasaloy.json` carries `"testing": { "mode": "off" | "tests-after" | "tdd" }`. The schema rejects any other value and any other key in the object. `off` is the default.
- **An absent key reads as `off`.** A project scaffolded before the key existed still validates and keeps working. `init` always writes the key, so a new project never relies on the default.
- **`init --testing=<mode>` sets it at scaffold time.** An attended init, one with a terminal on stdin and stdout and no flag, asks once. An unattended init with no flag writes `off`. That is the opt-in default, not a guess, so it does not break [ADR 0046](0046-adr-the-cli-runs-unattended-by-refusing-never-by-guessing-2026-10-21.md). A bad value is a refusal, exit 2, before anything is written.
- **`saasaloy testing [mode]` reads and changes it.** With no argument it prints the bare mode word on stdout, so a script can read it. With a mode it saves the mode and rewrites the block in the same run.
- **The root `AGENTS.md` carries a marked block.** The template's "Testing Instructions" section holds `<!-- saasaloy:testing -->` and `<!-- /saasaloy:testing -->`. The CLI rewrites only the text between them. The three texts live in `packages/cli/src/lib/testing.ts`, and the template ships the `off` text, which a test holds equal to the code.
- **The base render fills the block for the project's mode.** `init`, `update` and base adoption render the template with the mode from `saasaloy.json`. The recorded hash is of the filled bytes, so `update` compares against what the project holds and never puts the `off` text back into a `tdd` project.
- **The new hash is recorded only for a clean file.** `saasaloy testing` records the rewritten `AGENTS.md` hash when the file on disk matched the base's recorded hash before the rewrite. An edited file keeps its old hash, so `update` still reads it as edited and offers a merge rather than an overwrite.
- **Missing markers do not stop the change.** When the owner removed the block, `saasaloy testing` saves the mode, warns with the file name, and exits 0.
- **Turning testing off deletes nothing.** A written test file may hold the owner's work, and the CLI never deletes a file the owner may have edited ([ADR 0034](0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md)).
- **`update` names the switch once for an old project.** When the key is absent and the manifest holds a `*.test.ts` that a module owns, `update` prints one line that suggests `saasaloy testing tests-after`. The base's own tests do not count. A project with the key, at any value, hears nothing.

## Why two places

The value has to be machine-readable, because the CLI decides which files ship from it (issue #242 phase 2). The agent has to read it where it already reads its rules, because an agent does not open `saasaloy.json` before writing code. One source rendered into the other keeps them in step: the CLI writes both in the same command, and the render reads the value rather than the text.

## Considered Options

- **The mode in `AGENTS.md` only.** Rejected: the CLI would parse prose to decide which files to write, and an owner's edit to the wording would change behaviour.
- **The mode in `saasaloy.json` only, with a static paragraph that tells the agent to read it.** Rejected: an agent follows the text in front of it, and a pointer to a JSON key is one more step it can skip.
- **A `{{TESTING_BLOCK}}` template variable.** Rejected: `saasaloy testing` would still need a marker rewrite for an existing project, so the render and the command would fill the block two ways. One marker function serves both.
- **A `testing` module whose presence turns testing on.** Rejected in the plan: a module holds files, not a value, and `remove testing` would have to delete the owner's tests.

## Consequences

- The template's `AGENTS.md` changed, so its template hash changed, and every existing project sees the base as outdated once. A clean `AGENTS.md` is overwritten with the block filled for the project's mode, which is `off` for a project with no key.
- A project whose `AGENTS.md` was edited gets the block through the merge plan, like any other base change.
- Phase 2 of issue #242 adds the backfill step that `saasaloy testing <on-mode>` calls. The command marks the place for it.

## References

- `docs/plans/0080-plan-opt-in-testing-2026-10-23.md`, rows "Testing is opt-in", "TDD flag lives in two places", "CLI surface" and "The `AGENTS.md` block and `update`".
- [ADR 0032](0032-adr-the-base-carries-provenance-and-updates-through-the-module-path-2026-09-06.md), the base's recorded hashes that the clean-file rule reads.
