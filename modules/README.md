# modules — the Saasaloy registry

Each subdirectory is one module the `saasaloy add <name>` applier reads **off disk**
(v1 is a local applier; the remote GitHub-hosted registry is a later, additive step —
see build spec §2.4 and §2.11).

A module is a shadcn-shaped descriptor plus the files it drops in:

```
modules/
  <name>/
    registry-item.json     # name, type, dependsOn[], dependencies[], files[], patches, agent{}
    files/                 # template files, copied to alias targets in the consumer project
```

See `docs/plans/saasaloy-build-spec.md` §3.3 for the descriptor shape. Modules land in
Phase 1 (`api`, `database`, `waitlist`) and Phase 2 (`auth`, `admin`, `billing`, …); this
directory is intentionally empty until then.
