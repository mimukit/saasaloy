# 0008 — `saasaloy init` single binary

The CLI entry point is one binary with one mental model — `init` / `add` / `list` — not a separate `create-saasaloy` package. `npx saasaloy init my-app` bootstraps from a clean machine exactly like a `create-*` package would, consistent with shadcn (`npx shadcn init`, not `create-shadcn`). See build-spec [§2.10](../plans/saasaloy-build-spec.md).

## Status
accepted — supersedes `create-saasaloy`

## Considered Options
- A `create-saasaloy` package for the `npm create` entry point — rejected as a second package to maintain; a thin `create-saasaloy` shim can be added later purely for that entry point if/when open-sourcing.

## Consequences
- One package, one mental model.
