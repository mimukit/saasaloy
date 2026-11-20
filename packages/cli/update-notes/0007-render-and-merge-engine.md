---
title: The CLI renders the project and merges your edits three ways
version: 0.10.0
---

Saasaloy 0.10.0 replaces the engines behind `add`, `remove` and `update` with one engine. It renders the whole project in memory, at the old release and at the new one, and compares each file with the disk. A file you never edited is written. A file you edited is merged three ways, and the lines both sides changed get conflict markers in the file itself. There is no merge plan file and no `--resolved` flag any more. The first `saasaloy update` on a project an older CLI wrote converts its state files, so read this note before you run it.

## What update does

- **Only `update` converts.** A project an older CLI wrote holds a version 1 `.saasaloy/manifest.json` and a `saasaloy-lock.json` with no `requested` list. The first `saasaloy update` converts both in the same run as the update. `add`, `remove` and `testing` refuse such a project with exit 2 and name `saasaloy update`.
- **The conversion finds the base of each file by its hash.** For each tracked file it renders your set of modules at the lock's release, then at each older release down to 0.1.0, and keeps the render whose hash equals the recorded one. The report line `Converting a version 1 project: found the base of N of M tracked files` gives the count. A file with no base found is merged as a file on both sides, with two-way markers.
- **`update` needs a clean tree.** A dirty tree refuses with exit 2. The conversion and the update then land as one diff you can review with `git diff`.
- **The report goes to stdout.** It lists the files with conflict markers, the files written once that changed upstream, the files left deleted, the files kept but no longer tracked, and the update notes. It ends with a line that names `pnpm check`.
- **A conflict does not stop the run.** The run writes the markers, moves the lock and the manifest to 0.10.0, lists each such file under `pendingMerges` in the manifest, and exits 3.
- **Files written once stay yours.** `README.md`, the landing page, `packages/config/src/project.ts`, the blocks and the other files the template marks as yours are written when the path is new, then never changed. The report lists one of them one time when upstream changes it.
- `saasaloy.json` and `packages/env/.env.example` merge like any other file. Your own aliases and values stay, and the keys of a new module arrive.

## What update merges

Every file you edited that the new release changed. The run writes the merge into the file. Where your lines and the upstream lines overlap, the file holds `<<<<<<< mine`, your lines, `||||||| base`, the old release's lines, `=======`, the new lines and `>>>>>>> saasaloy 0.10.0`. A file with no base found has two-way markers, with no `|||||||` part.

## What you do

1. Commit or stash your work, then create a branch for the conversion: `git switch -c saasaloy-0.10.0`. A revert of the conversion commit also throws away the markers you resolved, so keep it on its own branch until `pnpm check` passes.
2. Run `saasaloy update --dry-run` and read the report. Then run `saasaloy update --yes > .saasaloy/update-report.md`.
3. If the run went wrong and you did not commit, run `saasaloy update --abort`. It puts back the version 1 manifest and lock and every file the run changed, byte for byte.
4. Resolve each file under `## Files with conflict markers`: keep your edit, add the upstream change, and delete every marker line. A file with no marker line left is resolved; nothing records it. While a listed file still holds a marker line, `add`, `remove` and `update` refuse with exit 2.
5. For each file under `## Written once, changed upstream`, decide. To take the change, run `saasaloy update --merge <path> --yes`, which merges that one file three ways. To keep your version, do nothing.
6. `saasaloy update <module>` and `saasaloy update base` are gone. One update moves every module of the default registry to the release of the CLI that runs. To stage an update across several releases, run an older CLI first, `pnpm dlx saasaloy@<version> update --yes`, finish that report, then update with the newest CLI.
7. `update --resolved`, `update --from` and `update --out` are gone. Redirect stdout to keep the report.
8. When the work is done, record this note with `saasaloy update --done base/0007-render-and-merge-engine --yes`.

## Verify

```sh
grep -c '"version": 2' .saasaloy/manifest.json
grep -n '"requested"' saasaloy-lock.json
pnpm install
pnpm check
```

The first command prints `1`, the second prints the `requested` line, and `pnpm check` passes. `saasaloy update` then exits `0`.
