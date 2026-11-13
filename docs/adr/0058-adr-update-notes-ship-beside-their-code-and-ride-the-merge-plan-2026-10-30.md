# 0058: Update notes ship beside their code and ride the merge plan

The merge plan covers managed files only, and the steps for every other change lived in the changelog, which is sorted by CLI version, written for people, and never reaches the agent in a project; v0.8.0 lost its steps entirely when release-it generated the section above a hand-written one. An update note is now a Markdown file that ships next to the code it describes: `packages/cli/update-notes/` for the base, selected by CLI version range, and `modules/<name>/update-notes/` for a module, selected by comparing that folder at the lock's SHA and the new SHA. `update` renders the notes whose `when` holds into the merge plan, records each as pending in the manifest until `update --done <id>`, and exits `3` while a merge or a note is pending. A breaking commit must add a note or say why it needs none.

## Status
accepted

## Considered Options
- A root `MIGRATION.md`: the agent still finds and filters it by hand, it does not ship in the npm package, and nothing ties a section to the change it describes.
- Longer changelog entries only: the same filtering problem, and module updates follow registry SHAs, not CLI versions.
- Codemods for every step: they break on code the owner edited, which is the case update exists to protect. A mechanical step stays a command in a note.
- Selecting module notes by version or SHA keys in each note: the folder comparison needs no key, because `update` already loads both revisions.

## Consequences
- Exit code `3` widens from "files wait on a merge" to "work is pending"; `EXIT_MERGE_PENDING` becomes `EXIT_WORK_PENDING`. A script that read `3` as a file merge now also sees it for notes.
- The manifest gains `pendingNotes` and the lock's `base` record gains `adoptedAt`. Both schemas reject unknown fields, so a CLI from before this change refuses a project the new CLI wrote.
- An adopted project cannot place base notes older than its adoption: `update --from <version>` selects them exactly on the first update after adoption, and without it they print as "may apply".
- A note is text for the agent. The CLI still runs nothing after an update.
