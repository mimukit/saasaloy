# Plan — Make `saasaloy add` honest about partial failure

Grilled: 2026-09-02

> Tracked in [#49](https://github.com/mimukit/saasaloy/issues/49) (single issue — all phases folded).
> Was blocked by [#47](https://github.com/mimukit/saasaloy/issues/47) for its test infrastructure; #47 closed 2026-09-02, so this plan is unblocked.
> Updated 2026-09-01: gaps 1 and 2 of the original draft landed independently (#98, #101/f84b9cc); rescoped to what remains, plus the `config.installed` truthfulness finding deferred here from the PR #101 review. Grilled the same day.
> Re-grilled 2026-09-02: settled the failure-injection mechanism, pulled the doctor partial-install check into this plan (its host #47 is delivered), and unpinned the ADR number.

## Context

`saasaloy add` writes files, merges npm dependencies, applies config patches, and creates skill symlinks. If it throws halfway, the project is left in a partial state. The command's failure model is deliberate: `commands/add.ts` wraps `executePlan` in a `try/finally` that persists the manifest, config, and lock regardless of outcome, so **the ledger stays truthful and recovery is re-running `add`**. File writes are idempotent, `planDeps` dedupes, and the manifest's content hashes make a re-run classify already-written files as `unchanged`.

Since the original draft, two of its four gaps were fixed on main:

- **Dependency ordering** — `writeDeps` now runs *after* `executePlan` (landed with #98), so a mid-plan failure leaves the root `package.json` untouched.
- **The lock save** — moved into the same `finally` as the manifest and config (#101, commit f84b9cc), so a mid-plan throw cannot leave changed files without provenance.

What remains:

1. **`config.installed` claims more than disk delivers.** `executePlan` appends every `plan.install` entry to `config.installed` at the end of the run, whether or not that module's files landed. A file held back as `lateDrift` (edited between plan preview and write) keeps its old bytes, yet its module is marked installed — and `add` then skips an installed module at plan time, so `saasaloy add <name>` reports "nothing to do" and the user cannot repair it. Only `update` offers a way out. (Found in the CodeRabbit review of #101, [thread](https://github.com/mimukit/saasaloy/pull/101#discussion_r3896304790), deferred here.) The fix needs a per-module notion of "applied completely" that `ApplyResult` does not yet expose.
2. **The `finally` path can defeat itself.** `upsertLock` runs first inside the `finally` and calls `source.provenance()`, which **throws** if no commit SHA was ever resolved. If that throw fires, the manifest and config saves after it never run, and the new error masks the original one — the exact "bookkeeping describes disk" guarantee the block exists to provide.
3. **Nothing tells the user what to do.** A mid-apply failure surfaces through `cancel(formatFailure(error))` — the recovery instruction, "re-run `saasaloy add <module>`", is never stated.
4. **No test drives a mid-plan failure**, so none of the behaviour above is protected against regression, including the two fixes that already landed.
5. **The model is not written down.** It lives in code comments; `remove` (#27), `update` (#17), and every future applier change depend on it.

**Success:** a mid-plan failure leaves a state accurately described by the manifest, config, and lock; re-running `add` converges to a complete install; the user is told so; and the failure model is a recorded decision rather than an implicit property of statement ordering.

## Design decisions (settled)

The last five rows were settled at the 2026-09-01 grill.

| Decision | Resolution |
|----------|-----------|
| **Failure model** | **Keep "re-run is recovery" and make it correct.** The applier's operations are already idempotent and the manifest already exists to make a re-run classify correctly. Formalize what the code was reaching for rather than replacing it. |
| **Rejected: stage-and-commit** | Writing to a staging directory and atomically moving into place gives true atomicity for *files*, but config patches (`magicast`/`jsonc-parser` edits to existing project files) and root `package.json` merges cannot be staged that way. Partial atomicity at a large cost, with a partial-state case still left to reason about. |
| **Rejected: journal-based undo** | Recording every write and rolling back on failure would create a second undo path that must stay in sync with `remove`'s (#27), and `remove` itself declines to reverse config patches (deferred to #36) — so the journal couldn't fully roll back either. Revisit if #36 lands and makes reversal complete. |
| **Installed-state derives from results, not intent** | `config.installed` and the lock's per-module entries are keyed off what `executePlan` actually applied per module, not off `plan.install`. This is the invariant — *bookkeeping describes disk* — extended from files to module state. |
| **Documented as an ADR** | A hard-to-reverse behavioral contract that `remove`, `update`, and every future module depend on. It belongs in `docs/adr/` next to ADR 0006 (copy-in updates, manifest hash tracking). |
| **The completeness gate is authorization, not bytes** | `lateDrift` blocks installed-ness because the user approved a plan showing *different* bytes. On the re-run the same file classifies as `drift` at plan time, the preview shows it, and informed approval installs the module with the file held for merge. Plan-time `heldBack` therefore never blocks installed-ness, and the state converges in one re-run. The ADR records this asymmetry and its reason. |
| **Dependency repair needs no `--force` change** | A failed dependency is absent from `config.installed` once installed-state derives from results, so a plain re-run of `add <requested>` re-plans it. `--force` keeps meaning "re-apply this one module". |
| **Patch failures never block completeness** | `patchConflicts` and `patchRefusals` stay a warning class ("wire it by hand"). If they blocked installed-ness, a refused patch would make a module permanently uninstallable, since a re-run refuses the same patch again. File writes alone decide "completed". |
| **`doctor` surfaces the partial state; the lock stays a provenance record** | The lock records nothing for an incomplete module. `doctor` (#47) gains a check: a module with manifest-tracked files but no `config.installed` entry is flagged as "partial install — re-run `saasaloy add <name>`". No new lock schema field (ADR 0012 made the lock provenance, not status). |
| **An incomplete non-throwing run exits 0** | A `lateDrift` hold-back is a declined write, not a failure — consistent with `heldBack` merges. The output names the uninstalled module and says a re-run completes it. Only a thrown apply error exits non-zero. |
| **Failure injection is a filesystem fault, not a code hook** (2026-09-02) | The e2e test makes one target's parent directory read-only before the run, so a real write throws mid-plan with no test hook in production code. The `ApplyResult` completeness logic gets in-process unit tests as well. Rejected: an env-var hook inside `executePlan` (ships test code) and in-process-only tests (skip the `finally` path in `add.ts`, which Phase 2 hardens). |
| **The doctor check ships in this plan** (2026-09-02) | #47 delivered `doctor` and its plan is closed, so there is no cross-plan note to leave. The "manifest tracks files, module not in `installed`" check lands in `lib/doctor.ts` here, with a test. |
| **ADR number is next-free at write time** (2026-09-02) | 0029 is taken by the auth ADR; 0030 exists. Use the next free number when the ADR is written instead of a pinned literal. |
| **Scope** | Bookkeeping truthfulness, `finally`-path hardening, the recovery message, an ADR, and tests. **No** new applier capability, no rollback engine, no change to what a fully successful `add` does. |

## Approach

### Phase 1 — Make `ApplyResult` say which modules fully applied

- Extend `ApplyResult` (in `packages/cli/src/lib/applier.ts`) with a per-module completeness view — e.g. `completed: string[]`: modules whose every planned *file write* landed or was already `unchanged`. `lateDrift` excludes a module; plan-time `heldBack`, patch conflicts, and patch refusals do not (settled above).
- In `executePlan`, append to `config.installed` only the completed modules, replacing the unconditional `plan.install` loop.
- In `commands/add.ts`, derive the lock's freshly-installed list the same way (today it filters `plan.install` by `config.installed`, which becomes correct automatically once the step above lands — verify rather than assume).
- Report an incomplete module in the output: name it, say why (`lateDrift`), and say the re-run completes it. The run still exits 0 (settled above).

### Phase 2 — Harden the `finally` path

- Guard `source.provenance()` inside the `finally`: if no SHA was resolved, skip the lock upsert (there is nothing truthful to record) rather than throwing over the manifest and config saves.
- Guard each of the three saves so a failure in one cannot skip the others or mask the original apply error; surface a save failure as a warning alongside the original error.
- Confirm the local-source `provenance()` (registry.ts:218) cannot throw the same way.

### Phase 3 — Tell the user how to recover

- Catch the failure at the command boundary and emit a clear message: what failed, that partial changes were recorded truthfully, and that re-running `saasaloy add <module>` completes the install.
- Use the existing `@clack/prompts` + `picocolors` presentation rather than a raw throw. Keep a non-zero exit code (`exitCodeFor`) for the thrown case only.

### Phase 4 — Record the decision

- Write `docs/adr/adr-NNNN-re-run-is-recovery-for-partial-applies.md` (next free number; 0031 as of 2026-09-02): the model, why stage-and-commit and journal-undo were rejected, the authorization framing of the completeness gate, the patch-failure and exit-code decisions, and the invariant every future applier change must preserve — *bookkeeping describes disk*, for files and for module installed-state alike.
- Cross-reference from ADR 0006 and from `CONTEXT.md`'s `.saasaloy/manifest.json` entry.
- Add the settled check to `packages/cli/src/lib/doctor.ts`: a module with manifest-tracked files but no `config.installed` entry is flagged "partial install — re-run `saasaloy add <name>`", with a test. (Was a cross-plan note to #47; that plan is delivered.)

### Phase 5 — Prove it

- Inject a failure mid-`executePlan` by making one planned target's parent directory read-only before the run (the harness runs unprivileged, so the write throws) and assert: files written before the failure are in the manifest; the lock is consistent with them; the root `package.json` is unmodified; `config.installed` does not claim the module.
- Drive the `lateDrift` case: edit a planned file between plan and apply, assert the module stays uninstalled, the run exits 0 with the re-run note, and the re-run (approving the drift plan) installs the module with the file held for merge.
- Assert **convergence**: re-running the same `add` against the partial state completes, classifies already-written files as `unchanged`, and produces a project identical to one from a clean single run.
- Unit-test the `ApplyResult` completeness derivation in-process with a stubbed write, so the per-module logic is covered without the subprocess harness.
- Uses the #47 harness (`packages/cli/test/support/`: `runCli`, `fixtureModule`, `startGithubFixture`), which landed 2026-09-02. The former blocker is cleared.

## Non-goals

- **True atomicity** — no staging directory, no all-or-nothing guarantee.
- **A rollback or undo engine.** Undo is `saasaloy remove` (#27); reversing config patches is #36.
- **Any change to a fully successful `add`.** The happy path stays byte-identical.
- **The broader test suite** — `plan-applier-test-harness-2026-08-01.md` (#47).
- **Interrupt handling (Ctrl-C mid-apply).** Signal safety is a separate question from exception safety.
