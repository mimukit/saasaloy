---
name: saasaloy-update
description: Runbook for an AI agent that updates this project to a newer Saasaloy CLI and newer module versions with saasaloy update. Use when the owner says "update saasaloy", "upgrade the CLI", "pull the latest modules", "update the base template", "work the merge plan", "clear the update notes", when saasaloy update or saasaloy outdated --check exits 3 or 2, when a merge plan or .saasaloy/merge-plan.md is handed to you, or when an adopted project takes its first update. Covers the CLI upgrade, the preview, --out, the file merges, the update notes and "Notes that may apply", --resolved and --done, --from, the verify commands, and the exit codes.
---

# saasaloy-update

`saasaloy update` re-applies the base template and the installed modules at a newer version. It overwrites a file nobody edited. It does not overwrite a file with local edits: it puts that file in a **merge plan**, a Markdown document for you to work. The merge plan also carries **update notes**: work outside the files Saasaloy writes, such as an import path in this project's own code, a moved block, or a setting.

The update is done when `saasaloy update` exits `0`. Until then, the CLI records each unfinished merge and each unfinished note, and every later run prints them again.

## Exit codes

| Code | Meaning | What you do |
|---|---|---|
| `0` | Nothing is left to do. A preview (`--dry-run`, `--diff`) also exits `0`. | Stop. The update is done. |
| `1` | The run failed. | Read the error. `saasaloy update --abort` restores the newest backup. |
| `2` | The run refused. Nothing was written. | Read the message. It names the cause: a dirty tree, no terminal and no `--yes`, an unknown `--resolved` path or `--done` id, a bad `--from`. |
| `3` | The run applied what it could. Files wait on a merge, or update notes wait to be done. | Work the merge plan, then record the work. |

## Procedure

1. **Upgrade the CLI.** Run `pnpm add -g saasaloy@latest`, then run `saasaloy --version`. A project needs no CLI upgrade to take a newer module, but the base template ships inside the CLI, so a base update needs it.
2. **Preview.** Run `saasaloy update --dry-run`. It writes nothing and exits `0`. Its Plan box gives the count of files to apply, files that need a merge, and update notes. Report that count to the owner.
3. **Apply.** Run `saasaloy update --yes --out .saasaloy/merge-plan.md`. `--yes` skips the `Proceed?` prompt, and a run with no terminal refuses without it. A dirty working tree refuses with exit `2`: commit first, or add `--force`. With `--out`, the merge plan goes to that file and not to stdout.
4. **Work the merge plan.** Read `.saasaloy/merge-plan.md` from the top. Do the update notes and the file merges as [Work the merge plan](#work-the-merge-plan) says.
5. **Record the work.** Record each merged file with `--resolved` and each finished note with `--done`, as [Record the work](#record-the-work) says. The merge plan ends each part with the exact command.
6. **Verify.** Run `pnpm install`. Run each command under the merge plan's `## Verification` heading, and the migration command when it lists one. Then run `pnpm check`. Fix each failure before you go on.
7. **Run the update again.** Run `saasaloy update --yes --out .saasaloy/merge-plan.md`. An exit `3` means work is still pending: go back to step 4 with the new merge plan. Stop when it exits `0`.
8. **Clean up.** Delete `.saasaloy/merge-plan.md`. It is not a project file, so never commit it. Report what changed, each note you cleared, and each step you left for the owner.

## Work the merge plan

The merge plan holds these parts, in this order:

- `## Update notes`: one `###` heading per note, with the note id and its title, such as `### base/0001-brand-css: Move the web tokens from web.css into brand.css`.
- `### Notes that may apply`: notes the CLI cannot place. The project may already hold their result.
- `### When a note is done`: the `--done` command for every note above it.
- One `##` section per module that has files to merge, with the files, the intent of the change, and the `--resolved` command.
- `## Verification`: the commands to run after the work.

### An update note

Each note has four parts. `What update does` says what the run already changed. `What the merge plan gets` names the files, if any, that the run sent to a merge for this note. `What you do` is the work. `Verify` is the check.

1. Read the whole note before you change anything.
2. Do each step under `What you do`, in order. A step that runs `saasaloy update` is already done by the run that wrote this merge plan, so skip it.
3. Run each command under `Verify`, and compare its output with what the note says.
4. When the check passes, the note is done. Record it with `--done`.

A step that only a person can do, such as a value in a deployed environment or a production secret, is not yours. Do the local part of the note, record the note with `--done`, and name the step for the owner in your report.

### A note that may apply

The CLI puts a note under `### Notes that may apply` when it cannot tell whether the project already took it. The module had no earlier version to compare with, or the base was adopted and nothing records the CLI that made it.

1. Read the note's `What you do` and run its `Verify`.
2. If the check already passes, the project holds the result. Do not repeat the steps.
3. If the check fails, do the steps as for any other note, then run `Verify` again.
4. In both cases, record the note with `--done`.

### A file merge

Each file under a module's section changed in the module and in this project. The section gives the old upstream version, the new upstream version, and the intent of the change. Edit the file on disk, which is the project's copy.

1. Keep every local edit. Add the upstream change on top of it.
2. Where both changes touch the same lines and you cannot keep both, keep the local version and say so in your report.
3. Do not edit a file the merge plan does not list. The run already updated every other file.
4. Never edit `.saasaloy/manifest.json` or `saasaloy-lock.json`. The CLI owns both, and the `--resolved` and `--done` flags are the only way to write them.

A section titled "Config patches that moved" is not a file. Reconcile the change by hand. The module's lock stays at the old version, and `--resolved` does not apply to it.

## Record the work

`saasaloy update` cannot see that a merge or a note is finished. You tell it with two repeatable flags, on a normal update run:

```sh
saasaloy update \
  --resolved apps/api/src/index.ts \
  --done api/0001-app-origin \
  --done base/0001-brand-css \
  --yes
```

- `--resolved <path>` records a merged file. Use the path from the file's heading in the merge plan. The CLI records the file's current hash without a check of its content, so record a file only when its merge is finished.
- `--done <id>` records a finished note. Use the id from the note's heading. A note you record leaves the merge plan.
- Record a note in the same run as the merges of its module. A `--done` before that module's `--resolved` can make the note come back once. When in doubt, put every `--resolved` and every `--done` in one run.
- A path that waits on no merge, or an id that is not pending, refuses the run with exit `2`. The message lists what is pending. Nothing is written.
- The record run is an update run, so it needs `--yes` with no terminal, and it refuses a dirty tree. Commit the work first, or add `--force`. Commit only when the owner allows commits in this session.

## An adopted project

A project that has no base record in `saasaloy-lock.json` is adopted on its first update. The run records each base file at its hash on disk, reports "Adopted N base files", and exits `0`. Run `saasaloy update` again for the real update.

The CLI does not know which version made an adopted project, so its base notes print under `### Notes that may apply`. If you know the version, name it on the first applied run after the adoption:

```sh
saasaloy update --from 0.7.0 --yes --out .saasaloy/merge-plan.md
```

The base notes newer than `0.7.0` then print as normal notes. `--from` works only on the first applied update after an adoption. On the adopting run, on a module name other than `base`, and on any later run it refuses with exit `2`, because the lock range is already exact. A preview does not use up that run. If nobody knows the version, leave `--from` out and treat each base note as a note that may apply.

## Unattended run

When no person is at the keyboard, ask nothing. Pass `--yes` to every run that writes. Do every step of the procedure, and stop with a report when one of these happens:

- A run exits `1` or `2` and the message gives no fix you can make inside this project.
- A merge where you cannot keep both changes. Keep the local version, record nothing for that file, and name it.
- `pnpm check` stays red after three tries at a fix.

In each case, leave the work pending. `saasaloy update` exits `3` until the owner finishes it, and `saasaloy outdated` lists what is left.

## Next

Run `saasaloy-testing` to decide which tests a change from the update needs. When an update note adds an environment key, `saasaloy-env` covers the key list and `pnpm env:setup`.
