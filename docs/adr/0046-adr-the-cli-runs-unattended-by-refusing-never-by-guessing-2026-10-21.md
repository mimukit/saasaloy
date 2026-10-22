# 0046: The CLI runs unattended by refusing, never by guessing

An agent or a CI job drives `saasaloy` with no TTY. Before this decision, `init` with no name and `remove` without `--yes` opened prompts with no TTY check, so they could wait on stdin forever, and `add waitlist --yes` refused with no flag that could answer its driver choice. Now every prompt goes through one guard. With no TTY and no flag that answers the prompt, the command exits 2 and names the flag, and every prompt has such a flag (`init --yes`, `add --with`, `env --from-file`, `update --resolved`). `--json` on `list`, `doctor`, `outdated`, `env --check` and `add --dry-run` prints one JSON document to stdout with a top-level `schemaVersion: 1`, the TUI and warnings go to stderr, and the exit codes in `lib/exit.ts` keep their meaning. Settled on 2026-10-21 in the grill of `docs/plans/0074-plan-agent-native-mvp-build-2026-10-21.md`.

## Status

accepted

## Considered Options

- Pick a default when there is no TTY. Rejected: a silent default picks a database driver or skips an install with nobody watching, and the run looks green. It is the same reason `<CAP>_PROVIDER` has no fallback.
- Treat the `CI` env var as "non-interactive". Rejected: plan 0023 already settled that the TTY check ignores `CI`, and an agent's shell does not set it.
- An MCP server as the agent interface. Rejected: a second surface to keep in step with the CLI, when every coding agent already runs shell commands.

## Consequences

- A new prompt without an answering flag fails the CLI test that runs every command with stdin closed.
- A breaking change to a `--json` shape bumps `schemaVersion`. Adding a field does not.
- An agent reads module metadata (`description`, `stage`, `needs`) from `saasaloy list --json`, never by parsing the TUI.
