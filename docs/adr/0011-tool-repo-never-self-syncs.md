# 0011 — Tool repo never self-syncs

This repo (`saasaloy-monorepo`) is the CLI itself, not a generated project, so it does **not** run any sync on itself: its `AGENTS.md`/`CLAUDE.md` are hand-maintained committed docs (not git-ignored regenerated views), and the CLI is exercised only inside the git-ignored `.dev/` sandbox so `init`/`add` never mutate the repo. Its own dev skills (e.g. `create-module`) are hosted `.agents/`-canonical with a `.claude/skills/<name>` **symlink** — deliberately asymmetric with shipped modules, which are **copied** into a consumer's `.claude/skills/`. Settled in sessions `7a6b8ad5` and `1d1cf3aa` (2026-07-21/22).

## Status
accepted

## Considered Options
- Leave the repo's agent views git-ignored and regenerate them with a root `sync` script — rejected: it implies `sync` runs here, a footgun where `pnpm sync` regenerates views in the repo root; the root `sync` script was removed and the docs are tracked directly.
- Unify hosting so the repo also *copies* its dev skill (matching the module model) — rejected as out-of-scope re-architecture. The symlink-vs-copy asymmetry is intentional: the repo is the source of truth for its own skill, whereas a generated project must own a detached copy ([ADR-0007](0007-agent-native-static-agents-md-copied-skills.md)).

## Consequences
- An intentional asymmetry that looks like a contradiction from the code alone: modules copy, this repo symlinks.
- The orphaned `saasaloy.agent.json` (dead config from the reversed sync era) was deleted as part of this cleanup.
