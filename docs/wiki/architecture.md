# Architecture

Saasaloy is a copy-in tool, not a framework. Nothing it installs is imported from a
Saasaloy package at runtime; the CLI writes source files into your repo and then gets out
of the way. That single choice explains most of what follows.

Terms used here — module, capability, feature, provider, applier, coordinate — are
defined once in [`CONTEXT.md`](../../CONTEXT.md). The decisions behind the design are in
[`docs/adr/`](../adr/), one per file, linked below where they apply.

## Two repos

There is the **tool repo** (this one: the CLI, the module registry, the base template) and
there is the **generated project** (what `saasaloy init` produces on your machine). They
never merge. The tool repo does not run its own modules on itself
([ADR 0011](../adr/adr-0011-tool-repo-never-self-syncs-2026-07-22.md)).

## The CLI

`packages/cli/src/index.ts` is a dispatcher and nothing more: it maps four command names
to four handlers and prints help for anything else. The work lives in `commands/`, and the
reusable machinery under `lib/`, split into seams:

| Seam | File | Responsibility |
|---|---|---|
| Registry | `lib/registry.ts` | the only place that knows *where* descriptors live |
| Resolution | `lib/resolve.ts` | depth-first `dependsOn` walk, topologically ordered, cycle-detecting |
| Applier | `lib/applier.ts` | plan file writes, classify each against the manifest, execute the safe ones |
| Remover | `lib/remover.ts` | the same plan/execute split, in reverse, offline |
| Conflicts | `lib/conflicts.ts` | the `conflictsWith` check, read from descriptors and the lock |
| Design | `lib/design.ts` | detect a plan that writes `packages/ui/`, so `add` can flag the design contract |
| Patch engine | `lib/patch/` | structural edits to JSONC, `package.json` and TypeScript modules |
| Schemas | `lib/schema.ts` | ajv validation of every descriptor and state file |

The CLI ships as one binary with the base template and the JSON schemas bundled inside it
([ADR 0008](../adr/adr-0008-saasaloy-init-single-binary-2026-07-22.md)), so `init` needs no
network at all.

## The registry is the repo

`saasaloy add waitlist` resolves against `mimukit/saasaloy` on GitHub. There is no
intermediate package registry and no publish step
([ADR 0012](../adr/adr-0012-remote-first-registry-repo-is-the-registry-2026-07-23.md)).

A remote install resolves in this order:

1. **Ref to SHA, once.** The requested ref, or the repo's default branch, is resolved to a
   concrete commit SHA. Every module in one install pins to that same SHA.
2. **Fetch the subtree.** `modules/<name>/` is downloaded at that SHA into a temp
   directory.
3. **Validate.** The descriptor is checked against `registry-item.schema.json`, and its
   `name` must match its folder.
4. **Recurse.** Each `dependsOn` name resolves as a sibling in the same source, at the same
   SHA.

`saasaloy list` is deliberately cheaper: it regexes module names out of the repo's git
tree and reads no descriptors, which is why a syntactically broken module still appears in
the list and only fails at `add`.

Setting `SAASALOY_REGISTRY_DIR` swaps the remote source for a local `modules/` directory.
It wins over any `owner/repo` coordinate, and both `add` and `list` warn when you supply
one anyway.

## What the applier does to your project

A generated project keeps three state files, and every command derives its behaviour from
them:

| File | Holds |
|---|---|
| `saasaloy.json` | the alias map plus the list of installed modules. Also the marker that identifies the project root. |
| `saasaloy-lock.json` | per module, the source, the requested ref, and the resolved commit SHA. |
| `.saasaloy/manifest.json` | every file and skill link a module applied, by owning module and content hash, plus the config patches it applied. |

**Aliases decouple a module from your layout.** A descriptor targets
`@api/routes/waitlist.ts`; `saasaloy.json` maps `@api` to a real directory. A capability
that scaffolds a new workspace registers the alias, and the features that build on it
never learn the path.

**Content hashes are how the tool knows what is yours.** Before writing, the applier
compares each target against the manifest hash and classifies it: `create`, `overwrite`
(tracked and unmodified), `unchanged`, `drift` (tracked but hand-edited) or `conflict`
(exists and never ours). Only the first three are written. Drift and conflict are held
back and reported
([ADR 0006](../adr/adr-0006-copy-in-updates-manifest-hash-tracking-2026-07-22.md)).

**The lock is the reproducibility anchor.** A repeat `add` of a module already in the lock
reuses its recorded SHA instead of resolving `main` again, so the same install produces the
same bytes. The reuse is narrow: the add must name the module, carry no explicit `@ref`,
and target the same `owner/repo` the lock entry recorded, with `SAASALOY_REGISTRY_DIR`
unset. Everything else resolves the ref afresh.

## Two tiers of module

Capabilities scaffold a workspace and establish conventions — a routes directory, a schema
barrel, a providers folder. Features drop files into those conventions and declare what
they need through `dependsOn`
([ADR 0005](../adr/adr-0005-two-tier-convention-based-modules-2026-07-22.md)). A capability
brings its vendor SDK with it and encapsulates it, so nothing else in the project imports
that SDK directly
([ADR 0020](../adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)).

Convention-based file drops cover most of what a module needs. The rest is **config
patches**: structural edits to a file some other module owns, such as adding a Worker
binding to `wrangler.jsonc` or registering a provider in an exported array. Those run
through AST-aware codemods rather than string replacement
([ADR 0010](../adr/adr-0010-config-patch-magicast-jsonc-parser-2026-07-22.md)), and are
recorded flat in the manifest
([ADR 0019](../adr/adr-0019-module-patches-applied-flat-array-2026-07-24.md)).

The asymmetry to know about: a patch is applied forward by every kind, but only
`chained-route` has an inverse `remove` can run. The other four are dropped from the
manifest with a warning. See [Known limitations](reference.md#known-limitations).

## The base is nearly empty

`saasaloy init` writes an Astro landing page, a shared UI package and a shared TypeScript
config, and stops
([ADR 0003](../adr/adr-0003-base-is-landing-page-only-2026-07-22.md)). The design layer —
tokens, theme, the component styling conventions — ships in that base rather than arriving
with a later module
([ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md)), and so does its
written contract: a seeded `DESIGN.md` plus a `saasaloy-design` skill that re-derives it
when the UI changes
([ADR 0023](../adr/adr-0023-design-contract-ships-in-the-base-2026-08-28.md)). `add` plays
along: when a module's plan writes into `packages/ui/`, it prints a reminder to re-run the
skill. Everything
churny is a module you install when you need it, which is what keeps an unused capability
from aging in your repo.

The target runtime is Cloudflare throughout
([ADR 0001](../adr/adr-0001-all-in-on-cloudflare-2026-07-22.md)).

## Agent-native by construction

A generated project carries `AGENTS.md` and `CLAUDE.md` as committed, static files, and a
module that ships an agent skill installs it into `.agents/skills/` with a
`.claude/skills/` symlink pointing at it
([ADR 0007](../adr/adr-0007-agent-native-static-agents-md-copied-skills-2026-07-22.md),
[ADR 0015](../adr/adr-0015-module-skills-agents-canonical-claude-symlink-2026-07-24.md)).
Those links are tracked in the manifest, so unlike config patches they are removed when the
module is.

_Verified against `main`@`0f8b7a7` on 2026-08-30._
