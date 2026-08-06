# Plan — `saasaloy update` and the AI-assisted merge

Grilled: 2026-08-06

> Tracked in [#48](https://github.com/mimukit/saasaloy/issues/48) (single issue — all phases folded),
> under the [#17](https://github.com/mimukit/saasaloy/issues/17) umbrella whose scope this plan
> absorbs and expands.

## Context

Every copy-in tool shares one fatal flaw: **you own the code, so you can never update it.** shadcn
accepts this — components are a starting point you fork and forget. Saasaloy cannot, because its
entire thesis is anti-rot: *"static boilerplates rot within a release cycle, and the thinner the
frozen base, the less there is to rot."* A base that can't be updated is a boilerplate with extra
steps.

The build spec has always known this. §2.9 calls **AI-assisted merge a first-class path**, and
`CONTEXT.md` defines it: for a drifted file, emit *"a structured, agent-consumable merge plan —
natural-language intent + target files + old/new context — handed straight to an agent CLI."* No
other scaffolding tool does this. It is the project's genuine moat.

It is also, today, a paragraph in a glossary. There is no `saasaloy update` command.

The good news is that far more of the machinery exists than the gap suggests:

- **Drift detection works.** `applier.ts` classifies every managed file by comparing its on-disk
  hash to `.saasaloy/manifest.json`: match → `overwrite` (safe), mismatch → `drift`. Drifted and
  conflicting files are **held back and reported**, never clobbered.
- **A diff renderer exists** — `lib/diff.ts`, a dependency-free LCS line diff, written with this
  exact use in mind ("good enough to show a human *or hand to an agent*").
- **Three-way merge is actually possible.** The manifest stores only a hash, so it cannot supply the
  merge base. But `saasaloy-lock.json` records the **exact commit SHA** each module was resolved at
  — so the original version of a drifted file can be refetched from that SHA. *Base* = old SHA's
  file, *theirs* = new SHA's file, *mine* = what's on disk. This is the strongest argument the
  lockfile has for existing, and nothing currently uses it that way.
- **Refetching base needs no new code.** `RemoteRegistrySource` takes a ref and resolves it through
  `/repos/…/commits/<ref>`, which accepts a raw SHA (`registry.ts:251`).

**Success:** a user whose module has moved runs `saasaloy update <module>`; untouched managed files
are cleanly overwritten; every file they hand-edited produces a merge plan an agent can execute
without guessing; the lock is rewritten to the new SHA; and nothing the user wrote is ever lost.

## Design decisions (settled)

The first block predates the grill; the second was settled on 2026-08-06.

| Decision | Resolution |
|----------|-----------|
| **Scope: `update` and the merge are one plan** | Drift can't be routed to a merge without an update flow to detect it, and an update flow that clobbers hand-edits is worse than none. Issue #17 already scopes both together. |
| **The CLI emits an artifact and invokes nothing** | `update` writes a structured merge plan and stops. It does **not** shell out to `claude`/`codex`/any agent binary. Tool-agnostic, testable without a model in the loop, and it never spends the user's tokens uninvited. |
| **The artifact is markdown** | Human-readable and agent-readable as one file, with no renderer to maintain. A `--json` variant is deferred until something needs to parse it. |
| **Three-way, not two-way** | The merge plan carries *base*, *theirs*, and *mine*. A two-way diff would make the agent guess which side of a difference was the user's intent. |
| **The clean path is not an AI path** | A file whose hash matches the manifest is overwritten deterministically, no merge plan, no agent (spec §2.13). |
| **`update` re-resolves and rewrites the lock** | Per #17's remote-first addendum: re-resolve the ref via giget and rewrite `source`/`ref`/`resolved`. |
| **Nothing is applied without confirmation** | `update` follows `add`'s contract: summarize, support `--dry-run`/`--diff`, confirm before writing. |

### Settled in the grill (2026-08-06)

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | **The unit of update** | Module-managed files, plus config-patch **detection** — not tracking. `applyPatch` gains a `matched` signal so a patch whose target already holds a *different* value under the same `matchOn` key is reported into the merge plan as prose. Real patch tracking stays #36's. The base template is out: `init` writes no manifest, so every base file would classify as `conflict`. |
| 2 | **Mapping a manifest entry to its module file** | Each `managed` entry gains `from` — the module-relative source path (`{ module, hash, from: "files/lib/email.ts" }`). Absent `from` falls back to re-deriving the target from the descriptor. Costs a schema-doc edit only: `validateManifest` has no runtime caller, so projects installed before this ship keep working. |
| 3 | **No merge base** | Degrade to two-way (*theirs* vs *mine*) and stamp the document `no merge base — <reason>`. Covers a force-pushed branch, a deleted tag, a repo gone private, and every `local` install (`resolved: "local"`), which never had a base. Refusing leaves the user worse off, since the clean path has already run. `update` warns when `SAASALOY_REGISTRY_DIR` contradicts the lock's remote provenance rather than silently updating from a working copy. |
| 4 | **Where "intent" comes from** | Commit subjects touching `modules/<name>/` between the two SHAs, read through the existing `api()` helper. Zero authoring burden, and this repo's Conventional Commits discipline already reads as a changelog. Degrades to diff-only under the same conditions as #3. An authored `modules/<name>/CHANGELOG.md` can layer on later without breaking anything. |
| 5 | **The new version dropped a file** | Reuse `remover.ts`'s classification: on-disk hash matches the manifest → delete the file and drop its entry; hand-edited → never delete, and the merge plan records "the module dropped this file, your edits are still here". **Implies #48 lands after #27's PR merges.** |
| 6 | **A tracked file is missing from disk** | Restore it — classify as `create`, exactly as `add` does — and list it in the confirmation summary as `restore  <path>` so a deliberate deleter sees it before confirming. Dropping the entry instead would silently un-manage the file, and the next `update` couldn't tell it from a `conflict`. |
| 7 | **Where the merge plan goes** | **stdout by default**, `--out <path>` to write it to disk. Nothing is invented in the user's repo and `saasaloy update email \| claude` works with no flag. |
| 8 | **A changed dependency pin** | Bump only pins the module owns *and* the user hasn't touched: base's descriptor vs theirs says which pins the module moved, and the current `package.json` value matching base's proves it wasn't overridden. Reported as `bump  hono 4.6.3 → 4.7.1`. Anything else keeps `planDeps`'s existing conflict warning. |
| 9 | **stdout hygiene** | The merge plan owns stdout; every clack frame and prompt goes to **stderr**, and a non-TTY stdout implies `--yes`. Implementation risk: clack v1.7's stream override needs verifying per function, and `note`/`log` may need a thin wrapper — fall back to suppressing the TUI entirely on a non-TTY stdout if it can't be redirected cleanly. |
| 10 | **Re-resolving a pinned ref** | Re-resolve the lock's recorded `ref`. A `ref` that is itself a SHA is frozen by definition → `pinned at <sha7> — nothing to update`, and `--ref <branch\|tag>` is the explicit way to move it, rewriting `ref` alongside `resolved` so the unpin is recorded. |
| 11 | **A new `dependsOn`** | Fold the new prerequisite into the update plan — `resolveGraph()` already computes the closure — shown as `install (new prerequisite)` under the same confirmation, pinned to the same SHA, with its own lock entry. |
| 12 | **Migration regeneration** | Print `pnpm --filter @repo/db db:generate` in the summary; never shell out. `update` can't assume pnpm is on PATH or that install has run, and Phase 5 shouldn't be what makes `update` fail on someone's machine. |
| 13 | **`conflict` files** | Route them to the same document, marked *new file collides with yours* and rendered two-way — there is no base, since the module didn't ship the file at the old SHA. Reuses #3's degraded rendering rather than adding a third mode. |
| 14 | **Bare `saasaloy update`** | Every installed module, one summary, one confirmation, one document with a `## <module>` section per module that drifted. A module that fails to resolve is reported and skipped, so one deleted upstream repo can't block every other update. |
| 15 | **Failing halfway** | Inherit `add`'s invariant unchanged — bookkeeping-describes-disk, written in a `finally` for whatever landed, with the lock moving to the new SHA only for modules that fully applied. Real transactionality lands once for both commands in #49. |
| 16 | **Verification** | Name `pnpm typecheck` in the summary and the merge plan's Verification section; don't run it. An `update` commonly precedes `pnpm install`, so a typecheck run there fails for reasons unrelated to the merge, and the agent reading the plan is who should verify after merging. **This rewrites an acceptance criterion on #48** (see below). |

### A premise the grill corrected

The old open questions asked whether *"migration regeneration needs the user's D1 binding to be
meaningful."* It doesn't. `modules/database/files/drizzle.config.ts` is **generation-only** — no
`dbCredentials`, it reads the schema glob and emits SQL offline. The binding is needed only by
`db:migrate:local`/`db:migrate:prod` (`wrangler d1 migrations apply`), which this plan already
declares a non-goal. Decision 12 is what remains of that question.

## Approach

### Phase 1 — Detect an update

- `saasaloy update [<module>] [--ref <ref>] [--out <path>] [--dry-run] [--diff] [--yes]` — one
  module, or every installed module when omitted (decision 14).
- Re-resolve each module's recorded `ref` to a current commit SHA and compare against the lock's
  `resolved`. Equal → nothing to do. A SHA-valued `ref` is frozen; `--ref` is the way off it
  (decision 10).
- Reuse `RemoteRegistrySource.resolve()` rather than adding a second resolution path.
- A module whose source can't be reached is reported and skipped, not fatal (decision 14).
- **Seam:** the read-only half of this is exactly `saasaloy outdated` from the DX plan. Build the
  comparison as a shared function so `outdated` is a thin caller, not a reimplementation.

### Phase 2 — Classify every managed file three ways

- Fetch the module at the **new** SHA (theirs) and at the **old** SHA from the lock (base).
- Map each manifest entry to its module file via the new `from` field, falling back to re-deriving
  the target from the descriptor when it's absent (decision 2).
- For each file the module owns:
  - base == theirs → module didn't change this file; leave it alone regardless of drift.
  - on-disk hash == manifest hash → **clean**: safe deterministic overwrite.
  - on-disk hash ≠ manifest hash → **drift**: route to the merge plan, never write.
  - tracked file missing from disk → **restore**, listed as `restore  <path>` (decision 6).
  - present at base, absent at theirs → **removed**: delete when the hash matches, never when
    drifted, reusing `remover.ts`'s classifier (decision 5).
  - target exists but is untracked → **conflict**: two-way section in the merge plan (decision 13).
- When base is unreachable — or the module is `local` — every drifted file degrades to two-way and
  the document is stamped with the reason (decision 3).

### Phase 3 — Apply the clean path

- Overwrite clean files, update their manifest hashes and `from` fields, restore missing tracked
  files, delete cleanly-removed ones, apply new config patches, and refresh skill files under
  `.agents/skills/` plus their `.claude/skills` links.
- Bump the module's own dependency pins where the user hasn't overridden them (decision 8).
- Install any new `dependsOn` prerequisite as part of the same confirmed plan (decision 11).
- Rewrite the lock to the new SHA — only for what actually landed (decision 15).
- If nothing drifted, the update is complete here and no merge plan is emitted.

### Phase 4 — Emit the merge plan

The differentiating artifact. One markdown document, stdout by default (decision 7), with a
`## <module>` section per module:

- **Intent** — commit subjects touching `modules/<name>/` between the two SHAs (decision 4).
- **Provenance** — module, old SHA → new SHA, the ref, and the degraded stamp when base is missing.
- **Per drifted file** — its path, the diff of *base → theirs* and of *base → mine*, rendered with
  the existing `lineDiff`.
- **Config patches that moved** — file, kind, the value on disk, and the value the new descriptor
  wants, for every patch whose `matchOn` key already matches at a different value (decision 1).
  `modules/database`'s `d1_databases` entry is the live example: it ships `database_id: "local"`,
  which every real user edits, and `upsertWranglerBinding` will never touch it again.
- **Instructions to the agent** — reconcile both sets of changes, preserving the user's intent while
  taking the module's fix; the user's edits are the ones that must not be lost.
- **Verification** — `pnpm typecheck`, named not run (decision 16).

### Phase 5 — Surface migration work

- When the update touched `packages/db/src/schema/**`, print `pnpm --filter @repo/db db:generate` in
  the summary and in the merge plan (decision 12). Skip cleanly when `database` isn't installed.
- Never run it, and never apply a migration.

### Phase 6 — Name the verification

- The summary and the merge plan both name `pnpm typecheck` (the template root's
  `turbo run typecheck`). The CLI does not execute it (decision 16).

## Sequencing

- **After #27's PR (#37).** Decision 5 imports `remover.ts`'s classifier, and decision 2's `from`
  field edits `manifest.schema.json` — a file #37 already touches, including a new
  `manifest.patches` section that decision 1 reads.
- **Alongside #49.** Decision 15 defers transactionality to it; #49's body should gain a line saying
  its solution covers `update` as well as `add`, so the second command isn't forgotten.
- **Before #50's `outdated`.** Phase 1's shared comparison function is what that command calls.

## Non-goals

- **Invoking an agent.** No subprocess to `claude`/`codex`/anything, no API calls, no model
  dependency in the CLI.
- **Implementing a merge algorithm.** The CLI produces evidence; the agent (or human) resolves.
- **Running anything in the user's workspace.** Not `drizzle-kit`, not `typecheck`, not `pnpm` —
  commands are named, never executed (decisions 12 and 16).
- **Applying migrations.** Generate and surface, never run against the user's data.
- **Tracked config patches.** Detection only; reversible patch tracking stays #36.
- **Updating the base template.** `init` writes no manifest, so base files aren't classifiable —
  a prerequisite, not a scope cut to make here.
- **`saasaloy outdated`** — the read-only report lives in the DX plan and calls into Phase 1's
  comparison.
- **Cross-agent skill distribution.** Already solved by ADR 0015.
- **Reverse config patches (#36) and `remove` (#27).**
