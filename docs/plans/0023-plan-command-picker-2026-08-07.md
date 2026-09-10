# Plan — Interactive command picker on bare invocation

Grilled: 2026-08-07

> Tracked in [#63](https://github.com/mimukit/saasaloy/issues/63).

## Context

`saasaloy` with no arguments prints a static list and exits (`packages/cli/src/index.ts:47`). Every
other surface of the CLI is interactive — `init` asks for a project name, `add` and `remove` open a
`@clack/prompts` picker when you don't name a module — so the help-and-exit path is the one place a
user who doesn't yet know the command names has to read, quit, and retype.

Show a picker of the available commands instead: select one, and it runs.

Grounding this in the code turns up a second, related defect. Those `add`/`remove` pickers
(`add.ts:233`, `remove.ts:158`) have **no TTY guard**. In CI, or with stdin piped, `saasaloy add`
with no module argument doesn't fail — it hangs on a prompt nobody can answer. The new picker would
be the third instance of the same hazard, so this plan introduces one shared interactivity check and
retrofits it to the two existing pickers.

**Success:** a newcomer types `saasaloy`, sees what the tool can do, picks, and the command runs —
while CI gets the same help text and the same exit code it gets today, and `saasaloy add` in a
pipeline fails fast instead of hanging.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **One registry, two consumers** | `COMMANDS` moves out of `index.ts` into `src/commands/index.ts` and becomes the single source for both `printHelp()` and the picker. A new command is one entry; help and picker follow automatically. Satisfies the "no second list" criterion structurally rather than by discipline. |
| **Split the entrypoint so it can be tested** | `index.ts` today calls `main()` at import time, so importing it in a test *runs the CLI and calls `process.exit`*. Dispatch moves to `src/cli.ts` exporting `main(argv, deps?)`; `index.ts` shrinks to the shebang plus the bootstrap that maps the resolved code onto `process.exit`. tsup's entry stays `src/index.ts`. |
| **The test seam is dependency injection, not module mocking** | `main(argv, { registry, select })`, both defaulted to the real thing. Tests pass a fake registry of `vi.fn()` commands and a fake `select` that returns a name or clack's cancel symbol. **Grounding:** not one of the package's five existing tests (`applier`, `lock`, `registry`, `remover`, `pkg-json`) uses `vi.mock` — they're plain functions over real temp dirs. `vi.mock("@clack/prompts")` would introduce a mocking style the package doesn't have, for a seam a parameter already gives us. |
| **Interactivity is one predicate, in `lib/tui.ts`** | `isInteractive()` = `process.stdin.isTTY && process.stdout.isTTY`. Both streams, because clack needs raw-mode stdin to read keys and a real stdout to render. It lives next to the other terminal helpers (`stripAnsi`, `wrapForNote`) and is used by all three pickers. It must read `process.*` **at call time**, not at module load, or a test can't stub it. |
| **`process.env.CI` is deliberately *not* in the predicate** | Every real non-interactive context — GitHub Actions, `docker run` without `-t`, a pipe, `ssh` with a command — already has no TTY, so `CI` guards a hypothetical. Its false positive is not hypothetical: because the helper backs all three pickers, a developer with `CI` exported would silently lose `init`'s name prompt and `add`'s module picker too. |
| **Non-TTY falls back byte-for-byte** | `!isInteractive()` → today's `printHelp()` and today's exit `0`. No new output, no new code. |
| **Explicit help is never the picker** | `--help`, `-h`, and `help` short-circuit to `printHelp()` before the interactivity check, on a TTY as much as anywhere. |
| **The picker replaces help on a TTY** | The select's own labels carry each command's `describe` as a hint, so printing help above it would render the same list twice. |
| **Picking hands off; it does not prompt for arguments** | The chosen command runs as `command.run([])`. Every command already handles empty argv by asking — `init` prompts for a name, `add`/`remove` open their module pickers. The picker teaching itself each command's argument shape would duplicate four flows that already exist and rot the moment one changes. |
| **Cancel exits 1, and Esc is the only way out** | `cancel("cancelled")` + `return 1`, matching `init`, `add`, and `remove` (`init.ts:90`, `add.ts:238`). No stack trace: `isCancel()` handles it, nothing throws. No explicit "Exit" entry — neither existing picker has one, and one convention across all three beats a special case at the top level. |
| **Picker order is the registry's insertion order** | `init · add · remove · list` is lifecycle-shaped; the record literal carries a comment saying that order is deliberate so a contributor appends thoughtfully. No `order`/`group` field until the list passes ten entries — seven (after #50 adds `env`, `outdated`, `new module`) still scans in one screen. |
| **No escape hatch for a TTY that shouldn't prompt** | `--help` already prints exactly what the picker replaces. `SAASALOY_NO_PROMPT` is the right shape if it's ever needed, but honoring it honestly means auditing all four commands' prompts — a bigger diff than the feature itself. |
| **Unknown command is unchanged** | Error + help + exit `1`, on a TTY too. A did-you-mean that opens the picker would make the exit code depend on whichever command the user then picked. |
| **Presentation reuses what exists** | `@clack/prompts` `select` + `picocolors`, per ADR 0009. No new dependency. |
| **#58 (module stacks) needs nothing from this plan** | A stack is a `registry-item.json` installed through `add`, so it surfaces in `add`'s existing module picker with no change here. |

## Approach

Three phases, each independently shippable and each landing with its own tests. Phase 1 is a pure
refactor with no behavior change; Phase 2 fixes a live bug; Phase 3 is the feature.

### Phase 1 — Extract the registry and make dispatch testable

- Move the `Command` interface and the `COMMANDS` record to `src/commands/index.ts`, exported, with
  the comment fixing its lifecycle order.
- Add `src/cli.ts` with `printHelp(registry)` and `main(argv, deps?)`, both exported, where `deps` is
  `{ registry = COMMANDS, select = clackSelect }`.
- Reduce `src/index.ts` to the shebang, the `main()` call, and the existing exit/error handling.
- Verify `pnpm build` still emits an executable `dist/index.js` with its shebang intact.
- Tests (`src/cli.test.ts`): help output lists every key in the injected registry; a known command
  dispatches with the remaining argv and returns its code; unknown command → exit 1; `--help`, `-h`,
  `help` → exit 0.

### Phase 2 — One interactivity predicate, retrofitted to the existing pickers

- Add `isInteractive()` to `src/lib/tui.ts`, reading `process.stdin.isTTY` / `process.stdout.isTTY`
  at call time.
- Guard `add.ts:233` and `remove.ts:158`: when no module is named and the session isn't interactive,
  `cancel()` with the command's existing `USAGE` string and return 1 instead of opening a prompt that
  can never be answered. No DI needed here — the guard fires before `select` is reached, so the test
  only has to stub the TTY flags.
- Tests: `isInteractive()` across the isTTY matrix; `runAdd([])` and `runRemove([])` under a stubbed
  non-TTY return 1 without reaching a prompt.

### Phase 3 — The picker

- In `main()`, the bare-invocation branch becomes: not interactive → `printHelp()` + 0; interactive →
  `pickCommand(deps)`.
- `pickCommand` renders `select({ message, options })` where each option is
  `{ value: name, label: name, hint: describe }` — built by mapping the registry, never a literal
  list. On `isCancel`, `cancel("cancelled")` + 1. Otherwise `return registry[picked].run([])`.
- The picker deliberately opens **no** `intro()`/`outro()` of its own; the chosen command's existing
  `intro()` starts the clack rail, so the handoff reads as one continuous flow rather than two
  stacked boxes.
- Tests: with a stubbed TTY and an injected fake `select`, bare argv builds one option per registry
  entry (asserted against `Object.keys(registry)`, so a drifting list fails), runs the chosen command
  with `[]`, and returns its code; a cancelled select returns 1 and throws nothing; with `isTTY`
  false the same argv prints help, returns 0, and never calls `select`.
- Manual QA pass with qakit. `pnpm cli` (bare `node dist/index.js`) stays as-is and becomes the
  hand-test entrypoint; cover a real terminal, `pnpm cli | cat`, and `echo "" | pnpm cli`.

## Open questions

None. The grill of 2026-08-07 closed every branch — the test seam, the shape of `isInteractive()`,
the escape hatch, picker ordering, the exit affordance, and the #58 interaction are all recorded as
settled decisions above.

## Non-goals

- Reworking any individual command's own prompts.
- A full TUI — no persistent menu loop, no navigation, no panes. The picked command runs once and the
  CLI exits with its code.
- **A did-you-mean on unknown commands.** Deliberately deferred and deliberately *not* filed as a
  follow-up issue: unknown-command behavior stays error + help + exit 1. Anyone reviving it should
  start from the exit-code argument in the decisions table above.
- Prompting for command arguments inside the picker.
- A global flag layer or a `SAASALOY_NO_PROMPT` opt-out.
- Any new dependency.
