# `src/containers/`

Containers are the third UI layer. A container binds a shared store or cross-island state, then wires the data and the callbacks into pure blocks. Keep them thin — the visual weight stays in the block.

The base ships none, so this folder holds only this note. Delete the note when you add your first container.

Rules (the full version is in the repository's `AGENTS.md`):

- A container imports a client-state store from `@repo/ui/lib/*`, subscribes to it, and renders blocks. It owns no markup a block could own.
- No IO anywhere in `@repo/ui` — no fetch, no persistence, no auth. The app that owns the data hydrates the store.
- One container, one file, one component export. Reach it by subpath: `import { CartSummary } from "@repo/ui/containers/cart-summary";`.
