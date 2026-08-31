# Reference

Everything the CLI declares: five commands, their flags, the coordinate grammar, the
environment variables it reads, and the files it writes. Nothing here is aspirational — if
a flag isn't listed, it doesn't exist.

## Commands

```text
saasaloy <command> [options]
```

| Command | What it does |
|---|---|
| `init` | scaffold a new Saasaloy project (base: Astro landing + ui + config) |
| `add` | apply a module into the current project (resolves `dependsOn`) |
| `update` | re-apply modules at a newer ref, with a merge plan for anything you edited |
| `remove` | undo a module's applied files via the manifest (offline) |
| `list` | list the modules a registry offers, marking the ones installed here |

`saasaloy help`, `saasaloy --help` and `saasaloy -h` all print the command list and exit
0. Bare `saasaloy` opens a picker over the same list on a terminal, and prints the list
and exits 0 when there is no terminal to answer it — a pipe, or CI.
`saasaloy --version`, `-v` and `version` print the installed version.
Every command also answers its own `--help` with its usage and flags.

`add`, `update` and `remove` are run from inside a project: they find the project root by
walking up from your working directory looking for `saasaloy.json`. `list` marks what the
current project has installed when it is run inside one, and works anywhere.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | the command did what it was asked, or you answered no to a confirmation |
| `1` | something failed, or you cancelled: a fetch died, a write threw, Ctrl-C |
| `2` | saasaloy refused by design: an unknown flag or command, a module conflict, an unmet `requiresOneOf`, an invalid state file, or a prompt with no terminal to answer it in |

A wrapper script reads `2` as "the input is wrong, retrying will not help" and `1` as
"transient, a retry may work".

## `saasaloy init`

```text
saasaloy init [<name>] [--force] [--no-install] [--no-git]
```

`<name>` may be a bare name (`my-app`), `.` for the current directory, or a path
(`./apps/my-app`). The project name is the last segment of the resolved path and must
match `^[a-z0-9][a-z0-9-]*$`. Omit it and the CLI prompts.

| Flag | Effect |
|---|---|
| `--force` | scaffold into a directory that already has files in it. Without it, a non-empty target cancels with exit 2. A `.git` directory alone does not count as non-empty. |
| `--no-install` | skip the "Install dependencies now?" prompt and never run `pnpm install`. |
| `--no-git` | do not run `git init` in the new project. |

`init` runs `git init` in the scaffolded project before the install, because husky's
`prepare` script installs its hooks during `pnpm install` and needs a repository to install
them into. It is skipped when the target already sits inside a working tree, so
`saasaloy init .` in an existing repo does not nest a second one, and a failure warns rather
than aborting the scaffold.

Like every other command, `init` rejects a flag it does not know with exit 2.

## `saasaloy add`

```text
saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--dry-run] [--diff] [--yes] [--force]
```

With no module named, `add` shows a picker over the source, listing only modules this
project has not installed. Unknown flags and extra positional arguments are rejected
before any work happens, with exit 2.

| Flag | Effect |
|---|---|
| `--dry-run` | print the plan and stop. Nothing is written. |
| `--diff` | print the plan plus a per-file diff, capped at 60 lines each, and stop. Nothing is written. |
| `--yes`, `-y` | skip the `Proceed?` confirmation. |
| `--force` | re-apply the module you named even though it is already installed. Already-installed dependencies are left alone. |

Without `--force`, a module whose graph is fully installed prints `Nothing to do` and
exits 0.

A successful `add` ends with a next-steps box: the `/saasaloy-<module>` skill it linked,
which holds the module's own procedure, and the environment variables it needs, re-printed
after the confirmation rather than before it. It also writes `apps/api/.dev.vars.example`
from the installed descriptors' `envVars` maps, one commented entry per variable. Copy that
file to `.dev.vars` — which is gitignored, while the example is not — and fill in the
blanks. A value already in the file is never overwritten, and no key is ever removed.

A module descriptor may declare `conflictsWith`, naming modules it refuses to sit beside.
`add` checks that list before it writes anything and exits 2 with a message naming both
modules and the `saasaloy remove` that clears the conflict. The check reads both the
incoming descriptors and `saasaloy-lock.json`, so it fires whichever module went in first,
and `--force` does not bypass it. `add` never uninstalls anything to resolve a conflict. A
module installed before its lock entry existed can't be checked this way; `add` says so and
proceeds.

A descriptor may also declare `requiresOneOf`, naming modules exactly one of which has to
be present. `add` counts an option as present when it is already installed or arrives in
the same resolved graph. When none is, an interactive run offers the list as a picker and
adds what you choose to the plan; `--yes` or a run with no terminal exits 2 and names the
options instead of choosing for you. `database` declares it, so the core can never land on
a project with no driver behind its `@repo/db/client` export.

`database-d1` and `database-postgres` are the pair both fields point at today. They are
**driver modules**, two implementations of the same capability's connection layer, and a
project holds exactly one: `requiresOneOf` on the core stops it at zero, `conflictsWith` on
each driver stops it at two. The `database` core carries the tables, the schema barrel and
`db:generate`; the driver carries the client, the dialect and the migrate commands. Switch
by removing one driver and adding the other, which moves no data
([ADR 0026](../adr/adr-0026-database-driver-split-2026-08-28.md)).

`auth` and `waitlist` ship SQLite payloads and declare `dependsOn: ["database-d1"]`, so on
a project running `database-postgres` both are refused by the conflict check. That is a
stopgap until their payloads are dialect-neutral; see ADR 0026's 2026-08-31 amendment.

See [Add a module](how-to/add-a-module.md) for the workflow.

## `saasaloy update`

```text
saasaloy update [<module>] [--ref <ref>] [--out <path>] [--dry-run] [--diff] [--yes]
```

Re-apply installed modules at a newer commit than `saasaloy-lock.json` records. With no
module named it considers every installed module. A file you never touched is overwritten;
a file you edited is left alone and routed into a **merge plan** — a document written to
stdout describing what changed upstream, what you changed, and what the reconciliation has
to preserve. `saasaloy update email | claude` is the designed pipeline.

| Flag | Effect |
|---|---|
| `--ref <ref>` | update one named module to this branch, tag or SHA instead of the registry's current default branch. Needs an explicit module; a bare `update --ref` exits 2. |
| `--out <path>` | write the merge plan to a file instead of stdout. Refuses a path that resolves to one of the project's own state files. |
| `--dry-run` | print the plan and stop. Nothing is written. |
| `--diff` | print the plan plus a per-file diff and stop. Nothing is written. |
| `--yes`, `-y` | skip the `Proceed?` confirmation. |

The confirmation gates on **stdin**, not stdout: the merge plan goes to stdout, so a
redirect there says nothing about whether anyone is watching. Without a terminal on stdin
and without `--yes`, `update` refuses with exit 2 rather than applying unconfirmed. A
preview (`--dry-run`, `--diff`) writes nothing and is exempt.

`update` runs the same `conflictsWith` check `add` does, because a new version can
introduce a `dependsOn` on a second driver, and it reports any environment variable the new
version added that the lock has no record of.

## `saasaloy remove`

```text
saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force]
```

No `owner/repo` coordinate: `remove` is fully offline and reads only local state. With no
module named it shows a picker over the installed modules. Unknown flags and extra
positionals are rejected with exit 2.

| Flag | Effect |
|---|---|
| `--dry-run` | print the plan and stop. Nothing is removed. |
| `--diff` | print the plan plus a deletion diff per file and a reversal diff per `chained-route` patch, and stop. Nothing is removed. |
| `--yes`, `-y` | skip every prompt, including the per-file drift confirmation. Drifted files then survive on disk, untracked. |
| `--force` | remove the module even though other installed modules depend on it. |

See [Remove a module](how-to/remove-a-module.md), and read
[Known limitations](#known-limitations) before assuming `remove` undoes `add`.

## `saasaloy list`

```text
saasaloy list [<owner/repo[@ref]>] [--installed] [--available]
```

One optional coordinate names a registry; with none it lists the default registry. Output
is names only, read from one listing of the repo's git tree, which is why a module with an
invalid descriptor still appears here and only fails at `add`.

Run inside a project, each name is marked installed or not, anything installed that this
registry does not offer is named on its own line, and the closing line counts both.
Run outside one, nothing can be marked and every name is listed plain.

| Flag | Effect |
|---|---|
| `--installed` | list only the modules this project has installed |
| `--available` | list only the modules this project has not installed |

The two exclude each other; passing both exits 2. Unknown flags are rejected the same way.

## Module coordinates

```text
waitlist                → default registry (mimukit/saasaloy), module `waitlist`
owner/repo/waitlist     → third-party repo, module `waitlist`
owner/repo@ref/waitlist → pinned to a branch, tag or SHA
owner/repo              → no module named ⇒ picker over that repo
(nothing)               → picker over the default registry
```

Two forms are not supported and produce a `Malformed coordinate` error:

- a ref containing `/`, such as `owner/repo@feature/x/waitlist`. Pin that branch's tip SHA
  instead.
- a ref without an explicit `owner/repo`, such as `waitlist@v2`.

Third-party module identity is expected to change with
[#39](https://github.com/mimukit/saasaloy/issues/39).

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `SAASALOY_REGISTRY_DIR` | `add`, `list` | resolve modules from a local `modules/` directory instead of GitHub. Takes precedence over any `owner/repo` in the coordinate, and both commands warn when you pass one anyway. A missing directory is an error. |
| `GITHUB_TOKEN` | `add`, `list` | authenticate GitHub API calls. Raises the rate limit from 60 to 5000 requests an hour and allows private registries. Hitting the anonymous limit produces `GitHub API rate limit hit … Set GITHUB_TOKEN to raise it.` |
| `GIGET_AUTH` | `add`, `list` | fallback for the same purpose; `GITHUB_TOKEN` wins if both are set. |
| `SAASALOY_DEBUG` | every command | any non-empty value prints the full `cause` chain and stack under a failure's message, instead of the message alone. Set it before you paste an error into a bug report. |

Every GitHub API call carries a 15-second timeout and no retry, so a connection that opens
and then stalls fails with a message rather than hanging. Every network failure names
`SAASALOY_REGISTRY_DIR` as the offline path.

## Email providers

`email` is the capability; a provider module supplies one implementation behind its
interface. Pick one before you send anything.

| Module | Needs |
|---|---|
| `email-console` | nothing. It logs the rendered message instead of sending it, so local development and tests need no plan, no domain and no API key. |
| `email-cloudflare` | a Workers **paid plan**, plus a sending domain onboarded by hand in the Cloudflare dashboard (Email Service → Email Sending). Neither is something the CLI can do or verify for you. It also patches `apps/api/wrangler.jsonc` with a `send_email` binding and registers itself in `packages/email/src/index.ts`. |

## Project files

A project uses three state files, but not from the start: `init` writes only
`saasaloy.json`, and the first `saasaloy add` creates the other two. `saasaloy.json`
carries the base app in its own `base` field (`"base": "web"`), and `installed[]` holds
only the modules `saasaloy add` applied. A project scaffolded before that field existed
lists `web` in `installed[]`; the CLI lifts it into `base` the next time it writes the
file. Their keys are defined
by JSON Schema rather than repeated here, so the schema is always the current answer:

| File | Schema |
|---|---|
| `saasaloy.json` | [`saasaloy.schema.json`](../../packages/cli/schemas/saasaloy.schema.json) |
| `saasaloy-lock.json` | [`saasaloy-lock.schema.json`](../../packages/cli/schemas/saasaloy-lock.schema.json) |
| `.saasaloy/manifest.json` | [`manifest.schema.json`](../../packages/cli/schemas/manifest.schema.json) |

Module authors write one more:

| File | Schema |
|---|---|
| `modules/<name>/registry-item.json` | [`registry-item.schema.json`](../../packages/cli/schemas/registry-item.schema.json) |

Worked examples sit in
[`packages/cli/schemas/examples/`](../../packages/cli/schemas/examples/). Point a
descriptor's `$schema` at the matching file and your editor validates it as you type.

## Known limitations

Two gaps are load-bearing enough to plan around.

**`remove` reverses one config patch kind out of five.**
[#36](https://github.com/mimukit/saasaloy/issues/36). When a module patches a file another
module owns, `remove` can only undo the edit for `chained-route`, where it takes the
`.route()` link back out, and the named import with it when no other code in the file still
references the identifier. For the other four kinds it drops the record from
the manifest and prints a warning naming the file, and the edit stays. Removing
`email-cloudflare` leaves the `send_email` binding in `apps/api/wrangler.jsonc` and the
provider registration in `packages/email/src/index.ts`. Revert those by hand. Skill links,
by contrast, are removed properly.

**`add` is not transactional.**
[#49](https://github.com/mimukit/saasaloy/issues/49). If `add` fails partway through, it
persists the manifest and config so the record matches what actually landed, and
re-running `add` is the intended recovery. The dependency merge and the lockfile write both
run after the file writes succeed, so a failed `add` no longer leaves `package.json`
advertising packages whose code never arrived. What is still missing is the rollback of the
files that did land, and a message telling you that re-running is the fix.

_Verified against the CLI source on 2026-08-31._
