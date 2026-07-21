
# Saasaloy — agent overview

## Conventions

- **Package manager is pnpm 11**; all non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`. Exact versions are pinned (`saveExact`).
- Always use `.dev` directory for testing or running `saasaloy` cli commands.
