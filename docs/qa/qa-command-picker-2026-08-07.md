# QA Plan: interactive command picker on bare invocation (issue #63)

_Generated 2026-08-07 · covers `main...issue-63-interactive-command-picker-on-bare-invocation` — 6 commits, `7580524` … `6872e7f`._

## Summary
- Running `saasaloy` with no arguments **on a real terminal** now opens a `@clack/prompts` picker listing every command from the shared `COMMANDS` registry, and runs the chosen one in the same process. Without a terminal it prints exactly the help it always printed and exits 0. `add` and `remove` gained the same no-terminal guard for their module pickers.
- "Working" means two things at once: **the picker is pleasant on a TTY** (right options, right order, clean handoff, clean cancel), and **nothing that has no terminal ever waits for a keystroke** — a picker that hangs in CI is worse than no picker.

Most of the no-terminal half of that is machine-verifiable and **the agent already verified it** — see [Automated verification](#automated-verification-by-ai-agent), 14 checks, all green, run against the existing `packages/cli/dist/index.js`. What is left for a human is the part a headless box can only approximate:

- **The picker itself** — how it renders, how the arrow keys feel, whether the handoff into the chosen command reads as one continuous clack rail or two stacked boxes.
- **A genuine terminal emulator** — this repo's dev box has no PTY of its own, so the agent drove everything through `script -qec`. That proves the branch logic; it does not prove your iTerm/Windows Terminal/tmux behaves.
- **Terminal hygiene after a cancel** — cursor restored, no lingering raw mode, no stack trace.

### The one thing that must not regress

`isInteractive()` (`packages/cli/src/lib/tui.ts`) is `process.stdin.isTTY && process.stdout.isTTY`, read at call time. **Both** streams must be terminals. That is what makes `saasaloy | less`, `saasaloy > out.txt`, `echo | saasaloy`, `ssh box saasaloy` and every CI runner fall back to help instead of blocking on a prompt nobody can answer. **TC-3.1 and TC-3.2 are the manual half-TTY regressions** and are the cases to run first if you only run two.

`process.env.CI` is deliberately **not** part of the predicate — a developer who happens to export `CI` should not silently lose every prompt in the CLI. Do not report that as a gap.

### Gate status — do not re-run

`pnpm build && pnpm typecheck && pnpm test` was already run green on this exact source: build → `packages/cli/dist/index.js`, **143 tests across 14 test files**. The four new test files are `src/cli.test.ts`, `src/lib/tui.test.ts`, `src/commands/add.test.ts`, `src/commands/remove.test.ts`. You do not need to re-run the gate to execute this plan; the built artifact is already in place.

## Run log
_Fill in when you run the plan._

| Field | Value |
|---|---|
| Tester | |
| Date run | |
| Build / commit | |

**Overall**

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment
True for the whole plan — do this once, before Scenario 1.

- Node ≥ 24 (verified here on `v24.19.0`), pnpm 11.
- This worktree, on branch `issue-63-interactive-command-picker-on-bare-invocation`.
- **A real terminal emulator.** Every scenario below needs one. Do not run this plan inside an editor "output" pane, a CI job, or anything that pipes the CLI's stdout.
- **Network** is needed only by TC-2.2 (`add` fetches the module registry). Everything else is offline.
- `packages/cli/dist/index.js` already exists and is current — no build needed.

Confirm the branch and that the artifact is there:

```sh
git status --short && git log --oneline -1 && ls -l packages/cli/dist/index.js
```

Per `AGENTS.md`, all CLI runs happen inside `.dev/`. Create it and park there — every command in this plan assumes `.dev/` is your working directory:

```sh
mkdir -p .dev && cd .dev
```

Define the entrypoint once, so the cases stay short:

```sh
CLI="$(cd .. && pwd)/packages/cli/dist/index.js"
```

Sanity-check it resolves:

```sh
node "$CLI" --help
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — real terminal, no Saasaloy project | Bare `saasaloy` opens the picker with the registry's commands | 🔴 Critical |
| TC-1.2 | 1 — real terminal, no Saasaloy project | Picking a command runs it in-process, no re-invocation | 🔴 Critical |
| TC-1.3 | 1 — real terminal, no Saasaloy project | Esc and Ctrl-C cancel cleanly: `cancelled`, exit 1, no stack trace | 🔴 Critical |
| TC-1.4 | 1 — real terminal, no Saasaloy project | `--help` / `-h` / `help` still print help on a TTY, never the picker | 🟡 Normal |
| TC-1.5 | 1 — real terminal, no Saasaloy project | Unknown command still errors + prints help + exits 1, no picker | 🟡 Normal |
| TC-1.6 | 1 — real terminal, no Saasaloy project | Terminal is left healthy after the picker | 🟢 Low |
| TC-2.1 | 2 — real terminal, inside a Saasaloy project | Picker → `remove` hands off into `remove`'s own module picker | 🔴 Critical |
| TC-2.2 | 2 — real terminal, inside a Saasaloy project | `saasaloy add` on a TTY still opens its module picker (guard doesn't misfire) | 🟡 Normal |
| TC-2.3 | 2 — real terminal, inside a Saasaloy project | Picker → `init` prompts for a name (empty-argv handoff) | 🟡 Normal |
| TC-3.1 | 3 — real terminal, output piped or redirected | `saasaloy \| less` and `saasaloy > file` print help instead of hanging | 🔴 Critical |
| TC-3.2 | 3 — real terminal, output piped or redirected | Piped stdin, and a remote `ssh` invocation, print help instead of hanging | 🔴 Critical |
| TC-3.3 | 3 — real terminal, output piped or redirected | `add` / `remove` with no module and no terminal fail fast, offline | 🟡 Normal |

## Scenario 1 — Real terminal, no Saasaloy project

**Setup** — once, for every case in this scenario.

1. Open a real terminal window (not an editor pane, not a piped shell).
2. From the repo root, move into a directory that is **not** a Saasaloy project, so `init`/`add`/`remove` behave as they would for a newcomer.

```sh
mkdir -p .dev/nowhere && cd .dev/nowhere && CLI="$(cd ../.. && pwd)/packages/cli/dist/index.js"
```

- [ ] Setup complete

### TC-1.1 — Bare `saasaloy` opens the picker with the registry's commands · 🔴 Critical

**Goal** — a newcomer who types the bare command is shown what the tool can do, not a wall of text to read and retype.

**Steps**

1. Run the bare command.

   ```sh
   node "$CLI"
   ```

   - [ ] A clack picker appears, prompting `What would you like to do?`
   - [ ] Exactly four options are listed: `init`, `add`, `remove`, `list`
   - [ ] They appear in that order — scaffold → compose → undo → browse
   - [ ] Each option shows a dimmed hint matching its help text, e.g. `init` → `scaffold a new Saasaloy project (base: Astro landing + ui + config)`
   - [ ] **No help block is printed above the picker** — no `Usage:` line, no second copy of the command list
   - [ ] No `┌ saasaloy …` intro box is drawn above the picker

2. Press the down arrow twice, then the up arrow once.

   - [ ] The highlighted row moves with each keypress and wraps/stops sanely at the ends
   - [ ] Only one row is highlighted at a time; the list does not redraw duplicated

3. Compare against the help output in a second terminal.

   ```sh
   node "$CLI" --help
   ```

   - [ ] The picker's four names and hints match help's four names and descriptions exactly — one registry, two consumers

4. Press Esc to leave the picker for now.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — Picking a command runs it in-process, no re-invocation · 🔴 Critical

**Goal** — the choice executes in the same process, with an empty argv, and the clack rail reads as one continuous session rather than two stacked boxes.

**Steps**

1. Run the bare command and select `list` (arrow down to it, press Enter).

   ```sh
   node "$CLI"
   ```

   - [ ] The picker's chosen line collapses into a completed clack step (a `◇`/`│` row), it does not vanish and reprint
   - [ ] `list`'s own `┌ saasaloy list ` intro box opens directly below, connected to the same rail
   - [ ] There is exactly **one** intro box, not two, and no blank re-print of the picker
   - [ ] The module list renders (or an honest network error if you are offline)

2. Check the exit code of that run.

   ```sh
   echo $?
   ```

   - [ ] The exit code is `list`'s own, not a code invented by the picker (`0` on success)

3. Watch the process list from a second terminal while a picked command is mid-flight, or simply note timing.

   - [ ] No second `node …/index.js` process is spawned — the pick does not re-invoke the CLI

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — Esc and Ctrl-C cancel cleanly · 🔴 Critical

**Goal** — backing out of the picker is a normal outcome, not a crash.

**Steps**

1. Run the bare command, then press **Esc** at the picker.

   ```sh
   node "$CLI"
   ```

   - [ ] The rail closes with `└ cancelled`
   - [ ] **No stack trace**, no `Error:`, no `at Object.<anonymous>` lines
   - [ ] No command runs afterwards — nothing is scaffolded, fetched, or written

2. Read the exit code.

   ```sh
   echo $?
   ```

   - [ ] It is `1`

3. Run it again and press **Ctrl-C** at the picker.

   ```sh
   node "$CLI"
   ```

   - [ ] Same `└ cancelled`, no stack trace
   - [ ] Exit code is `1` (check with `echo $?`)
   - [ ] The shell prompt returns immediately — the process does not linger

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — `--help` / `-h` / `help` still print help on a TTY · 🟡 Normal

**Goal** — asking for help explicitly is never answered with a prompt, terminal or not.

**Steps**

1. Run each of the three forms in turn.

   ```sh
   node "$CLI" --help
   ```

   ```sh
   node "$CLI" -h
   ```

   ```sh
   node "$CLI" help
   ```

   - [ ] All three print the same help block: title line, `Usage:`, `Commands:`, four commands
   - [ ] **None of them opens the picker** — the shell prompt comes straight back, nothing waits for a keystroke
   - [ ] Colors render (bold title, cyan command names, dim descriptions) — you are on a TTY, so they should

2. Check the exit code of the last one.

   ```sh
   echo $?
   ```

   - [ ] It is `0`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.5 — Unknown command still errors, prints help, exits 1 · 🟡 Normal

**Goal** — a typo is corrected the same way it always was; the picker deliberately does not take over as a "did you mean".

**Steps**

1. Run a command that does not exist.

   ```sh
   node "$CLI" instal
   ```

   - [ ] A red `Unknown command: instal` is printed
   - [ ] The full help block follows it
   - [ ] **No picker opens** — nothing waits for input

2. Check the exit code.

   ```sh
   echo $?
   ```

   - [ ] It is `1`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.6 — Terminal is left healthy after the picker · 🟢 Low

**Goal** — the picker restores the terminal it borrowed; no invisible cursor, no swallowed keystrokes.

**Steps**

1. Run the bare command and cancel with Esc.

   ```sh
   node "$CLI"
   ```

   - [ ] The block cursor is visible again at the shell prompt
   - [ ] Typing echoes normally — the terminal is not stuck in raw mode
   - [ ] Ctrl-C at the shell prompt behaves as usual

2. Run it again and pick `list`, letting it finish.

   ```sh
   node "$CLI"
   ```

   - [ ] Same three checks above hold after a *completed* command, not only after a cancel
   - [ ] Scrollback is readable — no leftover escape junk or half-erased rail lines

3. Resize the terminal narrow (roughly 50 columns) and run the bare command once more.

   - [ ] The picker and its hints wrap or truncate without corrupting the rail

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 2.

```sh
cd .. && rm -rf nowhere
```

## Scenario 2 — Real terminal, inside a Saasaloy project

**Setup** — once, for every case in this scenario. A minimal hand-written project is enough and keeps this offline and fast; you do **not** need `pnpm play:init`.

1. From `.dev/`, create a throwaway project directory with one installed module recorded.

```sh
mkdir -p qa63 && cd qa63 && printf '{"aliases":{"@web":"apps/web"},"installed":["waitlist"]}' > saasaloy.json && CLI="$(cd ../.. && pwd)/packages/cli/dist/index.js"
```

- [ ] Setup complete

### TC-2.1 — Picker → `remove` hands off into `remove`'s own module picker · 🔴 Critical

**Goal** — the picker hands off with an empty argv and the chosen command's existing prompt flow takes over, so the picker never has to learn any command's argument shape.

**Steps**

1. Run the bare command and select `remove`.

   ```sh
   node "$CLI"
   ```

   - [ ] `┌ saasaloy remove ` opens on the same rail, one box
   - [ ] A **second** picker appears: `Pick a module to remove`, listing `waitlist`
   - [ ] `remove` did not error about a missing module argument — it asked instead

2. Press Esc at the module picker.

   - [ ] `└ remove cancelled` is printed (`remove`'s own wording, not the picker's `cancelled`)
   - [ ] No stack trace
   - [ ] Exit code is `1` (check with `echo $?`)
   - [ ] `saasaloy.json` is unchanged — `installed` still lists `waitlist`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — `saasaloy add` on a TTY still opens its module picker · 🟡 Normal

**Goal** — the new no-terminal guard on `add` does not misfire when a terminal *is* present. Needs network.

**Steps**

1. Run `add` with no module argument.

   ```sh
   node "$CLI" add
   ```

   - [ ] `┌ saasaloy add ` opens
   - [ ] The registry is fetched and a module picker appears with real module names
   - [ ] **No usage/error message** about a missing module — the guard stayed out of the way

2. Press Esc.

   - [ ] `└ add cancelled`, exit code `1`, no stack trace
   - [ ] Nothing was written into the project directory

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — Picker → `init` prompts for a name · 🟡 Normal

**Goal** — the empty-argv handoff is genuinely fine for the one command that needs an argument, because `init` asks for it itself.

**Steps**

1. Run the bare command and select `init`.

   ```sh
   node "$CLI"
   ```

   - [ ] `┌ saasaloy init ` opens on the same rail
   - [ ] A **text** prompt asks for the project name — it does not fail on a missing argument
   - [ ] The prompt shows a sensible default or placeholder

2. Press Esc rather than scaffolding anything.

   - [ ] `└ init cancelled`, exit code `1`, no stack trace
   - [ ] No new directories or files were created — check with `ls`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 3.

```sh
cd .. && rm -rf qa63
```

## Scenario 3 — Real terminal, output piped or redirected

The hard requirement. Everything here **must return to your shell prompt on its own**; if any step sits there waiting, that is an immediate 🔴 fail — hit Ctrl-C and record it.

**Setup** — once, for every case in this scenario.

1. Stay in a real terminal, in `.dev/`.

```sh
cd .dev && CLI="$(cd .. && pwd)/packages/cli/dist/index.js"
```

- [ ] Setup complete

### TC-3.1 — Piped or redirected stdout falls back to help · 🔴 Critical

**Goal** — `saasaloy | less` and `saasaloy > file` are the everyday half-TTY cases: stdin *is* a terminal, stdout is not. A prompt drawn into a pipe would hang forever.

**Steps**

1. Pipe the bare command into `cat`.

   ```sh
   node "$CLI" | cat
   ```

   - [ ] The help block prints
   - [ ] No picker, no waiting — the prompt returns immediately
   - [ ] The output is plain, uncolored (picocolors correctly disables color into a pipe)

2. Pipe it into a pager and quit with `q`.

   ```sh
   node "$CLI" | less
   ```

   - [ ] `less` opens showing the help block, not an empty screen or a frozen terminal
   - [ ] `q` exits normally

3. Redirect to a file and read it back.

   ```sh
   node "$CLI" > /tmp/bare.txt; echo "exit=$?"; cat /tmp/bare.txt
   ```

   - [ ] `exit=0`
   - [ ] The file contains the full help block
   - [ ] The file contains **no** ANSI escape bytes and no picker text like `What would you like to do?`

4. Confirm the redirected output is byte-identical to explicit help.

   ```sh
   node "$CLI" > /tmp/bare.txt && node "$CLI" --help > /tmp/help.txt && diff /tmp/bare.txt /tmp/help.txt && echo IDENTICAL
   ```

   - [ ] `IDENTICAL` prints — no diff

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.2 — Piped stdin, and a remote `ssh` invocation, fall back to help · 🔴 Critical

**Goal** — the other half-TTY case (stdout is a terminal, stdin is not) and the real-world shape of it: a non-interactive `ssh` command, the closest everyday stand-in for a CI runner.

**Steps**

1. Feed the bare command an empty stdin while leaving stdout on the terminal.

   ```sh
   echo "" | node "$CLI"
   ```

   - [ ] The help block prints, **in color** (stdout is still a TTY)
   - [ ] No picker, no waiting

2. Redirect stdin from `/dev/null`.

   ```sh
   node "$CLI" < /dev/null; echo "exit=$?"
   ```

   - [ ] Help prints and `exit=0`

3. If you have SSH access to any box with this checkout, run it non-interactively (no `-t`). Skip and note if not.

   ```sh
   ssh <host> 'node /path/to/packages/cli/dist/index.js; echo "exit=$?"'
   ```

   - [ ] Help prints and `exit=0` — the session ends on its own, it does not hang

4. Run it under a job-control-free context, e.g. as a background job whose stdin is detached.

   ```sh
   (node "$CLI" < /dev/null > /tmp/bg.txt 2>&1 &) ; sleep 2; cat /tmp/bg.txt
   ```

   - [ ] The help block is in `/tmp/bg.txt` within 2 seconds — the process did not block

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.3 — `add` / `remove` with no module and no terminal fail fast, offline · 🟡 Normal

**Goal** — the two commands that already had module pickers now refuse instead of hanging, and `add` refuses *before* it touches the network.

**Steps**

1. Recreate the minimal project and enter it.

   ```sh
   mkdir -p qa63 && cd qa63 && printf '{"aliases":{"@web":"apps/web"},"installed":["waitlist"]}' > saasaloy.json && CLI="$(cd ../.. && pwd)/packages/cli/dist/index.js"
   ```

2. Run `add` with no module, stdin detached.

   ```sh
   node "$CLI" add < /dev/null; echo "exit=$?"
   ```

   - [ ] A `└ No module named and no terminal to pick one in — usage: …` line prints, quoting the full `saasaloy add [<module>|…]` usage
   - [ ] `exit=1`
   - [ ] It returns **instantly** (well under a second) — the registry was never fetched
   - [ ] Nothing was written into the directory

3. Confirm the "offline" part by disconnecting your network (or blocking it) and repeating step 2.

   - [ ] Same message, same `exit=1`, no network error and no timeout

4. Run `remove` with no module, stdin detached.

   ```sh
   node "$CLI" remove < /dev/null; echo "exit=$?"
   ```

   - [ ] The equivalent message quoting `saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force]`
   - [ ] `exit=1`
   - [ ] `saasaloy.json` is unchanged

5. Repeat both with stdout redirected instead of stdin (the other half-TTY side).

   ```sh
   node "$CLI" add > /tmp/add.txt 2>&1; echo "exit=$?"; cat /tmp/add.txt
   ```

   - [ ] Same usage message, `exit=1`, no hang

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above.

```sh
cd .. && rm -rf qa63 && rm -f /tmp/bare.txt /tmp/help.txt /tmp/bg.txt /tmp/add.txt
```

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Run from `.dev/`, against the already-built `packages/cli/dist/index.js`. The agent's box is headless, so every terminal case below was driven through `script -qec …` to obtain a real PTY.

Exit codes and the non-TTY fallback:

```sh
cd .dev && for args in "" "--help" "-h" "help" "nope"; do node ../packages/cli/dist/index.js ${=args} </dev/null >/tmp/o 2>&1; echo "args='$args' exit=$?"; done
```

Byte-identity of bare non-TTY output against explicit help:

```sh
cd .dev && diff <(node ../packages/cli/dist/index.js < /dev/null 2>&1 | cat) <(node ../packages/cli/dist/index.js --help < /dev/null 2>&1 | cat) && echo IDENTICAL
```

Half-TTY A — PTY stdin, piped stdout:

```sh
script -qec "node $PWD/packages/cli/dist/index.js | cat" /dev/null < /dev/null
```

Half-TTY B — piped stdin, PTY stdout:

```sh
script -qec "echo '' | node $PWD/packages/cli/dist/index.js" /dev/null < /dev/null
```

Esc cancel under a real PTY:

```sh
{ sleep 1; printf '\033'; sleep 2; } | timeout 8 script -qec "node $PWD/packages/cli/dist/index.js; echo EXITCODE=\$?" /dev/null
```

Ctrl-C cancel under a real PTY:

```sh
{ sleep 1; printf '\003'; sleep 2; } | timeout 8 script -qec "node $PWD/packages/cli/dist/index.js; echo EXITCODE=\$?" /dev/null
```

In-process handoff — pick `remove` (down, down, Enter), then Esc out of its module picker:

```sh
{ sleep 1; printf '\033[B'; sleep 0.3; printf '\033[B'; sleep 0.3; printf '\r'; sleep 1.5; printf '\033'; sleep 1.5; } | timeout 12 script -qec "node $PWD/packages/cli/dist/index.js; echo EXITCODE=\$?" /dev/null
```

`add` / `remove` no-terminal guards, inside a minimal hand-written project:

```sh
cd .dev/qa63 && node ../../packages/cli/dist/index.js add </dev/null; echo "exit=$?"
```

```sh
cd .dev/qa63 && node ../../packages/cli/dist/index.js remove </dev/null; echo "exit=$?"
```

Results:

- ✅ **Bare, both streams piped** → printed the full help block (title, `Usage:`, `Commands:`, `init`/`add`/`remove`/`list` with descriptions), `exit=0`. No picker, no hang.
- ✅ **Byte-identity** → `diff` of bare-non-TTY output vs `--help` output printed `IDENTICAL`. The two paths call the same `printHelp(registry)`, and the diff confirms it end to end.
- ✅ **`--help` → exit 0 · `-h` → exit 0 · `help` → exit 0**, all printing help, none opening a picker.
- ✅ **Unknown command `nope`** → `Unknown command: nope` + help, `exit=1`. No picker on any path.
- ✅ **Half-TTY A (PTY stdin, piped stdout)** → help printed, uncolored, process exited. No prompt.
- ✅ **Half-TTY B (piped stdin, PTY stdout)** → help printed, *with* ANSI color (stdout really was a terminal). No prompt. Together these two confirm `isInteractive()` requires **both** streams.
- ✅ **Picker renders under a full PTY** → clack's rail and radio glyphs drawn, cursor hidden (`ESC[?25l`), prompt waiting for input. The interactive path is genuinely reached when a terminal exists.
- ✅ **Esc cancel** → `└  cancelled`, `EXITCODE=1`. No `Error:`, no stack frames in the captured output.
- ✅ **Ctrl-C cancel** → `└  cancelled`, `EXITCODE=1`. Same clean shape.
- ✅ **In-process handoff** → selecting `remove` from the picker opened `┌   saasaloy remove ` and its module picker in the *same* process; Esc there produced `└  remove cancelled` (`remove`'s own wording) and `EXITCODE=1`. No re-invocation.
- ✅ **`add` with no module, no terminal** → `└  No module named and no terminal to pick one in — usage: \`saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--dry-run] [--diff] [--yes] [--force]\`.`, `exit=1`, returned immediately (guard sits ahead of `source.listModules()` in `packages/cli/src/commands/add.ts`).
- ✅ **`remove` with no module, no terminal** → `└  No module named and no terminal to pick one in — usage: \`saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force]\`.`, `exit=1`.
- ✅ **`isInteractive()` unit coverage** exists in `packages/cli/src/lib/tui.test.ts` for all four TTY combinations plus a call-time-not-load-time assertion.
- ✅ **Gate** — `pnpm build && pnpm typecheck && pnpm test` was run green earlier in this session on this exact source (143 tests / 14 files). **Deliberately not re-run here** — the change under test is not the build path, so a second run buys nothing.

No ❌.

## Not covered / needs human judgment
- **A genuine terminal emulator.** Everything interactive above was driven through `script -qec` on a headless box. That proves the branch logic and the exit codes; it cannot tell you how the picker looks or feels in iTerm2, Windows Terminal, Alacritty, tmux, or an editor's integrated terminal. Scenario 1 exists for exactly that.
- **Visual polish and rail continuity** — whether the handoff from picker to command reads as one clack session or two stacked boxes is a judgment call. TC-1.2 and TC-2.1 ask you to make it.
- **Terminal restoration** — cursor visibility and raw-mode cleanup after a cancel (TC-1.6) are observable only on a real terminal.
- **Narrow / resized terminals** — hint truncation and wrapping at ~50 columns (TC-1.6 step 3) was not exercised by the agent.
- **Windows** — no `script`, different TTY semantics, different key handling for Esc/Ctrl-C. Nothing here was run on Windows. If Windows is a supported target, re-run Scenario 1 and Scenario 3 there.
- **A real CI runner.** The agent approximated CI with `</dev/null` and pipes, which is the same `isTTY` shape, but nobody ran this inside GitHub Actions — this repo has no `.github/workflows` at all.
- **`add` on a TTY with network** (TC-2.2) — the agent stayed offline on purpose, so the "guard doesn't misfire when a terminal exists" case is untested by machine.
- **Performance, concurrency, security, accessibility** — deliberately skipped as dimensions. The change adds no I/O, no persistence, no network call, no shared state and no new dependency; it selects between two existing code paths on a boolean. Screen-reader behavior in a TUI is `@clack/prompts`' concern and unchanged by this branch.
- **`process.env.CI`** is intentionally excluded from `isInteractive()` (see `packages/cli/src/lib/tui.ts`). A developer with `CI=1` exported on a real terminal will still get prompts. That is the settled decision, not a defect.
- **Unknown-command did-you-mean** was an explicit non-goal in the plan doc. `saasaloy instal` still errors and prints help; do not file the absence of a suggestion picker.
