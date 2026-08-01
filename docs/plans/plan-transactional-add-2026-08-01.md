# Plan — Make `saasaloy add` honest about partial failure

> Tracked in [#49](https://github.com/mimukit/saasaloy/issues/49) (single issue — all phases folded).
> Blocked by [#47](https://github.com/mimukit/saasaloy/issues/47) for its test infrastructure.

## Context

`saasaloy add` writes files, merges npm dependencies, applies config patches, and creates skill
symlinks. If it throws halfway, the project is left in a partial state — and today the bookkeeping
that describes that state is subtly wrong.

The code is not careless about this. `commands/add.ts` wraps `executePlan` in a `try/finally` that
persists the manifest and config **regardless of outcome**, with a comment stating the intent
plainly: *"Record whatever actually landed even if a mid-plan write failed — a written file the
manifest doesn't know about would classify as a conflict next run."* That is a deliberate failure
model: **the ledger stays truthful, and recovery is re-running `add`.** It's a defensible choice for
a copy-in tool — file writes are idempotent, `planDeps` dedupes, and the manifest's content hashes
make a re-run classify already-written files as `unchanged`.

The problem is that the model is neither fully implemented nor written down anywhere:

1. **Dependencies are written before any file is.** `writeDeps` mutates the root `package.json`
   *before* `executePlan` runs. A mid-plan failure therefore leaves the project carrying dependencies
   for a module whose code never landed — and if the user gives up rather than re-running, those
   orphan dependencies stay forever.
2. **The lock save escapes the `try/finally`.** `upsertLock` and `saveLock` sit *after* the block, so
   a failed apply leaves files on disk with **no provenance recorded at all** — precisely the
   integrity anchor ADR 0012 introduced the lock to provide. The manifest says the files are managed;
   the lock can't say where they came from.
3. **Nothing tells the user what to do.** A thrown error surfaces as a stack trace or a message. The
   recovery instruction — "re-run `saasaloy add <module>`" — is never stated.
4. **No test drives a mid-plan failure**, so none of the above is protected against regression.

**Success:** a mid-plan failure leaves a state that is accurately described by the manifest, config,
and lock; re-running `add` converges to a complete install; the user is told so; and the failure
model is a recorded decision rather than an implicit property of statement ordering.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Failure model** | **Keep "re-run is recovery" and make it correct.** The applier's operations are already idempotent and the manifest already exists to make a re-run classify correctly. Formalize what the code was reaching for rather than replacing it. |
| **Rejected: stage-and-commit** | Writing to a staging directory and atomically moving into place gives true atomicity for *files*, but config patches (`magicast`/`jsonc-parser` edits to existing project files) and root `package.json` merges cannot be staged that way. It would deliver partial atomicity at a large cost while still leaving a partial-state case to reason about. |
| **Rejected: journal-based undo** | Recording every write and rolling back on failure is the middle-weight option and would share machinery with `saasaloy remove` (#27). Rejected for now because it creates a **second undo path** that must stay in sync with `remove`'s, and because `remove` itself already declines to reverse config patches (deferred to #36) — so the journal couldn't fully roll back either. Revisit if #36 lands and makes reversal complete. |
| **Dependency write moves after the apply** | The risky, many-step work (file writes, patches, symlinks) runs first; dependencies land only if it succeeded. Under the re-run model either order converges, but this order never leaves orphan dependencies for a user who walks away. |
| **Lock save moves inside the `try/finally`** | Provenance is bookkeeping, and all bookkeeping should obey one rule: describe what is actually on disk. |
| **Documented as an ADR** | This is a hard-to-reverse behavioral contract that `remove` (#27), `update` (#17), and every future module depends on. It belongs in `docs/adr/` next to ADR 0006 (copy-in updates, manifest hash tracking), not buried in a code comment. |
| **Scope** | Ordering, bookkeeping truthfulness, the recovery message, an ADR, and tests. **No** new applier capability, no rollback engine, no change to what a successful `add` does. |

## Approach

### Phase 1 — Reorder the apply sequence

- Move the `writeDeps` block in `commands/add.ts` to **after** `executePlan` returns successfully.
- Preserve today's best-effort semantics: a missing root `package.json` warns rather than failing,
  and dependency version conflicts warn rather than blocking.
- Confirm nothing in `executePlan` reads the root `package.json` deps it previously would have found
  already written.

### Phase 2 — Bring the lock inside the bookkeeping guarantee

- Move `upsertLock` + `saveLock` into the same `finally` that persists the manifest and config.
- Handle the case the current placement quietly avoids: `source.provenance()` **throws** if called
  before a SHA was resolved, which is reachable when the failure happened early. Guard it.
- Resolve what the lock should record on a partial apply — see Open questions; the plan's assumption
  is that it records provenance for modules whose files actually landed, derived from the apply
  result rather than from the intended install list.

### Phase 3 — Tell the user how to recover

- Catch the failure at the command boundary and emit a clear message: what failed, that partial
  changes were recorded, and that re-running `saasaloy add <module>` completes the install.
- Use the existing `@clack/prompts` + `picocolors` presentation rather than a raw throw.
- Keep a non-zero exit code.

### Phase 4 — Record the decision

- Write `docs/adr/adr-00NN-re-run-is-recovery-for-partial-applies-2026-08-01.md`: the model, why
  stage-and-commit and journal-undo were rejected, and the invariant every future applier change must
  preserve — *bookkeeping describes disk*.
- Cross-reference from ADR 0006 and from `CONTEXT.md`'s `.saasaloy/manifest.json` entry.

### Phase 5 — Prove it

- Inject a failure mid-`executePlan` (a fixture module whose Nth file write throws) and assert:
  files written before the failure are in the manifest; the lock records provenance consistent with
  those files; the root `package.json` is **unmodified**; and `config.installed` does not claim the
  module is installed.
- Assert **convergence**: re-running the same `add` against that partial state completes, classifies
  the already-written files as `unchanged`, and produces a project identical to one from a clean
  single run.
- **Depends on** `plan-applier-test-harness-2026-08-01.md` for the fixture-module and temp-project
  infrastructure. That plan should land first, or this phase builds a thin version of it.

## Open questions

Targets for grillkit before this is filed as issues.

- **What does the lock record on a partial apply?** Only modules whose files fully landed, every
  module attempted, or a partial marker? "Fully landed" is cleanest but the current `ApplyResult`
  may not carry enough information to distinguish it — that needs checking.
- **Should `config.installed` ever record a partially-applied module?** Today it's appended at the
  very end of `executePlan`, so a partial apply leaves it absent while files exist and are tracked.
  That is the re-run model working as intended — but it means `saasaloy list`/`remove` see a module
  that isn't installed while its files sit on disk. Does `remove` (#27) need to handle that, or is a
  manifest entry without a `config.installed` entry a state `doctor` should flag?
- **Does `--force` interact correctly with a partial state?** It re-applies only the requested
  module, not its dependencies — if the failure occurred *inside* a dependency, `--force` on the
  requested module would not repair it.
- **Should a config patch that fails behave the same as a file write that fails?** Patches are
  currently non-fatal (they degrade to a `patchConflicts` warning), which is a different failure
  class from a throwing write. Is that distinction deliberate?
- **Is there a case for `--no-deps`,** so a user recovering from a failure can re-run the file apply
  without touching `package.json`?

## Non-goals

- **True atomicity** — no staging directory, no all-or-nothing guarantee.
- **A rollback or undo engine.** Undo is `saasaloy remove` (#27); reversing config patches is #36.
- **Any change to a successful `add`.** The happy path must be byte-identical afterwards.
- **The broader test suite** — `plan-applier-test-harness-2026-08-01.md`.
- **Interrupt handling (Ctrl-C mid-apply).** A signal-safety story is a separate question from an
  exception-safety one.
