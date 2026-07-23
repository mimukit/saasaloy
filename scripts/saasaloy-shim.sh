#!/usr/bin/env sh
# Runs THIS worktree's freshly-built saasaloy CLI against THIS worktree's local
# modules/ registry. Copied into .dev/playground/saasaloy by `pnpm play:init`.
# Self-locating: derives the worktree root from its own path, so the same file
# works in every git worktree — no baked absolute paths. Keep `pnpm cli:dev`
# running so dist/index.js stays fresh.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec env SAASALOY_REGISTRY_DIR="$root/modules" \
  node "$root/packages/cli/dist/index.js" "$@"
