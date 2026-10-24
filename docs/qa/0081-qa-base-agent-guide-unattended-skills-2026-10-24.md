# QA Plan: the base agent guide and the unattended skill paths

_Generated 2026-10-24 · against `59342abe` (clean) · covers issue #224: the base `AGENTS.md` cut, `packages/ui/AGENTS.md`, `pnpm check`, and the `autonomy: afk` paths of `saasaloy-setup`, `saasaloy-landing-copy` and `saasaloy-design`_

## Summary
- The generated project gets a short root agent guide, a design-layer guide in `packages/ui`, one check command, and skills that run with no questions under `autonomy: afk`.
- Working means `pnpm check` passes on a fresh project and edits no file, and each skill takes its unattended path only when the brief says `autonomy: afk`.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-224-make-the-base-agent-guide-and-skills-work` at `59342abe` or later.
- The playground is `.dev/playground`. CONTRIBUTING.md declares it disposable.
- An agent CLI that loads skills from `.claude/skills/`, such as Claude Code.

Scaffold the playground with the local CLI:

```sh
pnpm play:destroy && pnpm play:init
```

Give it local env values:

```sh
cd .dev/playground && cp packages/env/.env.example packages/env/.env && pnpm env:setup
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh playground, no brief | The attended interview ends with the unattended question | 🟡 Normal |
| TC-2.1 | 2: Playground with an incomplete `afk` brief | Setup logs the empty section and stops | 🔴 Critical |
| TC-3.1 | 3: Playground with the benchmark brief | Setup, landing copy and design run with no question | 🔴 Critical |
| TC-3.2 | 3: Playground with the benchmark brief | The two agent guides read well | 🟢 Low |

## Scenario 1: Fresh playground, no brief

**Setup.** Run once, for every case in this scenario.

1. Open an agent session in `.dev/playground`.

- [ ] Setup complete

### TC-1.1: The attended interview ends with the unattended question  ·  🟡 Normal

**Goal.** With no `autonomy` field, `saasaloy-setup` keeps its attended interview and asks the new question last.

**Steps**

1. Tell the agent: `Run the saasaloy-setup skill.` Answer the ten questions with any values.
   - [ ] The agent asks "Run the build unattended?" after question 10, on its own
2. Answer `b` (yes).
   - [ ] `docs/product-brief.md` starts with frontmatter that holds `autonomy: afk`
3. Run the skill again, and answer `a` (no) to the last question.
   - [ ] The brief has no `autonomy` field

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before Scenario 2.

```sh
git checkout -- . && git clean -fd docs
```

## Scenario 2: Playground with an incomplete `afk` brief

**Setup.** Run once, for every case in this scenario.

1. Copy the benchmark brief into the playground, then delete the text under `## Proof` and keep the heading.

```sh
cp ../../scripts/agent-bench/brief.md docs/product-brief.md
```

- [ ] Setup complete

### TC-2.1: Setup logs the empty section and stops  ·  🔴 Critical

**Goal.** An unattended setup run on an incomplete brief writes the gap to the build log and changes nothing else.

**Steps**

1. Tell the agent: `Run the saasaloy-setup skill.`
   - [ ] The agent asks no question
   - [ ] `docs/build-log.md` has a `## Blocked` section that names Proof
   - [ ] `packages/config/src/project.ts` is unchanged (`git status` shows only `docs/`)

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before Scenario 3.

```sh
git checkout -- . && git clean -fd docs
```

## Scenario 3: Playground with the benchmark brief

**Setup.** Run once, for every case in this scenario.

```sh
mkdir -p docs && cp ../../scripts/agent-bench/brief.md docs/product-brief.md
```

- [ ] Setup complete

### TC-3.1: Setup, landing copy and design run with no question  ·  🔴 Critical

**Goal.** Each of the three skills writes its output from a complete `afk` brief and asks nothing.

**Steps**

1. Tell the agent: `Run the saasaloy-setup skill.`
   - [ ] The agent asks no question, and `project.ts` sets `name: "Shelfnote"` and `locale: "en"`
   - [ ] `docs/build-log.md` has a `## Setup` section
2. Tell the agent: `Run the saasaloy-landing-copy skill.`
   - [ ] The agent asks no question and writes no `docs/landing-copy-draft.md`
   - [ ] `landing.ts` describes Shelfnote with the brief's prices ($4/mo Reader, Free up to 50 books)
   - [ ] `docs/build-log.md` has a `## Landing copy` section that lists any dropped block
3. Tell the agent: `Run the saasaloy-design skill.`
   - [ ] The agent asks no question, applies one registry style, and logs its URL under `## Design`
   - [ ] The chosen look fits "quiet and plain, like a good library card"
4. Run the gate.

   ```sh
   pnpm check
   ```

   - [ ] `pnpm check` passes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The two agent guides read well  ·  🟢 Low

**Goal.** An agent that reads only the two guides finds the rules it needs.

**Steps**

1. Read `AGENTS.md` and `packages/ui/AGENTS.md` in the playground.
   - [ ] The root guide reads as one document, and its design-layer summary points to `packages/ui/AGENTS.md`
     - "Unattended work" names both inputs, the gate, the branch, the log, and the allowed and forbidden actions
     - nothing in the root guide refers to a section that moved
   - [ ] The design-layer guide reads on its own, with headings for theme, imports, primitives, blocks, containers and copy

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm run lint
```

```sh
pnpm run typecheck
```

```sh
pnpm run test
```

```sh
pnpm play:destroy && pnpm play:init
```

```sh
cd .dev/playground && cp packages/env/.env.example packages/env/.env && pnpm env:setup && pnpm check && git status --porcelain
```

- ✅ `pnpm run lint` at `59342abe` (same content, before the commit) → exit 0, all four passes clean
- ✅ `pnpm run typecheck` at `59342abe` → exit 0
- ✅ `pnpm run test` at `59342abe` → exit 0; 931, 90, 147 and 455 tests pass, 0 fail
- ✅ C1 · `wc -l` on the scaffolded `AGENTS.md` → `249`
- ✅ C2 · the scaffold has `packages/ui/AGENTS.md` (159 lines) and `packages/ui/CLAUDE.md` holding `@AGENTS.md`
- ✅ C3 · `grep -c 'made before the theme split'` on the base `AGENTS.md` → `0`; the steps are in `docs/wiki/runbooks/finish-the-theme-split.md`
- ✅ C4 · "currently empty", "TanStack Start", a skill count of three or four, the `git init` claim and `uikit` → 0 matches each
- ✅ C5 · "Unattended work" holds `autonomy: afk`, the brief, `pnpm check`, `build/mvp`, `docs/build-log.md`, the allowed list and the forbidden list
- ✅ C6 · the "Claude-Code-only" consequence in ADR 0007 → 0 matches; the Status line carries a dated correction
- ✅ C7 · `pnpm check` on a fresh scaffold at `59342abe`, after the env step → exit 0 (typecheck, lint, 111 tests, web build); `git status --porcelain` afterwards → empty
- ✅ C8 · `saasaloy-setup` asks "Run the build unattended?" after the ten-question table and writes `autonomy: afk` on yes (text check)
- ✅ C9 to C13 · each of the three skills has an `## Unattended run` section that its Step 0 or `theme` step routes to on `autonomy: afk`, and the attended steps are unchanged (text check only)
- ❌ C7 without the env step · `pnpm check` at `8bc82565` → exit 1: `apps/web` build fails with `PUBLIC_SITE_URL` and `PUBLIC_API_URL` unset. The base template has no `packages/env/.env` until a person writes one. "Unattended work" now names the env file as an input.
- ❌ C7 before `59342abe` · turbo 2.11.6 appended an 11-line `turborepo-agent-rules` block to `AGENTS.md` during `pnpm check`. Fixed by `"agentGuidance": false` in the base `turbo.json`.

The agent did not run C9 to C12 as live skill runs. The session's permission policy refused a headless `claude -p --permission-mode bypassPermissions` run. TC-2.1 and TC-3.1 cover them.

### Browser checks
_No browser checks. The change has no UI._

## Not covered / needs human judgment
- `saasaloy env --from-file packages/env/.env.example` in a fresh project exits 2: "No installed module declares PUBLIC_SITE_URL, PUBLIC_API_URL". The base keys cannot go through `--from-file`. This is CLI behaviour from #223, and this branch does not change it.
- Security, concurrency, performance and accessibility: not in scope. The change is documents, skill text and two config lines.
- The full unattended build on `build/mvp` with one commit per stage: #228 builds the skill that runs it.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
