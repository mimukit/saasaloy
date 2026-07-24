# 0018 — `database` dependsOn `api` (revises the api/database peer framing)

The `api` plan and [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md) framed `api` and `database` as independent **peers** ("neither needs the other"). But `database` must patch the D1 binding into `apps/api/wrangler.jsonc`, and a module cannot patch a file that isn't there. So `database` declares **`dependsOn: ["api"]`**: `saasaloy add database` resolves and installs `api` first, then patches its `wrangler.jsonc`. Settled while grilling issue #9 (the `database` capability module).

## Status
accepted — supersedes the "peer, neither needs the other" language in the `api` plan (`docs/plans/plan-api-capability-module-2026-07-23.md`) and [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md) for this edge only.

## Considered Options
- **Keep `database` a peer; move the wrangler patch to the first feature that wires a route to the DB** (e.g. `waitlist`) — rejected: the D1 binding is `database`'s structural concern, not a per-feature one; every DB-using feature would re-declare the same patch, and `add database` alone would leave `packages/db` unreachable from the Worker.
- **Keep `database` a peer with a conditional/optional patch that only fires when `api` is installed** — rejected: needs applier support for optional-target patches that does not exist, and silently skipping the binding when `api` is absent is a worse failure than an explicit prerequisite.

## Consequences
- **Direction is asymmetric but consistent:** `database` → `dependsOn` → `api`; features still `dependsOn: ["database"]`, never the reverse. `api` remains a root capability with no `dependsOn`.
- **`add database` pulls `api`** through the normal recursive, topologically-sorted resolution behind the confirmation prompt — no new mechanism.
- The peer framing survives everywhere it isn't contradicted by a cross-workspace patch; this ADR narrows it, it does not discard `api`'s root-capability independence.

## References
Plans: `docs/plans/plan-database-capability-module-2026-07-24.md`, `docs/plans/plan-api-capability-module-2026-07-23.md`. Prior: [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md). Issues: #9, #8.
</content>
