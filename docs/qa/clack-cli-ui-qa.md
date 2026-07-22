# QA Plan: `saasaloy` CLI UI/DX — @clack/prompts + picocolors

_Generated 2026-07-22 · covers the working-tree change for issue #18: adopt `@clack/prompts` + `picocolors` across the CLI (`logger.ts`, `init`, `add`, `list`, `index.ts` help). Scope was narrowed — `init` + `logger` are fully polished; `add`/`list` are clack-styled stubs (no working picker/applier — that's Phase 1)._

## Summary
The CLI's console output moved from a plain `console.log` shim to `@clack/prompts`' connected-rail components (`intro`/`spinner`/`note`/`outro`, `log.*`, and interactive `text`/`confirm` prompts) with `picocolors` accents. `init` also gained interactivity: it prompts for a missing project name and offers to run `pnpm install` in the freshly scaffolded folder. "Working" means: a human runs each command in a real terminal and sees the polished rail UI — aligned box borders, a live spinner during scaffolding and install, colored accents — with no broken layout, no leftover ANSI garbage, and identical *behavior* (exit codes, files written, next steps) to before, plus the new install flow that never breaks project creation even when `pnpm install` fails.

Because this is a visual/UX change, nearly every case needs a **human eye in a real TTY** — piped/captured output strips color and spinner animation, so it can't be judged by script. The automated section below covers only the behavior-level checks (build, typecheck, exit codes).

## Preconditions
- Node ≥ 24, pnpm 11, macOS/Linux/Windows, in a **real interactive terminal** (not a pipe, not a CI log pane — the spinner and colors need a TTY).
- Build the CLI from this branch:

```sh
pnpm --filter saasaloy build
```

- Use a throwaway scratch dir for `init` so you don't scaffold into the repo. From the repo root, the built entry is `packages/cli/dist/index.js`. A convenient scratch target inside the repo is `.dev/` (gitignored):

```sh
node packages/cli/dist/index.js init .dev/qa-playground --force
```

- A terminal that supports dark **and** light backgrounds is useful for TC-8. A 60–80 column-wide terminal is useful for TC-7.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `init` renders full rail: intro → spinner → note → outro | 🔴 Critical |
| TC-2 | `init` spinner animates live during scaffolding | 🟡 Normal |
| TC-3 | `init` next-steps note is accurate and readable | 🔴 Critical |
| TC-4 | `add` stub renders clack-styled "coming soon" | 🟡 Normal |
| TC-5 | `list` stub renders clack-styled empty state | 🟡 Normal |
| TC-6 | `--help` and unknown-command output are colored & aligned | 🟡 Normal |
| TC-7 | Box borders align at narrow terminal width | 🟢 Low |
| TC-8 | Colors legible in light + dark terminals; NO_COLOR respected | 🟢 Low |
| TC-9 | `init` pre-flight errors (bad name / non-empty dir) still read clearly | 🟡 Normal |
| TC-10 | `init` offers to run `pnpm install` after scaffolding | 🔴 Critical |
| TC-11 | Accepting install runs `pnpm install` with a single-line loader | 🔴 Critical |
| TC-12 | Declining install leaves `pnpm install` in the next-steps note | 🟡 Normal |
| TC-13 | `pnpm install` failure is reported and does not break `init` | 🔴 Critical |

## Test cases

### TC-1 — `init` renders full rail: intro → spinner → note → outro  ·  🔴 Critical
**Steps**
1. From the repo root, run:

```sh
node packages/cli/dist/index.js init .dev/qa-playground --force
```

2. Watch the output top to bottom.

**Expected:** A single connected vertical rail (`│`) links every block: an `intro` header reading ` saasaloy init ` (on a cyan background), then a scaffolding step, then a boxed **Next steps** note, then an `outro` `└  created qa-playground`. The header text `saasaloy init` shows on a colored (cyan) background swatch. No plain un-railed `console.log` lines are mixed in.
**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-2 — `init` spinner animates live during scaffolding  ·  🟡 Normal
**Steps**
1. Re-run the `init` command from TC-1 (use a fresh target or `--force`).
2. Watch the line immediately after the intro while it scaffolds.

**Expected:** A spinner animates next to `Scaffolding qa-playground` (the project name accented), then resolves to a completed step `Scaffolded qa-playground (apps/web · packages/ui · packages/config)` with the parenthetical dimmed. The cursor is restored afterward (no missing/hidden cursor, no leftover `[?25l` escape text on screen).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — `init` next-steps note is accurate and readable  ·  🔴 Critical
**Steps**
1. After running `init` from TC-1, read the **Next steps** box.
2. Confirm the listed commands are correct and follow them mentally for the `.dev/qa-playground` target.

**Expected:** The box titled `Next steps` contains, in order: `cd .dev/qa-playground`, `pnpm install`, `pnpm dev` (with dimmed `# astro dev on apps/web`), `pnpm --filter web run deploy` (dimmed `# wrangler deploy to Cloudflare`), `saasaloy add waitlist` (dimmed `# add your first feature`). The command text is cyan; the `#` comments are dimmed and vertically don't break the box border. When the target is `.` the `cd` line is omitted (verify separately by running `init .` in an empty scratch dir).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — `add` stub renders clack-styled "coming soon"  ·  🟡 Normal
**Steps**
1. Run:

```sh
node packages/cli/dist/index.js add
```

**Expected:** A rail with intro ` saasaloy add `, a boxed **Coming soon** note explaining the module applier is not built yet (Phase 1) and that an interactive picker will land once the `modules/` registry has descriptors, and an outro `nothing to add yet` (dimmed). No crash, no "not implemented" stack trace. (This is intentionally a stub — a working multiselect picker is deferred to Phase 1.)
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — `list` stub renders clack-styled empty state  ·  🟡 Normal
**Steps**
1. Run:

```sh
node packages/cli/dist/index.js list
```

**Expected:** A rail with intro ` saasaloy list `, a boxed **Registry** note reading "No modules available yet (Phase 1)" and naming `api · database · waitlist` as the first modules, and an outro `0 modules` (dimmed). The `modules/` token is accented cyan.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — `--help` and unknown-command output are colored & aligned  ·  🟡 Normal
**Steps**
1. Run each:

```sh
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js bogus
```

**Expected:** `--help` shows a bold `saasaloy` title with a dimmed tagline, a `Usage:` line with `<command>` in cyan, and a `Commands:` list where each command name (`init`/`add`/`list`) is cyan and its description is dimmed, columns aligned. `bogus` prints a red `Unknown command:` prefix followed by `bogus`, then the same help block. (Help/errors deliberately stay plain `console.log` + picocolors, not the clack rail — arg parsing is still native.)
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Box borders align at narrow terminal width  ·  🟢 Low
**Steps**
1. Resize the terminal to ~60 columns.
2. Re-run `init` (TC-1) and `list` (TC-5).

**Expected:** The note boxes and rail render without the right border wrapping to a second line or misaligning; long lines (e.g. the deploy comment) either fit or degrade gracefully. No corrupted box-drawing characters.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — Colors legible in light + dark terminals; NO_COLOR respected  ·  🟢 Low
**Steps**
1. Run `init` (TC-1) once in a dark-background terminal and once in a light-background one; judge legibility of the cyan/dimmed/green accents and the cyan-background intro swatch.
2. Confirm color can be disabled:

```sh
NO_COLOR=1 node packages/cli/dist/index.js --help
```

**Expected:** Accents are readable on both backgrounds (no dark-on-dark or invisible dim text). With `NO_COLOR=1`, output is plain text with no ANSI color codes but the same structure/content (picocolors honors `NO_COLOR`).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-9 — `init` pre-flight errors still read clearly  ·  🟡 Normal
**Steps**
1. Trigger each error path:

```sh
node packages/cli/dist/index.js init
node packages/cli/dist/index.js init Bad_Name
node packages/cli/dist/index.js init .dev/qa-playground
```

(The third assumes `.dev/qa-playground` already exists and is non-empty from TC-1, run **without** `--force`.)

**Expected:** Each prints a clack `log.error` line (red rail marker) with a clear message — missing name → usage hint; `Bad_Name` → invalid-name guidance about lowercase/digits/hyphens; existing non-empty dir → "not empty" with the `--force` hint. Each exits non-zero (behavior unchanged from before the UI work). Messages are legible, not swallowed by the rail.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-10 — `init` offers to run `pnpm install` after scaffolding  ·  🔴 Critical
**Steps**
1. From the repo root, run into a fresh scratch target:

```sh
node packages/cli/dist/index.js init .dev/qa-install --force
```

2. Watch the prompt that appears right after the `Scaffolded …` step (before the next-steps note).

**Expected:** A clack `select` prompt on the rail reading **Install dependencies now?**, with the two choices listed **one per line** — `Yes, run pnpm install` (the `pnpm install` accented cyan) and `No, I'll run it later` — the first selected by default. Use ↑/↓ to move between them; Enter selects. The prompt sits inside the same connected rail (no un-railed line). Hitting Ctrl-C at this prompt does **not** abort with an error — `init` treats a cancel like "no" and proceeds to the next-steps note (exit 0).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-11 — Accepting install runs `pnpm install` with a single-line loader  ·  🔴 Critical
**Steps**
1. Run TC-10 and select **yes** at the install prompt.
2. Watch the line that follows while dependencies install, then read the next-steps note.
3. After it finishes, confirm the deps landed:

```sh
ls .dev/qa-install/node_modules >/dev/null && echo INSTALLED
```

**Expected:** Only a **single animated loader line** shows — `Installing dependencies (pnpm install)` (the parenthetical dimmed). pnpm's own install output (progress bars, package lists, peer warnings) is **not** streamed to the screen — just the spinner. On success it resolves to `Installed dependencies (pnpm install)`. The install runs **inside the newly created folder** (`.dev/qa-install`), so `node_modules` appears there and `INSTALLED` prints. Because deps were just installed, the **Next steps** note **omits** the `pnpm install` line (it jumps `cd …` → `pnpm dev`). Exit code 0.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-12 — Declining install leaves `pnpm install` in the next-steps note  ·  🟡 Normal
**Steps**
1. Run `init` again into a fresh target and select **no** at the install prompt:

```sh
node packages/cli/dist/index.js init .dev/qa-noinstall --force
```

2. Read the **Next steps** note; confirm no install ran.

**Expected:** No loader appears; nothing is installed (`.dev/qa-noinstall/node_modules` does not exist). The **Next steps** note **includes** the `pnpm install` line in its original position (after `cd …`, before `pnpm dev`), i.e. identical to the pre-feature output. Exit code 0. (A Ctrl-C at the prompt behaves the same as choosing "no" — see TC-10.)
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-13 — `pnpm install` failure is reported and does not break `init`  ·  🔴 Critical
**Steps**
1. Force an install failure. The simplest reproducible way is to make `pnpm` unresolvable for the run so `spawn` errors (simulates "pnpm not on PATH"):

```sh
PATH=/usr/bin node packages/cli/dist/index.js init .dev/qa-failinstall --force
```

(Adjust `PATH` so `pnpm` isn't found, or temporarily corrupt the scaffolded `package.json`/registry to make `pnpm install` exit non-zero.) Select **yes** at the install prompt.

**Expected:** The loader stops with a yellow warning (`pnpm install did not finish`), followed by a `log.warn` telling the user to run `pnpm install` themselves and a `log.error` showing the **tail** of the failure (last few lines, not a full stack dump). Crucially, `init` **continues** — the project folder is still fully scaffolded, the **Next steps** note still prints (with the `pnpm install` line present, since install didn't succeed), and the command exits **0** (project creation is not treated as failed just because install didn't complete).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `init` still writes the same base tree (`apps/web`, `packages/ui`, `packages/config`) with the project name substituted — the UI change touched only presentation, not scaffolding.
- [ ] Exit codes unchanged: `init` success = 0, `init` errors = 1, `add`/`list` = 0, unknown command = 1.
- [ ] `logger.error` / `logger.step` call sites in `init.ts` still produce output (the logger interface is unchanged; only its implementation now delegates to clack).
- [ ] No stray `console.log` debug lines or double-printed blocks.
- [ ] Whether install is accepted, declined, cancelled, or fails, `init` always reaches the **Next steps** note + outro and exits 0 (only the presence of the `pnpm install` step differs).

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm --filter saasaloy build
pnpm --filter saasaloy typecheck
node packages/cli/dist/index.js list  >/dev/null; echo $?
node packages/cli/dist/index.js add   >/dev/null; echo $?
node packages/cli/dist/index.js bogus >/dev/null; echo $?
node packages/cli/dist/index.js --help >/dev/null; echo $?
FORCE_COLOR=1 node packages/cli/dist/index.js --help | od -c | grep 033
```

- ✅ `build` (tsup) → succeeded, emitted `dist/index.js` (5.87 KB).
- ✅ `typecheck` (`tsc --noEmit`) → no errors.
- ✅ Dependencies present at exact versions → `@clack/prompts@1.7.0`, `picocolors@1.1.1` in `packages/cli/package.json` (satisfies AC #1).
- ✅ Exit codes → `list`=0, `add`=0, `bogus`=1, `--help`=0 (behavior unchanged).
- ✅ `init` end-to-end into `.dev/qa-playground` → exit 0, rail rendered (intro/spinner/note/outro), base tree written.
- ✅ ANSI emission under `FORCE_COLOR=1` → escape sequences (`\033[`) present in `--help`, confirming picocolors is wired (color is auto-stripped in non-TTY, which is correct).
- ✅ Logger call-site interface unchanged → `init.ts` still calls `logger.error` / `logger.step`; only the implementation now delegates to clack `log.*`.

## Not covered / needs human judgment
- **Visual polish** — box alignment, color legibility, spinner animation, and the cyan-background intro swatch can only be judged live in a TTY (captured output strips all of it). This is the core of TC-1–TC-8.
- **Cross-terminal rendering** — behavior in specific emulators (iTerm2, Windows Terminal, VS Code integrated terminal, tmux) and their Unicode/box-drawing support isn't scripted.
- **Ctrl-C / cancel UX** — `init` now has two live prompts (project-name `text` when the arg is missing, and the install `confirm`); their cancel behavior is exercised by TC-10/TC-12 in a TTY but can't be scripted. `add`/`list` remain non-interactive stubs (no prompts to cancel).
- **Live install prompt in a TTY** — the `confirm` toggle, the single-line install loader, and the accept/decline branches (TC-10–TC-13) need a real terminal; piped stdin closes before the prompt submits, so these can't be captured by script. The underlying `pnpm install`-in-target and error-handling logic is verifiable, but the interactive selection is human-only.
- **`saasaloy add` picker & real module list** — intentionally out of scope for this change; TC-4/TC-5 verify only the styled stubs.
