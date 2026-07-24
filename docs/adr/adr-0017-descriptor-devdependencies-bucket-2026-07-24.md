# 0017 — Module descriptors gain a `devDependencies[]` bucket (peers deferred)

Feature modules need build-time-only npm packages — `@types/*`, tooling — that belong in a consumer's **`devDependencies`**, but the descriptor (`registry-item.json`) had only a single flat `dependencies[]` array, which the applier always merges into the consumer's **`dependencies`** (`applier.ts` → `planDeps`/`writeDeps` in `packages/cli/src/lib/pkg-json.ts`). So descriptors gain a second **`devDependencies[]`** array — same pinned `name@version` form and same resolver + cooldown treatment as `dependencies[]` (ADR 0016) — routed to the consumer's `devDependencies` bucket. `planDeps` **dedups across both buckets**: a package can't land in both, and `dependencies` wins. Decided now while `modules/` is empty so no descriptor needs retrofitting. **`peerDependencies[]` is deferred** until a concrete peer use case exists, because peers conventionally carry *ranges* (the consuming app satisfies them), which would be the sole exception to the exact-pin rule — a semantic not worth baking in with zero usage to validate it. Settled while grilling the dep-update workflow plan.

## Status
accepted — extends [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md) (a feature lists its npm deps in the descriptor; the applier merges them into the target workspace's `package.json`) by splitting that mechanism into runtime vs dev buckets. Overrides the dep-update plan's original "no applier / descriptor-shape change" non-goal — an intentional, scoped applier feature.

## Considered Options
- **Keep one flat `dependencies[]`, let `@types/*` land in `dependencies`** — rejected: type-only packages in runtime `dependencies` is the wrong bucket; harmless in a private app scaffold but it sets a bad convention the registry would propagate everywhere.
- **Add both `devDependencies[]` and `peerDependencies[]` now** — rejected: peers carry an unresolved *exact-vs-range* semantic (two modules each exact-pinning a different peer would be unsatisfiable) and there is no module needing a peer today. YAGNI; defer until a real case forces the decision.
- **Special-case `@types/*` by name heuristic** (route `@types/`-prefixed deps to `devDependencies` automatically) — rejected: implicit magic that misses non-`@types` build tooling (a module shipping its own `tsup`/`vitest`); an explicit author-declared bucket is clearer and complete.

## Consequences
- **Applier change (scoped):** `applier.ts` aggregates a parallel `devDependencies` array into the plan (alongside the existing `dependencies`); `writeDeps`/`planDeps` — which hardcoded `pkg.dependencies` — are parameterized by bucket; `add.ts` and its TUI summary handle both. Tests assert a `devDependencies[]` entry lands in the consumer's `devDependencies`, and that a name present in both descriptor buckets resolves to `dependencies` only.
- **Schema + type:** `registry-item.schema.json` and `RegistryItem` (`packages/cli/src/lib/schema.ts`) gain `devDependencies[]` with the same pinned-`name@version` pattern (bare names rejected at author time by `ajv`).
- **Scanner coverage:** `deps:check`/`deps:update` read and pin both descriptor buckets.
- **Open (deferred):** `peerDependencies[]` shape and whether peers become the one range-carrying exception to exact pins — to be settled when the first module needs a peer.

## References
Plan: `docs/plans/plan-dep-update-workflow-2026-07-24.md`. Extends ADR 0013; builds on [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md) (two-tier modules) and [ADR 0016](adr-0016-in-script-cooldown-gate-for-invisible-manifests-2026-07-24.md) (pin + cooldown policy). Applier: `packages/cli/src/lib/applier.ts`, `packages/cli/src/lib/pkg-json.ts`, `packages/cli/src/commands/add.ts`. Schema: `packages/cli/schemas/registry-item.schema.json`. Issue: #31.
