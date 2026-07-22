# Saasaloy

Ubiquitous language for Saasaloy — an open-source, composable SaaS accelerator (a CLI + module system, not a boilerplate). This is a glossary of what terms mean in this project; the settled *decisions* and their reasoning live in [`docs/adr/`](docs/adr/).

## The product

### Saasaloy
An open-source **composable SaaS accelerator**: a CLI + module system that scaffolds a near-inert base and installs everything churny — API, database, auth, admin, features — on demand, borrowing shadcn's copy-in (you-own-the-code) distribution mechanics.
_Avoid: boilerplate, starter template._

### Base
The near-inert scaffold `saasaloy init` produces: `apps/web` (Astro) + `packages/ui` + `packages/config`, and nothing churny. A thin base is the anti-rot thesis — the less there is, the less there is to rot.

### Module
A unit of capability or feature installed by `saasaloy add`.

### Capability module
A module that scaffolds an app or package **and** establishes convention-based extension points: `api`, `database`, `auth`, `admin`, `email`, and the Phase-3 set (`queue`, `storage`, `cron`, `kv`, `realtime`, `ai`, `observability`, `ratelimit`).

### Feature module
A module that drops files into a capability's conventions and declares its `dependsOn`: `waitlist`, `billing`, `teams`, `feedback`, `usage-metering`, `api-keys`, `file-uploads`, …

### Convention-based extension point
An auto-discovery folder or barrel a module drops into without patching another module's internals — `api`'s `routes/` glob, `database`'s schema barrel, and the proposed `consumers/`, `scheduled/`, `uploads/` folders. These are what make granular modules safe.
_Avoid: extension hook._

### Proof module
A feature module whose real job is to validate that the machinery generalizes: *first proof* = `waitlist`, *hard proof* = `billing`, *cheapest proof* = `feedback` (zero new capability).

### Dependency leverage
The Phase-3 prioritization axis: a capability's rank equals how many downstream features it unblocks; cheapest-to-scaffold breaks ties.

## Registry & applier

### Applier
The engine behind `saasaloy add`: it obtains a module descriptor from a [registry source](#registry-source), resolves file targets through the alias map, topologically sorts prerequisite modules, and applies files + npm deps + config patches — all `--dry-run`/`--diff`-able. Descriptors are fetched from a remote GitHub repo by default (the `readFile → fetch` swap has landed — [ADR 0012](docs/adr/0012-remote-first-registry-repo-is-the-registry.md)); a local checkout is a dev/offline override.
_Avoid: registry (the applier is the engine; the "registry" is a [registry source](#registry-source))._

### Registry source
Where the applier fetches descriptors from: a GitHub repo (`owner/repo`) by convention (`modules/<name>/registry-item.json` + `files/`), resolved to a commit SHA and fetched via giget. `SAASALOY_REGISTRY_DIR` points the applier at a local checkout for dev/offline. The repo *is* the registry — no build step, no committed index, no central submission.
_Avoid: registry server, registry service._

### Default registry
The built-in registry source (`mimukit/saasaloy`) a bare `saasaloy add <name>` resolves against. An explicit `owner/repo/name` [module coordinate](#module-coordinate) targets a third-party registry instead.

### Module coordinate
How a module is addressed on the `saasaloy add` command line: `name` (default registry) | `owner/repo/name` | `owner/repo@ref/name` (pinned branch/tag/SHA) | `owner/repo` (no module ⇒ interactive picker over that repo).

### `registry-item.json`
A module descriptor, shadcn-shaped: `files[]` (path → alias target), `dependsOn[]`, `dependencies[]` (npm), `patches`, and an `agent` block.

### Descriptor `agent` block
The descriptor field pinning the skill folder(s) a module ships: `{ "skills": ["skills/<name>"] }`.

### `saasaloy.json`
The consumer manifest in a generated project: the alias map plus the list of installed modules (which drives `dependsOn` resolution).

### `.saasaloy/manifest.json`
Managed-file tracking: each file or skill a module applied, recorded with a content hash and its owning module, so update and `remove` know exactly what to undo. Committed `AGENTS.md`/`CLAUDE.md` are **not** managed entries.

### `saasaloy-lock.json`
Machine-owned provenance at the consumer root: per installed module, its [registry source](#registry-source) + ref + resolved commit **SHA** + resolved `dependsOn` graph. The npm-style lock to `saasaloy.json`'s intent — it makes remote installs reproducible (the SHA *is* the integrity anchor), so the default ref can be a live branch rather than a hand-pinned tag.
_Avoid: putting resolved SHAs in `saasaloy.json`._

### File aliases
The descriptor's path targets: `@web` / `@api` / `@db` / `@ui` / `@admin`.

### Config-patch engine
The AST-codemod layer for the structural ~10% of edits: `magicast` for TS/JS module edits (e.g. a Better Auth plugin array) and `jsonc-parser` for `wrangler.jsonc` bindings.

### Copy-in update (`--diff`)
The update path for existing projects: hash a managed file — match → clean overwrite; drift (hand-edited) → route to AI-merge rather than clobber.
_Avoid: versioned-package update._

### AI-assisted merge
The structured, agent-consumable merge plan `--diff` emits for a drifted file — natural-language intent + target files + old/new context — handed straight to an agent CLI.

## AI-agent-native

### Agent-native project
A generated project that ships its agent context committed, so any agent tool opens it with context immediately — present on a fresh clone, no generation step.

### `AGENTS.md` / `CLAUDE.md`
Committed **static** base files carrying the fixed common project rules; `CLAUDE.md` is a one-line `@AGENTS.md` import. Neither is generated.

### Module skill (skill folder)
A module's on-demand guidance, shipped as a Claude skill folder (`skills/<name>/SKILL.md`) that `saasaloy add` **copies** into the consumer's `.claude/skills/<name>/` and records in the manifest.
_Avoid (superseded): agent fragment, `.agents/*.md` fragment, `saasaloy sync`._

## The two repos

### Tool repo
This repo (package `saasaloy-monorepo`): it develops and maintains the CLI, the base template, and the modules. It tracks its own `AGENTS.md`/`CLAUDE.md` directly and **never self-syncs**; its own dev skills are hosted `.agents/`-canonical with a `.claude/skills/` symlink.
_Avoid: generated project._

### Generated project
The downstream SaaS repo produced by `saasaloy init`.

### `.dev`
The git-ignored sandbox directory where the CLI is exercised, so running `init`/`add` never mutates the tool repo.
