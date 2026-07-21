# {{PROJECT_NAME}} — agent overview

This is a **Cloudflare-native SaaS** scaffolded with Saasaloy. The base is intentionally
thin: an Astro marketing site plus shared config. Capabilities and features are added on
demand with `saasaloy add <module>`, each carrying current, correct wiring.

## Layout

- `apps/web` — Astro marketing site (static output, deployed to Cloudflare Workers static
  assets via `wrangler`). Pages in `src/pages/`.
- `packages/ui` — `@repo/ui`, shared UI. A stub until a feature module needs components.
- `packages/config` — `@repo/config`, shared TypeScript config other packages extend.
- Added later: `apps/api` (Hono on Workers, file-based routes), `apps/admin` (TanStack
  Router SPA), `packages/db` (Drizzle + D1).

## Conventions

- **pnpm 11** — non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`.
  Exact versions are pinned (`saveExact`).
- **TypeScript + ESM.** Internal packages are consumed JIT (no build step) via `workspace:*`.
- **Add features, don't hand-wire them.** Prefer `saasaloy add <module>` over manually
  creating routes/schema/auth; modules drop files into convention-based extension points.

## Agent layer

`.agents/*.md` is the single source of truth for agent guidance. `saasaloy sync` compiles it
into `AGENTS.md` (Codex/Antigravity), `CLAUDE.md` (`@AGENTS.md` import), and `.claude/skills`
(symlinks). Those are generated and git-ignored — **edit fragments here, then run `pnpm sync`**.
