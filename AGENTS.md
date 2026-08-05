
# Saasaloy — agent overview

## Conventions

- **Package manager is pnpm 11**; all non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`. Exact versions are pinned (`saveExact`).
- Always use `.dev` directory for testing or running `saasaloy` cli commands.
- **Every scaffolded workspace ships a `clean` script.** Any `package.json` under `packages/cli/templates/base/` or `modules/*/files/` must declare `"clean"` backed by an exact-pinned `rimraf` devDependency — never `rm -rf` (not cross-platform). Clean only what the workspace generates (`dist`, `.astro`, `.wrangler`, `*.tsbuildinfo`); the template's root `clean` handles `node_modules` and `.turbo` for the whole repo. See the template's `AGENTS.md`.
- **Template + module-descriptor deps are pnpm-invisible** — keep them fresh with `pnpm deps:update` (interactive: grouped report → pick bumps → confirm; majors are their own opt-in group) → `pnpm deps:verify`. Exact-pinned, within-major, 3-day cooldown; `--allow-major`/`--allow-fresh` to override, `--yes` for non-interactive. `pnpm deps:check` is the read-only CI gate. See CONTRIBUTING.md "Updating dependencies" and ADR 0016. The repo's own workspace deps stay on `pnpm outdated`/`update`.
