# QA Plan: Agent-view sync pipeline (`saasaloy sync`)

_Generated 2026-07-21 · covers the Phase 0 agent layer: `packages/cli/src/lib/*`, `packages/cli/src/commands/sync.ts`, the CLI dispatcher, and the dogfooded `.agents/` + `saasaloy.agent.json` in this repo (uncommitted working tree)._

## Summary
`saasaloy sync` compiles the canonical `.agents/` source into per-tool views: `AGENTS.md` (literal concatenation of `.agents/*.md`, read by Codex/Antigravity), `CLAUDE.md` (a one-line `@AGENTS.md` import for Claude Code), and `.claude/skills/*` (symlinks to `.agents/skills/*`). Managed outputs and the link map are recorded in `.saasaloy/manifest.json`. "Working" means: a human editing only the fragments under `.agents/` and running `pnpm sync` gets correct, tool-loadable guidance and skills, with generated files kept out of git.

## Preconditions
- Branch: `main`, working tree with the uncommitted Phase 0 changes.
- Node ≥ 24.13, pnpm 11, deps installed (`pnpm install`).
- Build the CLI once before manual testing:

```sh
pnpm --filter saasaloy build
```

- To exercise the Claude Code cases (TC-1, TC-2, TC-6) you need Claude Code installed and this repo opened as the working directory in a **fresh session** (so it re-reads `CLAUDE.md` and `.claude/skills`).

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `CLAUDE.md` `@AGENTS.md` import loads guidance in a live Claude Code session | 🔴 Critical |
| TC-2 | `author-module` skill is discoverable and triggers in Claude Code | 🔴 Critical |
| TC-3 | Generated `AGENTS.md` reads accurately and is genuinely useful | 🟡 Normal |
| TC-4 | Edit a fragment → `pnpm sync` → the tool reflects the change | 🟡 Normal |
| TC-5 | Windows: skill links regenerate as junctions and resolve | 🟡 Normal |
| TC-6 | CLI `--help` output is clear and readable | 🟢 Low |

## Test cases

### TC-1 — `CLAUDE.md` `@AGENTS.md` import loads guidance in a live Claude Code session · 🔴 Critical
The whole point of the pipeline is that the single source reaches Claude Code. Only a human running Claude Code can confirm the `@`-import actually resolves and the guidance is in context.

**Steps**
1. Ensure views are generated:

```sh
pnpm sync
```

2. Open this repo in a **new** Claude Code session.
3. Ask it something answerable only from the overview, e.g. "According to this repo's agent guidance, where do non-auth pnpm settings go, and why is `package.json` not a project-root marker?"

**Expected:** The answer reflects `.agents/00-overview.md` content (pnpm settings live in `pnpm-workspace.yaml`; monorepo root-marker reasoning) — proving `CLAUDE.md` → `@AGENTS.md` → fragments loaded. No "I don't have that context" response.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — `author-module` skill is discoverable and triggers in Claude Code · 🔴 Critical
The skill exists only as a symlink `.claude/skills/author-module → ../../.agents/skills/author-module`. A human must confirm Claude Code discovers it through the link and can invoke it.

**Steps**
1. In a fresh Claude Code session in this repo, check that `author-module` appears in the available skills.
2. Trigger it, e.g. "use the author-module skill to help me scaffold a new module".

**Expected:** The skill is listed and, when invoked, its `SKILL.md` content (module shape, convention-based drop points, `dependsOn`) is used. Confirms the symlink is followed by the tool, not just present on disk.
**Actual:** _(tester fills in)_ — _note: during implementation the skill was observed auto-appearing in the agent's skill list this session, a positive early signal; still confirm in a clean session._

- [ ] Pass
- [ ] Fail

### TC-3 — Generated `AGENTS.md` reads accurately and is genuinely useful · 🟡 Normal
Hash/idempotency are machine-checked; whether the *content* is correct and useful is human judgment.

**Steps**
1. Open the generated `AGENTS.md`.
2. Read it as if you were an agent new to the repo. Cross-check claims against reality (layout, pnpm/TS conventions, the sync workflow).

**Expected:** Content is accurate (no stale/wrong statements), the generated banner is present at the top, fragment content is intact and readable, and it would actually orient a new contributor/agent.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Edit a fragment → `pnpm sync` → the tool reflects the change · 🟡 Normal
Confirms the source-of-truth workflow end to end, including that a human never edits generated files.

**Steps**
1. Add a distinctive line to `.agents/00-overview.md` (e.g. `> QA-MARKER: teams module is planned for Phase 2.`).
2. Regenerate:

```sh
pnpm sync
```

3. In a fresh Claude Code session, ask about the QA-MARKER fact.
4. Remove the line and run `pnpm sync` again to restore.

**Expected:** After sync, `AGENTS.md` contains the new line and Claude Code can answer from it; editing the generated `AGENTS.md` directly would be pointless (it's regenerated). Restoring the fragment + sync returns to the original.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Windows: skill links regenerate as junctions and resolve · 🟡 Normal
The code branches to `symlink(..., "junction")` on `win32`; this can't be verified on macOS/Linux.

**Steps**
1. On a Windows machine, clone the repo, `pnpm install`, `pnpm --filter saasaloy build`.
2. Run:

```sh
pnpm sync
```

3. Open `.claude\skills\author-module\SKILL.md`.

**Expected:** `.claude\skills\author-module` is created as a junction and its `SKILL.md` opens (content readable through the link). No symlink-permission error.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — CLI `--help` output is clear and readable · 🟢 Low
**Steps**
1. Run:

```sh
node packages/cli/dist/index.js --help
```

**Expected:** Lists `init`, `add`, `list`, `sync` with aligned, understandable descriptions; a newcomer can tell what each does.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `.claude/skills` used by *your own* Claude Code setup still works (the repo-local link doesn't clobber anything you rely on).
- [ ] Nothing generated leaks into git (see automated check below) — no accidental commit of `AGENTS.md`/`CLAUDE.md`/links.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm --filter saasaloy build
pnpm --filter saasaloy typecheck
node packages/cli/dist/index.js sync
node packages/cli/dist/index.js --help; echo $?
node packages/cli/dist/index.js bogus; echo $?
node packages/cli/dist/index.js init; node packages/cli/dist/index.js add; node packages/cli/dist/index.js list
git check-ignore AGENTS.md CLAUDE.md .claude/skills .saasaloy
# from a subdirectory and from an empty dir:
(cd packages/cli && node ../../packages/cli/dist/index.js sync)
(cd "$(mktemp -d)" && node <repo>/packages/cli/dist/index.js sync; echo $?)
```

- ✅ Build → `tsup` ESM build success.
- ✅ Typecheck → `tsc --noEmit` clean (strict + noUncheckedIndexedAccess + verbatimModuleSyntax).
- ✅ `sync` → `synced 1 fragment(s) → AGENTS.md, CLAUDE.md`; `linked 1 skill(s) into .claude/skills`.
- ✅ Idempotency → `AGENTS.md` sha256 identical across two consecutive runs (byte-stable, no timestamps).
- ✅ `AGENTS.md` → begins with the generated banner + full `00-overview.md` concatenation.
- ✅ `CLAUDE.md` → exactly one line, `@AGENTS.md`.
- ✅ Skill link → `.claude/skills/author-module` is a relative symlink `../../.agents/skills/author-module`; `SKILL.md` readable through it.
- ✅ Manifest → `.saasaloy/manifest.json` records both managed files with sha256 hashes and the link map.
- ✅ Stale-link pruning → a hand-created `ghost-skill` symlink was removed on the next `sync`; real skill kept.
- ✅ Exit codes → `--help` = 0; unknown command = 1 (prints help); `init`/`add`/`list` stubs = 1 ("not implemented yet").
- ✅ Gitignore → `git check-ignore` confirms `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, `.saasaloy` are ignored.
- ✅ Subdirectory run → `sync` from `packages/cli` and `packages/cli/src/lib` now finds the repo root and succeeds.
- ✅ No-source run → `sync` in an empty temp dir fails gracefully with a clear message and exit 1.
- ❌→✅ **Bug found & fixed during QA:** running `sync` from a subdirectory originally failed because the project-root finder listed `package.json` as a marker, stopping at `packages/cli` in the monorepo. Removed `package.json` from the marker set (`packages/cli/src/lib/project.ts`); re-verified green above.

## Not covered / needs human judgment
- **Codex / Antigravity** actually reading the generated `AGENTS.md` — external tools, not scriptable here (TC-1/TC-2 cover Claude Code only).
- **Windows** junction behavior (TC-5) — needs a Windows host; only the macOS/Linux symlink path was machine-verified.
- **Cloudflare deploy** — belongs to the second half of Phase 0 (`saasaloy init`), not this pipeline.
- **`saasaloy init` end-to-end** — still a stub; its scaffold + auto-`sync` will need its own QA plan.
