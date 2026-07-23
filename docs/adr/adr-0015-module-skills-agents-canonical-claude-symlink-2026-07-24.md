# 0015 — module skills are `.agents/`-canonical with a `.claude/skills` symlink

`saasaloy add` installs a module's skill folder as **real, committed files under `.agents/skills/<name>/`** and points a **`.claude/skills/<name>` symlink** at them. `.agents/skills/` is the cross-agent canonical home (Codex, Antigravity, Cursor, and other tools read it directly); the symlink is purely how Claude Code discovers the same files. This supersedes the "copy into `.claude/skills/`" mechanism of [ADR 0007](adr-0007-agent-native-static-agents-md-copied-skills-2026-07-22.md) for module skills — and makes shipped modules symmetric with how the tool repo hosts its own dev skills ([ADR 0011](adr-0011-tool-repo-never-self-syncs-2026-07-22.md)).

The link is created per skill folder — `.claude/skills/saasaloy-api → ../../.agents/skills/saasaloy-api` — so `.claude/skills/` stays a real directory that can hold a user's own hand-authored skills alongside the symlinked module ones. The native link is a POSIX symlink elsewhere and a **junction on Windows** (no admin rights, absolute target); the manifest records `source → link` in its `links` map so `remove` can undo both the files and the symlink. `.claude/skills/` is git-ignored in the base template and regenerated per-machine by `add`, so a POSIX symlink can never land on a Windows clone as a broken text file — the real files travel in `.agents/skills/`, the link is a local, native artifact.

## Status
accepted — supersedes the copy mechanism of ADR 0007 (the static `AGENTS.md`/`CLAUDE.md` half of 0007 still stands)

## Considered Options
- **Copy the skill folder into `.claude/skills/<name>/`** (ADR 0007) — rejected now: it makes module guidance Claude-Code-only, duplicates bytes the manifest must hash, and gives Codex/Antigravity/Cursor nothing to read. The reason 0007 rejected symlinks — "the canonical source is going away and symlinks are fragile across clone/Windows/git" — no longer holds: the canonical source **stays** (committed `.agents/skills/`), and the fragility is handled by junctions + git-ignore-and-regenerate.
- **Symlink the whole `.claude/skills` directory → `.agents/skills`** — rejected: a single dir symlink can't coexist with a user's own real `.claude/skills/`, and collides if one already exists. Per-folder links keep `.claude/skills/` a real directory.
- **Commit the `.claude/skills` symlinks to git** — rejected: a POSIX symlink checked out on a Windows clone without `core.symlinks` materializes as a plain text file containing the link path (broken until re-added). Git-ignoring the link and regenerating it natively per-machine is portable.

## Consequences
- Module guidance is now **cross-agent** (any tool that reads `.agents/skills/` sees it), not Claude-Code-only — the trade-off 0007 accepted is reversed in the better direction.
- Adding/removing a module is still a self-contained folder op: `add` writes `.agents/skills/<name>/` + one symlink and records both; `remove` deletes the tracked files and the link. No concat, no regeneration of a shared file.
- The `.claude/skills/<name>` folder name still carries the `saasaloy-` prefix ([ADR 0014](adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md)), so collision-avoidance with a user's own skills is unchanged — the link name, not just the copied folder, is namespaced.
- A pre-existing non-symlink at `.claude/skills/<name>` is treated as a **conflict**: left untouched and reported, never clobbered (mirrors the file `conflict` action).

Plan: `docs/plans/plan-scaffold-applier-2026-07-24.md` (skill-linking landed alongside the scaffold applier). Code: `packages/cli/src/lib/applier.ts` (`PlannedLink`, link classification/creation), `packages/cli/src/lib/fs-utils.ts` (`classifyLink`, `createDirLink`), `packages/cli/src/commands/add.ts`, `packages/cli/templates/base/_gitignore`. Related: [ADR 0007](adr-0007-agent-native-static-agents-md-copied-skills-2026-07-22.md), [ADR 0011](adr-0011-tool-repo-never-self-syncs-2026-07-22.md), [ADR 0014](adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md). Issue: #8.
