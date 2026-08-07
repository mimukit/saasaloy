# Saasaloy

Ubiquitous language for Saasaloy — an open-source, composable SaaS accelerator (a CLI + module system, not a boilerplate). This is a glossary of what terms mean in this project; the settled *decisions* and their reasoning live in [`docs/adr/`](docs/adr/).

## The product

### Saasaloy
An open-source **composable SaaS accelerator**: a CLI + module system that scaffolds a near-inert base and installs everything churny — API, database, auth, admin, features — on demand, borrowing shadcn's copy-in (you-own-the-code) distribution mechanics.
_Avoid: boilerplate, starter template._

### Base
The scaffold `saasaloy init` produces: `apps/web` (Astro) + `packages/ui` + `packages/tsconfig`, and nothing churny. It is inert on *functional* surfaces — no services, auth, database or network dependencies — which is where the anti-rot thesis actually bites. It is not bare, though: `packages/ui` owns the **design layer** (the Tailwind 4 theme, the vendored shadcn primitives, and the [blocks](#block) the landing page is composed from), because presentation dependencies rot aesthetically before they rot dangerously — a smaller blast radius than auth's, not an exemption from dependency auditing ([ADR 0022](docs/adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md)). Base files are a **one-time gift** — copied at `init`, never manifest-tracked, no update path.

### Block
A marketing-page composition in `packages/ui/src/blocks/` — `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer` — each entirely self-contained in one props-driven `.tsx` with its own copy defaults, and reachable only at its own `@repo/ui/blocks/<name>` subpath (never re-exported from the package root). A block composes vendored shadcn primitives; a primitive is the single control it composes. Filenames are semantic kebab-case, not shadcn's registry-style `{category}-{NN}` numbering.
_Avoid: section — that's the `sections/*.astro` file-drop extension point a module writes into. Avoid component — that's a primitive._

### Module
A unit of capability or feature installed by `saasaloy add`.

### Capability module
A module that scaffolds an app or package **and** establishes convention-based extension points: `api`, `database`, `auth`, `admin`, `email`, and the Phase-3 set (`queue`, `storage`, `cron`, `kv`, `realtime`, `ai`, `observability`, `ratelimit`). A capability built on a vendor SDK encapsulates it: the scaffolded workspace owns the npm dependency and exports project-facing utilities; no other workspace imports the vendor package directly ([ADR 0020](docs/adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)).

### Feature module
A module that drops files into a capability's conventions and declares its `dependsOn`: `waitlist`, `billing`, `teams`, `feedback`, `usage-metering`, `api-keys`, `file-uploads`, …

### Provider module
A module supplying **one implementation of a capability's provider interface**: `email-cloudflare`, `email-console`, and the planned `email-resend`. It carries a single file into the capability's `providers/` folder plus the patch that registers it, and it owns the descriptor surface that differs per provider — a binding, an npm dependency, a secret. Allowed only where the capability wraps a *stateless* third-party service ([ADR 0001](docs/adr/adr-0001-all-in-on-cloudflare-2026-07-22.md)'s 2026-08-04 amendment); the authoring guide is `.agents/skills/create-provider/`.
_Taxonomy wart, on purpose: a provider module is typed `saasaloy:feature`, because `registry-item.schema.json` constrains `type` to `saasaloy:capability | saasaloy:feature`. It isn't a feature in the sense above — it adds no user-facing behavior. A third tier would be a descriptor-format change, and one wart is cheaper than that._

### Convention-based extension point
An auto-discovery folder or barrel a module drops into without patching another module's internals — `api`'s `routes/` glob, `database`'s schema barrel, and the proposed `consumers/`, `scheduled/`, `uploads/` folders. These are what make granular modules safe.
_Avoid: extension hook._

### Proof module
A feature module whose real job is to validate that the machinery generalizes: *first proof* = `waitlist`, *hard proof* = `billing`, *cheapest proof* = `feedback` (zero new capability).

### Dependency leverage
The Phase-3 prioritization axis: a capability's rank equals how many downstream features it unblocks; cheapest-to-scaffold breaks ties.

## Registry & applier

### Applier
The engine behind `saasaloy add`: it obtains a module descriptor from a [registry source](#registry-source), resolves file targets through the alias map, topologically sorts prerequisite modules, and applies files + npm deps + config patches — all `--dry-run`/`--diff`-able. Descriptors are fetched from a remote GitHub repo by default (the `readFile → fetch` swap has landed — [ADR 0012](docs/adr/adr-0012-remote-first-registry-repo-is-the-registry-2026-07-23.md)); a local checkout is a dev/offline override.
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
The descriptor field pinning the skill folder(s) a module ships: `{ "skills": ["skills/saasaloy-<name>"] }`.

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
A module's on-demand guidance, shipped as a Claude skill folder (`skills/saasaloy-<name>/SKILL.md`) that `saasaloy add` **copies** into the consumer's `.claude/skills/saasaloy-<name>/` and records in the manifest. Every module skill is **`saasaloy-`-prefixed** (folder and frontmatter `name` alike) so it never collides with a user's own installed skills.
_Avoid (superseded): agent fragment, `.agents/*.md` fragment, `saasaloy sync`. Avoid an unprefixed module skill name (`api` → use `saasaloy-api`)._

## The two repos

### Tool repo
This repo (package `saasaloy-monorepo`): it develops and maintains the CLI, the base template, and the modules. It tracks its own `AGENTS.md`/`CLAUDE.md` directly and **never self-syncs**; its own dev skills are hosted `.agents/`-canonical with a `.claude/skills/` symlink.
_Avoid: generated project._

### Generated project
The downstream SaaS repo produced by `saasaloy init`.

### `.dev`
The git-ignored sandbox directory where the CLI is exercised, so running `init`/`add` never mutates the tool repo.
