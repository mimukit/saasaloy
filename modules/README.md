# modules — the Saasaloy registry

Each subdirectory is one module the `saasaloy add <name>` applier fetches from this repo
over the network — this repo *is* the default registry (ADR 0012). A local checkout of
this dir can be pointed at with `SAASALOY_REGISTRY_DIR` for dev/offline work.

A module is a shadcn-shaped descriptor plus the files it drops in:

```
modules/
  <name>/
    registry-item.json     # name, type, dependsOn[], dependencies[], files[], patches, agent{}
    files/                 # template files, copied to alias targets in the consumer project
```

See `docs/plans/saasaloy-build-spec.md` §3.3 for the descriptor shape. Modules land in
Phase 1 (`api`, `database`, `waitlist`) and Phase 2 (`auth`, `admin`, `billing`, …).

`hello/` and `hello-widget/` are the committed worked examples: `saasaloy add hello-widget`
fetches them from this repo to exercise the applier end to end — `dependsOn` resolution,
file drops, an npm dep, an env var, and a copied skill folder.
