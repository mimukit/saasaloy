# 0046: The CLI runs unattended by refusing, never by guessing

An agent or a CI job drives `saasaloy` with no TTY. Before this decision, `init` with no name and `remove` without `--yes` opened prompts with no TTY check, so they could wait on stdin forever, and `add waitlist --yes` refused with no flag that could answer its driver choice. Now every prompt goes through one guard. With no TTY and no flag that answers the prompt, the command exits 2 and names the flag, and every prompt has such a flag (`init --yes`, `add --with`, `env --from-file`, `update --resolved`). `--json` on `list`, `doctor`, `outdated`, `env --check` and `add --dry-run` prints one JSON document to stdout with a top-level `schemaVersion: 1`, the TUI and warnings go to stderr, and the exit codes in `lib/exit.ts` keep their meaning. Settled on 2026-10-21 in the grill of `docs/plans/0074-plan-agent-native-mvp-build-2026-10-21.md`.

## Status

accepted, amended 2026-10-23. See the amendment below, which records what the build settled beyond the decision text.

## Considered Options

- Pick a default when there is no TTY. Rejected: a silent default picks a database driver or skips an install with nobody watching, and the run looks green. It is the same reason `<CAP>_PROVIDER` has no fallback.
- Treat the `CI` env var as "non-interactive". Rejected: plan 0023 already settled that the TTY check ignores `CI`, and an agent's shell does not set it.
- An MCP server as the agent interface. Rejected: a second surface to keep in step with the CLI, when every coding agent already runs shell commands.

## Consequences

- A new prompt without an answering flag fails one of two CLI tests. `src/lib/prompts.test.ts` fails a command that imports a prompt from `@clack/prompts` instead of the guard in `lib/prompts.ts`. `src/commands/no-tty.test.ts` runs every command with stdin closed and with a silent pipe, in an empty directory and in a scaffolded project, and fails any command that is still running at its timeout.
- A breaking change to a `--json` shape bumps `schemaVersion`. Adding a field does not.
- An agent reads module metadata (`description`, `stage`, `needs`) from `saasaloy list --json`, never by parsing the TUI.

## Amendment — 2026-10-23: the flags, the error document and the help exception

The build of issue #223 settled four points that the decision text above does not name.

- Every prompt has an answering flag, and the list is longer than the four above. `init <name> --yes` answers the install prompt. `remove --yes` answers the confirm. `new module --type` and `--depends-on` answer the type picker and the dependency question. `env --set KEY=value` answers one variable, beside `env --from-file`. `--yes` on `add` and `update` answers their confirms. `update --resolved` does not answer a prompt: it records a merge as done, so the next run stops asking for it.
- A `--json` run that stops before its report still prints one document to stdout. An unknown flag, no project, or a refusal prints `{ "schemaVersion": 1, "error": { "exitCode", "message" } }`, so stdout parses on every exit.
- `--help` is the one exception to that rule. `saasaloy doctor --json --help` prints plain help on stdout and exits 0, because help is not a run and has no report to put in a document.
- The exit codes in `lib/exit.ts` keep their meaning under `--json`. A document never replaces an exit code.
