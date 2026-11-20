# Architecture

For what Saasaloy is and who it is for, read [the overview](../../CONTEXT.md#overview) first.

Saasaloy is a copy-in tool, not a framework. Nothing it installs is imported from a
Saasaloy package at runtime; the CLI writes source files into your repo and then gets out
of the way. That single choice explains most of what follows.

Terms used here — module, capability, feature, provider, render, file class, coordinate — are
defined once in [`CONTEXT.md`](../../CONTEXT.md). The decisions behind the design are in
[`docs/adr/`](../adr/), one per file, linked below where they apply.

## Two repos

There is the **tool repo** (this one: the CLI, the module registry, the base template) and
there is the **generated project** (what `saasaloy init` produces on your machine). They
never merge. The tool repo does not run its own modules on itself
([ADR 0011](../adr/0011-adr-tool-repo-never-self-syncs-2026-07-22.md)).

## The CLI

`packages/cli/src/index.ts` is a bootstrap and nothing more: it calls `main()` in
`cli.ts`, which dispatches against the command registry in `commands/index.ts` and prints
help for anything else. The registry holds eleven commands, in the order help and the picker
render them: `init`, `add`, `env`, `testing`, `outdated`, `update`, `remove`, `list`,
`new`, `doctor`, `skill`. The work lives in `commands/`. The engine that writes a project lives in `engine/`, and the rest of the reusable machinery under `lib/`, split
into seams:

| Seam | File | Responsibility |
|---|---|---|
| Registry | `lib/registry.ts` | the only place that knows *where* descriptors live |
| Resolution | `lib/resolve.ts` | depth-first `dependsOn` walk, topologically ordered, cycle-detecting |
| Payload | `engine/payload.ts` | load the base template and every module of a set at one ref, from the user cache, the registry or a local checkout |
| Render | `engine/render.ts` | turn a set of modules into a map from path to bytes and class; reads no disk and no network |
| Classes | `engine/classes.ts` | the one rule that gives each rendered path its class: `generated`, `merged` or `once` |
| Apply | `engine/apply.ts` | compare the old render, the new render and the disk, and leave, write, delete, merge or report each path |
| Merge | `engine/merge.ts`, `engine/json-merge.ts` | the three-way text merge through `git merge-file`, and the merge by key for JSON files |
| Conversion | `engine/convert.ts` | turn a version 1 manifest and lock into version 2, finding each file's base by its hash |
| Backup | `lib/backup.ts` | copy each file before a run changes it, for `--abort` |
| Conflicts | `lib/conflicts.ts` | the `conflictsWith` check, read from descriptors and the lock |
| Requirements | `lib/requires.ts` | the `requiresOneOf` check — a capability naming the drivers one of which must be present |
| Design | `lib/design.ts` | detect a plan that writes `packages/ui/`, so `add` can flag the design contract |
| Patch engine | `lib/patch/` | structural edits to JSONC, `package.json` and TypeScript modules, run by the render as transforms in memory |
| Schemas | `lib/schema.ts` | ajv validation of every descriptor and state file |

The CLI ships as one binary with the base template and the JSON schemas bundled inside it
([ADR 0008](../adr/0008-adr-saasaloy-init-single-binary-2026-07-22.md)), so `init` needs no
network at all.

## The registry is the repo

`saasaloy add waitlist` resolves against `mimukit/saasaloy` on GitHub. There is no
intermediate package registry and no publish step
([ADR 0012](../adr/0012-adr-remote-first-registry-repo-is-the-registry-2026-07-23.md)).

A remote install resolves in this order:

1. **Ref to SHA, once.** The requested ref is resolved to a concrete commit SHA. With no ref, the default registry resolves the tag `v<version>` of the CLI that runs ([ADR 0062](../adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md)) and a third-party repo resolves its default branch. Every module in one install pins to that same SHA.
2. **Fetch the payload.** The registry at that SHA, `modules/` and the base template, is downloaded into the user cache, `$XDG_CACHE_HOME/saasaloy/payload/<source>@<ref>/` or `~/.cache/saasaloy/payload/<source>@<ref>/`. A later run at the same ref reads the cache and needs no network.
3. **Validate.** The descriptor is checked against `registry-item.schema.json`, and its
   `name` must match its folder.
4. **Recurse.** Each `dependsOn` name resolves as a sibling in the same source, at the same
   SHA.

`saasaloy list` is deliberately cheaper: it regexes module names out of the repo's git
tree and reads no descriptors (`--json` is the exception and reads them), which is why a syntactically broken module still appears in
the list and only fails at `add`.

Setting `SAASALOY_REGISTRY_DIR` swaps the remote source for a local `modules/` directory.
It wins over any `owner/repo` coordinate, and both `add` and `list` warn when you supply
one anyway.

## What the engine does to your project

A generated project keeps three state files, and every command derives its behaviour from
them:

| File | Holds |
|---|---|
| `saasaloy.json` | the alias map plus the list of installed modules. Also the marker that identifies the project root. |
| `saasaloy-lock.json` | `requested`, the modules you asked for; per installed module the source, the requested ref and the resolved commit SHA; plus a `base` object with the CLI version and template hash the base was rendered at. |
| `.saasaloy/manifest.json` | version 2: per file its owning module, its source path, its class, the sha256 of its raw render and the release that wrote it; plus `pendingMerges`, `pendingNotes` and `doneNotes`. |

**One operation writes every project.** `init`, `add`, `remove`, `update` and `testing <mode>` all call `apply(oldLock, newLock)` ([ADR 0066](../adr/0066-adr-one-render-and-a-three-way-merge-replace-the-add-update-and-remove-engines-2026-11-20.md)). `add X` puts X in `requested`, `remove X` takes it out, `update` moves the release, and `init` applies from nothing. The run renders both locks in memory, compares each path with the disk, and picks one action: leave, write, delete, merge or report. The result depends only on the set of modules, so two install orders give the same tree, and `add` then `remove` gives back the starting tree.

**Aliases decouple a module from your layout.** A descriptor targets
`@api/routes/waitlist.ts`; `saasaloy.json` maps `@api` to a real directory. A capability
that scaffolds a new workspace registers the alias, and the features that build on it
never learn the path.

**A file class decides what a run may do with a path** ([ADR 0067](../adr/0067-adr-a-rendered-file-is-generated-merged-or-written-once-2026-11-20.md)). A `generated` file is written in full every run, and an owner edit refuses the run. A `merged` file you edited merges three ways, by line for text and by key for `package.json`, `wrangler.jsonc`, `tsconfig.json`, `turbo.json` and `saasaloy.json`. A `once` file is written when the path is new and then left alone; the base's `seedFiles` and `ownedFiles` and a module's `seed` entries are `once`.

**A hash proves what the CLI wrote.** The manifest records the sha256 of the raw render, before Prettier. A file whose disk bytes match it was never edited, so the run may write over it. For an edited file, the base of the merge is the render of the old lock, accepted only when its hash matches, else the render at the release the record names. With no match, the merge writes two-way markers ([ADR 0068](../adr/0068-adr-a-merge-base-is-found-by-hash-in-a-user-cache-2026-11-20.md)). The engine never deletes or overwrites a file whose bytes differ from what it wrote, except a `generated` file under `--force` ([ADR 0034](../adr/0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md)).

**A conflict does not stop the run.** The file gets markers, the lock and the manifest move, the path goes into `pendingMerges`, and the run exits 3. The next `add`, `remove` or `update` refuses until no marker line remains.

**A run can be undone.** Before it writes, the run copies each file it will change through `lib/backup.ts` and writes `.saasaloy/journal.json`. It writes the project first and the manifest and the lock last, then removes the journal. A journal left behind makes every later run refuse until `--abort` restores the files.

**The lock is the reproducibility anchor.** The default registry moves as one release: every default module stands at the tag of the CLI that last updated the project, and `add` refuses when the running CLI is another release. A third-party module keeps the commit SHA its lock entry recorded until `update` moves it to the tip of its ref.

## Two tiers of module

Capabilities scaffold a workspace and establish conventions — a routes directory, a schema
barrel, a providers folder. Features drop files into those conventions and declare what
they need through `dependsOn`
([ADR 0005](../adr/0005-adr-two-tier-convention-based-modules-2026-07-22.md)). A capability
brings its vendor SDK with it and encapsulates it, so nothing else in the project imports
that SDK directly
([ADR 0020](../adr/0020-adr-capability-owns-its-vendor-packages-2026-07-24.md)).

The descriptor still knows two types, `saasaloy:capability` and `saasaloy:feature`, but a capability with more than one possible implementation splits its second half into a [provider module](../../CONTEXT.md#provider-module) or a [driver module](../../CONTEXT.md#driver-module), both typed `saasaloy:feature`. A provider adds one file to the capability's `providers/` folder and registers it with a `plugin-array` patch; several coexist, and the runtime env var `<CAP>_PROVIDER` picks one, with no default in either direction ([ADR 0033](../adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md)). `email`, `sms`, `logger`, `queue`, `kv`, `storage`, `payment` and `subscription` are on that side. A provider that needs a non-`fetch` Worker entry point registers a [handler set](../../CONTEXT.md#handler-set) through the `handlers` table in `apps/api/src/worker.ts`, never through the deploy tooling.

A driver instead **replaces** files the capability would own, so exactly one is ever installed: `database-d1` and `database-postgres` name each other in `conflictsWith`, and `database` names both in `requiresOneOf` ([ADR 0026](../adr/0026-adr-database-driver-split-2026-08-28.md)). Which side a capability lands on is a three-question test, and the deciding question is replace-files versus add-one-file ([ADR 0037](../adr/0037-adr-an-alternate-implementation-that-adds-one-file-is-a-provider-2026-09-08.md)).

Convention-based file drops cover most of what a module needs. The rest is **config
patches**: structural edits to a file some other module owns, such as adding a Worker
binding to `wrangler.jsonc` or registering a provider in an exported array. Those run
through AST-aware codemods rather than string replacement
([ADR 0010](../adr/0010-adr-config-patch-magicast-jsonc-parser-2026-07-22.md)), and are
declared as a flat array in the descriptor
([ADR 0019](../adr/0019-adr-module-patches-applied-flat-array-2026-07-24.md)). The render applies each patch to the file in memory, in dependency order and then by module name, so the result never depends on install history.

No patch has an inverse, and none needs one. `remove` renders the project without the module, so its patches are simply absent from the new render, and the three-way merge takes their lines out of each file you edited.

### The dependency graph

Select a module to see what it depends on, what depends on it, and its providers or drivers. The graph reads the descriptors, so it shows the registry as it is. The [module catalog](generated/modules.md) shows the same graph with every module.

```saasaloy-graph focus=email
email (capability): depends on api; used by email-react, subscription; providers email-cloudflare, email-console, email-plunk
```

## The base is nearly empty

`saasaloy init` writes an Astro landing page, a shared UI package, the `config` and `env` packages, the deploy and release tooling, a shared TypeScript
config and the bundled agent skills, and stops
([ADR 0003](../adr/0003-adr-base-is-landing-page-only-2026-07-22.md)). The design layer —
tokens, theme, the component styling conventions — ships in that base rather than arriving
with a later module
([ADR 0022](../adr/0022-adr-design-layer-ships-in-the-base-2026-08-06.md)), and so does its
written contract: a seeded `DESIGN.md` plus a `saasaloy-design` skill that re-derives it
when the UI changes
([ADR 0027](../adr/0027-adr-design-contract-ships-in-the-base-2026-08-28.md)). `add` plays
along: when a module's plan writes into `packages/ui/`, it prints a reminder to re-run the
skill. Everything
churny is a module you install when you need it, which is what keeps an unused capability
from aging in your repo.

The target runtime is Cloudflare throughout
([ADR 0001](../adr/0001-adr-all-in-on-cloudflare-2026-07-22.md)).

## Agent-native by construction

A generated project carries `AGENTS.md` and `CLAUDE.md` as committed, static files, and a
module that ships an agent skill installs it into `.agents/skills/` with a
`.claude/skills/` symlink pointing at it
([ADR 0007](../adr/0007-adr-agent-native-static-agents-md-copied-skills-2026-07-22.md),
[ADR 0015](../adr/0015-adr-module-skills-agents-canonical-claude-symlink-2026-07-24.md)).
After each run the engine links every folder in `.agents/skills/` and drops each `.claude/skills/` link whose folder is gone, so a removed module's link goes with its skill.

_Verified against `main`@`928b4f03` on 2026-11-19._
