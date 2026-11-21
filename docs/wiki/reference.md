# Reference

Everything the CLI declares: its commands, their flags, the coordinate grammar, the
environment variables it reads, and the files it writes. Nothing here is aspirational — if
a flag isn't listed, it doesn't exist.

## Commands

```text
saasaloy <command> [options]
```

The command list, with each command's usage line and flags, is generated from the CLI source on [the CLI commands page](generated/cli.md). The sections below hold what a command does and what it prints.

`saasaloy help`, `saasaloy --help` and `saasaloy -h` all print the command list and exit
0. Bare `saasaloy` opens a picker over the same list on a terminal, and prints the list
and exits 0 when there is no terminal to answer it — a pipe, or CI.
`saasaloy --version`, `-v` and `version` print the installed version.
Every command also answers its own `--help` with its usage and flags.

`add`, `env`, `testing`, `outdated`, `update` and `remove` are run from inside a project: they find the project root by
walking up from your working directory looking for `saasaloy.json`. `list` marks what the
current project has installed when it is run inside one, and works anywhere.

`new` is the opposite. It refuses to run inside a generated project, because it authors a module for a registry repo. `doctor` reads the path you give it and picks project mode or registry mode by whether that path carries a `saasaloy.json`. `skill` works anywhere, and inside a project it renders with that project's name.

### Exit codes

The codes are generated from `packages/cli/src/lib/exit.ts` and listed with their meaning on [the CLI commands page](generated/cli.md#exit-codes). `0` is success, `1` is a failure, `2` is a refusal by design, and `3` means the run applied its work and left some pending: a file with conflict markers from `add`, `remove`, `update` or `testing`, or an update note not yet marked done.

A wrapper script reads `2` as "the input is wrong, retrying will not help" and `1` as
"transient, a retry may work".

### JSON output

`list`, `doctor`, `outdated`, `env --check`, `add --dry-run` and `skill` take `--json`. It prints one JSON document to stdout, and nothing else goes there: the clack TUI and every warning move to stderr. The one exception is `--help`: help is not a run, so `saasaloy doctor --json --help` prints plain help on stdout and exits 0. Every document starts with a `schemaVersion`. A breaking change to a command's document shape bumps that command's number, and a new field does not. `list`, `doctor`, `outdated`, `env --check` and `skill` print `"schemaVersion": 1`. `add --dry-run` prints `"schemaVersion": 3`: version 2 made `requested` a list of names, and version 3 came with the render engine, when each file's `action` became a result kind, each file gained its `class`, and `patches` went. Its error document carries 3 as well.

`--json` never prompts. It changes no exit code: `doctor` with findings, `outdated --check` with drift or a pending update note and `env --check` with unset variables still exit 2, and they still print their report. A run that stops before its report, such as an unknown flag, no project, or a refusal, prints an error document instead, so stdout parses on every exit:

```json
{ "schemaVersion": 1, "error": { "exitCode": 2, "message": "Unknown argument(s): --nope — usage: …" } }
```

`--json` on `add` without `--dry-run`, beside `--diff`, or on `env` without `--check` exits 2 with that error document. Each command's section below lists its document's fields.

## `saasaloy init`

```text
saasaloy init [<name>] [--force] [--yes | --no-install] [--no-git] [--testing=<off|tests-after|tdd>]
```

`<name>` may be a bare name (`my-app`), `.` for the current directory, or a path
(`./apps/my-app`). The project name is the last segment of the resolved path and must
match `^[a-z0-9][a-z0-9-]*$`. Omit it and the CLI prompts.

| Flag | Effect |
|---|---|
| `--force` | scaffold into a directory that already has files in it. Without it, a non-empty target cancels with exit 2. A `.git` directory alone does not count as non-empty. |
| `--yes`, `-y` | answer the "Install dependencies now?" prompt with yes: run `pnpm install` with no prompt. Passing it with `--no-install` exits 2. |
| `--no-install` | skip the "Install dependencies now?" prompt and never run `pnpm install`. |
| `--no-git` | do not run `git init` in the new project, and make no commit. |
| `--testing=<mode>` | the project's [testing mode](#saasaloy-testing): `off`, `tests-after` or `tdd`. An unknown value exits 2 before anything is written. |

`init` always writes `testing.mode` into `saasaloy.json`, and fills the testing block in the root `AGENTS.md` for that mode. With no `--testing` flag, an attended run (a terminal on stdin and stdout) asks once, and a run with no terminal writes `off`. `off` is the opt-in default, not a guess.

`init` runs `git init` in the scaffolded project before the install, because husky's
`prepare` script installs its hooks during `pnpm install` and needs a repository to install
them into. It is skipped when the target already sits inside a working tree that tracks it, so
`saasaloy init .` in an existing repo does not nest a second one. A target the outer repository ignores gets its own repository. A failure warns rather
than aborting the scaffold.

After a successful install in a repository it created, `init` runs `pnpm env:setup`, which writes each service's `.env` from the local defaults in `packages/env/.env.example`. So `pnpm check` and `pnpm dev` pass with no env step. A failure warns and leaves the exit code at 0.

Last, in a repository it created, `init` commits the scaffold on `main` with the subject `chore(repo): initial commit`. The commit runs with `--no-verify`: the hooks would run lint-staged over every scaffold file, and `pnpm check` is the gate for those files. With no git identity (`user.name` and `user.email`), `init` warns and makes no commit. In a repository that existed before, and under `--no-git`, it makes none.

Like every other command, `init` rejects a flag it does not know with exit 2.

With no terminal, `init` refuses with exit 2 before it writes a file: with no `<name>` it names `<name>`, and with neither `--yes` nor `--no-install` it names both. A `pnpm install` that fails prints pnpm's output and exits 1. The scaffold stays on disk, so run `pnpm install` in it once the cause is fixed.

## `saasaloy add`

```text
saasaloy add [<module>...|<owner/repo[@ref]/module>...|<owner/repo>] [--with <module>]... [--dry-run [--json]] [--diff] [--yes] [--force]
saasaloy add --abort
```

A bare module name reads the default registry at the tag `v<version>` of the CLI that runs, so the CLI and its modules come from one release ([ADR 0062](../adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md)). The lock records that tag as `ref` and its commit as `resolved`. The default registry moves as one release, so `saasaloy add <module>@main` refuses with exit 2 and names `saasaloy update`; a third-party `owner/repo@ref/module` keeps its own ref. `add` also refuses when the lock records another release than the running CLI: run `saasaloy update` first. A CLI whose tag the registry lacks, such as a development build or a version bumped ahead of its release, exits 2 and names `SAASALOY_REGISTRY_DIR` as the way out; it never falls back to `main` by itself.

`add` puts the named modules in the lock's `requested` list, [renders](#how-a-run-writes) the project with them, and applies the difference in one run. A project an older CLI wrote (a version 1 manifest) is refused with exit 2: run `saasaloy update` first, which converts it.

With no module named, `add` shows a multi-select over the source, listing only modules this project has not installed. With no terminal it exits 2 and prints the usage line. Unknown flags are rejected before any work happens, with exit 2.

Name several modules to add them in one run: `saasaloy add admin teams --with database-postgres --yes`. `add` resolves every name into one graph, prints one plan, asks once, and runs every refusal (`requires.saasaloy`, `requiresOneOf`, `conflictsWith` and file collisions) on the whole set before it writes the first file. Prerequisites install first, and argv order decides between modules that do not depend on each other. A repeated name counts once. Every name reads from one registry: two coordinates that differ in owner, repo or ref exit 2 and name the two, and an `owner/repo` with no module cannot be mixed with names. When the registry has none of several names, one message lists them all. A named module that is already installed is skipped with a note, and the rest install. A message about a prerequisite says which named module pulled it in, `lefty (required by needs-lefty)`.

| Flag | Effect |
|---|---|
| `--dry-run` | print the plan and stop. Nothing is written. |
| `--diff` | print the plan plus a per-file diff, and stop. Nothing is written. |
| `--yes`, `-y` | skip the `Proceed?` confirmation. |
| `--force` | merge or delete a file even with uncommitted changes, overwrite an edited `generated` file, and write a named module's tracked files that the project deleted again. |
| `--abort` | put back the files the last `add`, `remove`, `update` or `testing` run changed, and stop. |
| `--with <module>` | answer a `requiresOneOf` choice with this module, so the run needs no picker: `saasaloy add waitlist --with database-postgres --yes`. Repeatable, and `--with=<module>` works too. Each one joins the plan only when it is an option of a requirement still unmet; one that answers no requirement exits 2 before anything is written. |
| `--json` | with `--dry-run`, print the plan as one JSON document on stdout (see [JSON output](#json-output)). It never opens the picker or the driver prompt: name the module, and pass `--with` for an unmet `requiresOneOf`. |

The `--dry-run --json` document carries `requested` (the named modules in argv order, a list also for one name), `prerequisites`, `install` (the install order), `alreadyInstalled`, `files` (each with `target`, `action`, `class` and `module`; `action` is the result kind, such as `new`, `updated`, `clean`, `conflict` or `deleted`), `onceChanged`, `pendingMerges` and `warnings`. Every file the text plan shows is in it. A module whose graph is already installed prints the same keys with empty lists.

A module whose graph is fully installed prints `Nothing to do` and exits 0.

A successful `add` ends with a next-steps box: the `/saasaloy-<module>` skill it linked,
which holds the module's own procedure, and the environment variables it needs, re-printed
after the confirmation rather than before it. It also writes `packages/env/.env.example`
from the installed descriptors' `envVars` maps, the key list every service's `.env` is written from.

The next-steps box names `saasaloy env`, with the line `Run saasaloy env — it prompts for each unset one and writes it to packages/env/.env.`, then `pnpm env:setup` to write each service's own `.env` from that file. The example file stays as the checked-in record of what each variable means.

A module descriptor may declare `conflictsWith`, naming modules it refuses to sit beside.
`add` checks that list before it writes anything and exits 2 with a message naming both
modules and the `saasaloy remove` that clears the conflict. The check reads both the
incoming descriptors and `saasaloy-lock.json`, so it fires whichever module went in first,
and `--force` does not bypass it. `add` never uninstalls anything to resolve a conflict. A
module installed before its lock entry existed can't be checked this way; `add` says so and
proceeds.

Every file `add` writes is recorded in `.saasaloy/manifest.json` under the module that rendered it. A module may write over a file owned by a module it declares in `dependsOn`, which is how `database-postgres` puts its own `packages/db/tsconfig.json` over the one `database` scaffolds, and over nothing else. Two modules in one set that both write a path with no `dependsOn` edge either way are refused before anything is written, with exit 2 and every contested path named. Swapping `api-keys-user` for `api-keys-organization` is `saasaloy remove api-keys-user` then `saasaloy add api-keys-organization`.

A descriptor may also declare `requiresOneOf`, naming modules exactly one of which has to
be present. `add` counts an option as present when it is already installed or arrives in
the same resolved graph. When none is, an interactive run offers the list as a picker and
adds what you choose to the plan; `--yes` or a run with no terminal exits 2 and names the
options instead of choosing for you, with the flag that answers it: "Re-run as `saasaloy add waitlist --with database-postgres`, or pick another from that list." `--with` picks on the command line. `database` declares it, so the core can never land on
a project with no driver behind its `@repo/db/client` export.

`api-keys-user` and `api-keys-organization` use `requiresOneOf` on the `api-keys` core and
`conflictsWith` on each other. They are **driver modules**, two implementations that write the
same paths, and a project holds exactly one: `requiresOneOf` on the core stops it at zero,
`conflictsWith` on each driver stops it at two
([ADR 0055](../adr/0055-adr-an-api-key-owner-is-a-driver-chosen-at-add-time-2026-10-22.md)).
`database` names one driver, `database-postgres`, in `requiresOneOf`. The `database` core
carries the tables, the schema barrel and `db:generate`; the driver carries the client and the
migrate commands ([ADR 0026](../adr/0026-adr-database-driver-split-2026-08-28.md)). Postgres is
the only SQL dialect, so every module ships one schema file
([ADR 0065](../adr/0065-adr-postgres-is-the-only-sql-dialect-2026-11-20.md)).

An entry in `files[]`, a scaffold's `files[]` or `patches` may also declare `when`, which decides whether it ships at all. `{ "testing": true }` ships it only while the project's testing mode is `tests-after` or `tdd`, and every test file a module ships carries it. `{ "installed": ["e2e"] }` ships it only while every named module is installed, which is how a feature module ships its Playwright journey spec beside `e2e`. Both keys together mean both. A target whose every entry `when` drops is skipped rather than refused. The render writes every entry whose `when` holds on each run, so an entry whose condition turns true later arrives with the next `add`, `update` or `testing` run. When a condition turns false, an unedited file is deleted and an edited one stays, untracked; `testing off` is the exception and deletes nothing.

Two more descriptor fields belong to testing. `untested` on a file entry is a one-line reason the file ships with no test beside it, and the test guards print it instead of failing. `enablesTesting: true` marks a module whose whole point is tests: adding it to a project whose mode is `off` sets `tests-after`, prints one line saying so, and the same run writes the gated test files. It leaves `tdd` alone, and `remove` never changes the mode ([ADR 0054](../adr/0054-adr-when-gates-optional-entries-and-feature-modules-own-their-journeys-2026-10-23.md)).

A file entry in `files[]` or a scaffold's `files[]` may declare `"seed": true`, which makes it a [`once` file](#file-classes): written when the path is new, then the project's. `update` never overwrites or merges it unless `update --merge <path>` asks. A deleted one stays deleted until `update --restore <path>` or `add <module> --force`. `remove` deletes it while its hash still matches and keeps it, untracked, with one report line, once the project changed it. A module uses one for an extension point a merged file imports, so a project changes the seed and the merged file stays clean ([ADR 0060](../adr/0060-adr-a-module-file-may-be-a-seed-written-once-2026-11-04.md), [ADR 0067](../adr/0067-adr-a-rendered-file-is-generated-merged-or-written-once-2026-11-20.md)).

See [Add a module](how-to/add-a-module.md) for the workflow.

## `saasaloy env`

```text
saasaloy env [--check [--json]] [--from-file <path>]... [--set KEY=VALUE]...
```

Fill in the variables the installed modules declare. `env` reads each installed module's descriptor at the SHA the lock resolved and flattens its `envVars` map into declarations. A variable two modules declare is asked once. A module with no lock entry, a module installed from a local checkout, or a descriptor that cannot be read is warned about and skipped, and the run continues with the modules it did read.

Every value lands in one gitignored file, `packages/env/.env`. `pnpm env:setup` then writes each service's own `.env` from it, and the descriptor's `envServices` decides which service reads which key. `env` also warns when `packages/env/.env.example` does not list a declared key, because no service would read it.

| Flag | Effect |
|---|---|
| `--check` | report missing variables and exit 2, without prompting and without writing. Exits 0 once every declared variable is set. |
| `--from-file <path>` | write the `KEY=VALUE` lines of a dotenv file, with no prompt. Comments, blank lines and empty values are skipped. The path is read relative to the working directory. Repeatable. |
| `--set KEY=VALUE` | write one value, with no prompt. Repeatable, and a later `--set` beats a `--from-file` value for the same key. |
| `--json` | with `--check`, print the report as one JSON document on stdout (see [JSON output](#json-output)): `variables` (each with `name`, `module`, `description` and `set`), `missing`, `notInKeyList` (declared keys `packages/env/.env.example` does not list), `skipped` (the modules it could not read, as warnings) and `productionSecrets` (the lines of the Production secrets note). Without `--check` it exits 2. |

Use `--from-file` for a secret. A `--set` value stays in your shell history.

With no flag, `env` fills blanks only. It prompts for every declared variable that has no value (a `KEY=` placeholder counts as no value) and never rewrites a value already in the file, whatever the descriptor's `devVars` suggests. The prompt's message is the descriptor's own wording, and its `devVars` entry becomes the default. A filled placeholder keeps its line, a new key goes on the end, and every other line stays byte for byte.

With `--set` or `--from-file`, `env` opens no prompt, with or without a terminal. A value passed this way replaces the value the file holds for that key, because you chose it. Each key is checked first against the installed modules' declarations and the keys `packages/env/.env.example` lists, which holds the base's own keys such as `PUBLIC_SITE_URL`. One key in neither refuses the whole run with exit 2, names every unknown key, and writes nothing. Any declared key still unset afterwards is listed as a warning, and the run exits 0. `--check` with either flag exits 2, because one promises to write nothing and the other writes.

Before it writes or asks for a single value, `env` proves `packages/env/.env` is gitignored. A tracked file, or a project that is not a git repository, is refused with exit 2 and the message "packages/env/.env isn't gitignored — refusing to write a secret into a tracked file. Add it to .gitignore (the base template already does) and run again."

`env` never writes to a live account. It prints the production commands under a **Production secrets** note, one `wrangler secret put <NAME>` per non-`PUBLIC_` variable, to run from the Worker's workspace, closing with "Printed, never run — copy these when you deploy." The note prints on every run, `--check` included.

With no terminal and no flag, `env` takes the `--check` path, so it never waits on a prompt in CI. The message reads "N variables still unset — run `saasaloy env` in a terminal, or pass `--from-file <path>`, to fill them in."

Exit codes: 0 when every declared variable is set, when nothing declares one ("No module declares an environment variable."), when a prompt run filled the blanks in ("Environment filled in."), or when `--set`/`--from-file` wrote its values. 1 when you cancel a prompt ("Cancelled — nothing written.") or a write fails. 2 when the file is not gitignored, when a passed key is not declared, for `--json` without `--check`, when a `--from-file` path cannot be read, for a bad flag, and when variables are still unset under `--check` or with no terminal.

## `saasaloy testing`

```text
saasaloy testing [off|tests-after|tdd]
saasaloy testing --abort
```

With no argument, prints the project's mode as a bare word on stdout (`off`), so a script can read it. A project whose `saasaloy.json` has no `testing` key reads as `off`.

With a mode, it renders the project for that mode and applies the difference, like `add`: `saasaloy.json` records the mode under `testing.mode`, and the testing block in the root `AGENTS.md`, the text between `<!-- saasaloy:testing -->` and `<!-- /saasaloy:testing -->`, changes with it. `AGENTS.md` merges three ways, so your own text outside the markers stays.

Turning a mode on (`tests-after` or `tdd`) writes every entry of the installed modules whose `when` is now true. `off` deletes nothing: each gated test file stays on disk, and the manifest stops tracking it, so it is yours. A module with `enablesTesting` keeps the mode on, and `testing off` refuses while it is installed. The rules of `add` hold: the lock's release must be the running CLI's, and the run refuses when it must merge a file with uncommitted changes.

The `saasaloy-testing` skill, which every project ships in `.agents/skills/`, tells an agent what each mode asks and which test each kind of change needs ([ADR 0053](../adr/0053-adr-one-testing-mode-in-saasaloy-json-and-a-marked-agents-md-block-2026-10-23.md)).

Exit codes: 0 when the mode was printed or saved, 3 when a merge left conflict markers, 2 for an unknown mode, an extra argument, or a refusal.

## `saasaloy outdated`

```text
saasaloy outdated [--check] [--json]
```

Report whether anything has moved, without touching a file. The default registry moves as one release, so the base row and each default-registry module compare the release the lock records with the running CLI. A third-party module compares the lock's commit SHA with what its ref resolves to now.

A base row reads `current`, `outdated`, or `untracked`. `untracked` means the project has no usable base record. It is news, not drift: `outdated --check` does not fail on it, and `saasaloy update` records the base. A bare run exits 0 whatever it finds. `--check` exits 2 when the base or any module is `outdated`, so CI can gate on drift without parsing the table. An unreachable source is a row, not a throw, and it does not fail `--check` either. With `SAASALOY_REGISTRY_DIR` set, every module row reads `local` and the run warns that nothing was compared, so `--check` exits 0.

A pending update note is work waiting too. `outdated` lists each one by id and title in a **Pending update notes** box, and `--check` exits 2 while any is pending, with or without drift. See [Recording an update note](#recording-an-update-note).

`outdated` also lists each `once` file whose upstream render changed since the render that wrote it, under **Written once, changed upstream**, on every run. `saasaloy update --merge <path>` takes that change. The list is news, not drift, so `--check` does not fail on it.

`--json` prints the same rows as one document on stdout (see [JSON output](#json-output)): `base`, the base row, `modules`, one row per installed module, `drift`, the count of moved rows, `pendingNotes`, each pending note's `id` and `title` (an empty list when none is pending), and `onceChanged`, the `once` files upstream changed. `--check` exits 2 when `drift` is above 0 or `pendingNotes` is not empty. Each row carries `name`, `source`, `ref`, `current`, `latest` and `status`, plus `detail` when the table prints a note under it. The exit code is the one the same run without `--json` returns.

## `saasaloy update`

```text
saasaloy update [--restore <path>]... [--merge <path>]... [--done <id>]... [--dry-run] [--diff] [--force] [--yes]
saasaloy update --abort
```

Move the project to the release of the CLI that runs. The base and every default-registry module move together, to the tag `v<version>` of the running CLI ([ADR 0062](../adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md)); a third-party module moves to the tip of the ref its lock entry records. `update` takes no module name, and `saasaloy update <module>` exits 2. A staged update runs an older CLI first: `pnpm dlx saasaloy@<version> update`. A CLI older than the lock's release refuses with exit 2 and names the version to install.

The run renders the old lock and the new lock and applies the difference, file by file, by [class](#file-classes):

- A file you never edited is written.
- A `merged` file you edited merges three ways against the [base of the merge](#the-base-of-a-merge). Where both sides changed the same lines it gets conflict markers (`<<<<<<< mine`, `||||||| base`, `=======`, `>>>>>>> saasaloy <version>`), and the run exits 3.
- A `once` file is never changed. When upstream changed it, the report lists it one time for each change, and `update --merge <path>` merges it on request.
- A tracked file you deleted stays deleted. When upstream changed it, the report lists it under "Left deleted", and `update --restore <path>` writes it again.
- A file upstream dropped is deleted when you never edited it. An edited one stays on disk, untracked, under "Kept, no longer tracked".
- A `generated` file you edited refuses the run with exit 2 and names the file. `--force` overwrites it.

A conflict does not stop the run. The lock and the manifest move to the new release, and the manifest lists each file with markers under `pendingMerges`. While one of those files still holds a marker line, `add`, `remove` and `update` refuse with exit 2. A file is resolved when no marker line remains in it; no flag records it.

### The report

`update` prints a Markdown report on stdout, and the TUI goes to stderr, so `saasaloy update --yes > .saasaloy/update-report.md` keeps the report in a file. Its sections, each left out when empty:

- `## Files with conflict markers`, with the count of conflicts in each file and "no base: two-way markers" where the merge had no base.
- `## Written once, changed upstream`, each with its `saasaloy update --merge <path>` command.
- `## Left deleted`, each with its `saasaloy update --restore <path>` command.
- `## Kept, no longer tracked`.
- `## Warnings`.
- `## Update notes`, then `### Notes that may apply` and `### When a note is done` with the `--done` command for every note shown.

The report ends with a line that names `pnpm install` and `pnpm check`. The CLI runs no typecheck itself.

| Flag | Effect |
|---|---|
| `--restore <path>` | write a tracked file the project deleted again, from the current upstream. A path that is not a tracked, deleted file exits 2. Repeatable. |
| `--merge <path>` | merge a `once` file with its upstream change, three ways, against the release that wrote it. With no base found, two-way markers. Repeatable. |
| `--done <id>` | record an update note whose work is done, so the report stops listing it. Repeatable. See [Recording an update note](#recording-an-update-note). |
| `--dry-run` | print the plan and the report, and stop. Nothing is written. |
| `--diff` | print the plan plus a per-file diff, and stop. Nothing is written. |
| `--force` | apply even though the git working tree has uncommitted changes, and overwrite an edited `generated` file. Without it, a dirty tree is refused with exit 2, so `git diff` still shows what the update did. A project that is not a git repository is never blocked. |
| `--abort` | put back the files the last `add`, `remove`, `update` or `testing` run changed, the manifest and the lock included, and stop. |
| `--yes`, `-y` | skip the `Proceed?` confirmation. |

The flags of the old engine, `--from`, `--out`, `--ref` and the flag that recorded a finished merge, are gone. Each exits 2 with the reason.

The confirmation gates on **stdin**, not stdout: the report goes to stdout, so a redirect there says nothing about whether anyone is watching. Without a terminal on stdin and without `--yes`, `update` refuses with exit 2 rather than applying unconfirmed. A preview (`--dry-run`, `--diff`) writes nothing and is exempt.

`update` runs the same `conflictsWith` check `add` does, because a new version can introduce a `dependsOn` on a second driver.

Exit codes: 0 when there is nothing left to do, 3 when the run applied the update and left files with conflict markers or update notes not yet marked done, 2 for a refusal, 1 for a failure. A preview exits 0.

### How a run writes

`add`, `remove`, `update` and `testing <mode>` are one operation: render the old lock and the new lock, compare each path with the disk, and pick one action for it ([ADR 0066](../adr/0066-adr-one-render-and-a-three-way-merge-replace-the-add-update-and-remove-engines-2026-11-20.md)). Before it writes, the run copies each file it will overwrite, merge or delete into `.saasaloy/backups/<timestamp>/`, and it writes `.saasaloy/journal.json`. It writes the project, then the manifest and the lock, and removes the journal last. A journal left behind marks a run that did not finish: every later `add`, `remove` and `update` refuses with exit 2 until `--abort` restores the files. The backup directory is gitignored.

The clean-tree rule differs by command. `update` refuses any uncommitted change. `add`, `remove` and `testing` refuse only when the run must merge or delete a file that has uncommitted changes; a write of a new file needs no clean tree. `--force` overrides both.

### File classes

Each rendered file has one class, recorded in the manifest ([ADR 0067](../adr/0067-adr-a-rendered-file-is-generated-merged-or-written-once-2026-11-20.md)):

| Class | What a run does with it |
|---|---|
| `generated` | writes it in full every run. An owner edit refuses the run with exit 2; `--force` overwrites it. |
| `merged` | three-way merge of the old render, the new render and the disk. `package.json`, `wrangler.jsonc`, `tsconfig.json`, `turbo.json` and `saasaloy.json` merge by key, with markers around a key both sides changed. |
| `once` | written when the path is new, then left alone. `update --merge <path>` merges it on request. |

The base's `seedFiles` and `ownedFiles` in `_saasaloy-base.json` and a module entry's `"seed": true` are `once`. Each `<name>.generated.ts` file the render writes for a [registration table](../../CONTEXT.md#registration-table) is `generated`. Every other file is `merged`, `saasaloy.json` and `packages/env/.env.example` included.

### The base of a merge

The base is the render of the old lock, from the payload at the old ref, accepted only when its sha256 equals the hash the manifest recorded. The manifest hash is always the sha256 of the raw render, before Prettier, never the bytes on disk. When the old lock's render does not match, the run renders the release the record names in its `version`. A descriptor read at an older release loads with a retired key translated: `onlyWith: X` reads as `when.installed: [X]`, so a release with twin files renders the twin of the installed driver. With no match, the merge writes two-way markers ([ADR 0068](../adr/0068-adr-a-merge-base-is-found-by-hash-in-a-user-cache-2026-11-20.md)).

The payload of each ref lives in a cache for each user: `$XDG_CACHE_HOME/saasaloy/payload/<source>@<ref>/`, else `~/.cache/saasaloy/payload/<source>@<ref>/`. A fetch fills it, and a later run reads it. A run that needs a merge, with a cold cache and no network, refuses with exit 2. The base template at the running CLI's release is the one bundled in the CLI.

### The first run on an older project

A project an older CLI (0.9.0 or earlier) wrote has a version 1 manifest. Only `update` converts it; `add` and `remove` refuse it with exit 2 and name `saasaloy update`. The conversion finds each file's base by its recorded hash across the lock's release, the old-engine releases 0.1.0 to 0.9.0 newest first, and the lock's module commits, and writes version 2 records. A file with no base becomes a file on both sides, with two-way markers in the update that follows. The conversion and the update are one run on a clean tree, so the result is one diff to review, and `--abort` restores the version 1 manifest and lock. Convert on a branch.

A version 1 manifest that records no `hash` or no `from` for a file refuses with exit 2 and names `pnpm dlx saasaloy@0.9.0 update`, which records both. Run it, then the update with the newest CLI.

### Recording an update note

Every update note an applied run shows is recorded as pending in `.saasaloy/manifest.json` (`pendingNotes`), with its title and body. `--dry-run`, `--diff` and a declined prompt record nothing. A pending note prints again in every later report until it is cleared, and `update` exits 3 while any note is pending, even when no file moved. `saasaloy outdated` and `saasaloy doctor` list the pending notes.

`--done <id>` clears one note. It rides a normal update run, so with no terminal it needs `--yes` and a dirty working tree needs `--force`. The report ends its "Update notes" section with the exact command for its notes:

```sh
saasaloy update --done base/0001-brand-css --yes
```

An id that is not pending exits 2 before anything is written and lists the pending ids. A cleared id moves from `pendingNotes` to `doneNotes` in the manifest, and every later run skips it, so a cleared note never returns.

## `saasaloy remove`

```text
saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force]
saasaloy remove --abort
```

Render the project without the module and apply the difference. Every file and every patch the module wrote goes with it, because the render without the module never wrote them. With no module named it shows a picker over the modules you asked for. Unknown flags and extra positionals are rejected with exit 2.

| Flag | Effect |
|---|---|
| `--dry-run` | print the plan and stop. Nothing is removed. |
| `--diff` | print the plan plus a diff for each path, and stop. Nothing is removed. |
| `--yes`, `-y` | skip the confirmation prompt. |
| `--force` | delete and merge even over uncommitted changes, and overwrite an edited `generated` file. |
| `--abort` | put back the files the last `add`, `remove`, `update` or `testing` run changed, and stop. |

A file the module wrote and you never changed is deleted. A file you changed stays on disk, untracked, with one report line. A file another module or the base still renders, such as `package.json` or `apps/api/wrangler.jsonc`, merges three ways, so the module's lines go and yours stay; a conflict leaves markers and exits 3. A generated table file, such as `apps/api/src/routes.generated.ts`, is written again without the module's rows. `remove X` also takes every entry another module ships under a `when.installed` that names X, such as a journey spec gated on `e2e`.

`remove` refuses with exit 2 when other installed modules depend on the module, when the module was installed only as a prerequisite, when the lock's release differs from the running CLI, when the project has a version 1 manifest, and when a pending merge still holds a marker line. `--force` does not override the dependency refusal, because a module cannot render without its prerequisite.

`remove` reads the payload of the lock's release from the [user cache](#the-base-of-a-merge), and fetches it when the cache does not hold it.

With no terminal, a named module, and no `--yes`, `remove` refuses with exit 2 before it plans. `--dry-run` and `--diff` ask nothing, so they still run.

See [Remove a module](how-to/remove-a-module.md).

## `saasaloy list`

```text
saasaloy list [<owner/repo[@ref]>|@<ref>] [--installed] [--available] [--json]
```

One optional coordinate names a registry; with none it lists the default registry at this CLI's release tag, and `@main` lists it on `main`. The `--json` document's `registry` names the ref it read, such as `mimukit/saasaloy@v0.9.0`. Output
is names only, read from one listing of the repo's git tree, which is why a module with an
invalid descriptor still appears here and only fails at `add`. `--json` is the exception:
it reads each listed module's descriptor, so an invalid one fails the run.

Run inside a project, each name is marked installed or not, anything installed that this
registry does not offer is named on its own line, and the closing line counts both.
Run outside one, nothing can be marked and every name is listed plain.

| Flag | Effect |
|---|---|
| `--installed` | list only the modules this project has installed |
| `--available` | list only the modules this project has not installed |
| `--json` | print one JSON document on stdout with each listed module's descriptor fields (see [JSON output](#json-output)) |

The two filters exclude each other; passing both exits 2. Unknown flags are rejected the same way. `--json` combines with either filter: `saasaloy list --installed --json` is how an agent finds the installed modules and their skills.

The `--json` document carries `registry` (the source label), `base` (the base app, or `null` outside a project), `notInRegistry` (installed modules this registry does not offer) and `modules`. Each module carries:

| Field | Value |
|---|---|
| `name` | the module name |
| `tier` | `capability` or `feature`, from the descriptor's `type` |
| `description` | the descriptor's one line, or `null` when it has none |
| `stage` | `validate`, `mvp`, `teams`, `money` or `scale`, or `null` |
| `needs` | a list from `cloudflare-paid`, `stripe`, `domain` and `vendor-account`; `[]` means nothing outside the free tier, and `null` means the descriptor does not say |
| `dependsOn`, `requiresOneOf`, `conflictsWith` | the descriptor's lists, `[]` when absent |
| `envVars` | name → the descriptor's description of the variable |
| `skill` | the skill folder the module ships, such as `saasaloy-waitlist`, or `null` |
| `installed` | `true` when this project has it installed |

## `saasaloy new`

```text
saasaloy new module <name> [--type <tier>] [--depends-on <a,b>]
```

Scaffold a module in a registry repo. `module` is the only noun there is, and the picker hands off without one, so a bare `saasaloy new` means `saasaloy new module`. Any other noun exits 2 with "`saasaloy new <noun>` isn't a thing — the noun is one of: module."

| Flag | Effect |
|---|---|
| `--type <tier>` | `saasaloy:capability` or `saasaloy:feature`. Skips the tier prompt. A value that is neither exits 2. |
| `--depends-on <a,b>` | comma-separated capabilities this module needs. Skips the dependency prompt. `--depends-on=` or `--depends-on ""` means none. |

Both value flags take `--type feature` and `--type=feature`. A value flag with nothing usable after it is a usage error, not a silently empty value. The one exception is an empty `--depends-on`, which answers "no dependencies".

It writes three paths under `modules/<name>/`: `registry-item.json`, `files/.gitkeep`, and `skills/saasaloy-<name>/SKILL.md`. The descriptor declares a `requires.saasaloy` range floored at the running CLI's own minor, a `TODO` `description` for you to replace, `stage: "mvp"` and `needs: []`, so it passes `doctor` from the start. `doctor` warns on the `TODO` line until you replace it, and `new` prints that warning under **Still to write**. The name must match `^[a-z0-9][a-z0-9-]*$`, and the folder must not already exist; either problem refuses before anything is written.

After the write, `new` runs the same checks `saasaloy doctor` runs, in process. Findings are reported, not refused: the run still exits 0 with "Scaffolded with N findings — fix <dir>/registry-item.json, then `saasaloy doctor <dir>`." A clean scaffold ends with "<name> is ready — put its payload in <dir>/files/ and write its runbook in <dir>/skills/."

Exit 2 covers an unknown argument, an unknown noun, a bad name, an existing folder, a bad `--type`, and a missing name, tier or `--depends-on` with no terminal to ask on. A cancelled prompt exits 1. It also refuses inside a generated project, because `saasaloy.json` there means a project that installs modules rather than a registry that hosts them, and nothing is written.

## `saasaloy doctor`

```text
saasaloy doctor [<path>] [--json]
```

Validate what is on disk. Nothing named checks the current directory. `doctor` picks its mode by what the path carries: a `saasaloy.json` means project mode, anything else means registry mode. Its one flag is `--json`, and it never writes.

Registry mode checks one module folder (`saasaloy doctor modules/waitlist`) or a directory of them (`saasaloy doctor modules`); a module folder is one that carries a `registry-item.json`. Besides the schema, it checks what the schema cannot, among them declared files on disk, known aliases, sibling module names, exact-pinned dependencies, the skill folder, and a `description` on every descriptor. The schema keeps `description` optional so a project can still read an older descriptor, but a registry without one fails here. A `description` that still starts with `TODO`, as `new module` writes it, is a warning: it prints in a **Warnings** box and never fails the run. It prints one box per module with findings and a dim line counting how many were clean. A clean run ends with "No problems found." and exit 0. Findings exit 2, which is what makes `doctor` usable as a pre-publish gate in CI.

Project mode opens with a **Base** box: the recorded template name, the CLI version and short template hash it was recorded at, a count of files that match the record, the files that changed, and the files left deleted, which `saasaloy update --restore <path>` writes again. It also lists each pending merge, a file the last run left with conflict markers. A project with a version 1 manifest gets one line that names `saasaloy update`, which converts it. Base drift never fails the run. A **Pending update notes** box follows when an applied `saasaloy update` showed notes that nobody cleared yet, one line per note with the `saasaloy update --done <id>` command that clears it. Like base drift, a pending note never fails the run. An untracked base points at `saasaloy update` to record it.

Below the base box, project mode asks seven questions: a module in `installed` that owns no file in the manifest, a module that owns files but was never marked installed, a capability whose `requiresOneOf` no installed module meets, on a project running `kv-cloudflare` whether every registered rate limit policy has the `RL_<NAME>` binding its `consume` resolves to, whether a leftover `.dev.vars` file hides `.env` from wrangler, and whether a `config` value replaces an env var that a `.env` file still sets. The seventh is whether a retired Pulumi `infra/` workspace is still there, and its finding points at [the runbook](runbooks/move-off-the-infra-module.md). No findings exits 0 with "No problems found."; findings exit 2 with "N problems in saasaloy.json."

A path that does not exist exits 2, and so does a directory with no module folders in it.

`--json` prints the findings as one document on stdout (see [JSON output](#json-output)), with the exit code unchanged. `mode` is `registry` or `project`. Registry mode carries `path`, `modules` (each with `module`, its `findings` and its `warnings`) and `problems`, the finding count. Project mode carries `path`, `base` (the Base box as data), `pendingNotes` (each pending update note's `id` and `title`), `installed`, `findings`, `warnings` (the deploy warnings) and `problems`. Each finding has `module`, `where` and `message`.

## `saasaloy skill`

```text
saasaloy skill [<name>] [--json]
```

Print a base skill from the CLI that runs. A project holds the base skills of the CLI that last wrote its base, so its copy of `saasaloy-update` can describe flags and steps an older CLI had. `saasaloy skill saasaloy-update` prints the copy bundled in this CLI's npm package, with no network, as the same bytes `init` would write. Inside a project the template variables take that project's name; outside one they take `my-app`. Base skills only: a module skill arrives with its module through `add` and `update`.

With no name, `skill` lists each bundled base skill and the `description` from its frontmatter, one per line. `--json` prints that list as `{ "schemaVersion": 1, "skills": [{ "name", "description" }] }`. `skill <name> --json` prints `{ "schemaVersion": 1, "name", "description", "content" }`, where `content` is the text the plain run prints.

stdout carries only the skill text, the list or the JSON document. An unknown name exits 2 and lists the known names on stderr, with nothing on stdout (under `--json`, the error document). An unknown flag exits 2 the same way.

## Module coordinates

```text
waitlist                → default registry (mimukit/saasaloy) at this CLI's tag v<version>
owner/repo/waitlist     → third-party repo at its default branch, module `waitlist`
owner/repo@ref/waitlist → pinned to a branch, tag or SHA
owner/repo              → no module named ⇒ picker over that repo
@main                   → `list` only: the default registry at a branch, tag or SHA
(nothing)               → picker over the default registry
```

`add` refuses `waitlist@main` and any other `@ref` on the default registry, because the default registry moves as one release. A ref containing `/`, such as `owner/repo@feature/x/waitlist`, is not supported and produces a `Malformed coordinate` error. Pin that branch's tip SHA instead.

Third-party module identity is expected to change with
[#39](https://github.com/mimukit/saasaloy/issues/39).

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `SAASALOY_REGISTRY_DIR` | `add`, `env`, `list`, `outdated`, `remove`, `testing`, `update` | resolve modules from a local `modules/` directory instead of GitHub. Takes precedence over any `owner/repo` in the coordinate, and `add` and `list` warn when you pass one anyway. A missing directory is an error. Under `outdated` every module row reads `local`. |
| `GITHUB_TOKEN` | `add`, `env`, `list`, `outdated`, `update` | authenticate GitHub API calls. Raises the rate limit from 60 to 5000 requests an hour and allows private registries. Hitting the anonymous limit produces `GitHub API rate limit hit … Set GITHUB_TOKEN to raise it.` |
| `GIGET_AUTH` | `add`, `env`, `list`, `outdated`, `update` | fallback for the same purpose; `GITHUB_TOKEN` wins if both are set. |
| `SAASALOY_GITHUB_API` | every command that reaches GitHub | override the GitHub API base URL. A trailing slash is stripped. It is not a GitHub Enterprise switch: nothing else in the CLI reads it, and a real GHES base would need `GIGET_GITHUB_URL` set to match. |
| `SAASALOY_CACHE_DIR` | `add`, `remove`, `update`, `testing`, `outdated` | replace the whole payload cache folder, for tests. Without it the cache is `$XDG_CACHE_HOME/saasaloy/payload/`, else `~/.cache/saasaloy/payload/`. |
| `SAASALOY_DEBUG` | every command | any non-empty value prints the full `cause` chain and stack under a failure's message, instead of the message alone. Set it before you paste an error into a bug report. |

Every GitHub API call carries a 15-second timeout and no retry, so a connection that opens
and then stalls fails with a message rather than hanging. Every network failure names
`SAASALOY_REGISTRY_DIR` as the offline path.

The table above is the CLI's own environment. A module declares its own variables in its `registry-item.json` `envVars` map, and `saasaloy env` is what collects them. [The environment reference](generated/env.md) lists every one of them, with its module and the services that read it. Eight capabilities select their implementation with a `<CAP>_PROVIDER` variable, and that page lists each selector and its values. Each value names the provider module you install for it. `LOGGER_PROVIDER` is the only one that may stay unset: unset selects the first registered provider, and with none registered every log call is a silent no-op. It is the deliberate exception to "no default in either direction": a naming typo still throws, but a missing value never does, because an outage caused by the observability layer is worse than one absent knob.

## Email providers

`email` is the capability; a provider module supplies one implementation behind its
interface. Pick one before you send anything.

| Module | Needs |
|---|---|
| `email-console` | nothing. It logs the rendered message instead of sending it, so local development and tests need no plan, no domain and no API key. |
| `email-cloudflare` | a Workers **paid plan**, plus a sending domain onboarded by hand in the Cloudflare dashboard (Compute → Email Service → Email Sending). Neither is something the CLI can do or verify for you. It declares no `envVars` of its own: the `send_email` binding it patches into `apps/api/wrangler.jsonc` is the credential. It registers itself as a row of the `email.providers` table, which the CLI writes into `packages/email/src/providers.generated.ts`. |
| `email-plunk` | a Plunk account and its **secret** `sk_...` key in `PLUNK_API_KEY`, not the public `pk_...` key, which cannot send. Nothing here needs a paid Cloudflare plan or an onboarded domain, and the same code path runs in `wrangler dev` and in production. `PLUNK_API_URL` is optional and defaults to the hosted `https://next-api.useplunk.com`; only a self-hosted Plunk instance sets it, and it must use HTTPS except on localhost. Unset `PLUNK_API_KEY`, every send throws `EmailError("provider_error")` before the request leaves the Worker. |

`EMAIL_FROM` sits on the `email` core, not on a provider. It is the default sender address, on a domain the selected provider is allowed to send from, and any message may override it.

### The other providers that need an account

| Module | Needs |
|---|---|
| `queue-cloudflare` | no API token and no secret. The `queues.producers` entries it patches into `apps/api/wrangler.jsonc` are the credential, plus the one Cron Trigger tick the schedule table needs. It declares no `envVars`. |
| `kv-cloudflare` | no API token and no secret. The `kv_namespaces` and `ratelimits` entries in `apps/api/wrangler.jsonc` are the credential, and it declares no `envVars`. Three platform limits apply and none is the module's to fix: KV is eventually consistent, with a write visible at once in its own location and up to 60 seconds later everywhere else; the TTL floor is 60 seconds, and a shorter one is refused rather than rounded up; the rate limiter counts per Cloudflare location, so a `limit` of 10 is 10 per colo. |
| `storage-cloudflare` | the `BUCKET` binding alone for every read and write. Presigned URLs need more: an R2 API token with Object Read & Write, giving `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME`. All four are optional, and with any one missing the provider reports that it cannot sign and the core hands back its own proxy URL instead, so every byte streams through the Worker. `R2_BUCKET_NAME` must name the same bucket the binding points at. |
| `subscription-stripe` | a Stripe account. `STRIPE_SECRET_KEY` (`sk_test_…` in development, `sk_live_…` in production) is required once `SUBSCRIPTION_PROVIDER=stripe`; the client is built on first use, so a project on `SUBSCRIPTION_PROVIDER=console` runs the whole capability with it unset. `STRIPE_WEBHOOK_SECRET` is the signing secret of the endpoint you register at `https://dashboard.stripe.com/webhooks` pointing at `https://<your-api>/auth/stripe/webhook`; every delivery is verified against it, so an unsigned POST is refused before any handler runs. |
| `database-postgres` | a Postgres database for production. [Neon's free tier](https://neon.com/pricing) gives each project 1 GB and 100 compute hours a month with no credit card; any Postgres host works. Local development needs none: `db:setup` starts a Docker container. A `HYPERDRIVE` binding is an opt-in. Hyperdrive is on the Workers Free plan, and Hyperdrive Free fails queries past 100,000 a day ([Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), read 2026-11-20). |
| `sms` | nothing for `sms-console`, which declares no `envVars`. `sms-khudebarta` needs a [Khudebarta](https://khudebarta.com/) account: `KHUDEBARTA_API_KEY` and `KHUDEBARTA_SECRET_KEY` are required, and `KHUDEBARTA_API_URL` optionally overrides the gateway URL. It sends to Bangladeshi (`+880`) numbers only and requires a sender, so `SMS_FROM` must name the sender id registered with Khudebarta. `SMS_FROM` on the core is otherwise optional: a provider routing through a pool or a messaging service assigns the sender itself, and a provider that requires one rejects a send with `invalid_message` when neither `SMS_FROM` nor the message carries a `from`. |

## Project files

A project uses three state files, and `init` writes all three. `saasaloy.json`
carries the base app in its own `base` field (`"base": "web"`), and `installed[]` holds
only the modules `saasaloy add` applied. A project scaffolded before that field existed
lists `web` in `installed[]`; the CLI lifts it into `base` the next time it writes the
file. `.saasaloy/manifest.json` is version 2: for each file its `module`, `from`, `class`, `hash` (the sha256 of the raw render) and `version` (the release that wrote that render), plus `pendingMerges`, `pendingNotes` and `doneNotes`. Base files sit under the reserved module name `base`. `saasaloy-lock.json` carries `requested`, the modules you asked for, one entry per installed module, and a `base` object naming the CLI version and the hash of the template that rendered it. `.saasaloy/journal.json` exists only while a run is writing. Their keys are defined
by JSON Schema rather than repeated here, so the schema is always the current answer:

| File | Schema |
|---|---|
| `saasaloy.json` | [`saasaloy.schema.json`](../../packages/cli/schemas/saasaloy.schema.json) |
| `saasaloy-lock.json` | [`saasaloy-lock.schema.json`](../../packages/cli/schemas/saasaloy-lock.schema.json) |
| `.saasaloy/manifest.json` | [`manifest-v2.schema.json`](../../packages/cli/schemas/manifest-v2.schema.json); a version 1 manifest from 0.9.0 or earlier validates against [`manifest.schema.json`](../../packages/cli/schemas/manifest.schema.json) |

Module authors write one more:

| File | Schema |
|---|---|
| `modules/<name>/registry-item.json` | [`registry-item.schema.json`](../../packages/cli/schemas/registry-item.schema.json) |

Worked examples sit in
[`packages/cli/schemas/examples/`](../../packages/cli/schemas/examples/). Point a
descriptor's `$schema` at the matching file and your editor validates it as you type.

## Known limitations

**`add` writes the root `package.json` but runs no install.** Run `pnpm install` after an `add` or an `update` that changed it.

**Two modules cannot write one path** unless one declares the other in `dependsOn`. The render refuses such a set with exit 2 before anything is written.

**A cold cache needs the network.** A run that must merge a file reads the payload of the old release. With no cache entry and no network it refuses with exit 2.

_Verified against `main`@`33bc729b` on 2026-11-21._
