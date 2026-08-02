# Plan — `saasaloy update` and the AI-assisted merge

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

**Success:** a user whose module has moved runs `saasaloy update <module>`; untouched managed files
are cleanly overwritten; every file they hand-edited produces a merge plan an agent can execute
without guessing; schema changes regenerate migrations; and the lock is rewritten to the new SHA.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Scope: `update` and the merge are one plan** | Drift can't be routed to a merge without an update flow to detect it, and an update flow that clobbers hand-edits is worse than none. Issue #17 already scopes both together. |
| **The CLI emits an artifact and invokes nothing** | `update` writes a structured merge plan and stops. It does **not** shell out to `claude`/`codex`/any agent binary. Tool-agnostic (the spec names three agents and there will be more), testable without a model in the loop, and it never spends the user's tokens uninvited. The user pipes it or opens it in whatever they use. |
| **The artifact is markdown** | Human-readable and agent-readable as one file, with no renderer to maintain. Matches how this repo already writes plans, ADRs, and QA docs. A `--json` variant is deferred until something actually needs to parse it. |
| **Three-way, not two-way** | The merge plan carries *base* (old SHA), *theirs* (new SHA), and *mine* (on disk). A two-way diff would make the agent guess which side of a difference was the user's intent — the exact ambiguity that makes automated merges untrustworthy. Refetching base is what the lock's `resolved` SHA is for. |
| **The clean path is not an AI path** | A file whose hash matches the manifest is overwritten deterministically, with no merge plan and no agent involved. AI is reserved for the genuinely non-deterministic case, per spec §2.13. |
| **`update` re-resolves and rewrites the lock** | Per #17's remote-first addendum: re-resolve the ref to a new SHA via giget and rewrite `source`/`ref`/`resolved`. This is also how "is there an update?" is answered at all. |
| **Migrations belong here** | A module dropping a changed `schema/*.ts` needs Drizzle migrations regenerated. This is listed in #17's scope and is the same concern as the "migration handoff" idea from the DX brainstorm — it lives **here only**, so the two don't get built twice. |
| **Nothing is applied without confirmation** | `update` follows `add`'s existing contract: summarize the plan, support `--dry-run`/`--diff`, and confirm before writing. |

## Approach

### Phase 1 — Detect an update

- `saasaloy update [<module>]` — one module, or every installed module when omitted.
- Re-resolve each module's `ref` to a current commit SHA and compare against `saasaloy-lock.json`'s
  `resolved`. Equal → nothing to do.
- Reuse `RemoteRegistrySource.resolve()` rather than adding a second resolution path.
- **Seam:** the read-only half of this is exactly `saasaloy outdated` from the DX plan. Build the
  comparison as a shared function so `outdated` is a thin caller, not a reimplementation.

### Phase 2 — Classify every managed file three ways

- Fetch the module at the **new** SHA (theirs) and at the **old** SHA from the lock (base).
- For each file the module owns, per `.saasaloy/manifest.json`:
  - base == theirs → module didn't change this file; leave it alone regardless of drift.
  - on-disk hash == manifest hash → **clean**: safe deterministic overwrite.
  - on-disk hash ≠ manifest hash → **drift**: route to the merge plan, never write.
  - tracked file missing from disk → decide (restore, or report) — see Open questions.
- Handle files the new version **removed** or **renamed**, which `add` never has to think about.

### Phase 3 — Apply the clean path

- Overwrite clean files, update their manifest hashes, apply new config patches, add new
  dependencies, and refresh skill files under `.agents/skills/` plus their `.claude/skills` links.
- Rewrite the lock to the new SHA — but only for what actually landed, consistent with the
  bookkeeping-describes-disk invariant in `plan-transactional-add-2026-08-01.md`.
- If nothing drifted, the update is complete here and no merge plan is emitted.

### Phase 4 — Emit the merge plan

The differentiating artifact. A single markdown document containing:

- **Intent** — what changed between the two SHAs in natural language, drawn from the module's own
  descriptor and skill, not invented.
- **Provenance** — module, old SHA → new SHA, and the ref.
- **Per drifted file** — its path, the diff of *base → theirs* (what the module changed) and of
  *base → mine* (what the user changed), rendered with the existing `lineDiff`.
- **Instructions to the agent** — reconcile both sets of changes, preserving the user's intent while
  taking the module's fix; and the explicit note that the user's edits are the ones that must not be
  lost.
- **Verification** — how to check the result, naming the project's own typecheck/build commands.

Write it to a predictable path and print that path. Also support streaming to stdout so it can be
piped straight into an agent.

### Phase 5 — Regenerate migrations

- When the update changed files under the `database` module's schema convention, run
  `drizzle-kit generate` in the generated project.
- Surface the new migration file and require the user to review it — a generated migration against
  existing data is not a thing to apply silently.
- Skip cleanly when `database` isn't installed.

### Phase 6 — Verify

- Per #17: "a clean merge can still break at runtime." After an update, run the generated project's
  typecheck (and optionally build) and report failure loudly.
- Reuse the shape of the existing `deps:verify` script rather than new infrastructure.

## Open questions

Targets for grillkit before this is filed as issues.

- **Config patches have no merge story.** The patch engine is idempotent, so re-applying an unchanged
  patch is a no-op. But if a *new module version changes a patch's value*, there is no manifest
  tracking for patches at all — the old value can't be recognized, let alone three-way merged. Is
  this out of scope, folded into the merge plan as prose, or does it need patch tracking (which
  overlaps #36, reverse patches on remove)?
- **The base SHA may be unreachable.** A branch that was force-pushed, a deleted tag, a repo made
  private — the merge base disappears. Degrade to a two-way diff with a warning, or refuse?
- **`local` sources can't refetch a base.** A module installed via `SAASALOY_REGISTRY_DIR` records
  `resolved: "local"`. Does `update` refuse for those, or two-way them?
- **Where does the artifact go?** A gitignored scratch path, `docs/`, or stdout-only by default?
  Committing it would be noise; a temp file is easy to lose.
- **One plan for all drifted files, or one per file?** One document gives the agent whole-module
  context; separate documents parallelize better across agent sessions.
- **Does `update` handle dependency-graph changes** — a new module version adding a `dependsOn` that
  isn't installed yet?
- **Should the merge plan describe intent from the diff, or from a changelog** the module author
  writes? The latter is far better input for an agent but adds an authoring burden and a descriptor
  field.
- **Migration regeneration needs the user's D1 binding** to be meaningful — is that a precondition
  `update` checks, or does it generate blind?

## Non-goals

- **Invoking an agent.** No subprocess to `claude`/`codex`/anything, no API calls, no model
  dependency in the CLI.
- **Implementing a merge algorithm.** The CLI produces evidence; the agent (or human) resolves. If a
  deterministic three-way text merge is wanted later, that's a separate decision.
- **Applying migrations.** Generate and surface, never run against the user's data.
- **`saasaloy outdated`** — the read-only report lives in the DX plan and calls into Phase 1's
  comparison.
- **Cross-agent skill distribution.** Already solved by ADR 0015: module skills are real files at
  `.agents/skills/<name>/` with a `.claude/skills` symlink, so they are cross-agent today.
  (Whether every tool named in that ADR genuinely reads `.agents/skills/` is a separate research
  question, not a build task.)
- **Reverse config patches (#36) and `remove` (#27).**
