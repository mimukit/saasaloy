# 0060: A module file may be a seed, written once and then the project's

A project that builds on a module has had two choices for its own code in a module file: edit the managed file in place, or leave the module alone. PrimeShopr took the first. It edited the managed `payments.tsx`, `__root.tsx` and `admin-payment.ts` to add a search filter, a wrapper around the admin shell and a staff helper, and from then on every update of those files went to the AI merge, because under [ADR 0006](0006-adr-copy-in-updates-manifest-hash-tracking-2026-07-22.md) a changed hash means drift and under [ADR 0034](0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md) `update` never writes a file it did not write. The base template already had an answer for its own files, `seedFiles` in `_saasaloy-base.json`. A module had none.

A `files[]` or `scaffolds[].files[]` entry may now carry `"seed": true`. `add` and backfill write it once and record it in the manifest with its owning module and `"seed": true`. `update` never overwrites or merges a recorded seed, whatever its bytes or the new revision hold, and writes it again only when it is missing from disk, because a managed file imports from it. `remove` deletes a seed whose hash still matches the record, and keeps one the project changed without a prompt, untracks it and warns with its path. The extension point lives at `apps/admin/src/extend/<name>.ts(x)` or `apps/api/src/extend/<name>.ts`: a managed file imports from the seed, so the project changes the seed and the managed file stays clean.

## Status
accepted

## Considered Options
- Reuse the base's `ignoreTargets` path for module seeds: the base excludes a seed from the plan entirely, so a deleted seed never comes back. A module seed is imported by a managed file, and a missing one breaks the build, so it has to be restored.
- A list of seed paths on the descriptor, like `seedFiles`: a second place to name a file the entry already names, and a path that can drift from the entry it describes. A flag on the entry cannot.
- An [owned file](../../CONTEXT.md#owned-file) for modules: an owned file that exists goes to the merge plan on every upstream change, which is the cost this change removes.
- A registration array or a `config` section as the extension point: an edit to an array the module also patches is drift, and a config section holds values, not code.

## Consequences
- The manifest schema gains `seed` on a managed entry. It rejects unknown fields, so a CLI from before this change refuses a manifest that records a seed.
- `remove` runs offline with no descriptor, so it reads the flag from the manifest. A module revision that first marks an existing file `seed` adds the flag at the next `update`, with the file's bytes and hash left as they are.
- `update` restores a missing seed only for a module it plans, which is a module whose lock SHA moved. A seed deleted from a module at its latest SHA stays missing until the next update of that module or a re-add.
- A seed the new revision drops follows the ordinary removal rule: deleted while unchanged, kept and routed to the merge plan once changed.
- Upstream changes to a seed's content never reach a project that already holds it. A module that changes what its seed exports must say so in an [update note](0058-adr-update-notes-ship-beside-their-code-and-ride-the-merge-plan-2026-10-30.md).
