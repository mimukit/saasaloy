# 0019 — Module patches are applied (not deferred) and serialized as a flat array

The config-patch engine (issue #7, `upsertWranglerBinding` et al.) exists, but the applier still **defers** `patches` — `executePlan` pushes any module with a non-empty `patches` onto `deferredPatches` and never writes. `database` (issue #9) is the first module with a real patch (the D1 binding into `apps/api/wrangler.jsonc`), which forces two settled decisions: (1) **wire the engine into `executePlan`** so `saasaloy add` actually applies patches — read the target file, call `applyPatch`, write the result; `--dry-run`/`--diff` render the engine's diff; re-applying is idempotent; and (2) **serialize the descriptor `patches` field as a flat array** where each op carries its own `file`. Settled while grilling issue #9.

## Status
accepted — extends [ADR 0010](adr-0010-config-patch-magicast-jsonc-parser-2026-07-22.md) (the patch engine) by pinning how patches are expressed in a descriptor and applied by the applier.

## Considered Options
- **`patches` as an object keyed by target path → op array** (`{ "apps/api/wrangler.jsonc": [ … ] }`) — matches build-spec §3.4's keyed examples and the schema's current object type, but rejected in favor of a flat array with an explicit `file` field per op: it iterates directly, keeps each op self-describing, and reads better when one module patches several files.
- **Leave `patches` deferred** (author the descriptor, apply later) — rejected: issue #9's acceptance criterion requires `saasaloy add database` to actually wire the D1 binding, and `database` is the natural first consumer of the already-landed engine.

## Consequences
- **The registry-item schema `patches` retypes object → array** of `{ file, kind, … }` ops (was freeform `additionalProperties: true`), and `modules/api/registry-item.json` flips `"patches": {}` → `"patches": []`.
- **Stale docs to update:** build-spec §3.4's keyed-object patch examples, and the `create-module` skill's "`patches` ⏳ deferred" table row (patches are now applied at `add` time).
- **Patched files are not manifest-tracked as managed copies** — a patch mutates a file another module owns, so it isn't a clean hash-tracked copy. Cleanly undoing a patch on `remove` needs reverse-patching, a known gap owned by #27.
- Every patch op names its own `file` (project-relative), so a single module can patch multiple files without a nested keying convention.

## References
Plan: `docs/plans/plan-database-capability-module-2026-07-24.md`. Prior: [ADR 0010](adr-0010-config-patch-magicast-jsonc-parser-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md). Engine: `packages/cli/src/lib/patch/`. Schema: `packages/cli/schemas/registry-item.schema.json`. Issues: #9, #7, #6, #27.
</content>
