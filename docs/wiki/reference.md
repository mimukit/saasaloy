# Reference

Everything the CLI declares: nine commands, their flags, the coordinate grammar, the
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
| `env` | fill in the environment variables the installed modules declare (`--check` gates a deploy) |
| `outdated` | report the base template and each installed module, current vs latest (`--check` gates CI) |
| `update` | re-apply the base template and modules at a newer version, with a merge plan for anything you edited |
| `remove` | undo a module's applied files via the manifest (offline) |
| `list` | list the modules a registry offers, marking the ones installed here |
| `new` | scaffold a new module in a registry repo (descriptor + `files/` + skill stub) |
| `doctor` | validate local module descriptors, or a project's `saasaloy.json` against its manifest |

`saasaloy help`, `saasaloy --help` and `saasaloy -h` all print the command list and exit
0. Bare `saasaloy` opens a picker over the same list on a terminal, and prints the list
and exits 0 when there is no terminal to answer it — a pipe, or CI.
`saasaloy --version`, `-v` and `version` print the installed version.
Every command also answers its own `--help` with its usage and flags.

`add`, `env`, `outdated`, `update` and `remove` are run from inside a project: they find the project root by
walking up from your working directory looking for `saasaloy.json`. `list` marks what the
current project has installed when it is run inside one, and works anywhere.

`new` is the opposite. It refuses to run inside a generated project, because it authors a module for a registry repo. `doctor` reads the path you give it and picks project mode or registry mode by whether that path carries a `saasaloy.json`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | the command did what it was asked, or you answered no to a confirmation |
| `1` | something failed, or you cancelled: a fetch died, a write threw, Ctrl-C |
| `2` | saasaloy refused by design: an unknown flag or command, a module conflict, an unmet `requiresOneOf`, an invalid state file, a `doctor` or `env --check` finding, or a prompt with no terminal to answer it in |
| `3` | `saasaloy update` only: the run applied what it could and left files waiting on a merge |

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
from the installed descriptors' `envVars` maps, one commented entry per variable. A value already in the file is never overwritten, and no key is ever removed.

The next-steps box no longer tells you to copy that file by hand. It names `saasaloy env` instead, with the line `Run saasaloy env — it prompts for each unset one and writes it to the .dev.vars or .env that reads it.` The example file stays as the checked-in record of what each variable means.

A module descriptor may declare `conflictsWith`, naming modules it refuses to sit beside.
`add` checks that list before it writes anything and exits 2 with a message naming both
modules and the `saasaloy remove` that clears the conflict. The check reads both the
incoming descriptors and `saasaloy-lock.json`, so it fires whichever module went in first,
and `--force` does not bypass it. `add` never uninstalls anything to resolve a conflict. A
module installed before its lock entry existed can't be checked this way; `add` says so and
proceeds.

Every file `add` writes is recorded in `.saasaloy/manifest.json` under the module that
applied it, and one module may not overwrite another's file. A module may write over a
file owned by a module it declares in `dependsOn` — that is how `database-d1` puts its own
`packages/db/tsconfig.json` over the one `database` scaffolds — and over nothing else. Two
modules in the same run that both write a path with no `dependsOn` edge either way are
refused before anything is written, and so is a module claiming a path an installed,
unrelated module owns. Either refusal exits 2 and names every contested path.

`--force` does not cross module file ownership. It means "re-apply the module I named",
so it re-applies that module's own files and refuses before applying anything when the
module claims a file another module owns.
The message names `saasaloy remove <other>` as the way through, because removing the
owner deletes its files and its manifest entries together, which leaves ownership
consistent for the next `add`. Swapping `database-d1` for `database-postgres` is
`saasaloy remove database-d1` then `saasaloy add database-postgres`.

A descriptor may also declare `requiresOneOf`, naming modules exactly one of which has to
be present. `add` counts an option as present when it is already installed or arrives in
the same resolved graph. When none is, an interactive run offers the list as a picker and
adds what you choose to the plan; `--yes` or a run with no terminal exits 2 and names the
options instead of choosing for you. `database` declares it, so the core can never land on
a project with no driver behind its `@repo/db/client` export.

A file entry — in `files[]` or in a scaffold's `files[]` — may declare `onlyWith`, naming
one module. `add` copies that file only when the named module is in the resolved install
set: this run's graph plus what `saasaloy.json` already records. Two entries may name the
same `target` under disjoint conditions, which is how a module ships one file per database
dialect and lets the installed driver pick. The condition is applied where `add` and
`update` share their file listing, so `update` diffs the variant the project actually
holds. When a target's entries are all conditional and none matches, `add` exits 2 and
names the target and every candidate rather than leaving the file out.

`database-d1` and `database-postgres` are the pair both fields point at today. They are
**driver modules**, two implementations of the same capability's connection layer, and a
project holds exactly one: `requiresOneOf` on the core stops it at zero, `conflictsWith` on
each driver stops it at two. The `database` core carries the tables, the schema barrel and
`db:generate`; the driver carries the client, the dialect and the migrate commands. Switch
by removing one driver and adding the other, which moves no data
([ADR 0026](../adr/0026-adr-database-driver-split-2026-08-28.md)).

`auth` and `waitlist` install under either driver. Each ships its table declarations twice,
once against `sqlite-core` and once against `pg-core`, and the descriptor's `onlyWith`
condition installs the variant matching the driver already in the project; `--dry-run`
prints which source it chose. Because that choice is made at install time, switching driver
later means removing and re-adding those modules too. See ADR 0026's 2026-08-31 amendment
and [ADR 0029](../adr/0029-adr-auth-holds-a-request-scoped-db-client-2026-08-31.md).

See [Add a module](how-to/add-a-module.md) for the workflow.

## `saasaloy env`

```text
saasaloy env [--check]
```

Fill in the variables the installed modules declare. `env` reads each installed module's descriptor at the SHA the lock resolved, flattens its `envVars` map into declarations, and prompts for every one that is not already set. A module with no lock entry, a module installed from a local checkout, or a descriptor that cannot be read is warned about and skipped, and the run continues with the modules it did read.

| Flag | Effect |
|---|---|
| `--check` | report missing variables and exit non-zero, without prompting. |

Each variable routes to a workspace and to a file inside it: a `PUBLIC_*` name lands in that workspace's `.env`, every other name lands in its `.dev.vars`. When routing finds several plausible workspaces, an interactive run asks which one reads the variable, and `--check` prints "several workspaces fit (…) — run `saasaloy env` to pick one". When routing finds none, the line reads "no target workspace found — this module wrote no files under a known alias".

A value already present is never rewritten, whatever the descriptor's `devVars` suggests. The prompt's message is the descriptor's own wording, and the descriptor's `devVars` entry becomes the prompt's default.

Before it asks for a single secret, `env` proves every target file is gitignored. A tracked target is refused with exit 2 and the message "&lt;file&gt; isn't gitignored — refusing to write a secret into a tracked file. Add it to .gitignore (the base template already does) and run again."

`env` never writes to a live account. It prints the production commands under a **Production secrets** note, one `wrangler secret put <NAME>` per non-`PUBLIC_` variable grouped by workspace, closing with "Printed, never run — copy these when you deploy." The note prints on every run, `--check` included.

Exit codes: 0 when every declared variable is set, when nothing declares one ("No module declares an environment variable."), or when the run filled the blanks in ("Environment filled in."). 2 when a target is tracked, when you cancel a prompt ("Cancelled — nothing written."), and when variables are still unset under `--check` or with no terminal, which reads "N variables still unset — run `saasaloy env` to fill them in." A session with no terminal takes the same path `--check` does, so the command never hangs on a prompt in CI.

## `saasaloy outdated`

```text
saasaloy outdated [--check]
```

Report whether anything has moved, without touching a file. The first row is the base template: the template hash `saasaloy-lock.json` recorded against the one the running CLI ships, with the recorded and running CLI versions beside it. One row per installed module follows, comparing the lock's commit SHA with what its ref resolves to now.

A base row reads `current`, `outdated`, or `untracked`. `untracked` means the project has no usable base record, which includes every project scaffolded before the record existed and a project whose lock has a `base` object but whose manifest has no tracked base entries. It is news, not drift: `outdated --check` does not fail on it, and `saasaloy update` adopts or re-adopts the base. A bare run exits 0 whatever it finds. `--check` exits 2 when the base or any module is `outdated`, so CI can gate on drift without parsing the table. An unreachable source is a row, not a throw, and it does not fail `--check` either. With `SAASALOY_REGISTRY_DIR` set, every module row reads `local` and the run warns that nothing was compared, so `--check` exits 0.

## `saasaloy update`

```text
saasaloy update [<module>|base] [--ref <ref>] [--out <path>] [--dry-run] [--diff] [--force] [--yes]
saasaloy update --abort
```

Re-apply the base template and installed modules at a newer version than `saasaloy-lock.json` records. With nothing named it considers the base and every installed module; `saasaloy update base` considers the base alone. A file you never touched is overwritten; a file you edited is left alone and routed into a **merge plan** — a document written to stdout describing what changed upstream, what you changed, and what the reconciliation has to preserve. `saasaloy update email | claude` is the designed pipeline.

The base ships inside the CLI package, so its update compares the project against the template the running CLI renders for it. There is no old template on disk to use as a merge base, so a drifted base file renders two-way, current file against the new render, with the intent line "the base template changed; keep local edits, take the upstream change". Files the template declares as seed (`DESIGN.md`, `README.md`, the landing copy, and `saasaloy.json`) are never updated. Files it declares as owned — `packages/ui/src/styles/globals.css`, everything under `blocks/`, `components/`, `containers/` and `content/`, `packages/ui/src/index.ts`, `apps/web/src/layouts/Layout.astro` and `apps/web/public/favicon.*` — are created when absent and never written again. The template hands them over once, and the upstream change reaches you through the merge plan instead. A base file another module patched, such as `apps/web/package.json` after `waitlist`, has its recorded patches re-applied after the overwrite.

Two cases stop before anything is applied. A project with no usable base record is **adopted**: each existing base file is recorded at its on-disk hash, while each missing file is recorded at the rendered template hash. The run records the running CLI, reports the adoption, and exits 0. Each adopted entry is flagged `adopted`, because the hash came off your disk and says nothing about who wrote those bytes: the next update treats every one of those files as edited and offers a merge rather than a write. Missing files are still restored. `--dry-run` reports the adoption and writes nothing. A project whose record names a newer CLI than the one running is refused with exit 2 and both versions printed; upgrade the CLI instead.

| Flag | Effect |
|---|---|
| `--ref <ref>` | update one named module to this branch, tag or SHA instead of the registry's current default branch. Needs an explicit module; a bare `update --ref` exits 2, and so does `update base --ref`. |
| `--out <path>` | write the merge plan to a file instead of stdout. Refuses a path that resolves to one of the project's own state files. |
| `--dry-run` | print the plan and stop. Nothing is written. |
| `--diff` | print the plan plus a per-file diff and stop. Nothing is written. |
| `--force` | apply even though the git working tree has uncommitted changes. Without it, a dirty tree is refused with exit 2, so `git diff` still shows what the update did. A project that is not a git repository is never blocked. |
| `--abort` | restore the newest pre-update backup and stop. Reads no registry and builds no plan. |
| `--yes`, `-y` | skip the `Proceed?` confirmation. |

The confirmation gates on **stdin**, not stdout: the merge plan goes to stdout, so a
redirect there says nothing about whether anyone is watching. Without a terminal on stdin
and without `--yes`, `update` refuses with exit 2 rather than applying unconfirmed. A
preview (`--dry-run`, `--diff`) writes nothing and is exempt.

`update` runs the same `conflictsWith` check `add` does, because a new version can
introduce a `dependsOn` on a second driver, and it reports any environment variable the new
version added that the lock has no record of.

Before it writes anything, `update` copies every file the plan will touch — plus
`saasaloy.json`, `saasaloy-lock.json`, `package.json` and `.saasaloy/manifest.json` — into
`.saasaloy/backups/<timestamp>/`, and prints the path. `saasaloy update --abort` puts that
copy back, including deleting the files the run created. The directory is gitignored.

Exit codes: 0 when there is nothing left to do, 3 when the run applied what it could and
left files waiting on a merge, 2 for a refusal, 1 for a failure.

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
| `--diff` | print the plan plus a deletion diff per file and a reversal diff per reversible patch, and stop. Nothing is removed. |
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

## `saasaloy new`

```text
saasaloy new module <name> [--type <tier>] [--depends-on <a,b>]
```

Scaffold a module in a registry repo. `module` is the only noun there is, and the picker hands off without one, so a bare `saasaloy new` means `saasaloy new module`. Any other noun exits 2 with "`saasaloy new <noun>` isn't a thing — the noun is one of: module."

| Flag | Effect |
|---|---|
| `--type <tier>` | `saasaloy:capability` or `saasaloy:feature`. Skips the tier prompt. A value that is neither exits 2. |
| `--depends-on <a,b>` | comma-separated capabilities this module needs. Skips the dependency prompt. |

Both value flags take `--type feature` and `--type=feature`. A value flag with nothing usable after it is a usage error, not a silently empty value.

It writes three paths under `modules/<name>/`: `registry-item.json`, `files/.gitkeep`, and `skills/saasaloy-<name>/SKILL.md`. The descriptor declares a `requires.saasaloy` range floored at the running CLI's own minor. The name must match `^[a-z0-9][a-z0-9-]*$`, and the folder must not already exist; either problem refuses before anything is written.

After the write, `new` runs the same checks `saasaloy doctor` runs, in process. Findings are reported, not refused: the run still exits 0 with "Scaffolded with N findings — fix <dir>/registry-item.json, then `saasaloy doctor <dir>`." A clean scaffold ends with "<name> is ready — put its payload in <dir>/files/ and write its runbook in <dir>/skills/."

Exit 2 covers an unknown argument, an unknown noun, a bad name, an existing folder, a bad `--type`, a cancelled prompt, and a missing name or tier with no terminal to ask on. It also refuses inside a generated project, because `saasaloy.json` there means a project that installs modules rather than a registry that hosts them, and nothing is written.

## `saasaloy doctor`

```text
saasaloy doctor [<path>]
```

Validate what is on disk. Nothing named checks the current directory. `doctor` picks its mode by what the path carries: a `saasaloy.json` means project mode, anything else means registry mode. It takes no flags beyond `--help` and `-h`, and it never writes.

Registry mode checks one module folder (`saasaloy doctor modules/waitlist`) or a directory of them (`saasaloy doctor modules`); a module folder is one that carries a `registry-item.json`. It prints one box per module with findings and a dim line counting how many were clean. A clean run ends with "No problems found." and exit 0. Findings exit 2, which is what makes `doctor` usable as a pre-publish gate in CI.

Project mode opens with a **Base** box: the recorded template name, the CLI version and short template hash it was recorded at, a count of files that match the record, the files that drifted, the files that are missing, and the seed files it does not check. Base drift never fails the run. An untracked base prints "untracked — no record of which template scaffolded this project." and points at `saasaloy update` to record it.

Below the base box, project mode asks three questions: a module in `installed` that owns no file in the manifest, a module that owns files but was never marked installed, and, on a project running `kv-cloudflare`, whether every registered rate limit policy has the `RL_<NAME>` binding its `consume` resolves to. No findings exits 0 with "No problems found."; findings exit 2 with "N problems in saasaloy.json."

A path that does not exist exits 2, and so does a directory with no module folders in it.

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
| `SAASALOY_REGISTRY_DIR` | `add`, `env`, `list`, `outdated`, `update` | resolve modules from a local `modules/` directory instead of GitHub. Takes precedence over any `owner/repo` in the coordinate, and `add` and `list` warn when you pass one anyway. A missing directory is an error. Under `outdated` every module row reads `local`. |
| `GITHUB_TOKEN` | `add`, `list` | authenticate GitHub API calls. Raises the rate limit from 60 to 5000 requests an hour and allows private registries. Hitting the anonymous limit produces `GitHub API rate limit hit … Set GITHUB_TOKEN to raise it.` |
| `GIGET_AUTH` | `add`, `list` | fallback for the same purpose; `GITHUB_TOKEN` wins if both are set. |
| `SAASALOY_GITHUB_API` | every command that reaches GitHub | override the GitHub API base URL. A trailing slash is stripped. It is not a GitHub Enterprise switch: nothing else in the CLI reads it, and a real GHES base would need `GIGET_GITHUB_URL` set to match. |
| `SAASALOY_DEBUG` | every command | any non-empty value prints the full `cause` chain and stack under a failure's message, instead of the message alone. Set it before you paste an error into a bug report. |

Every GitHub API call carries a 15-second timeout and no retry, so a connection that opens
and then stalls fails with a message rather than hanging. Every network failure names
`SAASALOY_REGISTRY_DIR` as the offline path.

The table above is the CLI's own environment. A module declares its own variables in its `registry-item.json` `envVars` map, and `saasaloy env` is what collects them. Seven capabilities select their implementation with a `<CAP>_PROVIDER` variable:

| Variable | Values | Required |
|---|---|---|
| `BILLING_PROVIDER` | `stripe`, `console` | yes, no default |
| `EMAIL_PROVIDER` | `cloudflare`, `plunk`, `console` | yes, no default |
| `KV_PROVIDER` | `cloudflare`, `memory` | yes, no default |
| `QUEUE_PROVIDER` | `cloudflare`, `memory` | yes, no default |
| `SMS_PROVIDER` | `console` | yes, no default |
| `STORAGE_PROVIDER` | `cloudflare`, `memory` | yes, no default |
| `LOGGER_PROVIDER` | `console` | no. Unset selects the first registered provider, and with none registered every log call is a silent no-op |

Each value names the provider module you install for it. `LOGGER_PROVIDER` is the deliberate exception to "no default in either direction": a naming typo still throws, but a missing value never does, because an outage caused by the observability layer is worse than one absent knob.

## Email providers

`email` is the capability; a provider module supplies one implementation behind its
interface. Pick one before you send anything.

| Module | Needs |
|---|---|
| `email-console` | nothing. It logs the rendered message instead of sending it, so local development and tests need no plan, no domain and no API key. |
| `email-cloudflare` | a Workers **paid plan**, plus a sending domain onboarded by hand in the Cloudflare dashboard (Compute → Email Service → Email Sending). Neither is something the CLI can do or verify for you. It declares no `envVars` of its own: the `send_email` binding it patches into `apps/api/wrangler.jsonc` is the credential. It registers itself in `packages/email/src/index.ts`. |
| `email-plunk` | a Plunk account and its **secret** `sk_...` key in `PLUNK_API_KEY`, not the public `pk_...` key, which cannot send. Nothing here needs a paid Cloudflare plan or an onboarded domain, and the same code path runs in `wrangler dev` and in production. `PLUNK_API_URL` is optional and defaults to the hosted `https://next-api.useplunk.com`; only a self-hosted Plunk instance sets it, and it must use HTTPS except on localhost. Unset `PLUNK_API_KEY`, every send throws `EmailError("provider_error")` before the request leaves the Worker. |

`EMAIL_FROM` sits on the `email` core, not on a provider. It is the default sender address, on a domain the selected provider is allowed to send from, and any message may override it.

### The other providers that need an account

| Module | Needs |
|---|---|
| `queue-cloudflare` | no API token and no secret. The `queues.producers` entries it patches into `apps/api/wrangler.jsonc` are the credential, plus the one Cron Trigger tick the schedule table needs. It declares no `envVars`. |
| `kv-cloudflare` | no API token and no secret. The `kv_namespaces` and `ratelimits` entries in `apps/api/wrangler.jsonc` are the credential, and it declares no `envVars`. Three platform limits apply and none is the module's to fix: KV is eventually consistent, with a write visible at once in its own location and up to 60 seconds later everywhere else; the TTL floor is 60 seconds, and a shorter one is refused rather than rounded up; the rate limiter counts per Cloudflare location, so a `limit` of 10 is 10 per colo. |
| `storage-cloudflare` | the `BUCKET` binding alone for every read and write. Presigned URLs need more: an R2 API token with Object Read & Write, giving `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME`. All four are optional, and with any one missing the provider reports that it cannot sign and the core hands back its own proxy URL instead, so every byte streams through the Worker. `R2_BUCKET_NAME` must name the same bucket the binding points at. |
| `billing-stripe` | a Stripe account. `STRIPE_SECRET_KEY` (`sk_test_…` in development, `sk_live_…` in production) is required once `BILLING_PROVIDER=stripe`; the client is built on first use, so a project on `BILLING_PROVIDER=console` runs the whole capability with it unset. `STRIPE_WEBHOOK_SECRET` is the signing secret of the endpoint you register at `https://dashboard.stripe.com/webhooks` pointing at `https://<your-api>/auth/stripe/webhook`; every delivery is verified against it, so an unsigned POST is refused before any handler runs. |
| `sms` | nothing for `sms-console`, which declares no `envVars`. `sms-khudebarta` needs a [Khudebarta](https://khudebarta.com/) account: `KHUDEBARTA_API_KEY` and `KHUDEBARTA_SECRET_KEY` are required, and `KHUDEBARTA_API_URL` optionally overrides the gateway URL. It sends to Bangladeshi (`+880`) numbers only and requires a sender, so `SMS_FROM` must name the sender id registered with Khudebarta. `SMS_FROM` on the core is otherwise optional: a provider routing through a pool or a messaging service assigns the sender itself, and a provider that requires one rejects a send with `invalid_message` when neither `SMS_FROM` nor the message carries a `from`. |

## Project files

A project uses three state files, and `init` writes all three. `saasaloy.json`
carries the base app in its own `base` field (`"base": "web"`), and `installed[]` holds
only the modules `saasaloy add` applied. A project scaffolded before that field existed
lists `web` in `installed[]`; the CLI lifts it into `base` the next time it writes the
file. `.saasaloy/manifest.json` records every base file under the reserved module name
`base`, and `saasaloy-lock.json` carries a `base` object naming the CLI version and the
hash of the template that rendered it. A project scaffolded before that record existed has
neither; `saasaloy update` adopts it. Their keys are defined
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

**`remove` leaves the two `package.json` patch kinds behind.**
[#36](https://github.com/mimukit/saasaloy/issues/36). `remove` undoes the five kinds that
edit a source or config file — `chained-route`, `wrangler-binding`, `plugin-array`,
`const-array` and `drizzle-column` — taking the
named import out with the edit when no other code in the file still references the
identifier. Removing `email-cloudflare` now takes the `send_email` binding out of
`apps/api/wrangler.jsonc` and the provider registration out of
`packages/email/src/index.ts`. It never reverse-patches blindly: if you edited what the
patch wrote, `remove` prints the reason, skips the file, and drops only the record.

`package-json-dependency` and `package-json-script` are the two it does not reverse. A
dependency is not safe to uninstall offline, because the lockfile does not say who else
imports it, and nothing asks for a script back. For both, `remove` drops the record from
the manifest and prints a warning naming the file. Removing `waitlist` leaves `hono` and
`@repo/api` in `apps/web/package.json`. Revert those by hand.

**`add` is not transactional.**
[#49](https://github.com/mimukit/saasaloy/issues/49). If `add` fails partway through, it
persists the manifest and config so the record matches what actually landed, and
re-running `add` is the intended recovery. The dependency merge and the lockfile write both
run after the file writes succeed, so a failed `add` no longer leaves `package.json`
advertising packages whose code never arrived. The run now says so too: a thrown apply ends on "Partial apply — the manifest, config and lock describe what landed. Re-run `saasaloy add <module>` to complete it.", and an apply left incomplete by a file that changed while the plan was open names each module and asks for the same re-run. What is still missing is the rollback of the files that did land.

_Verified against `main`@`42cbf03` on 2026-09-11._
