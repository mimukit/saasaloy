# Reference

Everything the CLI declares: four commands, their flags, the coordinate grammar, the
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
| `remove` | undo a module's applied files via the manifest (offline) |
| `list` | list available modules |

`saasaloy`, `saasaloy help`, `saasaloy --help` and `saasaloy -h` all print the command
list and exit 0. An unrecognised command prints an error plus the list and exits 1.

`add` and `remove` are run from inside a project: they find the project root by walking up
from your working directory looking for `saasaloy.json`. `list` reads no project files and
works anywhere.

## `saasaloy init`

```text
saasaloy init [<name>] [--force] [--no-install]
```

`<name>` may be a bare name (`my-app`), `.` for the current directory, or a path
(`./apps/my-app`). The project name is the last segment of the resolved path and must
match `^[a-z0-9][a-z0-9-]*$`. Omit it and the CLI prompts.

| Flag | Effect |
|---|---|
| `--force` | scaffold into a directory that already has files in it. Without it, a non-empty target cancels with exit 1. A `.git` directory alone does not count as non-empty. |
| `--no-install` | skip the "Install dependencies now?" prompt and never run `pnpm install`. |

Unlike `add` and `remove`, `init` does not reject unknown flags. Anything beginning with
`-` that isn't one of the two above is ignored silently, so check your spelling.

## `saasaloy add`

```text
saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--dry-run] [--diff] [--yes] [--force]
```

With no module named, `add` shows a picker over the source. Unknown flags and extra
positional arguments are rejected before any work happens, with exit 1.

| Flag | Effect |
|---|---|
| `--dry-run` | print the plan and stop. Nothing is written. |
| `--diff` | print the plan plus a per-file diff, capped at 60 lines each, and stop. Nothing is written. |
| `--yes`, `-y` | skip the `Proceed?` confirmation. |
| `--force` | re-apply the module you named even though it is already installed. Already-installed dependencies are left alone. |

Without `--force`, a module whose graph is fully installed prints `Nothing to do` and
exits 0.

A module descriptor may declare `conflictsWith`, naming modules it refuses to sit beside.
`add` checks that list before it writes anything and exits 1 with a message naming both
modules and the `saasaloy remove` that clears the conflict. The check reads both the
incoming descriptors and `saasaloy-lock.json`, so it fires whichever module went in first,
and `--force` does not bypass it. `add` never uninstalls anything to resolve a conflict. A
module installed before its lock entry existed can't be checked this way; `add` says so and
proceeds.

See [Add a module](how-to/add-a-module.md) for the workflow.

## `saasaloy remove`

```text
saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force]
```

No `owner/repo` coordinate: `remove` is fully offline and reads only local state. With no
module named it shows a picker over the installed modules. Unknown flags and extra
positionals are rejected with exit 1.

| Flag | Effect |
|---|---|
| `--dry-run` | print the plan and stop. Nothing is removed. |
| `--diff` | print the plan plus a deletion diff per file, and stop. Nothing is removed. |
| `--yes`, `-y` | skip every prompt, including the per-file drift confirmation. Drifted files then survive on disk, untracked. |
| `--force` | remove the module even though other installed modules depend on it. |

See [Remove a module](how-to/remove-a-module.md), and read
[Known limitations](#known-limitations) before assuming `remove` undoes `add`.

## `saasaloy list`

```text
saasaloy list [<owner/repo[@ref]>]
```

**`list` takes no flags.** Arguments beginning with `-` are filtered out and never
inspected. It accepts one optional coordinate naming a registry; with none it lists the
default registry. Output is names only, read from one listing of the repo's git tree, which
is why a module with an invalid descriptor still appears here and only fails at `add`.

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

## Email providers

`email` is the capability; a provider module supplies one implementation behind its
interface. Pick one before you send anything.

| Module | Needs |
|---|---|
| `email-console` | nothing. It logs the rendered message instead of sending it, so local development and tests need no plan, no domain and no API key. |
| `email-cloudflare` | a Workers **paid plan**, plus a sending domain onboarded by hand in the Cloudflare dashboard (Email Service → Email Sending). Neither is something the CLI can do or verify for you. It also patches `apps/api/wrangler.jsonc` with a `send_email` binding and registers itself in `packages/email/src/index.ts`. |

## Project files

A project uses three state files, but not from the start: `init` writes only
`saasaloy.json`, and the first `saasaloy add` creates the other two. Their keys are defined
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
`.route()` link and its import back out. For the other four kinds it drops the record from
the manifest and prints a warning naming the file, and the edit stays. Removing
`email-cloudflare` leaves the `send_email` binding in `apps/api/wrangler.jsonc` and the
provider registration in `packages/email/src/index.ts`. Revert those by hand. Skill links,
by contrast, are removed properly.

**`add` is not transactional.**
[#49](https://github.com/mimukit/saasaloy/issues/49). If `add` fails partway through, it
persists the manifest and config so the record matches what actually landed, and
re-running `add` is the intended recovery. The known rough edges: npm dependencies are
merged into `package.json` before any file is written, so a failure can leave dependencies
for a module whose code never arrived; and the lockfile is saved outside that guarantee, so
a partial apply can leave files on disk with no source, ref or commit SHA recorded in
`saasaloy-lock.json`. Nothing currently tells you that re-running is the fix.

_Verified against `main`@`48d32d7` on 2026-08-09._
