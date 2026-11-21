# QA Plan: add the single requiresOneOf option without a question

_Generated 2026-11-21 · against `f5a106dd` (clean) · covers issue #371, plan 0119 phases 1 to 3_

## Summary

- `saasaloy add` adds the one option of a `requiresOneOf` list with no question, and `modules/database` no longer ships `packages/db/tsconfig.json`.
- Working means `saasaloy add database` installs `database` and `database-postgres` on a terminal and in a script, and a two-option list still asks or refuses.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-371-add-the-single-requiresoneof-option-without-a-question` at `f5a106dd`.
- The CLI runs from this branch's build, against this branch's `modules/`.
- Use a real terminal for this plan. The agent ran every non-interactive check.
- Screenshots: none. The change has no web screen.

Build the CLI from the repository root:

```sh
pnpm --filter saasaloy build
```

Make a throwaway directory under `.dev`:

```sh
mkdir -p .dev/qa-371 && cd .dev/qa-371
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh project on a terminal | `add database` asks no driver question | 🔴 Critical |
| TC-1.2 | 1: fresh project on a terminal | `add api-keys` still asks for the owner | 🟡 Normal |

## Scenario 1: fresh project on a terminal

**Setup.** Run once, for every case in this scenario.

1. Scaffold a project with this branch's CLI.

```sh
SAASALOY_REGISTRY_DIR="$(git rev-parse --show-toplevel)/modules" node "$(git rev-parse --show-toplevel)/packages/cli/dist/index.js" init app --no-install
```

2. Go into the project.

```sh
cd app
```

- [ ] Setup complete

### TC-1.1: `add database` asks no driver question  ·  🔴 Critical

**Goal.** A person on a terminal installs the database with no driver question.

**Steps**

1. Run `add` with no flag, and answer the one `Proceed?` prompt.

   ```sh
   SAASALOY_REGISTRY_DIR="$(git rev-parse --show-toplevel)/modules" node "$(git rev-parse --show-toplevel)/packages/cli/dist/index.js" add database
   ```

   - [ ] The run shows no "needs one of these — pick one" picker before the plan
   - [ ] The line `database needs database-postgres; adding it.` reads clearly in the clack output, above the plan
     - the line sits with the other clack lines, not as raw text
     - the plan that follows lists `database-postgres`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `add api-keys` still asks for the owner  ·  🟡 Normal

**Goal.** A list of two or more options still gets the picker on a terminal.

**Steps**

1. Run `add` for the module with two owners.

   ```sh
   SAASALOY_REGISTRY_DIR="$(git rev-parse --show-toplevel)/modules" node "$(git rev-parse --show-toplevel)/packages/cli/dist/index.js" add api-keys
   ```

   - [ ] A picker asks for `api-keys-organization` or `api-keys-user`
2. Press Ctrl+C at the picker.
   - [ ] The run stops with "add cancelled" and writes nothing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd ../.. && rm -rf .dev/qa-371
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The agent ran the CLI from `packages/cli/dist` at `f5a106dd`, with `SAASALOY_REGISTRY_DIR` set to the worktree's `modules/` and stdin closed, in fresh projects under `.dev/qa-371/`. It removed that directory after the checks.

Commands run (one per block):

```sh
pnpm --filter saasaloy build
```

```sh
saasaloy init app-a --no-install --no-git
```

```sh
saasaloy add database --yes
```

```sh
saasaloy add api-keys --yes
```

```sh
saasaloy add waitlist --with database-postgres --yes
```

```sh
saasaloy add waitlist --dry-run --json
```

```sh
saasaloy add waitlist --yes
```

```sh
npm i saasaloy@0.10.0 && saasaloy@0.10.0 init app-old --no-install --no-git && saasaloy@0.10.0 add admin --with database-postgres --yes
```

```sh
saasaloy update --yes
```

```sh
saasaloy doctor
```

```sh
pnpm test:modules
```

```sh
pnpm scaffold:check
```

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm docs:check
```

```sh
pnpm docs:stale
```

```sh
pnpm exec vitest run --config vitest.integration.config.ts test/e2e/single-option.test.ts test/e2e/agent-flags.test.ts
```

```sh
git grep -n -- "--with database-postgres" -- . ':!docs/adr' ':!docs/plans' ':!docs/research' ':!docs/qa' ':!docs/status' ':!packages/cli/CHANGELOG.md'
```

- ✅ C1 · `add database --yes` with no terminal → exit 0; `installed` holds `database` and `database-postgres`; the lock's `requested` is `["database","database-postgres"]`; `packages/db/tsconfig.json` has `"types": ["node", "vite/client"]`, the driver's copy.
- ✅ C2 · the same run prints `●  database needs database-postgres; adding it.` once.
- ✅ C3 · `add api-keys --yes` with no terminal → exit 2, `api-keys needs one of: api-keys-organization, api-keys-user, and none is installed`, and the project tree stays clean.
- ✅ C4 · `add waitlist --with database-postgres --yes` on a fresh project → exit 0, the driver installed, and no "adding it" line, because `--with` answered first.
- ✅ `add waitlist --yes` with no `--with` on a fresh project → exit 0, the line printed, `database-postgres` installed.
- ✅ `add waitlist --dry-run --json` → exit 0; stdout parses as one JSON document with `database-postgres` in `prerequisites`; the line goes to stderr; the tree stays clean.
- ✅ C5 · `update` keeps its refusal → unit test `render.test.ts` "refuses an unmet one-option requirement rather than add the option" passes, and was seen red with the refusal removed. `init` renders `requested: []` (`packages/cli/src/commands/init.ts:634`), so `init` meets no requirement.
- ✅ C6 · `modules/database/files/tsconfig.json` does not exist, and the descriptor names no `tsconfig`; `pnpm test:modules` → 1700 pass, 0 fail; `pnpm scaffold:check` → a fresh scaffold with 15 modules on `database-postgres` passes `pnpm check` (40 s).
- ✅ C7 · a project made by `saasaloy@0.10.0` with `admin --with database-postgres`, then `update --yes` with this branch's CLI → exit 0, "Updated to 0.11.0", 0 files with conflict markers, `packages/db/tsconfig.json` sha256 `3ac7bc06…` before and after, manifest owner `database-postgres`; `doctor` exits 0 with `database` and `database-postgres` both ✔. `pnpm release:smoke --upgrade-only` at `12b8a528` also passed.
- ✅ C8 · the `git grep` prints nothing (exit 1).
- ✅ C9 · `CONTEXT.md`'s `Driver module` entry states the one-option rule; `packages/cli/CHANGELOG.md` has one Features line under Unreleased.
- ✅ C10 · `pnpm test` (turbo 454, modules 1700, base 164, scripts 1036, 0 fail), `pnpm lint`, `pnpm typecheck` and `pnpm docs:check` (60 pages current) exit 0; `pnpm docs:stale` reports every hand-written page current.
- ✅ e2e · `single-option.test.ts` and `agent-flags.test.ts` → 11 tests pass.

## Not covered / needs human judgment

- C11, the terminal output, needs a person at a real terminal. The agent's runs had stdin closed.
- A `--with` answer for a requirement that only a single-option module brings in still refuses, because `add` reads `--with` before it adds single options. No module in the registry has this shape today.
- The "adding it" line also prints in a run that then refuses on a two-option list, such as `add api-keys --yes` on an empty project.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
