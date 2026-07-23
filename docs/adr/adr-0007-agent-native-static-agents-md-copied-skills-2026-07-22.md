# 0007 — AI-agent-native: static `AGENTS.md` + copied Claude skills

Every generated project is agent-native. Fixed common rules ship as a committed static `AGENTS.md` (plus a one-line `CLAUDE.md` = `@AGENTS.md`) copied verbatim from `templates/base` at `init` — plain committed files, present the instant `init` finishes and surviving a `git clone`. Module-specific guidance ships as a **Claude skill folder** that `saasaloy add` **copies** into `.claude/skills/<name>/` and records in the manifest; a module never appends to a shared agent file. See build-spec [§2.13](../plans/plan-saasaloy-build-spec-2026-07-21.md), [§3.3](../plans/plan-saasaloy-build-spec-2026-07-21.md).

## Status
accepted — supersedes the canonical `.agents/` → `saasaloy sync` pipeline. **Amended by [ADR 0015](adr-0015-module-skills-agents-canonical-claude-symlink-2026-07-24.md):** module skills now install as committed files under `.agents/skills/<name>/` with a `.claude/skills/<name>` symlink (not copied into `.claude/skills/`) — the static `AGENTS.md`/`CLAUDE.md` decision below is unchanged.

## Considered Options
- Canonical `.agents/*.md` fragments concatenated by a `saasaloy sync` step into git-ignored, regenerated `AGENTS.md`/`CLAUDE.md`/skill symlinks — rejected: git-ignored regenerated views are absent on a fresh clone or new agent session until `sync` runs, and `saasaloy` isn't a dependency of generated projects, so the agent opens with no context (caught in Phase 0 QA, TC-6). Committing static files and copying skills removes that entire failure class along with the concat/fragment/manifest-hash/`sync` machinery.
- Symlinking skills into `.claude/skills/` — rejected: the canonical source is going away and symlinks are fragile across clone/Windows/git; skills are copied as plain tracked files.

## Consequences
- Accepted trade-off: module guidance is now Claude-Code-only and on-demand (skills aren't read by Codex/Antigravity); the committed `AGENTS.md` still carries the universal rules to every tool. Revisit only if Codex/Antigravity become primary.
- Adding/removing a module is adding/removing a self-contained folder — no concat, no regeneration, a clean `remove`.
