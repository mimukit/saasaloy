# 0006 — Copy-in updates with manifest hash tracking

Existing projects receive module fixes via **copy-in + `--diff`**, not versioned packages, and managed-file status is tracked in a central `.saasaloy/manifest.json` (each managed file + a content hash + owning module) rather than in-file markers. On update the tool hashes the file: match → safe clean overwrite; drift (hand-edited) → routed to the AI-merge path instead of clobbered. The churny wiring is exactly what you don't hand-edit, so updates are usually clean overwrites of files you never touched. See build-spec [§2.9](../plans/saasaloy-build-spec.md).

## Status
accepted — supersedes the `// saasaloy:managed` in-file marker idea

## Considered Options
- `// saasaloy:managed` sentinel comments in generated files — rejected: manifest tracking keeps files clean, is pollution-free, and applies to *every* managed file (including copied skills), not just agent files.
- Versioned `@saasaloy/*` packages first — deferred: copy-in → package is a cheap later migration if manual merges ever start hurting; package-first is infra paid up front against a problem that may not exist, and copy-in is more agent-friendly (every file is in the repo where an AI can read and rewrite it).

## Consequences
- AI-assisted merge is a first-class path: `--diff` emits a structured, agent-consumable merge plan.
- The full update flow is `diff → merge → regenerate migrations → verify (smoke test)`, not just a text merge.
