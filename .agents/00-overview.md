# Saasaloy — agent overview

Saasaloy is a **composable SaaS accelerator for Cloudflare**: a CLI (`saasaloy`) plus a
module registry, not a static boilerplate. `saasaloy init` scaffolds a near-inert base
(Astro landing + `packages/ui` + `packages/config`); everything churny — API, database,
auth, admin, features — installs on demand via `saasaloy add <module>`. See
`docs/plans/saasaloy-build-spec.md` for the full, settled design and reasoning.

**This repo is the tool itself**, not a generated project. The `apps/web`, `packages/db`
layout in the spec's §3.1 is what `saasaloy init` emits into *other* projects.

## Repo layout

- `packages/cli/` — the `saasaloy` binary (`init`, `add`, `list`, `sync`). Command modules
  in `src/commands/`, shared logic in `src/lib/`.
- `modules/` — the registry: one dir per module (`registry-item.json` + `files/`), read off
  disk by the local applier. Empty until Phase 1.
- `.agents/` — **canonical agent source** for this repo (this file + `skills/`).
- `docs/plans/` — the build spec (source of truth).

## Conventions

- **Package manager is pnpm 11**; all non-auth settings live in `pnpm-workspace.yaml`
  (camelCase), never `.npmrc`. Exact versions are pinned (`saveExact`).
- **TypeScript, ESM, NodeNext.** Relative imports carry a `.js` extension. `strict` +
  `noUncheckedIndexedAccess` + `verbatimModuleSyntax` are on — use `import type` for types.
- **Keep scope ruthless** (spec §7): start with one implementation, extract packages only
  when duplication actually hurts. Prefer deterministic code for deterministic steps and an
  agent-ready plan for non-deterministic ones (spec §2.13).

## Agent layer (how this file reaches your tools)

`.agents/*.md` is the single source of truth. `saasaloy sync` compiles it into per-tool
views: `AGENTS.md` (literal concat, read by Codex/Antigravity), `CLAUDE.md` (a one-line
`@AGENTS.md` import), and `.claude/skills/*` (symlinks to `.agents/skills/*`). The views are
generated and git-ignored — **edit the fragments here, never the generated files** — then run
`pnpm sync`.
