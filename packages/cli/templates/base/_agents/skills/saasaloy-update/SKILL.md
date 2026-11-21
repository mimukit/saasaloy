---
name: saasaloy-update
description: Runbook for an AI agent that updates this project to a newer Saasaloy CLI with saasaloy update. Use when the owner says "update saasaloy", "upgrade the CLI", "pull the latest modules", "update the base template", "resolve the update conflicts", "clear the update notes", when saasaloy update or saasaloy outdated --check exits 3 or 2, or when a file holds conflict markers after an update. Covers the CLI upgrade, the first run on an older project, the preview, the report, conflict markers, files written once and --merge, a file deleted locally and --restore, the update notes and --done, --abort, an update that skips releases, and the exit codes.
---

# saasaloy-update

`saasaloy update` moves this project to the release of the CLI that runs. Every module of the default registry moves with it, in one run: there is no update of one module. A module from another registry moves to the tip of the ref its lock entry records.

The run renders the project at the old release and at the new release, and compares each file with the disk. It writes a file nobody edited. It merges a file with local edits three ways, and it writes conflict markers where both sides changed the same lines. It does not merge a file the project rewrites, such as `README.md` or a seed page: such a file is **written once**. The run prints a **report** on stdout: the files with conflict markers, the files written once that upstream changed, the files left deleted, and the **update notes**, the work outside the files Saasaloy writes.

The update is done when `saasaloy update` exits `0`.

## Exit codes

| Code | Meaning | What you do |
|---|---|---|
| `0` | Nothing is left to do. A preview (`--dry-run`, `--diff`) also exits `0`. | Stop. The update is done. |
| `1` | The run failed. | Read the error. `saasaloy update --abort` restores the files of the last run. When the error gives no fix you can make inside this project, follow the `saasaloy-report` skill. Run `saasaloy skill saasaloy-report` to read it. |
| `2` | The run refused. Nothing was written. | Read the message. It names the cause: a dirty tree, no terminal and no `--yes`, conflict markers from an earlier run, an unfinished run, a CLI older than the project, an unknown `--done` id, or a bad `--merge` or `--restore` path. |
| `3` | The run applied the update and left work. Files hold conflict markers, or update notes wait to be done. | Work the report, then run the update again. |

## Procedure

1. **Upgrade the CLI.** Run `pnpm add -g saasaloy@latest`, then run `saasaloy --version`. Then run `saasaloy skill saasaloy-update`. It prints this runbook as the running CLI ships it. When that text differs from this file, follow the printed text from here on.
2. **Preview.** Run `saasaloy update --dry-run`. It writes nothing and exits `0`. Its Plan box lists each file the run changes, and stdout holds the report the run would print. Report the count of conflicts and notes to the owner.
3. **Apply.** Run `saasaloy update --yes > .saasaloy/update-report.md`. `--yes` skips the `Proceed?` prompt, and a run with no terminal refuses without it. A dirty working tree refuses with exit `2`: commit first, or add `--force`.
4. **Work the report.** Read `.saasaloy/update-report.md` from the top. Do each part as [Work the report](#work-the-report) says.
5. **Verify.** Run `pnpm install`, then `pnpm check`. Fix each failure before you go on.
6. **Run the update again.** Commit the work, then run `saasaloy update --yes > .saasaloy/update-report.md`, with a `--done <id>` for each finished note. An exit `3` means work is still pending: go back to step 4. Stop when it exits `0`.
7. **Clean up.** Delete `.saasaloy/update-report.md`. It is not a project file, so never commit it. Report what changed, each note you cleared, and each step you left for the owner.

## Work the report

The report holds these parts, in this order. A part with nothing in it is left out.

- `## Files with conflict markers`: each file the run merged with a conflict.
- `## Written once, changed upstream`: each file the project owns that changed upstream.
- `## Left deleted`: each tracked file the project deleted that changed upstream.
- `## Kept, no longer tracked`: each file upstream removed that the project changed.
- `## Warnings`: each problem the run found that is not a conflict, such as a skill link it could not make or a dependency version conflict.
- `## Update notes`, with `### Notes that may apply` and `### When a note is done`.
- A last line that names `pnpm check`.

### Conflict markers

The run wrote the merge into the file on disk. Each conflict sits between marker lines: `<<<<<<< mine`, then the project's lines, then `||||||| base` and the lines of the old release, then `=======`, then the new release's lines and `>>>>>>> saasaloy <version>`. A file the run found on both sides with no old release has two-way markers, with no `|||||||` part.

1. Keep every local edit. Add the upstream change on top of it.
2. Where you cannot keep both, keep the local version and say so in your report.
3. Delete every marker line. A file with no marker line left is resolved: the next run sees that by itself, and nothing records it.
4. Do not edit a file the report does not list. The run already wrote every other file.
5. Never edit `.saasaloy/manifest.json` or `saasaloy-lock.json`. The CLI owns both.

`add`, `remove` and `update` refuse with exit `2` while a file the last run listed still holds a marker line.

### A file written once

A file written once is the project's after the first write. The run does not change it, and the report lists it one time for each upstream change. Read the line, then choose:

- To take the upstream change, run `saasaloy update --merge <path> --yes`. The run merges that one file three ways, against the release that wrote it. When the CLI cannot load that release, the merge writes two-way markers. Resolve any markers as [Conflict markers](#conflict-markers) says.
- To keep the project's version, do nothing. The report does not list the file again until upstream changes it again.

`saasaloy outdated` lists each file written once that upstream changed, on every run.

### A file deleted locally

A file under `## Left deleted` is a file Saasaloy tracks and the project deleted. The run wrote nothing for it. Ask whether the project still wants the file. When the owner is not there, keep it deleted and name it in your report.

- To keep it deleted, do nothing.
- To bring it back, run `saasaloy update --restore <path> --yes`. `--restore` writes the current upstream file. A path that is not a tracked file the project deleted refuses with exit `2`.

### An update note

Each note has four parts. `What update does` says what the run already changed. `What update merges` names the files the run merged for this note, so you know where to look for markers. `What you do` is the work. `Verify` is the check.

1. Read the whole note before you change anything.
2. Do each step under `What you do`, in order. A step that runs `saasaloy update` is already done by the run that wrote this report, so skip it.
3. Run each command under `Verify`, and compare its output with what the note says.
4. When the check passes, the note is done. Record it with `--done <id>` on the next run.

A note under `### Notes that may apply` is a note the CLI cannot place. Run its `Verify` first. If the check passes, the project already holds the result: record the note with `--done`. If it fails, do the steps as for any other note.

A step that only a person can do, such as a value in a deployed environment or a production secret, is not yours. Do the local part, record the note with `--done`, and name the step for the owner in your report.

## The first run on an older project

A project that an older CLI (0.9.0 or earlier) wrote holds a version 1 manifest. Only `saasaloy update` converts it. `saasaloy add` and `saasaloy remove` refuse such a project with exit `2` and name `saasaloy update`.

1. Commit all work. The conversion needs a clean tree.
2. Make a branch for the update, such as `git switch -c saasaloy-update`. Convert on that branch, not on `main`.
3. Run the update as the [procedure](#procedure) says. The run converts the manifest and the lock, then updates the project, in one run.
4. Review the result as one diff with `git diff`. Work the report as for any other update.
5. When the result is wrong, run `saasaloy update --abort`. It restores the version 1 manifest, the version 1 lock and every file the run changed.

The conversion finds the old release of each file from its recorded hash. A file with no match gets two-way markers in the report, because the run has no base for it. A manifest that records no hash refuses with exit `2` and names an older CLI: run `pnpm dlx saasaloy@0.9.0 update --yes` first, then the update with the newest CLI.

## Undo

`saasaloy update --abort` restores every file the last run changed, from the copy the run made before it wrote. Use it when a run went wrong and the work is not committed. Git cannot undo a `--force` run over uncommitted work, so commit before you use `--force`.

A run that stopped before it finished leaves `.saasaloy/journal.json`. Every later `add`, `remove` and `update` refuses with exit `2` until `--abort` restores the files.

## An update that skips releases

One update moves the project across every release between the lock and the running CLI. When a note says to stage the update, run an older CLI first: `pnpm dlx saasaloy@<version> update --yes`. Work that report to exit `0`, then run the update with the newest CLI.

A CLI older than the project refuses with exit `2`. Upgrade the CLI to the version the message names.

## Unattended run

When no person is at the keyboard, ask nothing. Pass `--yes` to every run that writes. Do every step of the procedure, and stop with a report when one of these happens:

- A run exits `1` or `2`, and the message gives no fix you can make inside this project.
- A conflict where you cannot keep both changes. Keep the local version, leave no marker line, and name the file.
- `pnpm check` stays red after three tries at a fix.

## Next

Run `saasaloy-testing` to decide which tests a change from the update needs. When an update note adds an environment key, `saasaloy-env` covers the key list and `pnpm env:setup`.
