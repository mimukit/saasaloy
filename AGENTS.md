
# Saasaloy — agent overview

## Conventions

- **Package manager is pnpm 11**; all non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`. Exact versions are pinned (`saveExact`).
- Always use `.dev` directory for testing or running `saasaloy` cli commands.
- **Template + module-descriptor deps are pnpm-invisible** — keep them fresh with `pnpm deps:check` → `deps:update` → `deps:verify` (exact-pinned, within-major, 3-day cooldown; `--allow-major`/`--allow-fresh` to override). See CONTRIBUTING.md "Updating dependencies" and ADR 0016. The repo's own workspace deps stay on `pnpm outdated`/`update`.
