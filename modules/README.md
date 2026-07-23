# modules — the Saasaloy registry

Each subdirectory is one module the `saasaloy add <name>` applier fetches from this repo
over the network — this repo *is* the default registry (ADR 0012). A local checkout of
this dir can be pointed at with `SAASALOY_REGISTRY_DIR` for dev/offline work.

A module is a shadcn-shaped descriptor plus the files it drops in:

```
modules/
  <name>/
    registry-item.json     # name, type, dependsOn[], dependencies[], files[], patches, scaffolds[], agent{}
    files/                 # template files, copied to alias (or scaffold-root) targets in the consumer project
    skills/saasaloy-<name>/  # skill folder, installed to the consumer's .agents/skills/saasaloy-<name>/ (+ a .claude/skills symlink)
```

See `docs/plans/plan-saasaloy-build-spec-2026-07-21.md` §3.3 for the descriptor shape. Modules land in
Phase 1 (`api`, `database`, `waitlist`) and Phase 2 (`auth`, `admin`, `billing`, …). The first to land
is `api` (a capability — it carries `scaffolds[]`; see ADR 0013 for the scaffolds/files split).

Tests create disposable registry fixtures. CLI development and manual QA use throwaway
registries under `.dev/`, so example modules do not need to live in the default registry.
