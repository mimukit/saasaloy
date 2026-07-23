# 0013 — Module authoring: dependency ownership and the scaffolds/files split

Authoring a module descriptor (`registry-item.json`) follows two rules that both fall out of the same capability-vs-feature asymmetry (ADR 0005): **a capability owns the workspace it scaffolds; a feature only drops files into workspaces others own.** From that: (1) **npm dependencies have one source of truth per workspace** — a capability declares its deps in the `package.json` it scaffolds and leaves the descriptor `dependencies[]` empty; a feature, owning no `package.json`, lists its npm deps in `dependencies[]` and the applier merges them into the target workspace's `package.json`. (2) **`scaffolds[]` births a whole workspace, `files[]` drops into an existing one** — a capability's `scaffolds[]` entry carries workspace-root-relative targets (no `@alias` — the alias root doesn't exist yet) and declares the alias it registers into `saasaloy.json`; its own initial files ship inside the scaffold, so a capability's `files[]` is empty. Settled while grilling the `api` capability (the first capability module).

## Status
accepted — extends [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md) (two-tier convention-based modules) by pinning how the two tiers express dependencies and file placement.

## Considered Options
- **npm deps: always in descriptor `dependencies[]`** (applier writes them into every `package.json`, capabilities included) — rejected: a capability already *ships* a `package.json`, so its deps would live in two places (descriptor + scaffolded file) and drift. One source of truth per workspace is simpler and drift-proof. `dependencies[]` isn't redundant — it remains the *only* mechanism for features, which own no `package.json`.
- **Scaffold-root files via a twin `@api-root` alias** (`@api-root → apps/api` alongside `@api → apps/api/src`) — rejected: every capability would need a parallel `-root` alias, doubling the alias map for a rare need, and something must still inject those aliases at scaffold time anyway.
- **Redefine `@api → apps/api`** (workspace root, not `src`) — rejected: makes the *frequent* case ugly (every feature would write `@api/src/routes/x.ts`) to serve the *rare* one, and contradicts the fixed alias map in build-spec §3.2.

## Consequences
- **`dependsOn[]` vs `dependencies[]` are distinct fields, never conflated:** `dependsOn[]` = inter-module prerequisites (topo-sorted Saasaloy modules); `dependencies[]` = npm packages (pnpm). Documented in `create-module`.
- **`scaffolds[]` items commit to a shape:** `{ "workspace", "aliases", "files": [{ "path", "target" }] }` with workspace-root-relative `target`s. The `registry-item.schema.json` `scaffolds.items` (currently bare `{ "type": "object" }`) should be tightened to match when the applier's scaffolding lands.
- **A capability declares the alias it establishes**, so the applier registers e.g. `@api → apps/api/src` into `saasaloy.json` at scaffold time — resolving the chicken-and-egg where the first feature needs `@api` to already exist.
- **A capability's `files[]` is typically empty**; the entry and its first route ship in the scaffold. Reviewers should expect that, not treat it as an omission.
- **Open (feature tier, deferred):** when a feature drops files into several workspaces (`@api`, `@db`, `@web`), the applier must decide *which* workspace's `package.json` receives its `dependencies[]` — likely inferred from the importing file's target alias. To be settled in the feature-module plans.

## References
Plan: `docs/plans/plan-api-capability-module-2026-07-23.md`. Convention doc: `.agents/skills/create-module/SKILL.md` (field notes + `scaffolds` guidance, updated alongside this ADR). Schema: `packages/cli/schemas/registry-item.schema.json`. Issue: #8.
