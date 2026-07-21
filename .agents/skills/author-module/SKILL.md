---
name: author-module
description: Scaffold a new Saasaloy module (registry-item.json + files + agent fragment) following the repo conventions. Use when adding a capability or feature module under modules/.
---

# author-module

Guide for authoring a new module in the Saasaloy registry. This is a stub; the full
scaffolding steps land alongside the Phase 1 applier (see `docs/plans/saasaloy-build-spec.md`
§2.7 and §3.3).

## Shape of a module

```
modules/<name>/
  registry-item.json     # name, type, dependsOn[], dependencies[], files[], patches, agent{}
  files/                 # template files copied to alias targets in the consumer project
```

## Conventions to honor

- **Feature modules never AST-patch another module's internals.** Extend via the
  convention-based drop points instead: a route file into `apps/api/routes/`, a table into
  `packages/db/schema/`, a UI component into `apps/web`. Only genuinely structural edits
  (a D1 binding, a Better Auth plugin) use small, tested AST patches.
- **Contribute agent context by dropping files**, not editing shared ones: an
  `agent.fragments[]` fragment lands in `.agents/`, an `agent.skills[]` folder in
  `.agents/skills/`. `saasaloy sync` re-derives the tool views.
- Declare `dependsOn` so the applier can resolve and topologically sort prerequisites.
