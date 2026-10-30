# Plan: Update notes that `saasaloy update` hands to the agent

Grilled: 2026-10-30

## Context

A project made with an older CLI has two ways to learn what an upgrade asks of it: the merge plan that `saasaloy update` prints, and the changelog. The merge plan covers files only. It says nothing about work that lives outside a managed file, such as an import path in the owner's own code, a moved stylesheet block, a port, a CORS origin, or a lint rule to copy. The changelog covers that work, but it is written for people, sorted by CLI version, and it does not reach the agent in the project.

v0.8.0 showed the gap. The hand-written migration steps for the brand.css split, the email-react port and the `:3002` CORS origin sat in an `## Unreleased` section of `packages/cli/CHANGELOG.md`. release-it generated the 0.8.0 section above it, so the GitHub release body lost those steps, and the file still labels released work as unreleased. The shell breaking item points at "the perl line in the saasaloy-shell skill" and "the oxlint twin-primitive rule from the base template" without the content.

Goal: an agent that holds only the merge plan can take an old project to the current release. It needs no changelog and no search of this repo.

Target: an agent given only the merge plan takes a project scaffolded at v0.7.0 to the current release, and `pnpm check` passes. Phase 7 checks this.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Shape of the solution | Structured notes that ship next to the code they describe, selected by `saasaloy update` and rendered into the merge plan. A single root `MIGRATION.md` and longer changelog entries were rejected: both leave the agent to find, read and filter by itself, and neither ships in the npm package. |
| Term and folder name | The term is **update note**, matching the `update` command and the `saasaloy-update` skill. The folder is `update-notes/`: `packages/cli/update-notes/` for the base, `modules/<name>/update-notes/` for a module. Not `migrations`, which already means database migrations (`MIGRATION_COMMAND` in `lib/updater.ts`). (Q1, asked) |
| Note format | One Markdown file per note, with YAML frontmatter. Markdown because the merge plan is Markdown and both a person and an agent read it with no renderer. |
| Note body | Four fixed sections: "What update does", "What the merge plan gets", "What you do", "Verify". The brand.css text at `packages/cli/CHANGELOG.md:65-105` is the model. Every note means "action needed"; there is no `breaking` field. (Q13, defaulted) |
| Note file name, id and order | `NNNN-<slug>.md`, serial per folder, never reused. The id is derived from the path, `base/NNNN-<slug>` or `<module>/NNNN-<slug>`, so the frontmatter carries no `id`. Base notes come first, by `version` then serial, then module notes in plan order, by serial. (Q5, defaulted) |
| Frontmatter | `title`, `when` (optional), and `version` (base notes only). |
| "Applies when" | Reuse the descriptor `When` type and `whenHolds` from `packages/cli/src/lib/when.ts` (ADR 0054). No second condition language. |
| Steps | Text only. A command goes in a fenced block for the agent to run. The CLI runs nothing, as today. (Q7, defaulted) |
| Base note selection | By CLI version range: newer than `lock.base.cliVersion`, up to and including the running CLI. |
| Module note selection | By folder comparison. A note file in `update-notes/` at the new SHA (theirs) and absent at the old SHA (base) is new in that range. `update` already loads both revisions in `commands/update.ts`. |
| Module with no merge base | A local install, a force-pushed ref or `SAASALOY_REGISTRY_DIR`: every note in the new revision prints, in a "may apply" group. (Q4, defaulted) |
| Adopted base | `update --from <version>` selects base notes from that version. Without the flag, older base notes print in a "may apply" group. Adoption records `adoptedAt` in the lock `base` record, so the CLI knows which notes it cannot place. `--from` works only on the first update after adoption. On any other run it refuses with exit `2` and says the lock range is already exact. (Q3 asked, Q14 defaulted) |
| A change on both sides | A note lives in the folder of the code its steps edit. A change that spans the base and a module gets one note per side, and each names the other's id. (Q9, defaulted) |
| Where the agent sees notes | An "Update notes" section in the merge plan, rendered by `renderMergePlan` in `lib/merge-plan.ts`, ahead of the per-module file sections. The merge plan is emitted when any note applies, even with no file to merge. |
| Pending notes | Each note shown by an applied run is recorded as pending in `.saasaloy/manifest.json` (new `pendingNotes` field in `schemas/manifest.schema.json`). `--dry-run`, `--diff` and a declined prompt record nothing. `saasaloy update --done <id>`, repeatable, clears one. A pending note prints again in every later merge plan until cleared. `doctor` and `outdated` list pending notes, and `outdated --check` exits `2` when any is pending. `saasaloy remove <module>` drops that module's pending notes. (Q2 asked; Q10, Q11, Q15 defaulted) |
| Exit code | `update` exits `3` while any merge or note is pending. `EXIT_MERGE_PENDING` in `lib/exit.ts` becomes `EXIT_WORK_PENDING`, and the outro lists merges and notes separately. (Q12, asked) |
| Release check | A breaking commit (`!` or a `BREAKING CHANGE:` footer) must add at least one file under a `**/update-notes/` folder in the same commit, or carry the footer `Update-Note: none (<reason>)`. `scripts/release-preflight.ts` enforces it over the commits since the last tag and prints each opt-out reason. A local commitlint rule in `commitlint.config.js` rejects the footer when the reason is empty. (Q6, asked) |
| Changelog and release body | The changelog stays generated and short. Each breaking item carries a summary line and a link to its note file at the tag. The full steps live only in the note. (Q8, defaulted) |
| Test runner | vitest for the CLI and the scripts, beside the source, as the repo does today. The upgrade smoke extends `scripts/release-smoke.ts`. |
| Outward actions | Editing the v0.8.0 GitHub release body waits on the owner's approval of the text (Phase 1). No other phase publishes anything. |
| Codemods | Out of this plan. See Non-goals. |

## Approach

Notes are data next to the code. `update` selects them, renders them and tracks them until they are done. A skill teaches the agent the loop. The release check makes a note required for a breaking change. A smoke test and one real agent run prove the chain.

Reuses:
- `ModuleUpdateInput.base` and `.theirs` (`lib/updater.ts`) for the module note range, and `LoadedModule.dir` as the folder to list.
- `compareBase`, `adoptBase` and `lock.base.cliVersion` (`lib/base.ts`, `lib/updater.ts`) and `parseVersion` / `compareVersions` (`lib/semver.ts`) for the base range.
- `whenHolds` (`lib/when.ts`) for "applies when".
- `renderMergePlan` and `fenced` (`lib/merge-plan.ts`) for output.
- `matchResolved` / `markResolved` and the `--resolved` flag parsing in `commands/update.ts` as the model for `--done`.
- `persistLedger` (`lib/ledger.ts`) to write the manifest through the one door `update` already uses.
- `scripts/release-preflight.ts` for the release check and `scripts/release-smoke.ts` for the packed-tarball smoke.
- `packages/cli/templates/base/_agents/skills/` for the new skill, next to `saasaloy-setup` and `saasaloy-env`.

Rejected in one line each: richer changelog only (no filtering by project, not in the package); root `MIGRATION.md` (same, and it drifts from the code); codemods for everything (break on code the owner edited).

### Phase 1: Repair the v0.8.0 notes (built 2026-10-30)
Attended: the owner approves the new GitHub release body before it is published, because editing a published release is an outward action.
- Move the `## Unreleased` content in `packages/cli/CHANGELOG.md` into the 0.8.0 section and delete the `Unreleased` heading.
- Inline the shell item's two pointers: the perl command from `modules/shell/skills/saasaloy-shell/SKILL.md:213` and the oxlint rule from `packages/cli/templates/base/oxlint.config.mjs:182`.
- Rewrite the v0.8.0 GitHub release body from the repaired section.
Done when: `grep -n "Unreleased" packages/cli/CHANGELOG.md` prints nothing, and `gh release view v0.8.0` shows the brand.css steps, the port 3003 item and the `:3002` CORS item.

### Phase 2: Note format, schema and loader
- Write `packages/cli/schemas/update-note.schema.json` for the frontmatter: `title`, `when`, `version`.
- Write `packages/cli/src/lib/update-notes.ts`: parse one note, validate it, derive its id from its path, and list the notes in a folder in serial order. No selection logic yet.
- Create `packages/cli/update-notes/` and add it to `files` in `packages/cli/package.json`.
- Write the v0.8.0 notes as real content:
  - `packages/cli/update-notes/0001-brand-css.md` (`version: 0.8.0`)
  - `modules/email-react/update-notes/0001-preview-port.md`
  - `modules/api/update-notes/0001-app-origin.md` and `modules/auth/update-notes/0001-app-origin.md`, each naming the other
  - `modules/shell/update-notes/0001-admin-kit-move.md` (`when: { installed: [admin] }`), with the import rewrite command and the oxlint rule inline
- Add a test that parses every `update-notes/` file in the repo, so `pnpm test` fails on a bad note.
Done when: `pnpm --filter saasaloy test` passes with the new parse test, and `npm pack --dry-run` in `packages/cli` lists `update-notes/0001-brand-css.md`.

### Phase 3: Select notes and render them in the merge plan
- In `commands/update.ts`, select base notes by version range and module notes by folder comparison, then filter each by `whenHolds` against the project's install set and testing mode.
- Put notes from a module with no merge base, and older base notes on an adopted project, in a "may apply" group.
- Record `adoptedAt` in the lock `base` record during adoption (`schemas/saasaloy-lock.schema.json`, `lib/lock.ts`, `adoptBase`).
- Add `--from <version>` with the refusal rule from the decisions table.
- Carry the selected notes on `UpdatePlan`, and render the "Update notes" section in `renderMergePlan`. Emit the merge plan when any note applies, even with no file to merge.
- Show the note count in the `summarizePlan` box.
Done when: a test project whose lock predates the v0.8.0 notes runs `saasaloy update --dry-run` and stdout holds an "Update notes" section with exactly the notes whose `when` holds for that project, and an adopted project without `--from` shows the base note under "may apply".

### Phase 4: Track pending notes
- Add `pendingNotes` to `schemas/manifest.schema.json` and `lib/manifest.ts`. Record the notes an applied run shows; record nothing on `--dry-run`, `--diff` or a declined prompt.
- Add `update --done <id>`, repeatable. An id that is not pending refuses the run with exit `2` and lists the pending ids.
- Print pending notes in every later merge plan until cleared.
- Rename `EXIT_MERGE_PENDING` to `EXIT_WORK_PENDING` in `lib/exit.ts` and return it while any merge or note is pending. List merges and notes separately in the outro.
- List pending notes in `doctor` and `outdated`, and make `outdated --check` exit `2` when any is pending.
- Make `saasaloy remove <module>` drop that module's pending notes.
Done when: an applied run that shows one note exits `3`; `saasaloy update --done <id>` then clears it; and the next `saasaloy update` exits `0` with "Everything is up to date."

### Phase 5: The `saasaloy-update` skill
- Add `packages/cli/templates/base/_agents/skills/saasaloy-update/SKILL.md`: upgrade the CLI, preview, apply with `--out`, work the file merges and the update notes, record merges with `--resolved` and notes with `--done`, run the verify commands, and run `update` again until it exits `0`. Include `--from` for an adopted project.
- Name the skill in the base template's `AGENTS.md` and in the root `llms.txt`.
Done when: `saasaloy init` in `.dev` writes `.agents/skills/saasaloy-update/SKILL.md` and links it under `.claude/skills/`.

### Phase 6: Release tooling requires a note
- In `scripts/release-preflight.ts`, read the commits since the last tag. Fail on a breaking commit that adds no file under `**/update-notes/` and carries no `Update-Note: none (<reason>)` footer. Print each opt-out reason.
- Add a local commitlint rule in `commitlint.config.js` that rejects an `Update-Note:` footer with an empty reason.
- Make the generated changelog entry for a breaking change carry a link to its note at the tag.
- Document the rule in `CONTRIBUTING.md` next to the release steps.
Done when: `scripts/release-preflight.test.ts` fails a breaking commit with no note and no footer, passes one that adds a note, and passes one with a footer that has a reason.

### Phase 7: Upgrade smoke
- Extend `scripts/release-smoke.ts`: scaffold a project with the previous published CLI, then run `update --dry-run` with the packed tarball against the repo's `modules/`.
- Assert that the merge plan lists the update notes expected for that project.
Done when: the smoke script exits `0` and its log names each expected note id.

### Phase 8: Agent acceptance run
Attended: the owner runs or watches the agent session and judges the result. This phase comes last because it tests the finished build.
- Scaffold a project at v0.7.0 with `admin`, `email-react`, `api` and `auth`. Upgrade the CLI. Run `saasaloy update --yes --out .saasaloy/merge-plan.md`.
- Give an agent only the merge plan and the `saasaloy-update` skill.
Done when: the agent finishes with `saasaloy update` exiting `0` and no pending notes, and `pnpm install && pnpm check` passes in that project. This is the target.

## Migration and rollback

The plan changes two stored files.
- `.saasaloy/manifest.json` gains an optional `pendingNotes` field (Phase 4). An older manifest has no field and reads as "no pending notes". An older CLI that meets the field fails `validateManifest`, so the schema change ships in the same release as the CLI that writes it.
- The lock `base` record gains an optional `adoptedAt` (Phase 3). A project without it is either made by `init` (exact range) or adopted before this change. The second case reads as "adopted at `cliVersion`", which is what `adoptBase` recorded. `schemas/saasaloy-lock.schema.json` also sets `additionalProperties: false`, so an older CLI rejects a lock that carries the field.

An older CLI on a project the new CLI touched is already refused: `update` stops when the lock records a newer CLI than the one running. `add`, `remove` and `doctor` do not have that check, and they hit the schema error instead. That error names the file, which is enough.

Rollback: both fields are optional and additive, so reverting a phase leaves old projects valid. A project that already wrote `pendingNotes` or `adoptedAt` needs the field deleted by hand before it runs a CLI from before that phase.

## Open questions

None. Every decision from the grill is settled.

## Non-goals

- Codemods or any automatic edit outside the existing update engine. A later plan can add them for mechanical steps.
- Update notes for releases before v0.8.0. Older releases keep their changelog text.
- A change to the three-way file classification in `lib/updater.ts`.
- Database migration tooling. Schema changes keep `MIGRATION_COMMAND`.
- A hosted docs page for upgrades. The notes ship in the npm package and the registry.
